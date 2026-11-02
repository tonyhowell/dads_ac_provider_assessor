import { createHash, randomUUID } from 'node:crypto';
import readXlsxFile from 'read-excel-file/node';
import type { Db, Queryable } from './db.ts';
import { catalogueEdits, upsertCatalogue } from './catalogue.ts';
import { effectiveProviders } from '../src/state/reducer.ts';
import { candidateToProvider, findHeader, groupProviders, isHomeCare, toServices, type Cell, type GenService } from '../src/genLoad.ts';
import { parseCsv } from '../src/csv.ts';
import type { Provider } from '../src/types.ts';
import type { Fetcher } from './pages.ts';

// Automatic import of the government's aged care service list (AIHW GEN). The server finds the newest list
// (from a page that links to it, or a direct file link), downloads it, and only does anything when the file
// has changed. Home care providers new to the catalogue are added, marked "from the government list";
// providers loaded from an earlier list get their outlets refreshed; ones that drop off the list are flagged
// (never deleted — they may have changed name). Hand-entered providers are never overwritten. No Claude calls.

export const DEFAULT_GEN_PAGE = 'https://www.gen-agedcaredata.gov.au/topics/providers-of-aged-care';
const MAX_BYTES = 60 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const UA = 'ProviderAssessor/1.0 (+https://assessor.quantivate.com.au; aged care provider list import)';

export interface GenSettings {
  /** A page that links to the list, or the file itself (.xlsx or .csv). */
  url: string;
  /** Whole country, or only the planning regions (or states) around active applications. */
  scope: 'national' | 'regions';
  /** Check on the schedule (GEN_IMPORT_EVERY_HOURS). */
  auto: boolean;
}

export interface GenImportStats {
  services?: number;
  home_care?: number;
  providers?: number;
  added?: number;
  updated?: number;
  unchanged?: number;
  missing?: number;
  back?: number;
  kept_by_hand?: number;
}

export interface GenImportRun {
  id: string;
  trigger: string;
  status: 'running' | 'done' | 'unchanged' | 'failed';
  source_url: string;
  file_url: string | null;
  as_at: string | null;
  stats: GenImportStats;
  log: string[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export class GenImportError extends Error {}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

export async function getGenSettings(db: Queryable, envUrl?: string): Promise<GenSettings> {
  const rows = await db.query<{ value: Partial<GenSettings> }>("SELECT value FROM app_settings WHERE key = 'gen_import'");
  const v = rows[0]?.value ?? {};
  return { url: v.url || envUrl || DEFAULT_GEN_PAGE, scope: v.scope === 'regions' ? 'regions' : 'national', auto: v.auto ?? true };
}

export async function saveGenSettings(db: Queryable, settings: GenSettings, userId: string | null): Promise<void> {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_by) VALUES ('gen_import', $1::jsonb, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(settings), userId],
  );
}

const toRun = (r: Record<string, unknown>): GenImportRun => ({
  id: r.id as string,
  trigger: r.trigger as string,
  status: r.status as GenImportRun['status'],
  source_url: r.source_url as string,
  file_url: (r.file_url as string | null) ?? null,
  as_at: day(r.as_at),
  stats: (r.stats as GenImportStats) ?? {},
  log: (r.log as string[]) ?? [],
  error: (r.error as string | null) ?? null,
  started_at: iso(r.started_at)!,
  finished_at: iso(r.finished_at),
});

export async function listGenImports(db: Queryable, limit = 10): Promise<GenImportRun[]> {
  return (await db.query('SELECT * FROM gen_imports ORDER BY started_at DESC LIMIT $1', [limit])).map(toRun);
}

/** An import left "running" by a restart can't finish: mark it failed. */
export async function reapGenImports(db: Queryable): Promise<void> {
  await db.query("UPDATE gen_imports SET status = 'failed', error = 'Stopped by a server restart.', finished_at = now() WHERE status = 'running'");
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The date a list is "as at", from its link text or file name: "30 June 2025", "2025-06-30", "june-2025", "2025-06". */
export function listDate(text: string): string | null {
  const t = decodeURIComponent(text).toLowerCase().replace(/[_-]+/g, ' ');
  const pad = (n: number) => String(n).padStart(2, '0');
  let m = t.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d\d)/);
  if (m) return `${m[3]}-${pad(MONTHS.indexOf(m[2]) + 1)}-${pad(Number(m[1]))}`;
  m = t.match(/(20\d\d)\s?(\d\d)\s?(\d\d)(?!\d)/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d\d)/);
  if (m) return `${m[2]}-${pad(MONTHS.indexOf(m[1]) + 1)}-01`;
  m = t.match(/(20\d\d)\s(\d\d)(?!\d)/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]}-01`;
  return null;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Links on a page, with their text. */
export function pageLinks(html: string, base: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      out.push({ href: new URL(decode(m[1]), base).toString(), text: decode(m[2]) });
    } catch {
      /* not a usable link */
    }
  }
  return out;
}

const isFile = (href: string) => /\.(xlsx|csv)(\?|#|$)/i.test(href);
/** A link that's probably a download of the list even when its address doesn't end in .xlsx (CMS download links). */
const looksLikeDownload = (l: { href: string; text: string }) => isFile(l.href) || /\b(xlsx|excel|csv)\b/i.test(l.text) || /\/getmedia\/|\/download(\b|\/|\?|$)|\/media\/\d+/i.test(l.href);
const isServiceList = (l: { href: string; text: string }) => /service[\s_-]*list|service[\s_-]*information/i.test(`${l.text} ${decodeURIComponent(l.href)}`);
const NATIONAL = /australia|national|all[\s_-]*states/i;
const MONTH_SLUGS = ['october', 'september', 'november', 'december', 'august'];

/** GEN's release pages follow a pattern: /resources/access-data/2025/october/aged-care-service-list-30-june-2025. */
export function releaseGuesses(base: string, today = new Date()): string[] {
  const origin = new URL(base).origin;
  const year = today.getFullYear();
  const out: string[] = [];
  for (const y of [year, year - 1, year - 2]) for (const m of MONTH_SLUGS) out.push(`${origin}/resources/access-data/${y}/${m}/aged-care-service-list-30-june-${y}`);
  return out;
}

/**
 * The newest service list files linked from a page. GEN publishes an Australia-wide file and one per state for each
 * release: the Australia-wide one is used when there is one. Follows links to "service list" release pages, and
 * if the page links to none, tries GEN's usual release addresses.
 */
export async function findListFiles(url: string, get: (url: string) => Promise<Response>, log: (s: string) => void, today = new Date()): Promise<string[]> {
  if (isFile(url)) return [url];
  const pick = (links: { href: string; text: string }[]) => {
    const files = links.filter(looksLikeDownload);
    const wanted = files.filter(isServiceList);
    // On a release page every file is part of the list, even if its name doesn't say so.
    const pool = (wanted.length ? wanted : files).map((l) => ({ ...l, date: listDate(`${l.text} ${l.href}`) ?? '' }));
    if (!pool.length) return [];
    const newest = pool.reduce((d, l) => (l.date > d ? l.date : d), '');
    const latest = pool.filter((l) => l.date === newest);
    const national = latest.filter((l) => NATIONAL.test(`${l.text} ${decodeURIComponent(l.href)}`));
    return [...new Set((national.length ? national.slice(0, 1) : latest).map((l) => l.href))];
  };
  const read = async (u: string, quiet = false): Promise<{ href: string; text: string }[] | null> => {
    const res = await get(u);
    if (!res.ok) {
      if (quiet) return null;
      throw new GenImportError(`${u} answered ${res.status}.`);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!/html/i.test(type)) throw new GenImportError(`${u} isn't a web page or a list file (${type || 'unknown type'}).`);
    return pageLinks(await res.text(), u);
  };
  const links = (await read(url))!;
  log(`${links.length} links on ${url}; ${links.filter(looksLikeDownload).length} look like downloads.`);
  // Files on this page, when they're clearly the service list (a release page, or a file list).
  if (links.some((l) => looksLikeDownload(l) && isServiceList(l)) || /aged-care-service-list/i.test(url)) {
    const here = pick(links);
    if (here.length) return here;
  }
  const releases = links
    .filter((l) => isServiceList(l) && !looksLikeDownload(l) && new URL(l.href).host === new URL(url).host && l.href.split('#')[0] !== url.split('#')[0])
    .map((l) => ({ ...l, date: listDate(`${l.text} ${l.href}`) ?? '' }))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const page of releases.slice(0, 3)) {
    log(`Looking on ${page.href}`);
    const found = pick((await read(page.href, true)) ?? []);
    if (found.length) return found;
  }
  // GEN's usual release addresses, newest first.
  if (/gen-agedcaredata\.gov\.au$/i.test(new URL(url).host) || /gen\.example$/.test(new URL(url).host)) {
    for (const guess of releaseGuesses(url, today)) {
      const found = await read(guess, true);
      if (!found) continue;
      log(`Found the release page ${guess}`);
      const files = pick(found);
      if (files.length) return files;
    }
  }
  throw new GenImportError(`No service list file (.xlsx or .csv) found on ${url}. Paste the release page (for example …/aged-care-service-list-30-june-2025) or the file's own link instead.`);
}

/** Every sheet's rows (CSV is one sheet). */
export async function readRows(bytes: Buffer, fileUrl: string, contentType: string): Promise<Cell[][][]> {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b; // .xlsx files are zip archives
  if (!zip && (/\.csv(\?|#|$)/i.test(fileUrl) || /text\/(csv|plain)/i.test(contentType))) return [parseCsv(bytes.toString('utf8'))];
  if (!zip) throw new GenImportError(`${fileUrl} isn't an Excel or CSV file (${contentType || 'unknown type'}).`);
  const sheets = await readXlsxFile(bytes);
  return sheets.map((s) => s.data as Cell[][]);
}

/** Services from every sheet that looks like the service list (other sheets are notes). */
export function servicesFrom(sheets: Cell[][][]): GenService[] {
  const out: GenService[] = [];
  for (const rows of sheets) {
    const header = findHeader(rows);
    if (header) out.push(...toServices(rows, header.index, header.mapping));
  }
  if (out.length) return out;
  throw new GenImportError("Couldn't find the provider columns in the file (looked for provider name, suburb, postcode and care type).");
}

const sameList = (a: string[] | undefined, b: string[] | undefined) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

/** Works out what changes in the catalogue. Pure, so it can be tested without a database. */
export function planImport(services: GenService[], catalogue: Provider[], opts: { asAt: string; note: string; regions: Set<string> | null }) {
  const home = services.filter(isHomeCare);
  const kept = opts.regions ? home.filter((s) => opts.regions!.has(s.region || s.state || 'Unknown')) : home;
  const candidates = groupProviders(kept, catalogue);
  const taken = new Set(catalogue.map((p) => p.id));
  const add: Provider[] = [];
  const update: { provider: Provider; change: string }[] = [];
  const stats: GenImportStats = { services: services.length, home_care: home.length, providers: candidates.length, added: 0, updated: 0, unchanged: 0, missing: 0, back: 0, kept_by_hand: 0 };
  const seen = new Set<string>();

  for (const c of candidates) {
    if (!c.existing) {
      add.push(candidateToProvider(c, taken, opts.asAt, opts.note));
      stats.added!++;
      continue;
    }
    const p = c.existing;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const fresh = candidateToProvider(c, new Set(), opts.asAt, opts.note);
    if (p.origin?.kind === 'gen') {
      const wasMissing = !!p.origin.missing_since;
      const next: Provider = { ...p, outlet: fresh.outlet, locations: fresh.locations, type: p.type ?? fresh.type, origin: { kind: 'gen', note: opts.note.slice(0, 300), at: p.origin.at } };
      if (wasMissing || p.outlet !== next.outlet || !sameList(p.locations, next.locations)) {
        update.push({ provider: next, change: wasMissing ? `Back on the government service list (${opts.note})` : `Outlets updated from the government service list (${opts.note})` });
        if (wasMissing) stats.back!++;
        else stats.updated!++;
      } else stats.unchanged!++;
    } else if (!p.locations?.length && fresh.locations?.length) {
      // Entered by hand: only fill in where its outlets are, if we didn't know.
      update.push({ provider: { ...p, locations: fresh.locations }, change: `Outlet locations added from the government service list (${opts.note})` });
      stats.updated!++;
    } else stats.kept_by_hand!++;
  }

  // Loaded from an earlier list but not on this one. With a regional import, only judge providers in those regions.
  if (!opts.regions) {
    for (const p of catalogue) {
      if (p.origin?.kind !== 'gen' || seen.has(p.id) || p.origin.missing_since) continue;
      update.push({ provider: { ...p, origin: { ...p.origin, missing_since: opts.asAt } }, change: `Not on the government service list as at ${opts.asAt}` });
      stats.missing!++;
    }
  }
  return { add, update, stats };
}

export interface GenImportDeps {
  db: Db;
  seedProviders: Provider[];
  envUrl?: string;
  fetcher?: Fetcher;
}

/** Runs one import. Returns the finished run record. */
export async function runGenImport(deps: GenImportDeps, opts: { trigger: string; userId?: string | null; force?: boolean }): Promise<GenImportRun> {
  const { db } = deps;
  const fetcher = deps.fetcher ?? fetch;
  const running = await db.query("SELECT id FROM gen_imports WHERE status = 'running' AND started_at > now() - interval '30 minutes'");
  if (running.length) throw new GenImportError('An import is already running.');
  const settings = await getGenSettings(db, deps.envUrl);
  const id = randomUUID();
  const log: string[] = [];
  const note = (s: string) => log.push(s);
  await db.query('INSERT INTO gen_imports (id, trigger, status, source_url) VALUES ($1, $2, $3, $4)', [id, opts.trigger, 'running', settings.url]);
  const finish = async (status: GenImportRun['status'], fields: { file_url?: string; sha256?: string; as_at?: string | null; stats?: GenImportStats; error?: string }) => {
    await db.query('UPDATE gen_imports SET status = $2, file_url = $3, sha256 = $4, as_at = $5, stats = $6::jsonb, log = $7::jsonb, error = $8, finished_at = now() WHERE id = $1', [
      id,
      status,
      fields.file_url ?? null,
      fields.sha256 ?? null,
      fields.as_at ?? null,
      JSON.stringify(fields.stats ?? {}),
      JSON.stringify(log.slice(-50)),
      fields.error ?? null,
    ]);
    return toRun((await db.query('SELECT * FROM gen_imports WHERE id = $1', [id]))[0]);
  };

  const get = async (url: string) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetcher(url, { headers: { 'user-agent': UA, accept: 'text/html,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,*/*' }, redirect: 'follow', signal: ctrl.signal });
    } catch (err) {
      throw new GenImportError(`Couldn't reach ${new URL(url).host}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  };

  let fileUrl: string | undefined;
  try {
    note(`Source: ${settings.url}`);
    const files = await findListFiles(settings.url, get, note);
    fileUrl = files.length === 1 ? files[0] : `${files.length} files: ${files.map((f) => decodeURIComponent(f.split('/').pop() ?? f)).join(', ')}`.slice(0, 2000);
    note(`Files: ${files.join(' ')}`);
    const hash = createHash('sha256');
    const sheets: Cell[][][] = [];
    const downloads: { url: string; bytes: Buffer; type: string }[] = [];
    let total = 0;
    for (const f of [...files].sort()) {
      const res = await get(f);
      if (!res.ok) throw new GenImportError(`${f} answered ${res.status}.`);
      const bytes = Buffer.from(await res.arrayBuffer());
      total += bytes.length;
      if (total > MAX_BYTES) throw new GenImportError('The files come to over 60 MB.');
      hash.update(bytes);
      downloads.push({ url: f, bytes, type: res.headers.get('content-type') ?? '' });
    }
    const sha256 = hash.digest('hex');
    const asAt = files.map(listDate).find(Boolean) ?? new Date().toISOString().slice(0, 10);
    const last = await db.query<{ sha256: string }>("SELECT sha256 FROM gen_imports WHERE status = 'done' AND sha256 IS NOT NULL ORDER BY started_at DESC LIMIT 1");
    if (!opts.force && last[0]?.sha256 === sha256) {
      note('Same files as the last import: nothing to do.');
      return await finish('unchanged', { file_url: fileUrl, sha256, as_at: asAt });
    }
    for (const d of downloads) sheets.push(...(await readRows(d.bytes, d.url, d.type)));

    const services = servicesFrom(sheets);
    note(`${services.length} services read.`);
    const catalogue = effectiveProviders(deps.seedProviders, (await catalogueEdits(db)).providers);
    let regions: Set<string> | null = null;
    if (settings.scope === 'regions') {
      const postcodes = new Set(
        (await db.query<{ postcode: string }>("SELECT DISTINCT postcode FROM applications WHERE status = 'active' AND postcode <> ''")).map((r) => r.postcode),
      );
      regions = new Set(services.filter((s) => postcodes.has(s.postcode)).map((s) => s.region || s.state || 'Unknown'));
      note(`Regions around active applications: ${[...regions].join(', ') || 'none found'}.`);
    }
    const listNote = `service list as at ${asAt}`;
    const plan = planImport(services, catalogue, { asAt, note: listNote, regions });
    await db.transaction(async (tx) => {
      for (const p of plan.add) await upsertCatalogue(tx, p, opts.userId ?? null, `Loaded from the government service list (${listNote})`);
      for (const u of plan.update) await upsertCatalogue(tx, u.provider, opts.userId ?? null, u.change);
    });
    note(`Added ${plan.stats.added}, updated ${plan.stats.updated}, flagged missing ${plan.stats.missing}.`);
    return await finish('done', { file_url: fileUrl, sha256, as_at: asAt, stats: plan.stats });
  } catch (err) {
    const message = err instanceof GenImportError ? err.message : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    if (!(err instanceof GenImportError)) console.error('[gen-import]', err);
    console.log(`[gen-import] steps: ${log.join(' | ')}`);
    return await finish('failed', { file_url: fileUrl, error: message });
  }
}
