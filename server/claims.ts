import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { Db, Queryable } from './db.ts';
import { ClaimsSchema } from '../src/schemas.ts';
import type { Claims, Provider } from '../src/types.ts';
import { MODEL, NotesError } from './interviewNotes.ts';

// What each provider says publicly about the interview topics. Researched by Claude with web search and
// web fetch, then structured in a second step that keeps only links the search actually returned.
// Public information, so one result serves every application; searched again after 60 days or on request.

export const CLAIMS_MAX_AGE_DAYS = 60;
/** A search still "running" after this long died with a server restart; it can be started again. */
const RUNNING_STALE_MS = 20 * 60 * 1000;

export interface ClaimsRow {
  provider_id: string;
  status: 'running' | 'ready' | 'failed';
  claims: Claims | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Topic {
  id: string;
  text: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const toRow = (r: Record<string, unknown>): ClaimsRow => ({
  provider_id: r.provider_id as string,
  status: r.status as ClaimsRow['status'],
  claims: r.claims ? ((typeof r.claims === 'string' ? JSON.parse(r.claims) : r.claims) as Claims) : null,
  error: (r.error as string | null) ?? null,
  started_at: iso(r.started_at)!,
  finished_at: iso(r.finished_at),
});

export async function listClaims(db: Queryable): Promise<ClaimsRow[]> {
  return (await db.query('SELECT * FROM provider_claims ORDER BY provider_id')).map(toRow);
}

export async function getClaims(db: Queryable, providerId: string): Promise<ClaimsRow | undefined> {
  const [row] = await db.query('SELECT * FROM provider_claims WHERE provider_id = $1', [providerId]);
  return row ? toRow(row) : undefined;
}

export const isFresh = (row: ClaimsRow, now = Date.now()) =>
  row.status === 'ready' && !!row.finished_at && now - new Date(row.finished_at).getTime() < CLAIMS_MAX_AGE_DAYS * 86_400_000;
const isRunning = (row: ClaimsRow, now = Date.now()) => row.status === 'running' && now - new Date(row.started_at).getTime() < RUNNING_STALE_MS;

/**
 * Starts a search unless a fresh result exists (and no refresh was asked for) or one is already running.
 * Returns the row as it now stands and whether the caller should run the search.
 */
export async function claimSearch(db: Db, providerId: string, userId: string, refresh: boolean): Promise<{ row: ClaimsRow; start: boolean }> {
  return db.transaction(async (tx) => {
    await tx.query(`INSERT INTO provider_claims (provider_id, status, requested_by, started_at) VALUES ($1, 'failed', $2, now()) ON CONFLICT (provider_id) DO NOTHING`, [providerId, userId]);
    const [locked] = await tx.query('SELECT * FROM provider_claims WHERE provider_id = $1 FOR UPDATE', [providerId]);
    const row = toRow(locked);
    const fresh = row.claims !== null && isFresh(row);
    if (isRunning(row) || (fresh && !refresh)) return { row, start: false };
    const [updated] = await tx.query(
      `UPDATE provider_claims SET status = 'running', error = NULL, requested_by = $2, started_at = now() WHERE provider_id = $1 RETURNING *`,
      [providerId, userId],
    );
    return { row: toRow(updated), start: true };
  });
}

export async function finishSearch(db: Queryable, providerId: string, result: { claims: Claims } | { error: string }): Promise<void> {
  if ('claims' in result) {
    await db.query(`UPDATE provider_claims SET status = 'ready', claims = $2::jsonb, error = NULL, finished_at = now() WHERE provider_id = $1`, [providerId, JSON.stringify(result.claims)]);
  } else {
    // A failed refresh keeps the previous claims, so the family still sees what was found before.
    await db.query(`UPDATE provider_claims SET status = 'failed', error = $2, finished_at = now() WHERE provider_id = $1`, [providerId, result.error]);
  }
}

const RESEARCH_SYSTEM = `You research what an Australian Support at Home (aged care) provider says publicly about itself, for a family preparing to interview it. Search the web and read the provider's own pages first (website, service pages, price list, policies, veterans or DVA pages), then reputable third-party sources (My Aged Care listings, the Aged Care Quality and Safety Commission, news).

For each interview topic you're given, report what the provider claims, if anything:
- Give the claim in plain words, a short exact quote, and the URL of the page it came from.
- Say whether the claim fully answers the topic or only partly.
- Report only what a page you actually retrieved says. Never infer, guess, or fill gaps from general knowledge; if nothing was found for a topic, leave it out.
- These are claims, not facts: the family will ask the provider to confirm them in writing.
Finish with a short overview of what the provider says about itself overall, and its main website.`;

function researchPrompt(provider: Provider, topics: Topic[]): string {
  const known = [provider.outlet && `Outlet: ${provider.outlet}`, provider.type && `Type: ${provider.type}`, provider.source_url && `Price list or listing: ${provider.source_url}`].filter(Boolean).join('\n');
  return `Provider: ${provider.provider}\n${known}\n\nInterview topics (id: topic):\n${topics.map((t) => `${t.id}: ${t.text}`).join('\n')}`;
}

const STRUCTURE_SYSTEM = `You turn research notes about an aged care provider's public claims into structured data. Use only claims present in the notes. Each item needs a source URL from the list of retrieved pages; leave out any claim without one. Keep quotes exact and short. Use the topic ids given.`;

const normalise = (u: string) => u.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

function apiError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) throw new NotesError(503, 'Research is not configured: check ANTHROPIC_API_KEY on the server.');
  if (err instanceof Anthropic.RateLimitError) throw new NotesError(429, 'The research service is busy. Try again in a few minutes.');
  if (err instanceof Anthropic.APIConnectionError) throw new NotesError(502, 'Could not reach the research service.');
  if (err instanceof Anthropic.APIError) throw new NotesError(502, `The research service returned an error (${err.status ?? 'unknown'}).`);
  throw err;
}

/** Researches one provider. `client` is injected so tests can use a fake. */
export async function researchClaims(client: Anthropic, provider: Provider, topics: Topic[]): Promise<Claims> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: researchPrompt(provider, topics) }];
  const seen = new Map<string, string>();
  let notes = '';
  try {
    // Server tools run on Anthropic's side; a long search can pause, so resume a few times.
    for (let turn = 0; turn < 5; turn++) {
      const message = await client.beta.messages
        .stream({
          model: MODEL,
          max_tokens: 32000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          system: RESEARCH_SYSTEM,
          tools: [
            { type: 'web_search_20260209', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'AU' } },
            { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 10 },
          ],
          messages,
        })
        .finalMessage();
      for (const block of message.content) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === 'web_search_result') seen.set(normalise(r.url), r.title ?? r.url);
        }
        if (block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result') {
          seen.set(normalise(block.content.url), block.content.content.title ?? block.content.url);
        }
        if (block.type === 'text') notes += block.text;
      }
      if (message.stop_reason === 'refusal') throw new NotesError(422, 'The research service declined to research this provider.');
      if (message.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: message.content });
    }
  } catch (err) {
    if (err instanceof NotesError) throw err;
    apiError(err);
  }
  if (!notes.trim()) throw new NotesError(502, 'The research came back empty. Try again later.');

  let structured;
  try {
    structured = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(ClaimsSchema) },
      system: STRUCTURE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Topic ids: ${topics.map((t) => t.id).join(', ')}\n\nRetrieved pages:\n${[...seen].map(([u, t]) => `- ${u} (${t})`).join('\n') || '(none)'}\n\n<notes>\n${notes}\n</notes>`,
        },
      ],
    });
  } catch (err) {
    apiError(err);
  }
  if (structured.stop_reason === 'refusal') throw new NotesError(422, 'The research service declined to structure these claims.');
  if (!structured.parsed_output) throw new NotesError(502, 'The research came back incomplete. Try again later.');
  const ids = new Set(topics.map((t) => t.id));
  const claims = structured.parsed_output;
  // Keep only claims about known topics with a link the search actually returned.
  return { ...claims, items: claims.items.filter((i) => ids.has(i.question_id) && seen.has(normalise(i.source_url))) };
}
