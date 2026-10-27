import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
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
import { createSuggestion, listSuggestions, upsertCatalogue, type Suggestion } from './catalogue.ts';
import { areaLabel, findPriceList, findProvidersInArea, type Area } from './discover.ts';
import { mentionsDisallowedFees } from '../src/flags.ts';
import { matchCatalogue } from '../src/genLoad.ts';
import { slugify } from '../src/data/normalise.ts';
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

export type EnrichPart = 'discover' | 'prices' | 'sources' | 'claims';
export const ENRICH_PARTS: EnrichPart[] = ['discover', 'prices', 'sources', 'claims'];
/** What a run checks unless told otherwise. Finding providers is chosen on purpose: it searches the web. */
export const DEFAULT_PARTS: EnrichPart[] = ['prices', 'sources', 'claims'];

export interface EnrichDeps {
  db: Db;
  getAnthropic: () => Anthropic;
  /** The catalogue as it stands (seed data plus admin edits). */
  providers: () => Promise<Provider[]>;
  topics: Topic[];
  fetcher?: Fetcher;
  /** Waits between fetch retries; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

export interface EnrichOptions {
  trigger: 'schedule' | 'admin' | 'cli';
  parts?: EnrichPart[];
  /** Most full web searches in one run. */
  maxResearch?: number;
  /** Only these providers (all when omitted). */
  providerIds?: string[];
  /** Areas to find providers in (default: the active applications' postcodes). */
  areas?: Area[];
}

interface Counts {
  checked: number;
  unchanged: number;
  changed: number;
  errors: number;
}

export interface RunStats {
  discover: { found: number; added: number; updated: number; failed: number };
  prices: Counts & { suggestions: number; matched: number; applied: number };
  sources: Counts & { summarised: number };
  claims: { due: number; revalidated: number; reread: number; researched: number; deferred: number; failed: number };
}

export type ItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** One thing a run checks: a price list, an extra source, or one provider's public claims. */
export interface RunItem {
  id: string;
  part: EnrichPart;
  label: string;
  url: string | null;
  status: ItemStatus;
  /** What it's doing now, e.g. "Downloading", "Reading with Claude Haiku". */
  stage: string | null;
  /** More about the stage, e.g. "2.1 MB of 4.0 MB". */
  detail: string | null;
  /** What happened, in a few words, once done. */
  outcome: string | null;
  error: { stage: string; message: string } | null;
  started_at: string | null;
  ms: number | null;
}

export interface RunProgress {
  items: RunItem[];
  /** Seconds left, estimated from this run and recent ones. Null before anything can be estimated. */
  eta_seconds: number | null;
  /** Things not needed this run. */
  skipped: { claims_current: number; no_price_list: number; not_shortlisted?: number };
  updated_at: string;
}

export interface EnrichmentRun {
  id: string;
  trigger: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  stats: Partial<RunStats>;
  usage: ReturnType<UsageTally['toJSON']> | Record<string, never>;
  log: string[];
  progress: Partial<RunProgress>;
  cancel_requested: boolean;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  heartbeat_at: string | null;
}

export class EnrichmentBusyError extends Error {}

/** A run that hasn't saved progress for this long died with a restart. */
const STALE_RUN_MINUTES = 15;
const MAX_LOG = 300;
/** Items checked at once, by part. Claims searches are slow and costly, so fewer run together. */
const CONCURRENCY: Record<EnrichPart, number> = { discover: 2, prices: 4, sources: 3, claims: 2 };
/** Seconds per item before there's any history to go on. */
const DEFAULT_SECONDS: Record<EnrichPart, number> = { discover: 120, prices: 20, sources: 20, claims: 60 };
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

const toRun = (r: Record<string, unknown>): EnrichmentRun => ({
  id: r.id as string,
  trigger: r.trigger as string,
  status: r.status as EnrichmentRun['status'],
  stats: json(r.stats),
  usage: json(r.usage),
  log: json(r.log),
  progress: json(r.progress ?? {}),
  cancel_requested: !!r.cancel_requested,
  error: (r.error as string | null) ?? null,
  started_at: iso(r.started_at)!,
  finished_at: iso(r.finished_at),
  heartbeat_at: iso(r.heartbeat_at) ?? null,
});

export async function listRuns(db: Queryable, limit = 20): Promise<EnrichmentRun[]> {
  return (await db.query('SELECT * FROM enrichment_runs ORDER BY started_at DESC LIMIT $1', [limit])).map(toRun);
}

const ACTIVE = `status = 'running' AND COALESCE(heartbeat_at, started_at) > now() - interval '${STALE_RUN_MINUTES} minutes'`;

/** The run in progress, if any. */
export async function activeRun(db: Queryable): Promise<EnrichmentRun | undefined> {
  const [r] = await db.query(`SELECT * FROM enrichment_runs WHERE ${ACTIVE} ORDER BY started_at DESC LIMIT 1`);
  return r ? toRun(r) : undefined;
}

/** Asks the running check to stop after the items it's on. */
export async function requestCancel(db: Queryable): Promise<boolean> {
  return (await db.query(`UPDATE enrichment_runs SET cancel_requested = true WHERE ${ACTIVE} RETURNING id`)).length > 0;
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
  if (content.kind === 'pdf') return [{ type: 'text', text: `Page URL: ${url} (a scanned PDF)` }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content.data } }];
  return [{ type: 'text', text: `<page url="${url}"${content.pdfPages ? ` pdf_pages="${content.pdfPages}"` : ''}>\n${content.text.slice(0, 300_000)}\n</page>` }];
}

/** What Claude will read, for the progress view. */
const readingWhat = (c: PageContent) => (c.kind === 'pdf' ? 'scanned PDF' : c.pdfPages ? `PDF text, ${c.pdfPages} page${c.pdfPages === 1 ? '' : 's'}` : `${Math.round(c.text.length / 1000)}k characters`);

/** Claude calls in a run: generous time for a long PDF, retried on rate limits and server errors. */
export const CLAUDE_REQUEST = { timeout: 5 * 60_000, maxRetries: 3 };

async function extract<S extends z.ZodType>(client: Anthropic, usage: UsageTally, schema: S, system: string, content: Anthropic.Beta.BetaContentBlockParam[]): Promise<z.infer<S>> {
  const result = await client.beta.messages.parse(
    {
      model: EXTRACT_MODEL,
      max_tokens: 8000,
      output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content }],
    },
    CLAUDE_REQUEST,
  );
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

function message(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'Claude took too long to answer (tried 4 times)';
  if (err instanceof Anthropic.RateLimitError) return 'Claude is busy right now (rate limited, tried 4 times)';
  if (err instanceof Anthropic.AuthenticationError) return 'the Claude API key was rejected';
  if (err instanceof Anthropic.APIError) return `Claude returned an error (${err.status ?? 'no status'})`;
  return err instanceof Error ? err.message : 'Unexpected error';
}
const now = () => new Date().toISOString();

/** Seconds per item for each part, from recent finished runs, falling back to defaults. */
async function historicalSeconds(db: Queryable): Promise<Record<EnrichPart, number>> {
  const rows = await db.query(`SELECT progress FROM enrichment_runs WHERE status <> 'running' ORDER BY started_at DESC LIMIT 5`);
  const out = { ...DEFAULT_SECONDS };
  for (const part of ENRICH_PARTS) {
    const ms = rows.flatMap((r) => (json<Partial<RunProgress>>(r.progress).items ?? []).filter((i) => i.part === part && i.ms !== null).map((i) => i.ms!));
    if (ms.length >= 2) out[part] = ms.reduce((a, b) => a + b, 0) / ms.length / 1000;
  }
  return out;
}

/** A run's state, saved to the database as it goes (at most every 1.5 seconds) for the live view. */
class Run {
  readonly usage = new UsageTally();
  readonly log: string[] = [];
  readonly items: RunItem[] = [];
  readonly stats: RunStats = {
    discover: { found: 0, added: 0, updated: 0, failed: 0 },
    prices: { checked: 0, unchanged: 0, changed: 0, errors: 0, suggestions: 0, matched: 0, applied: 0 },
    sources: { checked: 0, unchanged: 0, changed: 0, errors: 0, summarised: 0 },
    claims: { due: 0, revalidated: 0, reread: 0, researched: 0, deferred: 0, failed: 0 },
  };
  skipped = { claims_current: 0, no_price_list: 0, not_shortlisted: 0 };
  cancelled = false;
  private lastSave = 0;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    readonly db: Queryable,
    readonly id: string,
    private readonly history: Record<EnrichPart, number>,
  ) {}

  note(line: string) {
    if (this.log.length < MAX_LOG) this.log.push(line);
  }

  add(part: EnrichPart, label: string, url: string | null): RunItem {
    const item: RunItem = { id: String(this.items.length + 1), part, label, url, status: 'queued', stage: null, detail: null, outcome: null, error: null, started_at: null, ms: null };
    this.items.push(item);
    return item;
  }

  count(c: Counts, check: PageCheck) {
    c.checked += 1;
    if (check.status === 'unchanged') c.unchanged += 1;
    else if (check.status === 'error') c.errors += 1;
    else c.changed += 1;
  }

  /** Seconds left: queued work at each part's pace, shared across that part's workers, plus what's running. */
  eta(): number | null {
    const at = Date.now();
    let total = 0;
    for (const part of ENRICH_PARTS) {
      const mine = this.items.filter((i) => i.part === part);
      const finished = mine.filter((i) => i.ms !== null);
      const per = finished.length >= 2 ? finished.reduce((a, i) => a + i.ms!, 0) / finished.length / 1000 : this.history[part];
      const queued = mine.filter((i) => i.status === 'queued').length;
      const running = mine.filter((i) => i.status === 'running').map((i) => Math.max(3, per - (at - new Date(i.started_at!).getTime()) / 1000));
      if (!queued && !running.length) continue;
      total += (queued * per + running.reduce((a, b) => a + b, 0)) / Math.min(CONCURRENCY[part], queued + running.length);
    }
    return this.items.length ? Math.round(total) : null;
  }

  progress(): RunProgress {
    return { items: this.items, eta_seconds: this.eta(), skipped: this.skipped, updated_at: now() };
  }

  /** Saves progress if it's been a moment since the last save (or always, with `force`), and picks up a stop request. */
  save(force = false): Promise<void> {
    if (!force && Date.now() - this.lastSave < 1500) return this.saving;
    this.lastSave = Date.now();
    this.saving = this.saving.then(async () => {
      const [row] = await this.db.query(
        `UPDATE enrichment_runs SET stats = $2::jsonb, usage = $3::jsonb, log = $4::jsonb, progress = $5::jsonb, heartbeat_at = now() WHERE id = $1 RETURNING cancel_requested`,
        [this.id, JSON.stringify(this.stats), JSON.stringify(this.usage.toJSON()), JSON.stringify(this.log), JSON.stringify(this.progress())],
      );
      if (row?.cancel_requested) this.cancelled = true;
    });
    return this.saving;
  }

  start(item: RunItem, stage: string) {
    item.status = 'running';
    item.started_at = now();
    item.stage = stage;
    void this.save();
  }
  stage(item: RunItem, stage: string, detail: string | null = null) {
    item.stage = stage;
    item.detail = detail;
    void this.save();
  }
  detail(item: RunItem, detail: string) {
    item.detail = detail;
    void this.save();
  }
  done(item: RunItem, outcome: string, line?: string) {
    item.status = 'done';
    item.outcome = outcome;
    item.stage = null;
    item.detail = null;
    item.ms = Date.now() - new Date(item.started_at!).getTime();
    this.note(line ?? `${item.label}: ${outcome}`);
    return this.save(true);
  }
  fail(item: RunItem, stage: string, msg: string) {
    item.status = 'failed';
    item.error = { stage, message: msg };
    item.stage = null;
    item.detail = null;
    item.ms = Date.now() - new Date(item.started_at!).getTime();
    this.note(`${item.label}: ${stage} failed — ${msg}`);
    return this.save(true);
  }
}

/** Runs `work` over `list`, `n` at a time, stopping early when the run is cancelled. */
async function pool<T>(run: Run, list: T[], n: number, work: (x: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < list.length && !run.cancelled) await work(list[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
}

async function startRun(db: Db, trigger: string): Promise<Run> {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query('LOCK TABLE enrichment_runs IN EXCLUSIVE MODE');
    const busy = await tx.query(`SELECT id FROM enrichment_runs WHERE ${ACTIVE}`);
    if (busy.length) throw new EnrichmentBusyError('A data check is already running.');
    await tx.query(`UPDATE enrichment_runs SET status = 'failed', error = 'Stopped: the server restarted during the check', finished_at = now() WHERE status = 'running'`);
    await tx.query(`INSERT INTO enrichment_runs (id, trigger, status, heartbeat_at) VALUES ($1, $2, 'running', now())`, [id, trigger]);
  });
  return new Run(db, id, await historicalSeconds(db));
}

async function finishRun(run: Run, status: 'done' | 'failed' | 'cancelled', error: string | null = null) {
  if (status === 'cancelled') for (const i of run.items) if (i.status === 'queued') i.status = 'cancelled';
  await run.save(true);
  await run.db.query(`UPDATE enrichment_runs SET status = $2, error = $3, finished_at = now(), progress = $4::jsonb WHERE id = $1`, [run.id, status, error, JSON.stringify({ ...run.progress(), eta_seconds: 0 })]);
}

const pageOpts = (deps: EnrichDeps, run: Run, item: RunItem) => ({ fetcher: deps.fetcher, sleep: deps.sleep, onProgress: (d: string) => run.detail(item, d) });

export type PriceResult =
  | { ok: true; kind: 'unchanged' | 'matched' | 'suggested' | 'applied' | 'waiting' | 'no-list' | 'deferred'; outcome: string; provider: Provider }
  | { ok: false; stage: string; error: string };

export interface PriceOptions {
  usage: UsageTally;
  /** Search for the price list when the provider has no link (uses one search from the budget). */
  findMissing: boolean;
  takeSearch: () => boolean;
  pending?: Suggestion[];
  onStage?: (stage: string, detail?: string | null) => void;
  onDetail?: (detail: string) => void;
  onCheck?: (check: PageCheck) => void;
}

const noPrices = (p: Provider) => RATE_KEYS.every((k) => p[k] === null);

/**
 * Reads one provider's price list. Prices for a provider with none yet (one just loaded) go straight into the
 * catalogue, marked as read automatically; changes to existing prices become suggestions for an admin.
 */
export async function readPrices(deps: EnrichDeps, start: Provider, opts: PriceOptions): Promise<PriceResult> {
  const { db } = deps;
  let provider = start;
  if (!provider.source_url) {
    if (!opts.findMissing) return { ok: true, kind: 'no-list', outcome: 'No price list link', provider };
    if (!opts.takeSearch()) return { ok: true, kind: 'deferred', outcome: 'Needs a search for its price list — left for the next run (search limit reached)', provider };
    opts.onStage?.('Finding the price list with Claude Sonnet', 'usually under a minute');
    let found;
    try {
      found = await findPriceList(deps.getAnthropic(), provider, opts.usage);
    } catch (err) {
      return { ok: false, stage: 'Finding the price list', error: message(err) };
    }
    if (!found.price_list_url) return { ok: false, stage: 'Finding the price list', error: "no published price list was found — ask the provider for one" };
    provider = { ...provider, source_url: found.price_list_url, website: provider.website ?? found.website };
    await upsertCatalogue(db, provider, null, `Price list found by search: ${found.price_list_url}`);
  }
  opts.onStage?.('Downloading');
  const check = await checkPage(db, provider.source_url!, { fetcher: deps.fetcher, sleep: deps.sleep, onProgress: opts.onDetail });
  opts.onCheck?.(check);
  if (check.status === 'error') return { ok: false, stage: 'Download', error: check.error };
  if (check.status === 'unchanged' && !noPrices(provider)) return { ok: true, kind: 'unchanged', outcome: check.attempts > 1 ? `Unchanged (after ${check.attempts} tries)` : 'Unchanged', provider };
  if (check.status === 'unchanged') {
    // Seen before but never read into the catalogue (it had no prices): read it now.
    await forgetPage(db, check.url);
    return readPrices(deps, provider, opts);
  }
  try {
    opts.onStage?.('Reading with Claude Haiku', readingWhat(check.content));
    const found = await extract(deps.getAnthropic(), opts.usage, PriceListSchema, PRICE_SYSTEM, [
      { type: 'text', text: `Provider: ${provider.provider}${provider.outlet ? ` (${provider.outlet})` : ''}` },
      ...pageBlocks(check.content, check.url),
    ]);
    if (!found.is_price_list) return { ok: false, stage: 'Reading with Claude Haiku', error: "the page doesn't look like a price list — check the link" };
    opts.onStage?.('Comparing with the catalogue');
    const foundDate = found.prices_as_at ? latestDateIn(found.prices_as_at) : null;
    const first = check.status === 'new' ? 'Read for the first time' : 'Changed';
    if (noPrices(provider)) {
      const rates = Object.fromEntries(RATE_KEYS.filter((k) => found.rates[k] !== null).map((k) => [k, found.rates[k]]));
      if (!Object.keys(rates).length) return { ok: false, stage: 'Reading with Claude Haiku', error: 'no hourly prices found on the page — ask the provider for a quote' };
      const today = now().slice(0, 10);
      // Fees and conditions worth asking about become flags, as a family's own notes would.
      const feeNotes = found.notes.filter((n) => mentionsDisallowedFees(n) || /\b(travel|admin|fee|levy|establishment|exit|cancell?ation|minimum)\b/i.test(n));
      const updated: Provider = {
        ...provider,
        ...rates,
        prices_as_at: `${found.prices_as_at ?? 'Date not stated'} (read automatically on ${today})`,
        prices_as_at_date: foundDate ?? today,
        flags: [...new Set([...provider.flags, ...feeNotes])],
      };
      delete updated.special_rates;
      await upsertCatalogue(db, updated, null, `Prices read automatically from ${check.url}`);
      const n = Object.keys(rates).length;
      return { ok: true, kind: 'applied', outcome: `${n} price${n === 1 ? '' : 's'} read into the catalogue`, provider: updated };
    }
    const changes = priceChanges(provider, found);
    // A newer "prices as at" date is worth recording even when every price is the same; an older one isn't.
    const dateChanged = !!foundDate && (!provider.prices_as_at_date || foundDate > provider.prices_as_at_date);
    if (!Object.keys(changes).length && !dateChanged) return { ok: true, kind: 'matched', outcome: `${first}; prices match the catalogue`, provider };
    const proposed: Provider = {
      ...provider,
      ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v!.to])),
      ...(dateChanged ? { prices_as_at: found.prices_as_at!, prices_as_at_date: foundDate } : {}),
    };
    delete proposed.special_rates;
    const pending = opts.pending ?? (await listSuggestions(db, { status: 'pending' })).filter((s) => s.application_id === null && s.note.startsWith(AUTO_NOTE));
    if (pending.some((s) => s.provider_id === provider.id && RATE_KEYS.every((k) => s.proposed[k] === proposed[k]) && s.proposed.prices_as_at === proposed.prices_as_at))
      return { ok: true, kind: 'waiting', outcome: `${first}; the same change is already waiting for approval`, provider };
    const lines = Object.entries(changes).map(([k, v]) => `${k} ${v!.from === null ? 'not listed' : `$${v!.from}`} → $${v!.to}`);
    await createSuggestion(db, {
      current: provider,
      proposed,
      note: `${AUTO_NOTE} of ${check.url} on ${now().slice(0, 10)}, read by Claude: ${[...lines, dateChanged ? `prices as at "${found.prices_as_at}"` : ''].filter(Boolean).join('; ')}.${found.notes.length ? ` Page notes: ${found.notes.join('; ')}.` : ''} Check the page before approving.`,
      applicationId: null,
      userId: null,
    });
    return {
      ok: true,
      kind: 'suggested',
      outcome: `${first}; ${lines.length || 'no'} price${lines.length === 1 ? '' : 's'} differ${lines.length === 1 ? 's' : ''}${dateChanged ? ', newer date' : ''} — suggestion created`,
      provider,
    };
  } catch (err) {
    await forgetPage(db, check.url);
    return { ok: false, stage: 'Reading with Claude Haiku', error: `${message(err)}. It will be read again next time` };
  }
}

type PriceTarget = { provider: Provider; item: RunItem };

async function checkPrice(deps: EnrichDeps, run: Run, { provider, item }: PriceTarget, pending: Suggestion[], budget: { left: number }) {
  run.start(item, provider.source_url ? 'Downloading' : 'Finding the price list');
  const res = await readPrices(deps, provider, {
    usage: run.usage,
    findMissing: true,
    takeSearch: () => (budget.left > 0 ? (budget.left--, true) : false),
    pending,
    onStage: (stage, detail = null) => run.stage(item, stage, detail),
    onDetail: (d) => run.detail(item, d),
    onCheck: (c) => run.count(run.stats.prices, c),
  });
  if (!res.ok) {
    if (res.stage !== 'Download') run.stats.prices.errors += 1;
    return run.fail(item, res.stage, res.error);
  }
  if (res.kind === 'matched') run.stats.prices.matched += 1;
  if (res.kind === 'suggested') run.stats.prices.suggestions += 1;
  if (res.kind === 'applied') run.stats.prices.applied += 1;
  item.url = res.provider.source_url;
  return run.done(item, res.outcome);
}

async function checkSource(deps: EnrichDeps, run: Run, source: EnrichmentSource, item: RunItem, providers: Provider[]) {
  const { db } = deps;
  run.start(item, 'Downloading');
  const check = await checkPage(db, source.url, pageOpts(deps, run, item));
  run.count(run.stats.sources, check);
  if (check.status === 'error') return run.fail(item, 'Download', check.error);
  if (check.status === 'unchanged') return run.done(item, 'Unchanged');
  try {
    run.stage(item, 'Summarising with Claude Haiku', readingWhat(check.content));
    const catalogue = providers.map((p) => `${p.id}: ${p.provider}${p.outlet ? ` (${p.outlet})` : ''}`).join('\n');
    const found = await extract(deps.getAnthropic(), run.usage, SourceSummarySchema, SOURCE_SYSTEM, [
      { type: 'text', text: `Source: ${source.name}${source.note ? ` — ${source.note}` : ''}\n\nCatalogue (id: provider):\n${catalogue}` },
      ...pageBlocks(check.content, check.url),
    ]);
    const ids = new Set(providers.map((p) => p.id));
    const summary: SourceSummary = { ...found, mentions: found.mentions.map((m) => ({ ...m, provider_id: m.provider_id && ids.has(m.provider_id) ? m.provider_id : null })), url: check.url, change: check.status };
    await db.query('UPDATE enrichment_sources SET summary = $2::jsonb, summary_at = now() WHERE id = $1', [source.id, JSON.stringify(summary)]);
    run.stats.sources.summarised += 1;
    return run.done(item, `${check.status === 'new' ? 'Read for the first time' : 'Changed'} — ${summary.mentions.length} mention${summary.mentions.length === 1 ? '' : 's'} of providers`);
  } catch (err) {
    run.stats.sources.errors += 1;
    await forgetPage(db, check.url);
    return run.fail(item, 'Summarising with Claude Haiku', `${message(err)}. It will be read again next run`);
  }
}

export type ClaimsOutcome = 'revalidated' | 'reread' | 'researched' | 'deferred';

/**
 * Brings one provider's claims up to date, cheapest way first. `takeResearch` is asked just before a full web
 * search and returns false when the run's budget is used up, in which case the provider is deferred.
 */
export async function refreshClaims(
  deps: EnrichDeps,
  provider: Provider,
  before: ClaimsRow | undefined,
  opts: { force: boolean; takeResearch: () => boolean; usage: UsageTally; onStage?: (stage: string, detail?: string | null) => void; onDetail?: (detail: string) => void },
): Promise<ClaimsOutcome> {
  const { db } = deps;
  const recentResearch = !!before?.researched_at && Date.now() - new Date(before.researched_at).getTime() < FULL_RESEARCH_DAYS * 86_400_000;
  if (!opts.force && before?.claims && recentResearch) {
    const urls = [...new Map(before.claims.items.map((i) => [normaliseUrl(i.source_url), i.source_url])).values()];
    opts.onStage?.(`Checking ${urls.length} source page${urls.length === 1 ? '' : 's'}`);
    let done = 0;
    const checks = await Promise.all(
      urls.map(async (u) => {
        const c = await checkPage(db, u, { fetcher: deps.fetcher, sleep: deps.sleep });
        opts.onDetail?.(`${++done} of ${urls.length} checked`);
        return c;
      }),
    );
    if (urls.length > 0 && checks.every((c) => c.status !== 'error')) {
      const changed = checks.filter((c): c is Extract<PageCheck, { content: PageContent }> => c.status === 'changed' || c.status === 'new');
      if (!changed.length) {
        await finishSearch(db, provider.id, { claims: before.claims });
        return 'revalidated';
      }
      try {
        opts.onStage?.('Re-reading changed pages with Claude Haiku', `${changed.length} of ${urls.length} page${urls.length === 1 ? '' : 's'}`);
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
    const broken = checks.filter((c) => c.status === 'error').length;
    if (broken) opts.onStage?.(`${broken} source page${broken === 1 ? '' : 's'} couldn't be fetched — a full search is needed`);
  }
  if (!opts.takeResearch()) return 'deferred';
  opts.onStage?.('Searching the web with Claude Sonnet', 'usually 1–3 minutes');
  const claims: Claims = await researchClaims(deps.getAnthropic(), provider, deps.topics, opts.usage);
  await finishSearch(db, provider.id, { claims, researched: true });
  // Record the cited pages now, so the next check can tell whether they changed without a search.
  const cited = [...new Set(claims.items.map((i) => i.source_url))];
  opts.onStage?.('Recording the pages it cited', `${cited.length} page${cited.length === 1 ? '' : 's'}`);
  await Promise.all(cited.map((url) => checkPage(db, url, { fetcher: deps.fetcher, sleep: deps.sleep })));
  return 'researched';
}

const CLAIMS_WORDS: Record<Exclude<ClaimsOutcome, 'deferred'>, string> = {
  revalidated: 'Pages unchanged — confirmed as current',
  reread: 'Some pages changed and were re-read',
  researched: 'Searched the web',
};

async function checkClaimsFor(deps: EnrichDeps, run: Run, provider: Provider, before: ClaimsRow | undefined, item: RunItem, budget: { left: number }) {
  const { db } = deps;
  run.start(item, 'Starting');
  const { start } = await claimSearch(db, provider.id, null, false);
  if (!start) return run.done(item, 'Skipped — a search was already running for this provider');
  try {
    const outcome = await refreshClaims(deps, provider, before, {
      force: false,
      takeResearch: () => (budget.left > 0 ? (budget.left--, true) : false),
      usage: run.usage,
      onStage: (stage, detail = null) => run.stage(item, stage, detail),
      onDetail: (d) => run.detail(item, d),
    });
    if (outcome === 'deferred') {
      await releaseSearch(db, provider.id, before);
      run.stats.claims.deferred += 1;
      return run.done(item, 'Needs a full web search — left for the next run (search limit reached)');
    }
    run.stats.claims[outcome] += 1;
    return run.done(item, CLAIMS_WORDS[outcome]);
  } catch (err) {
    run.stats.claims.failed += 1;
    await finishSearch(db, provider.id, { error: err instanceof NotesError ? err.message : 'Unexpected error checking this provider.' });
    return run.fail(item, item.stage ?? 'Checking', message(err));
  }
}

/** One enrichment run. Throws EnrichmentBusyError if another is running. */
/** Providers on any application's shortlist (any stage). */
export async function shortlistedIds(db: Queryable): Promise<Set<string>> {
  const rows = await db.query<{ id: string }>(`SELECT DISTINCT e->>'provider_id' AS id FROM application_state, jsonb_array_elements(COALESCE(state->'selection', '[]'::jsonb)) AS e`);
  return new Set(rows.map((r) => r.id).filter(Boolean));
}

/** The areas the active applications are in. */
export async function applicationAreas(db: Queryable): Promise<Area[]> {
  const rows = await db.query<{ postcode: string; suburb: string }>(`SELECT DISTINCT postcode, suburb FROM applications WHERE status = 'active' AND postcode <> '' ORDER BY postcode`);
  const byPostcode = new Map<string, Area>();
  for (const r of rows) if (!byPostcode.has(r.postcode)) byPostcode.set(r.postcode, { postcode: r.postcode, suburb: r.suburb });
  return [...byPostcode.values()];
}

async function discoverArea(deps: EnrichDeps, run: Run, area: Area, item: RunItem, budget: { left: number }) {
  const { db } = deps;
  run.start(item, 'Waiting for a search');
  if (!(budget.left > 0 ? (budget.left--, true) : false)) return run.done(item, 'Left for the next run (search limit reached)');
  try {
    const catalogue = await deps.providers();
    run.stage(item, 'Searching the web with Claude Sonnet', 'usually 1–3 minutes');
    const found = await findProvidersInArea(deps.getAnthropic(), area, catalogue, run.usage);
    run.stage(item, 'Adding to the catalogue', `${found.length} found`);
    const taken = new Set(catalogue.map((p) => p.id));
    let added = 0;
    let updated = 0;
    for (const f of found) {
      const existing = matchCatalogue([f.name], catalogue);
      if (existing) {
        const patch: Partial<Provider> = {};
        if (!existing.source_url && f.price_list_url) patch.source_url = f.price_list_url;
        if (!existing.website && f.website) patch.website = f.website;
        if (!existing.postcodes_served?.includes(area.postcode) && existing.origin) patch.postcodes_served = [...(existing.postcodes_served ?? []), area.postcode];
        if (Object.keys(patch).length) {
          const next = { ...existing, ...patch };
          delete next.special_rates;
          await upsertCatalogue(db, next, null, `Filled in by the provider search for ${areaLabel(area)}`);
          Object.assign(existing, patch);
          updated += 1;
        }
        continue;
      }
      let id = slugify(f.name) || 'provider';
      for (let n = 2; taken.has(id); n++) id = `${slugify(f.name)}-${n}`;
      taken.add(id);
      const provider: Provider = {
        id,
        provider: f.name,
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
        prices_as_at: 'Not read yet',
        prices_as_at_date: null,
        veteran_fit: null,
        flags: [],
        source_url: f.price_list_url,
        website: f.website,
        postcodes_served: [area.postcode],
        origin: { kind: 'search', note: `Found by a search for ${areaLabel(area)}${f.evidence_url ? ` (${f.evidence_url})` : ''}`.slice(0, 300), at: now().slice(0, 10) },
      };
      await upsertCatalogue(db, provider, null, `Found by the provider search for ${areaLabel(area)}`);
      catalogue.push(provider);
      added += 1;
    }
    run.stats.discover.found += found.length;
    run.stats.discover.added += added;
    run.stats.discover.updated += updated;
    return run.done(item, `${found.length} provider${found.length === 1 ? '' : 's'} found: ${added} new, ${updated} filled in`);
  } catch (err) {
    run.stats.discover.failed += 1;
    return run.fail(item, item.stage ?? 'Searching', message(err));
  }
}

/** One enrichment run. Throws EnrichmentBusyError if another is running. */
export async function runEnrichment(deps: EnrichDeps, opts: EnrichOptions): Promise<EnrichmentRun> {
  const run = await startRun(deps.db, opts.trigger);
  const parts = new Set(opts.parts ?? DEFAULT_PARTS);
  try {
    deps.getAnthropic(); // fail early if Claude isn't configured

    // Plan every item first, so the live view can show what's coming and estimate the time.
    const areas = parts.has('discover') ? (opts.areas ?? (await applicationAreas(deps.db))) : [];
    const discover = areas.map((a) => ({ area: a, item: run.add('discover', `Find providers · ${areaLabel(a)}`, null) }));
    await run.save(true);
    const budget = { left: opts.maxResearch ?? 3 };
    // Finding providers first, so what it fills in (price list links) is used by the rest of the run.
    await pool(run, discover, CONCURRENCY.discover, ({ area, item }) => discoverArea(deps, run, area, item, budget));

    const all = await deps.providers();
    // Loaded providers are only checked once someone shortlists them; the rest of the catalogue always.
    const shortlisted = await shortlistedIds(deps.db);
    const providers = opts.providerIds ? all.filter((p) => opts.providerIds!.includes(p.id)) : all.filter((p) => !p.origin || shortlisted.has(p.id));
    run.skipped.not_shortlisted = opts.providerIds ? 0 : all.length - providers.length;

    const prices: PriceTarget[] = [];
    if (parts.has('prices')) {
      const seen = new Set<string>();
      for (const p of providers) {
        if (p.source_url && seen.has(p.source_url)) continue;
        if (p.source_url) seen.add(p.source_url);
        prices.push({ provider: p, item: run.add('prices', `Price list · ${p.provider}`, p.source_url) });
      }
    }
    const sources = parts.has('sources') ? (await listSources(deps.db)).filter((s) => s.active).map((s) => ({ source: s, item: run.add('sources', `Source · ${s.name}`, s.url) })) : [];
    const claims: { provider: Provider; before: ClaimsRow | undefined; item: RunItem }[] = [];
    if (parts.has('claims')) {
      for (const p of providers) {
        const before = await getClaims(deps.db, p.id);
        if (before?.claims && isFresh(before)) run.skipped.claims_current += 1;
        else claims.push({ provider: p, before, item: run.add('claims', `Public claims · ${p.provider}`, p.source_url) });
      }
      run.stats.claims.due = claims.length;
    }
    await run.save(true);

    const pending = (await listSuggestions(deps.db, { status: 'pending' })).filter((s) => s.application_id === null && s.note.startsWith(AUTO_NOTE));
    await pool(run, prices, CONCURRENCY.prices, (t) => checkPrice(deps, run, t, pending, budget));
    await pool(run, sources, CONCURRENCY.sources, ({ source, item }) => checkSource(deps, run, source, item, all));
    await pool(run, claims, CONCURRENCY.claims, ({ provider, before, item }) => checkClaimsFor(deps, run, provider, before, item, budget));

    if (run.cancelled) {
      run.note('Stopped by an admin.');
      await finishRun(run, 'cancelled', 'Stopped by an admin');
    } else await finishRun(run, 'done');
  } catch (err) {
    run.note(`Stopped: ${message(err)}`);
    await finishRun(run, 'failed', message(err));
  }
  return toRun((await deps.db.query('SELECT * FROM enrichment_runs WHERE id = $1', [run.id]))[0]);
}

export { CLAIMS_MAX_AGE_DAYS };
