import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Db, Queryable } from './db.ts';
import { checkPage, forgetPage, type Fetcher, type PageCheck, type PageContent } from './pages.ts';
import { EXTRACT_MODEL, UsageTally } from './usage.ts';
import { NotesError } from './interviewNotes.ts';
import {
  CLAIMS_MAX_AGE_DAYS,
  claimSearch,
  finishSearch,
  FULL_RESEARCH_DAYS,
  getClaims,
  isFresh,
  normaliseUrl,
  releaseSearch,
  rereadClaimPages,
  researchClaims,
  type ClaimsRow,
  type Topic,
} from './claims.ts';
import { createSuggestion, listSuggestions } from './catalogue.ts';
import { RATE_KEYS } from '../src/schemas.ts';
import { latestDateIn } from '../src/data/normalise.ts';
import type { Claims, Provider, RateKey } from '../src/types.ts';

// Data enrichment: run now and then (on a schedule, from the admin page or the command line) to keep the
// provider catalogue and public claims current at the lowest cost.
//
// 1. Price lists: each provider's published price page is fetched and hashed. Only a page that changed is
//    read, by Claude Haiku 5.5, and any price that differs from the catalogue becomes a suggestion for a
//    site admin to approve. Nothing is changed automatically.
// 2. Extra sources: pages the admins add (registers, government lists, notices) are checked the same way.
//    When one changes, Haiku summarises what it says about the catalogue's providers, for an admin to read.
// 3. Public claims older than 60 days, cheapest first:
//    - re-fetch the pages the claims came from; if none changed, the claims are confirmed as current (no model);
//    - if some changed, Haiku re-reads just those pages;
//    - only when there's nothing to go on (first time, pages gone, or the last full search is 180+ days old)
//      does a full web search run, with Claude Sonnet 5.5 — and at most `maxResearch` of those per run.

export type EnrichPart = 'prices' | 'sources' | 'claims';
export const ENRICH_PARTS: EnrichPart[] = ['prices', 'sources', 'claims'];

export interface EnrichDeps {
  db: Db;
  getAnthropic: () => Anthropic;
  /** The catalogue as it stands (seed data plus admin edits). */
  providers: () => Promise<Provider[]>;
  topics: Topic[];
  fetcher?: Fetcher;
}

export interface EnrichOptions {
  trigger: 'schedule' | 'admin' | 'cli';
  parts?: EnrichPart[];
  /** Most full web searches in one run. */
  maxResearch?: number;
  /** Only these providers (all when omitted). */
  providerIds?: string[];
}

interface Counts {
  checked: number;
  unchanged: number;
  changed: number;
  errors: number;
}

export interface RunStats {
  prices: Counts & { suggestions: number; matched: number };
  sources: Counts & { summarised: number };
  claims: { due: number; revalidated: number; reread: number; researched: number; deferred: number; failed: number };
}

export interface EnrichmentRun {
  id: string;
  trigger: string;
  status: 'running' | 'done' | 'failed';
  stats: Partial<RunStats>;
  usage: ReturnType<UsageTally['toJSON']> | Record<string, never>;
  log: string[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export class EnrichmentBusyError extends Error {}

/** A run still "running" after this long died with a restart. */
const STALE_RUN_HOURS = 3;
const MAX_LOG = 300;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

const toRun = (r: Record<string, unknown>): EnrichmentRun => ({
  id: r.id as string,
  trigger: r.trigger as string,
  status: r.status as EnrichmentRun['status'],
  stats: json(r.stats),
  usage: json(r.usage),
  log: json(r.log),
  error: (r.error as string | null) ?? null,
  started_at: iso(r.started_at)!,
  finished_at: iso(r.finished_at),
});

export async function listRuns(db: Queryable, limit = 20): Promise<EnrichmentRun[]> {
  return (await db.query('SELECT * FROM enrichment_runs ORDER BY started_at DESC LIMIT $1', [limit])).map(toRun);
}

// ---- Extra sources ----

export interface EnrichmentSource {
  id: string;
  name: string;
  url: string;
  note: string;
  active: boolean;
  summary: SourceSummary | null;
  summary_at: string | null;
  created_at: string;
}

const toSource = (r: Record<string, unknown>): EnrichmentSource => ({
  id: r.id as string,
  name: r.name as string,
  url: r.url as string,
  note: r.note as string,
  active: r.active as boolean,
  summary: r.summary ? json<SourceSummary>(r.summary) : null,
  summary_at: iso(r.summary_at),
  created_at: iso(r.created_at)!,
});

export async function listSources(db: Queryable): Promise<EnrichmentSource[]> {
  return (await db.query('SELECT * FROM enrichment_sources ORDER BY created_at')).map(toSource);
}

export async function addSource(db: Queryable, input: { name: string; url: string; note: string }, userId: string): Promise<EnrichmentSource> {
  const id = randomUUID();
  await db.query('INSERT INTO enrichment_sources (id, name, url, note, created_by) VALUES ($1, $2, $3, $4, $5)', [id, input.name.trim(), input.url.trim(), input.note.trim(), userId]);
  return toSource((await db.query('SELECT * FROM enrichment_sources WHERE id = $1', [id]))[0]);
}

export async function updateSource(db: Queryable, id: string, patch: { active?: boolean }): Promise<boolean> {
  const rows = await db.query('UPDATE enrichment_sources SET active = COALESCE($2, active) WHERE id = $1 RETURNING id', [id, patch.active ?? null]);
  return rows.length > 0;
}

export async function removeSource(db: Queryable, id: string): Promise<boolean> {
  return (await db.query('DELETE FROM enrichment_sources WHERE id = $1 RETURNING id', [id])).length > 0;
}

// ---- Extraction with Claude Haiku 5.5 ----

const rateShape = Object.fromEntries(RATE_KEYS.map((k) => [k, z.number().nonnegative().nullable()])) as Record<RateKey, z.ZodNullable<z.ZodNumber>>;

export const PriceListSchema = z.object({
  /** False when the page isn't a Support at Home price list (moved, or now a different page). */
  is_price_list: z.boolean(),
  /** The date the prices apply from, as the page states it. */
  prices_as_at: z.string().max(200).nullable(),
  rates: z.object(rateShape),
  /** Fees, minimums or conditions stated on the page, in a few words each. */
  notes: z.array(z.string().max(300)).max(20),
});
export type PriceList = z.infer<typeof PriceListSchema>;

const PRICE_SYSTEM = `You read an Australian Support at Home (aged care) provider's published price list and extract its standard hourly prices, in Australian dollars including GST if shown.

Use the standard weekday daytime hourly rate for each service:
- rn: registered nurse (nursing care by an RN)
- en: enrolled nurse
- pc: personal care
- domestic: domestic assistance (cleaning, household tasks)
- social: individual social support
- respite: in-home respite
- gardening: gardening or home maintenance
- care_mgmt: care management, as an hourly rate only if one is stated

Give null for any service the page doesn't price, or prices only per visit, per km or as a package. Never estimate or infer a price. Copy the date the prices apply from, as written. List fees, minimum visit lengths or charges (travel, admin, cancellation) in notes. If the page isn't a Support at Home price list, set is_price_list to false.`;

export const SourceSummarySchema = z.object({
  summary: z.string().max(2000),
  mentions: z
    .array(
      z.object({
        provider_id: z.string().max(100).nullable(),
        provider_name: z.string().max(200),
        fact: z.string().max(500),
        quote: z.string().max(500),
      }),
    )
    .max(60),
});
export type SourceSummary = z.infer<typeof SourceSummarySchema> & { url: string; change: 'new' | 'changed' };

const SOURCE_SYSTEM = `You read a public page used to check information about Australian Support at Home (aged care) providers: a register, a government list, a notice or a provider page. Summarise in plain words what it says that matters to a family choosing a provider (prices, registration, services offered, areas served, compliance or sanctions, program rule changes). Then list each statement about a provider in the catalogue you're given, with the catalogue id when it clearly matches (otherwise null), the fact in a few words and a short exact quote. Report only what the page says.`;

function pageBlocks(content: PageContent, url: string): Anthropic.Beta.BetaContentBlockParam[] {
  if (content.kind === 'pdf') return [{ type: 'text', text: `Page URL: ${url}` }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content.data } }];
  return [{ type: 'text', text: `<page url="${url}">\n${content.text.slice(0, 300_000)}\n</page>` }];
}

async function extract<S extends z.ZodType>(client: Anthropic, usage: UsageTally, schema: S, system: string, content: Anthropic.Beta.BetaContentBlockParam[]): Promise<z.infer<S>> {
  const result = await client.beta.messages.parse({
    model: EXTRACT_MODEL,
    max_tokens: 8000,
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content }],
  });
  usage.add(EXTRACT_MODEL, result.usage);
  if (result.stop_reason === 'refusal') throw new NotesError(422, 'Claude declined to read this page.');
  if (!result.parsed_output) throw new NotesError(502, 'The page could not be read into structured data.');
  return result.parsed_output as z.infer<S>;
}

/** Prices that differ from the catalogue by 50 cents or more. */
export function priceChanges(current: Provider, found: PriceList): Partial<Record<RateKey, { from: number | null; to: number }>> {
  const out: Partial<Record<RateKey, { from: number | null; to: number }>> = {};
  for (const k of RATE_KEYS) {
    const to = found.rates[k];
    if (to === null) continue;
    const from = current[k];
    if (from === null || Math.abs(from - to) >= 0.5) out[k] = { from, to };
  }
  return out;
}

const AUTO_NOTE = 'Automatic price check';

// ---- The run ----

class Run {
  readonly usage = new UsageTally();
  readonly log: string[] = [];
  readonly stats: RunStats = {
    prices: { checked: 0, unchanged: 0, changed: 0, errors: 0, suggestions: 0, matched: 0 },
    sources: { checked: 0, unchanged: 0, changed: 0, errors: 0, summarised: 0 },
    claims: { due: 0, revalidated: 0, reread: 0, researched: 0, deferred: 0, failed: 0 },
  };
  constructor(readonly id: string) {}
  note(line: string) {
    if (this.log.length < MAX_LOG) this.log.push(line);
  }
  count(c: Counts, check: PageCheck) {
    c.checked += 1;
    if (check.status === 'unchanged') c.unchanged += 1;
    else if (check.status === 'error') c.errors += 1;
    else c.changed += 1;
  }
}

async function startRun(db: Db, trigger: string): Promise<Run> {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query('LOCK TABLE enrichment_runs IN EXCLUSIVE MODE');
    const busy = await tx.query(`SELECT id FROM enrichment_runs WHERE status = 'running' AND started_at > now() - interval '${STALE_RUN_HOURS} hours'`);
    if (busy.length) throw new EnrichmentBusyError('A data check is already running.');
    await tx.query(`UPDATE enrichment_runs SET status = 'failed', error = 'Stopped (server restarted)', finished_at = now() WHERE status = 'running'`);
    await tx.query(`INSERT INTO enrichment_runs (id, trigger, status) VALUES ($1, $2, 'running')`, [id, trigger]);
  });
  return new Run(id);
}

async function saveRun(db: Queryable, run: Run, status: 'running' | 'done' | 'failed', error: string | null = null) {
  await db.query(`UPDATE enrichment_runs SET status = $2, stats = $3::jsonb, usage = $4::jsonb, log = $5::jsonb, error = $6, finished_at = CASE WHEN $2 = 'running' THEN NULL ELSE now() END WHERE id = $1`, [
    run.id,
    status,
    JSON.stringify(run.stats),
    JSON.stringify(run.usage.toJSON()),
    JSON.stringify(run.log),
    error,
  ]);
}

const message = (err: unknown) => (err instanceof NotesError || err instanceof Error ? err.message : 'Unexpected error');

async function checkPrices(deps: EnrichDeps, run: Run, providers: Provider[]) {
  const { db } = deps;
  const pending = (await listSuggestions(db, { status: 'pending' })).filter((s) => s.application_id === null && s.note.startsWith(AUTO_NOTE));
  for (const provider of providers) {
    if (!provider.source_url) continue;
    const check = await checkPage(db, provider.source_url, deps.fetcher);
    run.count(run.stats.prices, check);
    if (check.status === 'error') {
      run.note(`Price list for ${provider.provider}: couldn't fetch (${check.error}).`);
      continue;
    }
    if (check.status === 'unchanged') continue;
    try {
      const found = await extract(deps.getAnthropic(), run.usage, PriceListSchema, PRICE_SYSTEM, [
        { type: 'text', text: `Provider: ${provider.provider}${provider.outlet ? ` (${provider.outlet})` : ''}` },
        ...pageBlocks(check.content, check.url),
      ]);
      if (!found.is_price_list) {
        run.note(`Price list for ${provider.provider}: the page no longer looks like a price list — check the link.`);
        continue;
      }
      const changes = priceChanges(provider, found);
      // A newer "prices as at" date is worth recording even when every price is the same; an older one isn't.
      const foundDate = found.prices_as_at ? latestDateIn(found.prices_as_at) : null;
      const dateChanged = !!foundDate && (!provider.prices_as_at_date || foundDate > provider.prices_as_at_date);
      if (!Object.keys(changes).length && !dateChanged) {
        run.stats.prices.matched += 1;
        run.note(`Price list for ${provider.provider}: ${check.status === 'new' ? 'read for the first time' : 'changed'}; prices match the catalogue.`);
        continue;
      }
      const proposed: Provider = {
        ...provider,
        ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v!.to])),
        ...(dateChanged ? { prices_as_at: found.prices_as_at!, prices_as_at_date: foundDate } : {}),
      };
      delete proposed.special_rates;
      const same = pending.find((s) => s.provider_id === provider.id && RATE_KEYS.every((k) => s.proposed[k] === proposed[k]) && s.proposed.prices_as_at === proposed.prices_as_at);
      if (same) {
        run.note(`Price list for ${provider.provider}: same change is already waiting for approval.`);
        continue;
      }
      const lines = Object.entries(changes).map(([k, v]) => `${k} ${v!.from === null ? 'not listed' : `$${v!.from}`} → $${v!.to}`);
      await createSuggestion(db, {
        current: provider,
        proposed,
        note: `${AUTO_NOTE} of ${check.url} on ${new Date().toISOString().slice(0, 10)}, read by Claude: ${[...lines, dateChanged ? `prices as at "${found.prices_as_at}"` : ''].filter(Boolean).join('; ')}.${found.notes.length ? ` Page notes: ${found.notes.join('; ')}.` : ''} Check the page before approving.`,
        applicationId: null,
        userId: null,
      });
      run.stats.prices.suggestions += 1;
      run.note(`Price list for ${provider.provider}: ${lines.length} price${lines.length === 1 ? '' : 's'} differ — suggestion created.`);
    } catch (err) {
      run.stats.prices.errors += 1;
      await forgetPage(db, check.url);
      run.note(`Price list for ${provider.provider}: couldn't read it (${message(err)}). Will try again next run.`);
    }
  }
}

async function checkSources(deps: EnrichDeps, run: Run, providers: Provider[]) {
  const { db } = deps;
  const catalogue = providers.map((p) => `${p.id}: ${p.provider}${p.outlet ? ` (${p.outlet})` : ''}`).join('\n');
  for (const source of (await listSources(db)).filter((s) => s.active)) {
    const check = await checkPage(db, source.url, deps.fetcher);
    run.count(run.stats.sources, check);
    if (check.status === 'error') {
      run.note(`${source.name}: couldn't fetch (${check.error}).`);
      continue;
    }
    if (check.status === 'unchanged') continue;
    try {
      const found = await extract(deps.getAnthropic(), run.usage, SourceSummarySchema, SOURCE_SYSTEM, [
        { type: 'text', text: `Source: ${source.name}${source.note ? ` — ${source.note}` : ''}\n\nCatalogue (id: provider):\n${catalogue}` },
        ...pageBlocks(check.content, check.url),
      ]);
      const ids = new Set(providers.map((p) => p.id));
      const summary: SourceSummary = { ...found, mentions: found.mentions.map((m) => ({ ...m, provider_id: m.provider_id && ids.has(m.provider_id) ? m.provider_id : null })), url: check.url, change: check.status };
      await db.query('UPDATE enrichment_sources SET summary = $2::jsonb, summary_at = now() WHERE id = $1', [source.id, JSON.stringify(summary)]);
      run.stats.sources.summarised += 1;
      run.note(`${source.name}: ${check.status === 'new' ? 'read for the first time' : 'changed'} — ${summary.mentions.length} mention${summary.mentions.length === 1 ? '' : 's'} of providers.`);
    } catch (err) {
      run.stats.sources.errors += 1;
      await forgetPage(db, check.url);
      run.note(`${source.name}: couldn't read it (${message(err)}). Will try again next run.`);
    }
  }
}

export type ClaimsOutcome = 'revalidated' | 'reread' | 'researched' | 'deferred';

/**
 * Brings one provider's claims up to date, cheapest way first. `allowResearch` false means a full web search
 * isn't allowed (budget used up), and the provider is deferred instead.
 */
export async function refreshClaims(
  deps: EnrichDeps,
  provider: Provider,
  before: ClaimsRow | undefined,
  opts: { force: boolean; allowResearch: boolean; usage: UsageTally },
): Promise<ClaimsOutcome> {
  const { db } = deps;
  const now = Date.now();
  const recentResearch = !!before?.researched_at && now - new Date(before.researched_at).getTime() < FULL_RESEARCH_DAYS * 86_400_000;
  if (!opts.force && before?.claims && recentResearch) {
    const urls = [...new Map(before.claims.items.map((i) => [normaliseUrl(i.source_url), i.source_url])).values()];
    const checks = await Promise.all(urls.map((u) => checkPage(db, u, deps.fetcher)));
    if (urls.length > 0 && checks.every((c) => c.status !== 'error')) {
      const changed = checks.filter((c): c is Extract<PageCheck, { content: PageContent }> => c.status === 'changed' || c.status === 'new');
      if (!changed.length) {
        await finishSearch(db, provider.id, { claims: before.claims });
        return 'revalidated';
      }
      try {
        const fresh = await rereadClaimPages(deps.getAnthropic(), provider, deps.topics, changed, opts.usage);
        const changedUrls = new Set(changed.map((c) => normaliseUrl(c.url)));
        const kept = before.claims.items.filter((i) => !changedUrls.has(normaliseUrl(i.source_url)));
        await finishSearch(db, provider.id, { claims: { ...before.claims, items: [...kept, ...fresh] } });
        return 'reread';
      } catch (err) {
        for (const c of changed) await forgetPage(db, c.url);
        throw err;
      }
    }
  }
  if (!opts.allowResearch) return 'deferred';
  const claims: Claims = await researchClaims(deps.getAnthropic(), provider, deps.topics, opts.usage);
  await finishSearch(db, provider.id, { claims, researched: true });
  // Record the cited pages now, so the next check can tell whether they changed without a search.
  for (const url of new Set(claims.items.map((i) => i.source_url))) await checkPage(db, url, deps.fetcher);
  return 'researched';
}

async function checkClaims(deps: EnrichDeps, run: Run, providers: Provider[], maxResearch: number) {
  const { db } = deps;
  let researchLeft = maxResearch;
  for (const provider of providers) {
    const before = await getClaims(db, provider.id);
    if (before && before.claims && isFresh(before)) continue;
    run.stats.claims.due += 1;
    const { start } = await claimSearch(db, provider.id, null, false);
    if (!start) continue; // a search is already running
    try {
      const outcome = await refreshClaims(deps, provider, before, { force: false, allowResearch: researchLeft > 0, usage: run.usage });
      if (outcome === 'deferred') {
        await releaseSearch(db, provider.id, before);
        run.stats.claims.deferred += 1;
        run.note(`Public claims for ${provider.provider}: needs a full search — left for the next run.`);
        continue;
      }
      if (outcome === 'researched') researchLeft -= 1;
      run.stats.claims[outcome] += 1;
      run.note(
        `Public claims for ${provider.provider}: ${
          outcome === 'revalidated' ? 'pages unchanged, confirmed as current' : outcome === 'reread' ? 'some pages changed and were re-read' : 'searched the web'
        }.`,
      );
    } catch (err) {
      run.stats.claims.failed += 1;
      await finishSearch(db, provider.id, { error: err instanceof NotesError ? err.message : 'Unexpected error checking this provider.' });
      run.note(`Public claims for ${provider.provider}: failed (${message(err)}).`);
    }
  }
}

/** One enrichment run. Throws EnrichmentBusyError if another is running. */
export async function runEnrichment(deps: EnrichDeps, opts: EnrichOptions): Promise<EnrichmentRun> {
  const run = await startRun(deps.db, opts.trigger);
  const parts = new Set(opts.parts ?? ENRICH_PARTS);
  try {
    deps.getAnthropic(); // fail early if Claude isn't configured
    const all = await deps.providers();
    const providers = opts.providerIds ? all.filter((p) => opts.providerIds!.includes(p.id)) : all;
    if (parts.has('prices')) await checkPrices(deps, run, providers);
    await saveRun(deps.db, run, 'running');
    if (parts.has('sources')) await checkSources(deps, run, all);
    await saveRun(deps.db, run, 'running');
    if (parts.has('claims')) await checkClaims(deps, run, providers, opts.maxResearch ?? 3);
    await saveRun(deps.db, run, 'done');
  } catch (err) {
    run.note(`Stopped: ${message(err)}`);
    await saveRun(deps.db, run, 'failed', message(err));
  }
  return toRun((await deps.db.query('SELECT * FROM enrichment_runs WHERE id = $1', [run.id]))[0]);
}

export { CLAIMS_MAX_AGE_DAYS };
