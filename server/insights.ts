import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Db, Queryable } from './db.ts';
import { NotesError } from './interviewNotes.ts';
import { apiMessage, withFallbacks } from './fallbacks.ts';
import { CLAIMS_MAX_AGE_DAYS, normaliseUrl } from './claims.ts';
import { EXTRACT_MODEL, RESEARCH_MODEL, UsageTally } from './usage.ts';
import type { Provider } from '../src/types.ts';

// Insight into each provider (improvement plan 2.2):
// - Quality and compliance: Claude Sonnet searches the Aged Care Quality and Safety Commission's site for the
//   provider's findings, sanctions and notices; Claude Haiku structures them, keeping only links it retrieved.
//   Public information, shared by every application, checked again after 60 days.
// - Ask Claude about them: a fresh web search for each question, answered with its sources, kept per application.

const REQUEST = { timeout: 10 * 60_000, maxRetries: 3 };
const COMMISSION = ['agedcarequality.gov.au'];

export const ComplianceSchema = z.object({
  summary: z.string().max(1500),
  /** True when the search found the provider on the Commission's site with nothing against it. */
  none_found: z.boolean(),
  findings: z
    .array(
      z.object({
        kind: z.enum(['sanction', 'non_compliance', 'notice', 'audit', 'other']),
        date: z.string().max(40).nullable(),
        text: z.string().max(600),
        source_url: z.string().max(2000),
        source_title: z.string().max(300),
      }),
    )
    .max(40),
});
export type Compliance = z.infer<typeof ComplianceSchema>;

export interface ComplianceRow {
  provider_id: string;
  status: 'running' | 'ready' | 'failed';
  result: (Compliance & { checked_pages: number }) | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
const toRow = (r: Record<string, unknown>): ComplianceRow => ({
  provider_id: r.provider_id as string,
  status: r.status as ComplianceRow['status'],
  result: r.result ? json(r.result) : null,
  error: (r.error as string | null) ?? null,
  started_at: iso(r.started_at)!,
  finished_at: iso(r.finished_at),
});

export async function listCompliance(db: Queryable): Promise<ComplianceRow[]> {
  return (await db.query('SELECT * FROM provider_compliance ORDER BY provider_id')).map(toRow);
}

/** Starts a check unless one is running or a fresh one exists (without `refresh`). */
export async function claimCompliance(db: Db, providerId: string, refresh: boolean): Promise<{ row: ComplianceRow; start: boolean }> {
  return db.transaction(async (tx) => {
    await tx.query(`INSERT INTO provider_compliance (provider_id, status, started_at) VALUES ($1, 'failed', now() - interval '1 year') ON CONFLICT (provider_id) DO NOTHING`, [providerId]);
    const row = toRow((await tx.query('SELECT * FROM provider_compliance WHERE provider_id = $1 FOR UPDATE', [providerId]))[0]);
    const now = Date.now();
    const running = row.status === 'running' && now - new Date(row.started_at).getTime() < 20 * 60_000;
    const fresh = row.status === 'ready' && !!row.finished_at && now - new Date(row.finished_at).getTime() < CLAIMS_MAX_AGE_DAYS * 86_400_000;
    if (running || (fresh && !refresh)) return { row, start: false };
    const [updated] = await tx.query(`UPDATE provider_compliance SET status = 'running', error = NULL, started_at = now() WHERE provider_id = $1 RETURNING *`, [providerId]);
    return { row: toRow(updated), start: true };
  });
}

function apiError(err: unknown): never {
  if (err instanceof NotesError) throw err;
  if (err instanceof Anthropic.AuthenticationError) throw new NotesError(503, 'Claude features are not configured: check ANTHROPIC_API_KEY on the server.');
  if (err instanceof Anthropic.RateLimitError) throw new NotesError(429, 'Claude is busy. Try again in a minute.');
  if (err instanceof Anthropic.APIConnectionError) throw new NotesError(502, 'Could not reach Claude. Try again.');
  if (err instanceof Anthropic.APIError) {
    console.error('[claude]', err.status, apiMessage(err));
    throw new NotesError(502, `Claude returned an error (${err.status ?? 'unknown'}): ${apiMessage(err)}`);
  }
  throw err;
}

interface Searched {
  text: string;
  /** Retrieved pages: normalised URL → { url, title }. */
  seen: Map<string, { url: string; title: string }>;
  /** Pages the answer cites. */
  cited: Map<string, { url: string; title: string }>;
}

/** A web search with Claude Sonnet, resuming when it pauses, collecting what it retrieved and cited. */
async function search(client: Anthropic, system: string, prompt: string, usage: UsageTally, allowedDomains?: string[]): Promise<Searched> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
  const seen = new Map<string, { url: string; title: string }>();
  const cited = new Map<string, { url: string; title: string }>();
  let text = '';
  try {
    for (let turn = 0; turn < 5; turn++) {
      const message = await withFallbacks((extra) =>
        client.beta.messages
          .stream(
            {
              model: RESEARCH_MODEL,
              max_tokens: 16000,
              ...extra,
              output_config: { effort: 'low' },
              system,
              tools: [
                { type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'AU' }, ...(allowedDomains ? { allowed_domains: allowedDomains } : {}) },
                { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6, ...(allowedDomains ? { allowed_domains: allowedDomains } : {}) },
              ],
              messages,
            },
            REQUEST,
          )
          .finalMessage(),
      );
      usage.add(RESEARCH_MODEL, message.usage);
      for (const block of message.content) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === 'web_search_result') seen.set(normaliseUrl(r.url), { url: r.url, title: r.title ?? r.url });
        }
        if (block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result') {
          seen.set(normaliseUrl(block.content.url), { url: block.content.url, title: block.content.content.title ?? block.content.url });
        }
        if (block.type === 'text') {
          text += block.text;
          for (const c of block.citations ?? []) {
            const url = 'url' in c ? (c.url as string) : null;
            if (url) cited.set(normaliseUrl(url), { url, title: ('title' in c && (c.title as string)) || url });
          }
        }
      }
      if (message.stop_reason === 'refusal') throw new NotesError(422, 'Claude declined this search.');
      if (message.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: message.content });
    }
  } catch (err) {
    apiError(err);
  }
  return { text, seen, cited };
}

const COMPLIANCE_SYSTEM = `You check the Aged Care Quality and Safety Commission's public information about an Australian aged care provider, for a family choosing a home care provider. Search agedcarequality.gov.au for the provider: sanctions, notices of non-compliance, compliance notices, directions, audit and quality review findings. Report what the pages say, with dates. If the provider appears with nothing against it, say so. If you can't find the provider at all, say that. Never infer.`;

const STRUCTURE_SYSTEM = `You turn notes about a provider's Aged Care Quality and Safety Commission record into structured data. Use only what's in the notes; each finding needs a source URL from the list of retrieved pages. Set none_found to true only if the notes say the provider was found with nothing against it.`;

export async function checkCompliance(client: Anthropic, provider: Provider, usage = new UsageTally()): Promise<Compliance & { checked_pages: number }> {
  const found = await search(client, COMPLIANCE_SYSTEM, `Provider: ${provider.provider}${provider.outlet ? `\nOutlets: ${provider.outlet}` : ''}${provider.type ? `\nType: ${provider.type}` : ''}`, usage, COMMISSION);
  if (!found.text.trim()) throw new NotesError(502, 'The compliance search came back empty. Try again later.');
  let structured;
  try {
    structured = await client.beta.messages.parse(
      {
        model: EXTRACT_MODEL,
        max_tokens: 8000,
        output_config: { effort: 'low', format: betaZodOutputFormat(ComplianceSchema) },
        system: STRUCTURE_SYSTEM,
        messages: [{ role: 'user', content: `Retrieved pages:\n${[...found.seen.values()].map((p) => `- ${p.url} (${p.title})`).join('\n') || '(none)'}\n\n<notes>\n${found.text}\n</notes>` }],
      },
      { timeout: 5 * 60_000, maxRetries: 3 },
    );
  } catch (err) {
    apiError(err);
  }
  usage.add(EXTRACT_MODEL, structured.usage);
  if (structured.stop_reason === 'refusal' || !structured.parsed_output) throw new NotesError(502, 'The compliance findings could not be structured.');
  const out = structured.parsed_output;
  return { ...out, findings: out.findings.filter((f) => found.seen.has(normaliseUrl(f.source_url))), checked_pages: found.seen.size };
}

export async function finishCompliance(db: Queryable, providerId: string, result: { result: Compliance & { checked_pages: number } } | { error: string }) {
  if ('result' in result) await db.query(`UPDATE provider_compliance SET status = 'ready', result = $2::jsonb, error = NULL, finished_at = now() WHERE provider_id = $1`, [providerId, JSON.stringify(result.result)]);
  else await db.query(`UPDATE provider_compliance SET status = 'failed', error = $2, finished_at = now() WHERE provider_id = $1`, [providerId, result.error]);
}

// ---- Ask Claude about them ----

export interface ProviderQuestion {
  id: string;
  provider_id: string;
  question: string;
  answer: string;
  sources: { url: string; title: string }[];
  asked_by: string | null;
  created_at: string;
}

const ASK_SYSTEM = `You answer a family's question about an Australian Support at Home (in-home aged care) provider by searching the web: the provider's own website and price list first, then My Aged Care and other reputable sources. Answer in two or three plain sentences, citing the pages you used. If you can't find the answer, say so and suggest asking the provider at interview. Never guess.`;

export async function askAboutProvider(client: Anthropic, provider: Provider, question: string, usage = new UsageTally()): Promise<{ answer: string; sources: { url: string; title: string }[] }> {
  const known = [provider.outlet && `Outlets: ${provider.outlet}`, provider.website && `Website: ${provider.website}`, provider.source_url && `Price list: ${provider.source_url}`].filter(Boolean).join('\n');
  const found = await search(client, ASK_SYSTEM, `Provider: ${provider.provider}\n${known}\n\nQuestion: ${question}`, usage);
  const answer = found.text.trim() || "Claude couldn't find an answer in their published information. Ask them at interview.";
  // Sources: the pages the answer cites; if it cites none, the pages it retrieved.
  const sources = [...(found.cited.size ? found.cited : found.seen).values()].slice(0, 8);
  return { answer, sources };
}

const toQuestion = (r: Record<string, unknown>): ProviderQuestion => ({
  id: r.id as string,
  provider_id: r.provider_id as string,
  question: r.question as string,
  answer: r.answer as string,
  sources: json(r.sources),
  asked_by: (r.asked_by as string | null) ?? null,
  created_at: iso(r.created_at)!,
});

export async function listQuestions(db: Queryable, applicationId: string, providerId?: string): Promise<ProviderQuestion[]> {
  const rows = providerId
    ? await db.query('SELECT * FROM provider_questions WHERE application_id = $1 AND provider_id = $2 ORDER BY created_at', [applicationId, providerId])
    : await db.query('SELECT * FROM provider_questions WHERE application_id = $1 ORDER BY created_at', [applicationId]);
  return rows.map(toQuestion);
}

export async function saveQuestion(db: Queryable, q: Omit<ProviderQuestion, 'id' | 'created_at'> & { application_id: string }): Promise<ProviderQuestion> {
  const id = randomUUID();
  const [row] = await db.query(
    `INSERT INTO provider_questions (id, application_id, provider_id, question, answer, sources, asked_by) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING *`,
    [id, q.application_id, q.provider_id, q.question, q.answer, JSON.stringify(q.sources), q.asked_by],
  );
  return toQuestion(row);
}
