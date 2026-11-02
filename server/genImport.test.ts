// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createPgliteDb, migrate, type Db } from './db.ts';
import { catalogueEdits, upsertCatalogue } from './catalogue.ts';
import { findListFiles, getGenSettings, listDate, listGenImports, pageLinks, planImport, readRows, reapGenImports, runGenImport, saveGenSettings, servicesFrom } from './genImport.ts';
import type { Fetcher } from './pages.ts';
import { loadSeedData } from '../src/data/load.ts';
import type { GenService } from '../src/genLoad.ts';

const seed = loadSeedData();
let db: Db;
beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.query('DELETE FROM gen_imports');
  await db.query('DELETE FROM app_settings');
  await db.query('DELETE FROM provider_catalogue');
});

const HEADER = ['Service Name', 'Provider Name', 'Physical Address Suburb', 'Physical Address State', 'Physical Address Post Code', 'Care Type', 'Organisation Type', 'Aged Care Planning Region'];
const row = (service: string, provider: string, suburb: string, postcode: string, care = 'Home Care', region = 'Brisbane South') => [service, provider, suburb, 'QLD', postcode, care, 'Not-for-profit', region];
const csv = (rows: string[][]) => [['Aged care service list as at 30 June 2026'], [], HEADER, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');

/** A minimal .xlsx with inline strings. */
function xlsx(rows: string[][]): Buffer {
  const cell = (v: string, c: number, r: number) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${v.replace(/&/g, '&amp;')}</t></is></c>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, c, i)).join('')}</row>`)
    .join('')}</sheetData></worksheet>`;
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      'xl/workbook.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Services" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    }),
  );
}

/** The fake web: url → [body, content type]. */
const web = new Map<string, [string | Buffer, string]>();
const fetched: string[] = [];
const fetcher: Fetcher = async (url) => {
  fetched.push(url);
  const hit = web.get(url);
  return hit ? new Response(typeof hit[0] === "string" ? hit[0] : new Uint8Array(hit[0]), { headers: { 'content-type': hit[1] } }) : new Response('Not found', { status: 404 });
};
const TOPIC = 'https://gen.example/topics/providers-of-aged-care';
const RELEASE = 'https://gen.example/resources/access-data/2026/october/aged-care-service-list-30-june-2026';
const OLD_RELEASE = 'https://gen.example/resources/access-data/2025/october/aged-care-service-list-30-june-2025';
const QLD = 'https://gen.example/files/aged-care-service-list-30-june-2026-qld.xlsx';
const NSW = 'https://gen.example/files/aged-care-service-list-30-june-2026-nsw.csv';

describe('finding the list', () => {
  it('reads dates from link text and file names', () => {
    expect(listDate('Aged care service list: 30 June 2025')).toBe('2025-06-30');
    expect(listDate('/files/service-list-2026-03-31.xlsx')).toBe('2026-03-31');
    expect(listDate('aged-care-service-list-june-2024.xlsx')).toBe('2024-06-01');
    expect(listDate('no date here')).toBeNull();
  });

  it('follows the topic page to the newest release, and takes every state file there', async () => {
    web.clear();
    web.set(TOPIC, [`<a href="${OLD_RELEASE}">Aged care service list: 30 June 2025</a> <a href="/resources/access-data/2026/october/aged-care-service-list-30-june-2026">Aged care service list: 30 June 2026</a>`, 'text/html']);
    web.set(RELEASE, [`<a href="/files/aged-care-service-list-30-june-2026-qld.xlsx">Queensland</a><a href="${NSW}">NSW</a><a href="/files/aged-care-service-list-30-june-2025-qld.xlsx">Last year</a>`, 'text/html']);
    const get = (u: string) => fetcher(u, {});
    expect((await findListFiles(TOPIC, get, () => {})).sort()).toEqual([NSW, QLD]);
    expect(await findListFiles(QLD, get, () => {})).toEqual([QLD]);
    expect(pageLinks('<a class="x" href="a.xlsx">A &amp; B</a>', 'https://h.example/p/')).toEqual([{ href: 'https://h.example/p/a.xlsx', text: 'A & B' }]);
  });

  it('reads services from .xlsx and .csv', async () => {
    const rows = [['Title'], HEADER, row('Bayside Home Care', 'Bayside Care Ltd', 'Wynnum', '4178')];
    const fromXlsx = servicesFrom(await readRows(xlsx(rows), QLD, ''));
    expect(fromXlsx).toMatchObject([{ provider: 'Bayside Care Ltd', suburb: 'Wynnum', postcode: '4178', careType: 'Home Care' }]);
    const fromCsv = servicesFrom(await readRows(Buffer.from(csv([row('X', 'Y Care', 'Manly', '4179')])), NSW, 'text/csv'));
    expect(fromCsv).toMatchObject([{ provider: 'Y Care', suburb: 'Manly' }]);
  });
});

describe('planning changes', () => {
  const svc = (provider: string, suburb: string, postcode: string, careType = 'Home Care', region = 'Brisbane South'): GenService => ({
    service: `${provider} ${suburb}`, provider, address: '', suburb, state: 'QLD', postcode, careType, orgType: '', region, homeCarePlaces: null,
  });

  it('adds new home care providers, updates loaded ones, leaves hand-entered ones, flags missing ones', () => {
    const loaded = { ...seed.providers[0], id: 'old-co', provider: 'Old Co', origin: { kind: 'gen' as const, note: 'x', at: '2025-07-01' }, locations: ['Manly 4179'] };
    const gone = { ...seed.providers[0], id: 'gone-co', provider: 'Gone Co', origin: { kind: 'gen' as const, note: 'x', at: '2025-07-01' } };
    const services = [svc('New Co', 'Wynnum', '4178'), svc('Old Co', 'Cleveland', '4163'), svc('Bolton Clarke', 'Wynnum', '4178'), svc('Nursing Home Co', 'Wynnum', '4178', 'Residential')];
    const plan = planImport(services, [...seed.providers, loaded, gone], { asAt: '2026-06-30', note: 'service list as at 2026-06-30', regions: null });
    expect(plan.add.map((p) => [p.provider, p.locations, p.origin?.kind])).toEqual([['New Co', ['Wynnum 4178'], 'gen']]);
    const changes = Object.fromEntries(plan.update.map((u) => [u.provider.id, u]));
    expect(changes['old-co'].provider.locations).toEqual(['Cleveland 4163']);
    expect(changes['gone-co'].provider.origin?.missing_since).toBe('2026-06-30');
    // Entered by hand: only where its outlets are is filled in; prices and everything else stay.
    expect(changes['bolton-clarke'].provider).toEqual({ ...seed.providers.find((p) => p.id === 'bolton-clarke'), locations: ['Wynnum 4178'] });
    expect(plan.stats).toMatchObject({ services: 4, home_care: 3, added: 1, updated: 2, missing: 1 });
  });

  it('limits to regions, and doesn’t judge providers outside them', () => {
    const gone = { ...seed.providers[0], id: 'gone-co', provider: 'Gone Co', origin: { kind: 'gen' as const, note: 'x', at: '2025-07-01' } };
    const plan = planImport([svc('A Co', 'Wynnum', '4178'), svc('B Co', 'Sydney', '2000', 'Home Care', 'Inner West')], [gone], { asAt: '2026-06-30', note: 'n', regions: new Set(['Brisbane South']) });
    expect(plan.add.map((p) => p.provider)).toEqual(['A Co']);
    expect(plan.stats.missing).toBe(0);
  });
});

describe('running an import', () => {
  beforeEach(() => {
    web.clear();
    fetched.length = 0;
    web.set(TOPIC, [`<a href="${RELEASE}">Aged care service list: 30 June 2026</a>`, 'text/html']);
    web.set(RELEASE, [`<a href="${QLD}">QLD</a><a href="${NSW}">NSW</a>`, 'text/html']);
    web.set(QLD, [xlsx([HEADER, row('Bayside Home Care', 'Bayside Care Ltd', 'Wynnum', '4178'), row('Bayside Home Care Manly', 'Bayside Care Ltd', 'Manly', '4179')]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    web.set(NSW, [csv([row('Harbour Care', 'Harbour Care Inc', 'Sydney', '2000', 'Home Care', 'Inner West')]), 'text/csv']);
  });

  it('adds providers, does nothing when the list is unchanged, and flags providers that drop off', async () => {
    await saveGenSettings(db, { url: TOPIC, scope: 'national', auto: true }, null);
    const first = await runGenImport({ db, seedProviders: seed.providers, fetcher }, { trigger: 'admin' });
    expect(first).toMatchObject({ status: 'done', as_at: '2026-06-30', stats: { added: 2, services: 3 } });
    let catalogue = (await catalogueEdits(db)).providers;
    expect(catalogue.find((p) => p.provider === 'Bayside Care Ltd')).toMatchObject({ locations: ['Wynnum 4178', 'Manly 4179'], origin: { kind: 'gen' }, pc: null });

    const again = await runGenImport({ db, seedProviders: seed.providers, fetcher }, { trigger: 'schedule' });
    expect(again.status).toBe('unchanged');

    web.set(NSW, [csv([]), 'text/csv']);
    const third = await runGenImport({ db, seedProviders: seed.providers, fetcher }, { trigger: 'schedule' });
    expect(third).toMatchObject({ status: 'done', stats: { missing: 1, added: 0 } });
    catalogue = (await catalogueEdits(db)).providers;
    expect(catalogue.find((p) => p.provider === 'Harbour Care Inc')?.origin?.missing_since).toBe('2026-06-30');
    expect((await listGenImports(db)).map((r) => r.status)).toEqual(['done', 'unchanged', 'done']);
  });

  it('never overwrites a provider entered by hand', async () => {
    const mine = { ...seed.providers[0], id: 'bayside-care', provider: 'Bayside Care', locations: ['Wynnum 4178'], pc: 99 };
    await upsertCatalogue(db, mine, null, 'by hand');
    await saveGenSettings(db, { url: QLD, scope: 'national', auto: true }, null);
    const run = await runGenImport({ db, seedProviders: seed.providers, fetcher }, { trigger: 'admin' });
    expect(run).toMatchObject({ status: 'done', stats: { added: 0, kept_by_hand: 1 } });
    expect((await catalogueEdits(db)).providers.find((p) => p.id === 'bayside-care')).toMatchObject({ pc: 99, locations: ['Wynnum 4178'] });
  });

  it('records a failure clearly, and clears imports stopped by a restart', async () => {
    await saveGenSettings(db, { url: 'https://gen.example/nothing-here', scope: 'national', auto: true }, null);
    const run = await runGenImport({ db, seedProviders: seed.providers, fetcher }, { trigger: 'admin' });
    expect(run).toMatchObject({ status: 'failed', error: 'https://gen.example/nothing-here answered 404.' });
    await db.query("INSERT INTO gen_imports (id, trigger, status, source_url) VALUES ('stuck', 'admin', 'running', 'x')");
    await reapGenImports(db);
    expect((await listGenImports(db)).find((r) => r.id === 'stuck')).toMatchObject({ status: 'failed', error: 'Stopped by a server restart.' });
  });

  it('defaults to the GEN providers page, or the configured link', async () => {
    expect((await getGenSettings(db)).url).toBe('https://www.gen-agedcaredata.gov.au/topics/providers-of-aged-care');
    expect((await getGenSettings(db, 'https://x.example/list.xlsx')).url).toBe('https://x.example/list.xlsx');
  });
});
