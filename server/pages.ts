import { createHash } from 'node:crypto';
import { extractText, getDocumentProxy } from 'unpdf';
import type { Queryable } from './db.ts';

// Change detection for the pages enrichment reads. Fetching and hashing costs nothing in model tokens, so
// every check starts here: a page whose content hasn't changed is never sent to Claude again.
//
// PDFs are turned into text here, on the server: comparing text ignores a PDF re-saved with a new
// timestamp, and sending Claude text instead of the whole document is several times faster and cheaper.
// Only a scanned PDF with no text layer goes to Claude as a document.

/** Largest page or PDF we read. */
const MAX_BYTES = 25 * 1024 * 1024;
/** How long a site has to start answering. */
export const RESPONSE_TIMEOUT_MS = 20_000;
/** How long the whole download may take once it starts. Large PDFs on slow hosts need time. */
export const DOWNLOAD_TIMEOUT_MS = 150_000;
/** Tries per page: timeouts, dropped connections, 429 and 5xx answers are retried. */
export const ATTEMPTS = 3;
const RETRY_DELAYS_MS = [3_000, 10_000];
/** A PDF with less text than this per page is treated as scanned. */
const MIN_PDF_TEXT_PER_PAGE = 40;

export interface PageRecord {
  url: string;
  content_hash: string | null;
  etag: string | null;
  last_modified: string | null;
  http_status: number | null;
  error: string | null;
  checked_at: string | null;
  changed_at: string | null;
}

export type PageContent = { kind: 'text'; text: string; pdfPages?: number } | { kind: 'pdf'; data: string };

export type PageCheck =
  /** First time we've seen it: no baseline to compare with. */
  | { status: 'new'; url: string; hash: string; content: PageContent; bytes: number; attempts: number }
  | { status: 'changed'; url: string; hash: string; content: PageContent; bytes: number; attempts: number }
  | { status: 'unchanged'; url: string; bytes: number; attempts: number }
  | { status: 'error'; url: string; error: string; httpStatus: number | null; attempts: number };

/** The fetch the checker uses. Injected so tests never touch the network. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** What the checker is doing right now, for the run's progress view. */
export type PageProgress = (detail: string) => void;

export interface CheckOptions {
  fetcher?: Fetcher;
  onProgress?: PageProgress;
  /** Waits between retries; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Overrides for tests. */
  timeouts?: { responseMs: number; downloadMs: number };
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const toPage = (r: Record<string, unknown>) => ({ ...r, checked_at: iso(r.checked_at), changed_at: iso(r.changed_at) }) as PageRecord;

export async function getPage(db: Queryable, url: string): Promise<PageRecord | undefined> {
  const [r] = await db.query('SELECT * FROM source_pages WHERE url = $1', [url]);
  return r ? toPage(r) : undefined;
}

export async function listPages(db: Queryable): Promise<PageRecord[]> {
  return (await db.query('SELECT * FROM source_pages ORDER BY url')).map(toPage);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…' };

/** Readable text from HTML: drops scripts, styles and markup, keeps line breaks at block ends. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(e[1] === 'x' || e[1] === 'X' ? 2 : 1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

/** The text of a PDF, or null when it has no usable text layer (scanned) or can't be parsed. */
export async function pdfToText(buf: Buffer): Promise<{ text: string; pages: number } | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const joined = (text as string[]).map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`).join('\n\n');
    return joined.replace(/--- Page \d+ ---/g, '').trim().length >= MIN_PDF_TEXT_PER_PAGE * totalPages ? { text: joined, pages: totalPages } : null;
  } catch {
    return null;
  }
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

async function save(db: Queryable, url: string, fields: Partial<PageRecord> & { changed?: boolean }) {
  await db.query(
    `INSERT INTO source_pages (url, content_hash, etag, last_modified, http_status, error, checked_at, changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), CASE WHEN $7 THEN now() END)
     ON CONFLICT (url) DO UPDATE SET
       content_hash = COALESCE($2, source_pages.content_hash),
       etag = COALESCE($3, source_pages.etag),
       last_modified = COALESCE($4, source_pages.last_modified),
       http_status = $5, error = $6, checked_at = now(),
       changed_at = CASE WHEN $7 THEN now() ELSE source_pages.changed_at END`,
    [url, fields.content_hash ?? null, fields.etag ?? null, fields.last_modified ?? null, fields.http_status ?? null, fields.error ?? null, !!fields.changed],
  );
}

class FetchError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
  }
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const HTTP_WORDS: Record<number, string> = {
  401: 'the site wants a login',
  403: 'the site refused the check (it may block automated visits)',
  404: 'page not found — the link may have moved',
  410: 'page removed',
  429: 'the site asked us to slow down',
};

/** One attempt: a time limit to start answering, then a separate, longer one for the download. */
async function fetchOnce(
  url: string,
  headers: Record<string, string>,
  fetcher: Fetcher,
  onProgress: PageProgress | undefined,
  { responseMs, downloadMs }: { responseMs: number; downloadMs: number },
): Promise<{ res: Response; buf: Buffer | null }> {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(new FetchError(`no answer within ${responseMs / 1000} seconds`, true)), responseMs);
  let res: Response;
  try {
    res = await fetcher(url, { headers, redirect: 'follow', signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    if (ctrl.signal.reason instanceof FetchError) throw ctrl.signal.reason;
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    throw new FetchError(cause?.code === 'ENOTFOUND' ? 'the site address could not be found' : `connection failed${cause?.message ? ` (${cause.message})` : ''}`, cause?.code !== 'ENOTFOUND');
  }
  clearTimeout(timer);
  if (res.status === 304) return { res, buf: null };
  if (!res.ok) {
    void res.body?.cancel().catch(() => undefined);
    const words = HTTP_WORDS[res.status] ?? (res.status >= 500 ? 'the site had a server error' : 'unexpected answer');
    throw new FetchError(`HTTP ${res.status}: ${words}`, res.status === 429 || res.status >= 500, res.status);
  }
  const declared = Number(res.headers.get('content-length')) || null;
  if (declared && declared > MAX_BYTES) throw new FetchError(`file is too large (${mb(declared)}; limit ${mb(MAX_BYTES)})`, false, res.status);
  timer = setTimeout(() => ctrl.abort(new FetchError(`download took longer than ${downloadMs / 1000} seconds`, true)), downloadMs);
  try {
    if (!res.body) return { res, buf: Buffer.from(await res.arrayBuffer()) };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    let lastReport = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new FetchError(`file is too large (over ${mb(MAX_BYTES)})`, false, res.status);
      }
      chunks.push(value);
      if (onProgress && got - lastReport > 256 * 1024) {
        lastReport = got;
        onProgress(`${mb(got)}${declared ? ` of ${mb(declared)}` : ''}`);
      }
    }
    return { res, buf: Buffer.concat(chunks) };
  } catch (err) {
    if (ctrl.signal.reason instanceof FetchError) throw ctrl.signal.reason;
    if (err instanceof FetchError) throw err;
    throw new FetchError(`download interrupted (${err instanceof Error ? err.message : 'unknown error'})`, true, res.status);
  } finally {
    clearTimeout(timer);
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fetches a page and compares it with what we saw last time. Sends the stored ETag / Last-Modified so an
 * unchanged page can come back as 304 without its body. HTML and PDFs are compared on their text.
 * Slow or failing sites are retried; the result says how many attempts it took.
 */
export async function checkPage(db: Queryable, url: string, opts: CheckOptions = {}): Promise<PageCheck> {
  const { fetcher = fetch, onProgress, sleep = wait, timeouts = { responseMs: RESPONSE_TIMEOUT_MS, downloadMs: DOWNLOAD_TIMEOUT_MS } } = opts;
  const before = await getPage(db, url);
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; ProviderAssessor/1.0; family aged-care research; +https://assessor.quantivate.com.au)',
    Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5',
    'Accept-Language': 'en-AU,en;q=0.8',
  };
  if (before?.content_hash && before.etag) headers['If-None-Match'] = before.etag;
  if (before?.content_hash && before.last_modified) headers['If-Modified-Since'] = before.last_modified;

  let got: { res: Response; buf: Buffer | null } | undefined;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    onProgress?.(attempts === 1 ? 'Connecting' : `Connecting (try ${attempts} of ${ATTEMPTS})`);
    try {
      got = await fetchOnce(url, headers, fetcher, onProgress, timeouts);
      break;
    } catch (err) {
      const e = err instanceof FetchError ? err : new FetchError(err instanceof Error ? err.message : 'could not fetch the page', true);
      if (!e.retry || attempts >= ATTEMPTS) {
        const error = attempts > 1 ? `${e.message} (tried ${attempts} times)` : e.message;
        await save(db, url, { http_status: e.httpStatus, error });
        return { status: 'error', url, error, httpStatus: e.httpStatus, attempts };
      }
      onProgress?.(`${e.message[0].toUpperCase()}${e.message.slice(1)} — trying again`);
      await sleep(RETRY_DELAYS_MS[attempts - 1] ?? 10_000);
    }
  }

  const { res, buf } = got;
  if (!buf) {
    if (before?.content_hash) {
      await save(db, url, { http_status: 304 });
      return { status: 'unchanged', url, bytes: 0, attempts };
    }
    const error = 'the site said "not modified" but we have no copy yet';
    await save(db, url, { http_status: 304, error });
    return { status: 'error', url, error, httpStatus: 304, attempts };
  }

  const type = res.headers.get('content-type') ?? '';
  const isPdf = /pdf/i.test(type) || buf.subarray(0, 5).toString() === '%PDF-';
  let content: PageContent;
  if (isPdf) {
    onProgress?.(`Reading the PDF's text (${mb(buf.length)})`);
    const pdf = await pdfToText(buf);
    content = pdf ? { kind: 'text', text: pdf.text, pdfPages: pdf.pages } : { kind: 'pdf', data: buf.toString('base64') };
  } else {
    const raw = buf.toString('utf8');
    content = { kind: 'text', text: /html/i.test(type) || /^\s*</.test(raw.slice(0, 200)) ? htmlToText(raw) : raw };
  }
  const hash = sha256(content.kind === 'pdf' ? buf : content.text);
  const fields = { content_hash: hash, etag: res.headers.get('etag'), last_modified: res.headers.get('last-modified'), http_status: res.status, error: null };
  if (before?.content_hash === hash) {
    await save(db, url, fields);
    return { status: 'unchanged', url, bytes: buf.length, attempts };
  }
  await save(db, url, { ...fields, changed: true });
  return { status: before?.content_hash ? 'changed' : 'new', url, hash, content, bytes: buf.length, attempts };
}

/** Forgets a page's hash so the next check treats it as new: used when reading a changed page failed. */
export async function forgetPage(db: Queryable, url: string): Promise<void> {
  await db.query('UPDATE source_pages SET content_hash = NULL, etag = NULL, last_modified = NULL WHERE url = $1', [url]);
}
