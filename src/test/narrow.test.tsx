import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gathered, memoryBackend, memoryServer, renderApp } from './renderApp';
import { countChoice, countWith, DEFAULT_NARROW, fundingText, narrowPasses, narrowReasons, orgKind, providerFacts, sizeBand, type Row } from '../narrow';
import { loadSeedData } from '../data/load';
import type { Match } from '../matching';
import type { Provider } from '../types';

const seed = loadSeedData();
const base = seed.providers[0];
/** A provider loaded from the government list: no prices, outlets known, funding known. */
const loaded = (id: string, name: string, location: string, type: string, funding: number | null): Provider => ({
  ...base,
  id,
  provider: name,
  type,
  rn: null, en: null, pc: null, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null,
  prices_as_at: 'Not read yet',
  prices_as_at_date: null,
  veteran_fit: null,
  flags: [],
  source_url: null,
  postcodes_served: undefined,
  locations: [location],
  origin: { kind: 'gen', note: 'service list as at 2025-06-30', at: '2025-11-01' },
  ...(funding === null ? {} : { gov_funding: funding, gov_funding_year: '2024–25' }),
});
const LOADED = [
  loaded('wynnum-care', 'Wynnum Community Care', 'Wynnum 4178', 'Not-for-profit (Community based)', 3_200_000),
  loaded('manly-home', 'Manly Home Services', 'Manly 4179', 'For-profit (Private)', 12_000_000),
  loaded('city-big', 'City Big Care', 'Brisbane City 4000', 'Not-for-profit (Religious)', 400_000_000),
  loaded('ipswich-care', 'Ipswich Care', 'Ipswich 4305', 'For-profit (Private)', null),
];

describe('narrowing rules', () => {
  it('reads organisation types and size bands', () => {
    expect(orgKind('Not-for-profit (Religious)')).toBe('nfp');
    expect(orgKind('For-profit (Private)')).toBe('forprofit');
    expect(orgKind('Government (State)')).toBe('government');
    expect(orgKind(null)).toBe('other');
    expect([4e6, 5e6, 60e6, 300e6, null].map(sizeBand)).toEqual(['small', 'medium', 'large', 'very_large', 'unknown']);
    expect([850_000, 12_400_000, 310_000_000, 1_200_000_000].map(fundingText)).toEqual(['$850k', '$12.4m', '$310m', '$1.2b']);
  });

  it('filters on distance, type, size and record, with counts and reasons', () => {
    const m = (p: Provider) => ({ provider: p, verdict: 'quote', cost: { quarterly_cost: 0 } }) as unknown as Match;
    const rows: Row[] = [
      { m: m(LOADED[0]), facts: providerFacts(LOADED[0], { km: 2, serves: false, claims: false, compliance: { status: 'ready', result: { findings: [] } } }) },
      { m: m(LOADED[1]), facts: providerFacts(LOADED[1], { km: 8, serves: false, claims: false }) },
      { m: m(LOADED[2]), facts: providerFacts(LOADED[2], { km: 15, serves: false, claims: false, compliance: { status: 'ready', result: { findings: [{ kind: 'sanction' }] } } }) },
    ];
    const f = { ...DEFAULT_NARROW, radiusKm: 10 };
    expect(rows.filter((r) => narrowPasses(r.m, r.facts, f)).map((r) => r.m.provider.id)).toEqual(['wynnum-care', 'manly-home']);
    expect(countWith(rows, f, 'radiusKm', 20)).toBe(3);
    expect(countChoice(rows, f, 'org', 'nfp')).toBe(1);
    expect(countChoice(rows, { ...DEFAULT_NARROW }, 'sizes', 'very_large')).toBe(1);
    expect(countWith(rows, DEFAULT_NARROW, 'cleanRecord', true)).toBe(1);
    expect(narrowReasons(rows[2].m, rows[2].facts, { ...f, cleanRecord: true, sizes: ['small'] })).toEqual(['Over 10 km away', 'Size: very large', 'Sanctions or non-compliance found']);
  });
});

/** Suburb centres (approximate) for the test postcodes. */
const GEO: Record<string, { centre: [number, number]; localities: Record<string, [number, number]>; state: string }> = {
  '4178': { centre: [-27.44, 153.17], localities: { WYNNUM: [-27.443, 153.172] }, state: 'QLD' },
  '4179': { centre: [-27.455, 153.185], localities: { MANLY: [-27.455, 153.185] }, state: 'QLD' },
  '4000': { centre: [-27.47, 153.025], localities: { 'BRISBANE CITY': [-27.468, 153.028] }, state: 'QLD' },
  '4305': { centre: [-27.615, 152.76], localities: { IPSWICH: [-27.615, 152.76] }, state: 'QLD' },
};

/** The app's own API calls that go straight to the server: geo and nearby postcodes, answered from the real table. */
function stubGeo() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      const url = new URL(path, 'http://x');
      if (url.pathname === '/api/geo') {
        const wanted = (url.searchParams.get('postcodes') ?? '').split(',');
        return Response.json({ postcodes: Object.fromEntries(Object.entries(GEO).filter(([pc]) => wanted.includes(pc))) });
      }
      if (url.pathname === '/api/near') return Response.json({ km: 60, postcodes: Object.keys(GEO) });
      return Response.json({ members: [] });
    }),
  );
}
const family = () => {
  const s = gathered();
  s.participant = { ...s.participant!, suburb: 'Wynnum', postcode: '4178' };
  return s;
};

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Find, basic: narrow down', () => {
  it('narrows by distance, type and size with counts, and checks what is left', async () => {
    const user = userEvent.setup();
    stubGeo();
    const server = memoryServer(family());
    const backend = memoryBackend(server);
    backend.edits = LOADED;
    await renderApp('/providers', { server, backend });
    const panel = await screen.findByRole('region', { name: 'Narrow down' });
    // Ipswich (about 45 km) is still "in the area"; distances arrive from the postcode table.
    await waitFor(() => expect(within(panel).getByRole('button', { name: /Within 5 km/ })).toHaveTextContent('(2)'));
    await user.click(within(panel).getByRole('button', { name: /Within 20 km/ }));
    expect(within(panel).getByRole('status')).toHaveTextContent(/left of/);
    expect(screen.queryByRole('article', { name: 'Ipswich Care' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'City Big Care' })).toBeInTheDocument();

    await user.click(within(panel).getByLabelText(/Not-for-profit/));
    expect(screen.queryByRole('article', { name: 'Manly Home Services' })).not.toBeInTheDocument();
    await user.click(within(panel).getByLabelText(/^Small/));
    expect(screen.queryByRole('article', { name: 'City Big Care' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Wynnum Community Care' })).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: /Check these 1 provider/ }));
    expect(backend.researchRequests.at(-1)).toContain('wynnum-care');
    expect(await within(panel).findByText(/Checking: 0 of/)).toBeInTheDocument();
  });
});

describe('Find, advanced: the filter table', () => {
  it('filters, sorts, ticks for bulk actions and saves views', async () => {
    const user = userEvent.setup();
    stubGeo();
    localStorage.clear();
    const server = memoryServer(family());
    const backend = memoryBackend(server);
    backend.edits = LOADED;
    await renderApp('/providers?view=table', { server, backend });
    expect(screen.getByRole('heading', { level: 1, name: 'Find providers: advanced' })).toBeInTheDocument();
    const filters = screen.getByRole('complementary', { name: 'Filters' });
    const table = screen.getByRole('table');

    await user.click(within(filters).getByLabelText(/Very large/));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    expect(within(table).getByRole('rowheader', { name: /City Big Care/ }).parentElement).toHaveTextContent('$400m');
    await user.type(within(filters).getByLabelText('Name for this view'), 'Big ones');
    await user.click(within(filters).getByRole('button', { name: 'Save view' }));
    await user.click(within(filters).getByRole('button', { name: 'Clear all filters' }));
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(4));

    // Sort by size, largest first.
    await user.click(within(table).getByRole('button', { name: 'Size' }));
    expect(within(table).getAllByRole('rowheader')[0]).toHaveTextContent('City Big Care');

    await user.click(within(table).getByLabelText('Tick Wynnum Community Care'));
    await user.click(within(table).getByLabelText('Tick Manly Home Services'));
    const actions = screen.getByLabelText('With the ticked providers');
    await user.click(within(actions).getByRole('button', { name: /Check the ticked 2 providers/ }));
    expect(backend.researchRequests.at(-1)?.sort()).toEqual(['manly-home', 'wynnum-care']);
    await user.click(within(actions).getByRole('button', { name: 'Shortlist' }));
    await waitFor(() => expect(server.state.selection.map((e) => e.provider_id).sort()).toEqual(['manly-home', 'wynnum-care']));

    await user.click(within(filters).getByRole('button', { name: 'Big ones' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
  });
});
