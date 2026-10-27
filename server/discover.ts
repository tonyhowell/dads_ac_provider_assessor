import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { NotesError } from './interviewNotes.ts';
import { EXTRACT_MODEL, RESEARCH_MODEL, UsageTally } from './usage.ts';
import { normaliseUrl } from './claims.ts';
import { withFallbacks } from './fallbacks.ts';
import type { Provider } from '../src/types.ts';

// Finding providers: a web search (Claude Sonnet 5.5, the cheapest model with web search and fetch) for
// Support at Home providers serving an area, then a structuring step (Claude Haiku 5.5) that keeps only
// links the search actually returned. Also used for one provider at a time, to find a missing price list.

export interface Area {
  postcode: string;
  suburb: string;
}
export const areaLabel = (a: Area) => [a.suburb, a.postcode].filter(Boolean).join(' ');

export const FoundProvidersSchema = z.object({
  providers: z
    .array(
      z.object({
        name: z.string().max(200),
        website: z.string().max(2000).nullable(),
        /** Their published Support at Home price list (a page or PDF). */
        price_list_url: z.string().max(2000).nullable(),
        /** The page that shows they serve the area. */
        evidence_url: z.string().max(2000),
        note: z.string().max(300),
      }),
    )
    .max(60),
});
export type FoundProvider = z.infer<typeof FoundProvidersSchema>['providers'][number];

const AREA_SYSTEM = `You find Australian Support at Home (in-home aged care) providers that serve a given suburb and postcode, for a family choosing one. Search the web: My Aged Care's Find a provider, provider websites, and local listings. For each provider that serves the area, find its main website and its published Support at Home price list (providers must publish one; it's often a PDF or a "pricing" page). Report only providers and links you actually found on pages you retrieved. Skip residential-only aged care homes.`;

const PRICE_LIST_SYSTEM = `You find an Australian Support at Home (in-home aged care) provider's published Support at Home price list (a page or PDF; providers must publish one) and its main website. Search the web and check the pages you find. Report only links you actually retrieved.`;

const STRUCTURE_SYSTEM = `You turn research notes about Support at Home providers into structured data. Use only providers and links in the notes. Every URL must come from the list of retrieved pages; use null when there isn't one. Keep names as the provider uses them.`;

const REQUEST = { timeout: 10 * 60_000, maxRetries: 3 };

async function searchAndStructure(client: Anthropic, system: string, prompt: string, usage: UsageTally, maxSearches: number): Promise<FoundProvider[]> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
  const seen = new Map<string, string>();
  let notes = '';
  for (let turn = 0; turn < 5; turn++) {
    const message = await withFallbacks((extra) => client.beta.messages
      .stream(
        {
          model: RESEARCH_MODEL,
          max_tokens: 16000,
          ...extra,
          output_config: { effort: 'low' },
          system,
          tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches, user_location: { type: 'approximate', country: 'AU' } },
            { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: maxSearches + 2 },
          ],
          messages,
        },
        REQUEST,
      )
      .finalMessage());
    usage.add(RESEARCH_MODEL, message.usage);
    for (const block of message.content) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === 'web_search_result') seen.set(normaliseUrl(r.url), r.url);
      }
      if (block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result') seen.set(normaliseUrl(block.content.url), block.content.url);
      if (block.type === 'text') notes += block.text;
    }
    if (message.stop_reason === 'refusal') throw new NotesError(422, 'Claude declined this search.');
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }
  if (!notes.trim()) return [];
  const structured = await client.beta.messages.parse(
    {
      model: EXTRACT_MODEL,
      max_tokens: 8000,
      output_config: { effort: 'low', format: betaZodOutputFormat(FoundProvidersSchema) },
      system: STRUCTURE_SYSTEM,
      messages: [{ role: 'user', content: `Retrieved pages:\n${[...seen.values()].map((u) => `- ${u}`).join('\n') || '(none)'}\n\n<notes>\n${notes}\n</notes>` }],
    },
    { timeout: 5 * 60_000, maxRetries: 3 },
  );
  usage.add(EXTRACT_MODEL, structured.usage);
  if (structured.stop_reason === 'refusal' || !structured.parsed_output) throw new NotesError(502, 'The search results could not be structured.');
  const known = (u: string | null) => (u && seen.has(normaliseUrl(u)) ? seen.get(normaliseUrl(u))! : null);
  return structured.parsed_output.providers
    .map((p) => ({ ...p, website: known(p.website), price_list_url: known(p.price_list_url), evidence_url: known(p.evidence_url) ?? '' }))
    .filter((p) => p.name.trim() && (p.evidence_url || p.website || p.price_list_url));
}

/** Providers serving an area, with their websites and price lists where found. */
export function findProvidersInArea(client: Anthropic, area: Area, known: Provider[], usage: UsageTally): Promise<FoundProvider[]> {
  const prompt = `Area: ${areaLabel(area)}, Australia\n\nAlready known (still report them if they serve the area, with any website or price list you find):\n${known.map((p) => `- ${p.provider}`).join('\n') || '(none)'}`;
  return searchAndStructure(client, AREA_SYSTEM, prompt, usage, 8);
}

/** One provider's price list and website. */
export async function findPriceList(client: Anthropic, provider: Provider, usage: UsageTally): Promise<{ price_list_url: string | null; website: string | null }> {
  const prompt = `Provider: ${provider.provider}${provider.outlet ? `\nOutlets: ${provider.outlet}` : ''}${provider.locations?.length ? `\nLocations: ${provider.locations.slice(0, 5).join('; ')}` : ''}${provider.website ? `\nWebsite: ${provider.website}` : ''}`;
  const found = await searchAndStructure(client, PRICE_LIST_SYSTEM, prompt, usage, 3);
  const best = found.find((f) => f.price_list_url) ?? found[0];
  return { price_list_url: best?.price_list_url ?? null, website: best?.website ?? null };
}
