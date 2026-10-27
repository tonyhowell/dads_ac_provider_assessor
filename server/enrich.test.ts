// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createPgliteDb, migrate, type Db } from './db.ts';
import { readFileSync } from 'node:fs';
import { EnrichmentBusyError, activeRun, addSource, readPrices, recoverAfterRestart, listRuns, listSources, priceChanges, requestCancel, runEnrichment, type EnrichDeps, type PriceList, type RunProgress } from './enrich.ts';
import { checkPage, htmlToText, type Fetcher } from './pages.ts';
import { getClaims } from './claims.ts';
import { catalogueEdits, listSuggestions } from './catalogue.ts';
import { UsageTally } from './usage.ts';
import { loadSeedData } from '../src/data/load.ts';
import type { Claims, Provider } from '../src/types.ts';

let db: Db;
const seed = loadSeedData();
const bolton = seed.providers.find((p) => p.id === 'bolton-clarke')!;
const PRICE_URL = bolton.source_url!;
const topics = [
  { id: 'C1', text: 'Same workers?' },
  { id: 'E1', text: 'Veteran training?' },
];

/** The fake web: url → body. Counts fetches. */
const web = new Map<string, string>();
const fetches: string[] = [];
const fetcher: Fetcher = async (url) => {
  fetches.push(url);
  return web.has(url) ? new Response(web.get(url), { headers: { 'content-type': 'text/html' } }) : new Response('Not found', { status: 404 });
};

const usage = { input_tokens: 1000, output_tokens: 200 };
const prices = (over: Partial<PriceList['rates']> = {}, asAt = '1 Jul 2026'): PriceList => ({
  is_price_list: true,
  prices_as_at: asAt,
  rates: { rn: 189, en: 157, pc: 126, domestic: 112, social: 112, respite: 112, gardening: 113, care_mgmt: 155, ...over },
  notes: [],
});

function fakeClaude(parsed: unknown[]) {
  const parse = vi.fn(async (_params: unknown) => ({ stop_reason: 'end_turn', usage, parsed_output: parsed.shift() }));
  const stream = vi.fn((_params: unknown): { finalMessage: () => Promise<unknown> } => ({ finalMessage: async () => ({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'notes' }] }) }));
  return { parse, stream, client: { beta: { messages: { parse, stream } } } as unknown as Anthropic };
}

const deps = (client: Anthropic, providers: Provider[] = [bolton]): EnrichDeps => ({ db, getAnthropic: () => client, providers: async () => providers, topics, fetcher, sleep: async () => {} });

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
});
afterAll(() => db.close());
beforeEach(async () => {
  web.clear();
  fetches.length = 0;
  await db.query('TRUNCATE provider_suggestions, provider_claims, source_pages, enrichment_sources, enrichment_runs, provider_price_checks, provider_catalogue, provider_history, applications, application_state CASCADE');
});

describe('price lists', () => {
  it('reads a price list only when it changes, and suggests price changes for approval', async () => {
    web.set(PRICE_URL, '<html><script>var t=1</script><p>Personal care $130 per hour</p></html>');
    const fake = fakeClaude([prices({ pc: 130 }, '1 Oct 2026')]);
    const first = await runEnrichment(deps(fake.client), { trigger: 'cli', parts: ['prices'] });
    expect(first.status).toBe('done');
    expect(first.stats.prices).toMatchObject({ checked: 1, changed: 1, suggestions: 1 });
    // Haiku did the reading, with low effort.
    expect(fake.parse.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } });
    const [s] = await listSuggestions(db, { status: 'pending' });
    expect(s).toMatchObject({ provider_id: 'bolton-clarke', application_id: null, proposed: { pc: 130, prices_as_at: '1 Oct 2026', prices_as_at_date: '2026-10-01', gardening: 113 } });
    expect(s.note).toMatch(/^Automatic price check .* pc \$126 → \$130/);

    // Only a script changed: same text, so no model call.
    web.set(PRICE_URL, '<html><script>var t=2</script><p>Personal care $130 per hour</p></html>');
    const second = await runEnrichment(deps(fake.client), { trigger: 'cli', parts: ['prices'] });
    expect(second.stats.prices).toMatchObject({ checked: 1, unchanged: 1, changed: 0 });
    expect(fake.parse).toHaveBeenCalledTimes(1);
    expect(second.usage).toMatchObject({ estimated_cost_usd: 0 });

    // Changed again with the same prices: no duplicate suggestion.
    web.set(PRICE_URL, '<p>Personal care $130 per hour (updated)</p>');
    fake.parse.mockResolvedValueOnce({ stop_reason: 'end_turn', usage, parsed_output: prices({ pc: 130 }, '1 Oct 2026') } as never);
    const third = await runEnrichment(deps(fake.client), { trigger: 'cli', parts: ['prices'] });
    expect(third.log.join('\n')).toMatch(/already waiting for approval/);
    expect(await listSuggestions(db, { status: 'pending' })).toHaveLength(1);
  });

  it("doesn't suggest anything when the prices match, and retries a page it couldn't read", async () => {
    web.set(PRICE_URL, '<p>Prices</p>');
    const fake = fakeClaude([prices()]);
    expect((await runEnrichment(deps(fake.client), { trigger: 'cli', parts: ['prices'] })).stats.prices).toMatchObject({ matched: 1, suggestions: 0 });

    web.set(PRICE_URL, '<p>Prices, new</p>');
    fake.parse.mockRejectedValueOnce(new Error('overloaded'));
    const failed = await runEnrichment(deps(fake.client), { trigger: 'cli', parts: ['prices'] });
    expect(failed.stats.prices!.errors).toBe(1);
    // The page is forgotten, so the next run reads it again even though it hasn't changed since.
    fake.parse.mockResolvedValueOnce({ stop_reason: 'end_turn', usage, parsed_output: prices() } as never);
    const retried = await runEnrichment(deps(fake.client), { trigger: 'cli', parts: ['prices'] });
    expect(retried.stats.prices).toMatchObject({ changed: 1, matched: 1 });
  });

  it('compares prices to the catalogue, ignoring differences under 50 cents', () => {
    expect(priceChanges(bolton, prices({ pc: 126.3, rn: 200, gardening: null }))).toEqual({ rn: { from: 189, to: 200 } });
  });
});

describe('extra sources', () => {
  it('summarises a source when it changes, keeping only catalogue ids it recognises', async () => {
    const source = await addSource(db, { name: 'Register', url: 'https://register.example/list', note: '' }, null as unknown as string);
    web.set(source.url, '<table><tr><td>Bolton Clarke</td><td>Registered</td></tr></table>');
    const fake = fakeClaude([
      {
        summary: 'Lists registered providers.',
        mentions: [
          { provider_id: 'bolton-clarke', provider_name: 'Bolton Clarke', fact: 'Registered', quote: 'Registered' },
          { provider_id: 'made-up', provider_name: 'Other', fact: 'Registered', quote: 'Registered' },
        ],
      },
    ]);
    const run = await runEnrichment(deps(fake.client), { trigger: 'admin', parts: ['sources'] });
    expect(run.stats.sources).toMatchObject({ checked: 1, summarised: 1 });
    const [saved] = await listSources(db);
    expect(saved.summary).toMatchObject({ change: 'new', mentions: [{ provider_id: 'bolton-clarke' }, { provider_id: null }] });
    // The page text, not its markup, went to Claude.
    expect(JSON.stringify(fake.parse.mock.calls[0][0])).toContain('Bolton Clarke | Registered');
  });
});

describe('public claims after 60 days', () => {
  const PAGE = 'https://www.boltonclarke.com.au/veterans';
  const claims: Claims = {
    website: 'https://www.boltonclarke.com.au',
    overview: 'x',
    items: [
      { question_id: 'E1', status: 'stated', claim: 'Veterans team', quote: 'veterans team', source_url: PAGE, source_title: 'Veterans' },
      { question_id: 'C1', status: 'partly', claim: 'Regular workers', quote: 'regular', source_url: 'https://www.boltonclarke.com.au/care', source_title: 'Care' },
    ],
  };
  /** Claims found by a full search 90 days ago and last confirmed 70 days ago. */
  async function oldClaims() {
    await db.query(
      `INSERT INTO provider_claims (provider_id, status, claims, started_at, finished_at, researched_at) VALUES ('bolton-clarke', 'ready', $1::jsonb, now() - interval '70 days', now() - interval '70 days', now() - interval '90 days')`,
      [JSON.stringify(claims)],
    );
  }

  it('confirms claims without Claude when their pages are unchanged', async () => {
    await oldClaims();
    web.set(PAGE, '<p>Our veterans team</p>');
    web.set('https://www.boltonclarke.com.au/care', '<p>Regular workers</p>');
    const fake = fakeClaude([]);
    // First check records a baseline: both pages are new, so they're re-read once.
    fake.parse.mockResolvedValueOnce({ stop_reason: 'end_turn', usage, parsed_output: { items: claims.items } } as never);
    expect((await runEnrichment(deps(fake.client), { trigger: 'cli', parts: ['claims'] })).stats.claims).toMatchObject({ due: 1, reread: 1 });

    await db.query(`UPDATE provider_claims SET finished_at = now() - interval '61 days'`);
    const run = await runEnrichment(deps(fake.client), { trigger: 'cli', parts: ['claims'] });
    expect(run.stats.claims).toMatchObject({ due: 1, revalidated: 1, researched: 0 });
    expect(fake.parse).toHaveBeenCalledTimes(1);
    expect(fake.stream).not.toHaveBeenCalled();
    const row = (await getClaims(db, 'bolton-clarke'))!;
    expect(Date.now() - new Date(row.finished_at!).getTime()).toBeLessThan(60_000);
  });

  it('re-reads only the pages that changed, with the cheap model', async () => {
    await oldClaims();
    web.set(PAGE, 'v1');
    web.set('https://www.boltonclarke.com.au/care', 'care v1');
    const fake = fakeClaude([{ items: claims.items }]);
    await runEnrichment(deps(fake.client), { trigger: 'cli', parts: ['claims'] });
    await db.query(`UPDATE provider_claims SET finished_at = now() - interval '61 days'`);

    web.set(PAGE, 'v2: veterans team now has 40 staff');
    fake.parse.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      usage,
      parsed_output: { items: [{ question_id: 'E1', status: 'stated', claim: '40 veteran staff', quote: '40 staff', source_url: PAGE, source_title: 'Veterans' }] },
    } as never);
    const run = await runEnrichment(deps(fake.client), { trigger: 'cli', parts: ['claims'] });
    expect(run.stats.claims).toMatchObject({ reread: 1 });
    const sent = JSON.stringify(fake.parse.mock.calls[1][0]);
    expect(sent).toContain('v2: veterans team');
    expect(sent).not.toContain('care v1');
    const items = (await getClaims(db, 'bolton-clarke'))!.claims!.items;
    expect(items.map((i) => i.claim).sort()).toEqual(['40 veteran staff', 'Regular workers']);
  });

  it('searches the web with Sonnet only when needed, within the run budget', async () => {
    const anglicare = seed.providers.find((p) => p.id === 'anglicare-southern-queensland')!;
    const fake = fakeClaude([]);
    fake.stream.mockImplementation(() => ({
      finalMessage: async () => ({
        stop_reason: 'end_turn',
        usage: { ...usage, server_tool_use: { web_search_requests: 2 } },
        content: [
          { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: PAGE, title: 'Veterans' }] },
          { type: 'text', text: 'notes' },
        ],
      }),
    }));
    fake.parse.mockResolvedValue({ stop_reason: 'end_turn', usage, parsed_output: { website: null, overview: 'o', items: [claims.items[0]] } } as never);
    web.set(PAGE, 'veterans');
    const run = await runEnrichment(deps(fake.client, [bolton, anglicare]), { trigger: 'cli', parts: ['claims'], maxResearch: 1 });
    expect(run.stats.claims).toMatchObject({ due: 2, researched: 1, deferred: 1 });
    expect(fake.stream.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-5-5' });
    expect(fake.parse.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5' });
    // The deferred provider is left as it was: no half-started search.
    expect(await getClaims(db, 'anglicare-southern-queensland')).toBeUndefined();
    // The cited page now has a baseline for next time.
    expect(fetches).toContain(PAGE);
    expect(run.usage).toMatchObject({ models: { 'claude-sonnet-5-5': { web_searches: 2 } } });
  });
});

describe('runs', () => {
  it('allows one run at a time and records each', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: EnrichDeps = { ...deps(fakeClaude([]).client), providers: async () => (await gate, []) };
    const first = runEnrichment(slow, { trigger: 'admin' });
    await new Promise((r) => setTimeout(r, 50));
    await expect(runEnrichment(slow, { trigger: 'cli' })).rejects.toBeInstanceOf(EnrichmentBusyError);
    release();
    expect((await first).status).toBe('done');
    expect((await listRuns(db)).map((r) => [r.trigger, r.status])).toEqual([['admin', 'done']]);
  });

  it('stops cleanly when Claude is not configured', async () => {
    const run = await runEnrichment({ ...deps(fakeClaude([]).client), getAnthropic: () => { throw new Error('Set ANTHROPIC_API_KEY'); } }, { trigger: 'schedule' });
    expect(run).toMatchObject({ status: 'failed', error: 'Set ANTHROPIC_API_KEY' });
  });
});

describe('helpers', () => {
  it('turns HTML into readable text', () => {
    expect(htmlToText('<style>p{}</style><h1>Prices</h1><table><tr><td>Personal care</td><td>$126&nbsp;/hr</td></tr></table>')).toBe('Prices\nPersonal care | $126 /hr |');
  });

  it('estimates cost by model', () => {
    const u = new UsageTally();
    u.add('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 });
    u.add('claude-sonnet-5-5', { input_tokens: 100_000, output_tokens: 10_000, server_tool_use: { web_search_requests: 3 } });
    expect(u.estimatedCost()).toBeCloseTo(0.1 + 0.05 + 0.2 + 0.1 + 0.03, 4);
  });
});

describe('slow sites and PDFs', () => {
  const PDF = readFileSync(new URL('./fixtures/price-list.pdf', import.meta.url));
  const quick = { sleep: async () => {}, timeouts: { responseMs: 50, downloadMs: 100 } };

  it('reads a PDF as text on the server, so Claude gets text rather than the whole document', async () => {
    const pdfFetcher = async () => new Response(PDF, { headers: { 'content-type': 'application/pdf' } });
    const fake = fakeClaude([prices({ pc: 126 })]);
    await runEnrichment({ ...deps(fake.client), fetcher: pdfFetcher }, { trigger: 'cli', parts: ['prices'] });
    const sent = JSON.stringify(fake.parse.mock.calls[0][0]);
    expect(sent).toContain('Personal care $126.00 per hour');
    expect(sent).toContain('pdf_pages=\\"1\\"');
    expect(sent).not.toContain('"type":"document"');
  });

  it('retries a site that is slow to answer or has a server error, then succeeds', async () => {
    let calls = 0;
    const flaky: Fetcher = async (_url, init) => {
      calls += 1;
      if (calls === 1) return new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
      if (calls === 2) return new Response('busy', { status: 503 });
      return new Response('<p>ok</p>', { headers: { 'content-type': 'text/html' } });
    };
    const notes: string[] = [];
    const check = await checkPage(db, 'https://slow.example/prices.pdf', { fetcher: flaky, onProgress: (d) => notes.push(d), ...quick });
    expect(check).toMatchObject({ status: 'new', attempts: 3 });
    expect(notes).toContain('No answer within 0.05 seconds — trying again');
    expect(notes).toContain('HTTP 503: the site had a server error — trying again');
  });

  it('gives up after three tries with a clear reason, and stops a download that takes too long', async () => {
    const hang: Fetcher = async (_url, init) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    expect(await checkPage(db, 'https://hang.example/a', { fetcher: hang, ...quick })).toMatchObject({ status: 'error', attempts: 3, error: 'no answer within 0.05 seconds (tried 3 times)' });

    const trickle: Fetcher = async (_url, init) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('%PDF-'));
            init?.signal?.addEventListener('abort', () => c.error(init.signal!.reason));
          },
        }),
        { headers: { 'content-type': 'application/pdf' } },
      );
    expect(await checkPage(db, 'https://trickle.example/a.pdf', { fetcher: trickle, ...quick })).toMatchObject({ status: 'error', error: 'download took longer than 0.1 seconds (tried 3 times)' });

    const missing = await checkPage(db, 'https://gone.example/a', { fetcher, ...quick });
    expect(missing).toMatchObject({ status: 'error', attempts: 1, httpStatus: 404, error: 'HTTP 404: page not found — the link may have moved' });
  });
});

describe('progress', () => {
  it('plans every item, records stages, outcomes, errors and timings, and estimates time left', async () => {
    const anglicare = seed.providers.find((p) => p.id === 'anglicare-southern-queensland')!;
    web.set(PRICE_URL, '<p>prices</p>');
    const snapshots: RunProgress[] = [];
    const fake = fakeClaude([prices()]);
    const watched: EnrichDeps = {
      ...deps(fake.client, [bolton, anglicare, { ...anglicare, id: 'no-list', provider: 'No list', source_url: null }]),
      fetcher: async (url, init) => {
        const [run] = await listRuns(db, 1);
        snapshots.push(run.progress as RunProgress);
        return fetcher(url, init);
      },
    };
    const run = await runEnrichment(watched, { trigger: 'admin', parts: ['prices'], maxResearch: 0 });
    const items = (run.progress as RunProgress).items;
    expect(items.map((i) => [i.label, i.status])).toEqual([
      ['Price list · Bolton Clarke', 'done'],
      ['Price list · Anglicare Southern Queensland', 'failed'],
      ['Price list · No list', 'done'],
    ]);
    expect(items[2].outcome).toMatch(/search limit reached/);
    expect(items[0]).toMatchObject({ outcome: 'Read for the first time; prices match the catalogue', error: null });
    expect(items[0].ms).toBeGreaterThanOrEqual(0);
    expect(items[1].error).toEqual({ stage: 'Download', message: 'HTTP 404: page not found — the link may have moved' });
    expect(run.progress.skipped).toEqual({ claims_current: 0, no_price_list: 0, not_shortlisted: 0 });
    expect(run.progress.eta_seconds).toBe(0);
    // While running, the plan was already saved with an estimate.
    expect(snapshots[0].items).toHaveLength(3);
    expect(snapshots[0].eta_seconds).toBeGreaterThan(0);
  });

  it('stops after the items in hand when an admin asks', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...bolton, id: `p${i}`, provider: `P${i}`, source_url: `https://p${i}.example/prices` }));
    let asked = false;
    const stopping: EnrichDeps = {
      ...deps(fakeClaude([]).client, many),
      fetcher: async (url, init) => {
        if (!asked) {
          asked = true;
          expect(await requestCancel(db)).toBe(true);
        }
        await new Promise((r) => setTimeout(r, 20));
        return fetcher(url, init);
      },
    };
    const run = await runEnrichment(stopping, { trigger: 'admin', parts: ['prices'] });
    expect(run).toMatchObject({ status: 'cancelled', error: 'Stopped by an admin' });
    const statuses = (run.progress as RunProgress).items.map((i) => i.status);
    expect(statuses.filter((s) => s === 'cancelled').length).toBeGreaterThan(0);
    expect(statuses).not.toContain('running');
    expect(await activeRun(db)).toBeUndefined();
  });
});

describe('loaded providers, finding providers and prices on shortlist', () => {
  const loaded: Provider = {
    ...bolton,
    id: 'bayside-care',
    provider: 'Bayside Care',
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
    flags: [],
    source_url: null,
    origin: { kind: 'gen', note: 'qld.xlsx', at: '2026-10-27' },
  };

  /** A fake web search that "finds" the given pages, then a structuring step returning `parsed`. */
  function searching(pages: string[], parsed: unknown[]) {
    const fake = fakeClaude(parsed);
    fake.stream.mockImplementation(() => ({
      finalMessage: async () => ({
        stop_reason: 'end_turn',
        usage: { ...usage, server_tool_use: { web_search_requests: 1 } },
        content: [{ type: 'web_search_tool_result', content: pages.map((url) => ({ type: 'web_search_result', url, title: url })) }, { type: 'text', text: 'found some' }],
      }),
    }));
    return fake;
  }

  it('skips loaded providers in scheduled checks until someone shortlists them', async () => {
    const fake = fakeClaude([]);
    const run = await runEnrichment(deps(fake.client, [loaded]), { trigger: 'schedule', parts: ['prices', 'claims'] });
    expect(run.progress.items).toEqual([]);
    expect(run.progress.skipped).toMatchObject({ not_shortlisted: 1 });

    await db.query(`INSERT INTO applications (id, name, suburb, postcode, status) VALUES ('a1', 'Dad', 'Wynnum', '4178', 'active')`);
    await db.query(`INSERT INTO application_state (application_id, version, state) VALUES ('a1', 1, $1::jsonb)`, [JSON.stringify({ selection: [{ provider_id: 'bayside-care', stage: 'scan' }] })]);
    const later = await runEnrichment(deps(fake.client, [loaded]), { trigger: 'schedule', parts: ['prices'], maxResearch: 0 });
    expect(later.progress.items!.map((i) => i.label)).toEqual(['Price list · Bayside Care']);
  });

  it('reads prices straight into the catalogue for a provider that had none, finding its price list first', async () => {
    const LIST = 'https://bayside.example/pricing.pdf';
    web.set(LIST, '<p>Personal care $118 per hour. Travel charged at $1/km.</p>');
    const fake = searching([LIST, 'https://bayside.example/'], [
      { providers: [{ name: 'Bayside Care', website: 'https://bayside.example/', price_list_url: LIST, evidence_url: LIST, note: '' }] },
      { ...prices(), rates: { ...prices().rates, rn: null, en: null, pc: 118, domestic: 105, social: null, respite: null, gardening: null, care_mgmt: null }, prices_as_at: '1 October 2026', notes: ['Travel charged at $1/km'] },
    ]);
    const res = await readPrices(deps(fake.client, [loaded]), loaded, { usage: new UsageTally(), findMissing: true, takeSearch: () => true });
    expect(res).toMatchObject({ ok: true, kind: 'applied', outcome: '2 prices read into the catalogue' });
    expect(fake.stream.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-5-5' });
    const [saved] = (await catalogueEdits(db)).providers;
    expect(saved).toMatchObject({
      id: 'bayside-care',
      source_url: LIST,
      website: 'https://bayside.example/',
      pc: 118,
      domestic: 105,
      prices_as_at_date: '2026-10-01',
      flags: ['Travel charged at $1/km'],
    });
    expect(saved.prices_as_at).toMatch(/^1 October 2026 \(read automatically on \d{4}-\d{2}-\d{2}\)$/);
    // No suggestion needed: there were no prices to correct.
    expect(await listSuggestions(db, { status: 'pending' })).toEqual([]);
  });

  it('says plainly when no price list can be found', async () => {
    const fake = searching([], [{ providers: [] }]);
    expect(await readPrices(deps(fake.client), loaded, { usage: new UsageTally(), findMissing: true, takeSearch: () => true })).toEqual({
      ok: false,
      stage: 'Finding the price list',
      error: 'no published price list was found — ask the provider for one',
    });
  });

  it('finds providers in each application area: adds new ones and fills in what known ones are missing', async () => {
    await db.query(`INSERT INTO applications (id, name, suburb, postcode, status) VALUES ('a2', 'Dad', 'Wynnum', '4178', 'active')`);
    const fake = searching(['https://newco.example/', 'https://newco.example/prices', 'https://myagedcare.example/newco', 'https://bayside.example/fees'], [
      {
        providers: [
          { name: 'NewCo Home Support', website: 'https://newco.example/', price_list_url: 'https://newco.example/prices', evidence_url: 'https://myagedcare.example/newco', note: '' },
          { name: 'Bayside Care Pty Ltd', website: null, price_list_url: 'https://bayside.example/fees', evidence_url: 'https://bayside.example/fees', note: '' },
          { name: 'Made Up Care', website: 'https://never-retrieved.example/', price_list_url: null, evidence_url: 'https://never-retrieved.example/', note: '' },
        ],
      },
    ]);
    const catalogue = [loaded];
    const run = await runEnrichment({ ...deps(fake.client), providers: async () => [...catalogue, ...(await catalogueEdits(db)).providers.filter((p) => p.id !== 'bayside-care')] }, { trigger: 'admin', parts: ['discover'] });
    expect(run.progress.items!.map((i) => [i.label, i.outcome])).toEqual([['Find providers · Wynnum 4178', '2 providers found: 1 new, 1 filled in']]);
    const edits = (await catalogueEdits(db)).providers;
    expect(edits.find((p) => p.provider === 'NewCo Home Support')).toMatchObject({ source_url: 'https://newco.example/prices', postcodes_served: ['4178'], origin: { kind: 'search' } });
    expect(edits.find((p) => p.id === 'bayside-care')).toMatchObject({ source_url: 'https://bayside.example/fees', postcodes_served: ['4178'] });
    expect(run.stats.discover).toMatchObject({ found: 2, added: 1, updated: 1 });
  });
});

describe('checks that stopped without finishing', () => {
  const progress = (status: string) =>
    JSON.stringify({ eta_seconds: 90, items: [{ id: '1', part: 'prices', label: 'Price list · A', url: null, status, stage: 'Downloading', detail: null, outcome: null, error: null, started_at: null, ms: null }, { id: '2', part: 'prices', label: 'Price list · B', url: null, status: 'queued', stage: null, detail: null, outcome: null, error: null, started_at: null, ms: null }] });

  it("closes a run whose heartbeat stopped, so it doesn't show as running or block a new one", async () => {
    await db.query(`INSERT INTO enrichment_runs (id, trigger, status, heartbeat_at, started_at, progress) VALUES ('ghost', 'admin', 'running', now() - interval '20 minutes', now() - interval '25 minutes', $1::jsonb)`, [progress('running')]);
    expect(await activeRun(db)).toBeUndefined();
    const [ghost] = await listRuns(db);
    expect(ghost).toMatchObject({ id: 'ghost', status: 'failed', error: 'Stopped: the server restarted during the check. Run it again to finish.' });
    expect(ghost.progress.items!.map((i) => [i.status, i.error?.message ?? null])).toEqual([
      ['failed', 'interrupted — the check stopped before this finished'],
      ['cancelled', null],
    ]);
    expect(ghost.progress.eta_seconds).toBe(0);
    expect(await requestCancel(db)).toBe(false);
    expect((await runEnrichment(deps(fakeClaude([]).client, []), { trigger: 'admin' })).status).toBe('done');
  });

  it("on restart, closes the server's own runs, price reads and searches, but not a command-line run still going", async () => {
    await db.query(`INSERT INTO enrichment_runs (id, trigger, status, heartbeat_at, progress) VALUES ('mine', 'schedule', 'running', now(), $1::jsonb), ('cli', 'cli', 'running', now(), $1::jsonb)`, [progress('running')]);
    await db.query(`INSERT INTO provider_price_checks (provider_id, status) VALUES ('bolton-clarke', 'running')`);
    await db.query(`INSERT INTO provider_claims (provider_id, status) VALUES ('bolton-clarke', 'running')`);
    await recoverAfterRestart(db);
    expect((await listRuns(db)).map((r) => [r.id, r.status]).sort()).toEqual([
      ['cli', 'running'],
      ['mine', 'failed'],
    ]);
    expect((await db.query(`SELECT status, error FROM provider_price_checks`))[0]).toEqual({ status: 'failed', error: 'Interrupted by a server restart — try again' });
    expect((await getClaims(db, 'bolton-clarke'))!.status).toBe('failed');
  });

  it('keeps a long-running check alive with a heartbeat while it waits on Claude', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const slow: EnrichDeps = { ...deps(fakeClaude([]).client), providers: async () => (await gate, []) };
      const running = runEnrichment(slow, { trigger: 'admin' });
      await new Promise((r) => setTimeout(r, 30));
      await db.query(`UPDATE enrichment_runs SET heartbeat_at = now() - interval '10 minutes'`);
      await vi.advanceTimersByTimeAsync(31_000);
      await new Promise((r) => setTimeout(r, 30));
      expect((await activeRun(db))?.status).toBe('running');
      release();
      expect((await running).status).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });
});
