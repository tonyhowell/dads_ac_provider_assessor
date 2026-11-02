import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { NotesError } from './interviewNotes.ts';
import { apiMessage } from './fallbacks.ts';
import { pdfToText } from './pages.ts';
import { EXTRACT_MODEL, UsageTally } from './usage.ts';
import { detectKind, mergeProviders, parseCompare, parseProviderCards, shareLink, withFlag, type MacKind, type MacProvider } from '../src/mac.ts';
import { matchCatalogue } from '../src/genLoad.ts';
import { slugify } from '../src/data/normalise.ts';
import type { Provider } from '../src/types.ts';

// My Aged Care printouts → a preview of providers and prices for the coordinator to confirm. The shortlist and
// Compare printouts are read from their text (no Claude call); a provider's details printout lays prices out in
// columns that don't survive as text, so Claude Haiku reads that PDF as it looks. Nothing is saved here.

export interface ReadFile {
  name: string;
  kind: MacKind;
  providers: number;
  error?: string;
}

export interface PreviewProvider extends MacProvider {
  /** The catalogue provider it matches (by name, or by phone), if any. */
  match: { id: string; provider: string } | null;
}

const period = z.union([z.number(), z.literal('not_offered')]).nullable();
const DetailsSchema = z.object({
  provider_name: z.string(),
  services_listed: z.array(z.string()),
  prices: z.array(
    z.object({
      service: z.string(),
      unit: z.string(),
      standard: z.number().nullable(),
      non_standard: period,
      saturday: period,
      sunday: period,
      public_holiday: period,
    }),
  ),
});

const DETAILS_SYSTEM = `You read a My Aged Care "Find a provider" page saved as a PDF: one Support at Home provider's services and costs. The page lays out each service with a small table of "Delivery period" (Standard Hours, Non-Standard Hours, Saturdays, Sundays, Public Holidays) and "Cost (per hour / per meal / per trip …)". Tables can sit beside or after their service heading, and can continue across pages: match each table to its own service heading by layout.
Return:
- provider_name as shown;
- services_listed: every service name the page lists (including the "Services that may be suitable for you" and "All services" lists), as written;
- prices: one entry per service that has a cost table, with unit ("hour", "meal", "trip"…), the Standard Hours price as a number, and each other period as a number, "not_offered", or null when not shown.
Copy numbers exactly ($92.40 → 92.4). Never guess a price that isn't on the page. Skip services with no cost table.`;

export async function readDetails(client: Anthropic, pdf: Buffer, usage = new UsageTally()): Promise<MacProvider> {
  let result;
  try {
    result = await client.beta.messages.parse(
      {
        model: EXTRACT_MODEL,
        max_tokens: 16000,
        output_config: { effort: 'low', format: betaZodOutputFormat(DetailsSchema) },
        system: DETAILS_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
              { type: 'text', text: 'Read this provider details page.' },
            ],
          },
        ],
      },
      { timeout: 5 * 60_000, maxRetries: 2 },
    );
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new NotesError(503, 'Claude features are not configured: check ANTHROPIC_API_KEY on the server.');
    if (err instanceof Anthropic.APIError) throw new NotesError(502, `Claude returned an error (${err.status ?? 'unknown'}): ${apiMessage(err)}`);
    throw err;
  }
  usage.add(EXTRACT_MODEL, result.usage);
  const out = result.parsed_output;
  if (!out) throw new NotesError(502, 'The details page could not be read. Try again.');
  return {
    name: out.provider_name.trim(),
    based_in: null,
    phone: null,
    services: [...new Set(out.services_listed.map((s) => s.trim()).filter(Boolean))],
    prices: out.prices
      .filter((p) => p.service.trim())
      .map((p) => withFlag({ service: p.service.trim(), unit: p.unit.toLowerCase().replace(/^per\s+/, ''), standard: p.standard, non_standard: p.non_standard, saturday: p.saturday, sunday: p.sunday, public_holiday: p.public_holiday })),
    from: ['details'],
  };
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** The catalogue provider a My Aged Care listing most likely is: same phone, or a matching name. */
export function findMatch(p: MacProvider, catalogue: Provider[]): Provider | null {
  const phone = digits(p.phone);
  if (phone.length >= 8) {
    const byPhone = catalogue.filter((c) => digits(c.phone) === phone);
    if (byPhone.length === 1) return byPhone[0];
    const named = byPhone.find((c) => c.provider.toLowerCase() === p.name.toLowerCase());
    if (named) return named;
  }
  const exact = catalogue.find((c) => c.provider.toLowerCase() === p.name.toLowerCase());
  return exact ?? matchCatalogue([p.name], catalogue);
}

/** Reads the uploaded printouts into one preview. */
export async function readPrintouts(files: { name: string; data: Buffer }[], catalogue: Provider[], getClient: (() => Anthropic) | undefined, toText = pdfToText) {
  const lists: MacProvider[][] = [];
  const read: ReadFile[] = [];
  let share: string | null = null;
  for (const f of files) {
    const pdf = await toText(f.data);
    if (!pdf) {
      read.push({ name: f.name, kind: 'unknown', providers: 0, error: "This doesn't look like a saved My Aged Care page (no text found). Save the page with Print → Save as PDF." });
      continue;
    }
    const kind = detectKind(pdf.text);
    try {
      let list: MacProvider[] = [];
      if (kind === 'shortlist') {
        list = parseProviderCards(pdf.text);
        share ??= shareLink(pdf.text);
      } else if (kind === 'compare') list = parseCompare(pdf.text);
      else if (kind === 'details') {
        if (!getClient) throw new NotesError(503, 'Reading a provider details page needs Claude: set ANTHROPIC_API_KEY on the server. Shortlist and Compare pages still work.');
        list = [await readDetails(getClient(), f.data)];
      } else throw new NotesError(422, "This isn't a My Aged Care shortlist, Compare or provider details page.");
      lists.push(list);
      read.push({ name: f.name, kind, providers: list.length });
    } catch (err) {
      if (!(err instanceof NotesError)) console.error('[mac-read]', f.name, err);
      read.push({ name: f.name, kind, providers: 0, error: err instanceof NotesError ? err.message : 'Unexpected error reading this file.' });
    }
  }
  const providers: PreviewProvider[] = mergeProviders(lists).map((p) => {
    const m = findMatch(p, catalogue);
    return { ...p, match: m ? { id: m.id, provider: m.provider } : null };
  });
  return { providers, files: read, share_url: share };
}

/** The catalogue record after applying a My Aged Care listing: its prices replace ours where it publishes one. */
export function applyListing(p: MacProvider, existing: Provider | null, takenIds: Set<string>, opts: { asAt: string; shareUrl: string | null; rates: Partial<Record<string, number>> }): Provider {
  const prices = existing?.mac && existing.mac.prices.length ? mergeProviders([[{ ...p, prices: existing.mac.prices, services: existing.mac.services, from: [] }], [p]])[0] : p;
  const mac = { as_at: opts.asAt, prices: prices.prices.slice(0, 120), services: prices.services.slice(0, 150), share_url: opts.shareUrl ?? existing?.mac?.share_url ?? null };
  const priced = Object.keys(opts.rates).length > 0;
  const dated = priced ? { prices_as_at: `My Aged Care, ${new Date(`${opts.asAt}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`, prices_as_at_date: opts.asAt } : {};
  if (existing) {
    return { ...existing, ...opts.rates, ...dated, mac, phone: existing.phone ?? p.phone ?? undefined, based_in: existing.based_in ?? p.based_in ?? undefined };
  }
  let id = slugify(p.name) || 'provider';
  for (let n = 2; takenIds.has(id); n++) id = `${slugify(p.name)}-${n}`;
  takenIds.add(id);
  return {
    id,
    provider: p.name,
    type: null,
    outlet: null,
    rn: null,
    en: null,
    pc: null,
    domestic: null,
    social: null,
    respite: null,
    gardening: null,
    care_mgmt: null,
    prices_as_at: 'Not published on My Aged Care',
    prices_as_at_date: null,
    veteran_fit: null,
    flags: [],
    source_url: null,
    ...opts.rates,
    ...dated,
    ...(p.phone ? { phone: p.phone } : {}),
    ...(p.based_in ? { based_in: p.based_in } : {}),
    mac,
    origin: { kind: 'mac', note: 'From a My Aged Care printout', at: opts.asAt },
  } as Provider;
}
