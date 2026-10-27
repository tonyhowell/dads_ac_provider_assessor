import { createHash } from 'node:crypto';
import type { Queryable } from './db.ts';

// Change detection for the pages enrichment reads. Fetching and hashing costs nothing in model tokens, so
// every check starts here: a page whose content hash hasn't changed is never sent to Claude again.

/** Largest page or PDF we read. Price lists are small; anything bigger is skipped with an error. */
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

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

export type PageContent = { kind: 'text'; text: string } | { kind: 'pdf'; data: string };

export type PageCheck =
  /** First time we've seen it: no baseline to compare with. */
  | { status: 'new'; url: string; hash: string; content: PageContent }
  | { status: 'changed'; url: string; hash: string; content: PageContent }
  | { status: 'unchanged'; url: string }
  | { status: 'error'; url: string; error: string };

/** The fetch the checker uses. Injected so tests never touch the network. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));

export async function getPage(db: Queryable, url: string): Promise<PageRecord | undefined> {
  const [r] = await db.query('SELECT * FROM source_pages WHERE url = $1', [url]);
  return r ? ({ ...r, checked_at: iso(r.checked_at), changed_at: iso(r.changed_at) } as PageRecord) : undefined;
}

export async function listPages(db: Queryable): Promise<PageRecord[]> {
  return (await db.query('SELECT * FROM source_pages ORDER BY url')).map((r) => ({ ...r, checked_at: iso(r.checked_at), changed_at: iso(r.changed_at) }) as PageRecord);
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

/**
 * Fetches a page and compares it with what we saw last time. Sends the stored ETag / Last-Modified so an
 * unchanged page can come back as 304 without its body. HTML is compared on its text, so a changed script
 * or tracking tag doesn't count as a change.
 */
export async function checkPage(db: Queryable, url: string, fetcher: Fetcher = fetch): Promise<PageCheck> {
  const before = await getPage(db, url);
  const headers: Record<string, string> = { 'User-Agent': 'ProviderAssessor/1.0 (family aged-care research; +https://assessor.quantivate.com.au)', Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5' };
  if (before?.content_hash && before.etag) headers['If-None-Match'] = before.etag;
  if (before?.content_hash && before.last_modified) headers['If-Modified-Since'] = before.last_modified;
  let res: Response;
  try {
    res = await fetcher(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Could not fetch the page';
    await save(db, url, { error });
    return { status: 'error', url, error };
  }
  if (res.status === 304 && before?.content_hash) {
    await save(db, url, { http_status: 304 });
    return { status: 'unchanged', url };
  }
  if (!res.ok) {
    const error = `HTTP ${res.status}`;
    await save(db, url, { http_status: res.status, error });
    return { status: 'error', url, error };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    const error = 'Page is too large to read';
    await save(db, url, { http_status: res.status, error });
    return { status: 'error', url, error };
  }
  const type = res.headers.get('content-type') ?? '';
  const isPdf = /pdf/i.test(type) || buf.subarray(0, 5).toString() === '%PDF-';
  const content: PageContent = isPdf ? { kind: 'pdf', data: buf.toString('base64') } : { kind: 'text', text: /html/i.test(type) || /^\s*</.test(buf.toString('utf8', 0, 200)) ? htmlToText(buf.toString('utf8')) : buf.toString('utf8') };
  const hash = sha256(content.kind === 'pdf' ? buf : content.text);
  const fields = { content_hash: hash, etag: res.headers.get('etag'), last_modified: res.headers.get('last-modified'), http_status: res.status, error: null };
  if (before?.content_hash === hash) {
    await save(db, url, fields);
    return { status: 'unchanged', url };
  }
  await save(db, url, { ...fields, changed: true });
  return { status: before?.content_hash ? 'changed' : 'new', url, hash, content };
}

/** Forgets a page's hash so the next check treats it as new: used when reading a changed page failed. */
export async function forgetPage(db: Queryable, url: string): Promise<void> {
  await db.query('UPDATE source_pages SET content_hash = NULL, etag = NULL, last_modified = NULL WHERE url = $1', [url]);
}
