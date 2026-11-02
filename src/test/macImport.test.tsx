import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gathered, memoryBackend, memoryServer, renderApp } from './renderApp';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const family = () => {
  const s = gathered();
  s.participant = { ...s.participant!, suburb: 'Wynnum', postcode: '4178' };
  return s;
};

describe('Find: providers from My Aged Care', () => {
  it('opens My Aged Care for the family’s area, reads uploaded pages, and makes them the family’s list', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ members: [], postcodes: {} })));
    const server = memoryServer(family());
    const backend = memoryBackend(server);
    backend.macPreview = {
      share_url: 'https://www.myagedcare.gov.au/p/exampletest123',
      files: [
        { name: 'shortlist.pdf', kind: 'shortlist', providers: 2 },
        { name: 'compare.pdf', kind: 'compare', providers: 1 },
      ],
      providers: [
        {
          name: 'Care to Care',
          based_in: 'CANNON HILL QLD 4170',
          phone: '1300 620 013',
          services: [],
          from: ['shortlist', 'compare'],
          prices: [
            { service: 'General house cleaning', unit: 'hour', standard: 70 },
            { service: 'Gardening', unit: 'hour', standard: 1.1, flag: 'looks wrong' },
          ],
          match: null,
        },
        { name: 'Bolton Clarke Wynnum', based_in: 'WYNNUM QLD 4178', phone: null, services: [], from: ['shortlist'], prices: [], match: { id: 'bolton-clarke', provider: 'Bolton Clarke' } },
      ],
    };
    await renderApp('/providers', { server, backend });
    const card = screen.getByRole('region', { name: 'Find providers on My Aged Care' });
    const search = within(card).getByRole('link', { name: /Search for Wynnum 4178/ });
    expect(search.getAttribute('href')).toMatch(/^https:\/\/www\.myagedcare\.gov\.au\/find-a-provider\/search\/results\?careProgram=sah&distance=250&location=WYNNUM\+QLD\+4178/);
    expect(search.getAttribute('href')).toContain('services=General+house+cleaning');

    await user.upload(within(card).getByLabelText('Saved pages (PDF)'), [new File(['%PDF'], 'shortlist.pdf', { type: 'application/pdf' }), new File(['%PDF'], 'compare.pdf', { type: 'application/pdf' })]);
    await user.click(within(card).getByRole('button', { name: 'Read these files' }));
    const preview = await within(card).findByRole('region', { name: 'Check before adding' });
    expect(within(preview).getByText('shortlist.pdf: Shortlist, 2 providers')).toBeInTheDocument();
    const careRow = within(preview).getByRole('rowheader', { name: /Care to Care/ }).parentElement!;
    expect(careRow).toHaveTextContent('1 services');
    expect(careRow).toHaveTextContent('1 look wrong, left out');
    expect(within(preview).getByLabelText('Catalogue match for Bolton Clarke Wynnum')).toHaveValue('bolton-clarke');

    await user.click(within(preview).getByRole('button', { name: "Add 2 to this family's list" }));
    await waitFor(() => expect(server.state.find.mac).toMatchObject({ provider_ids: ['care-to-care', 'bolton-clarke'], share_url: 'https://www.myagedcare.gov.au/p/exampletest123' }));
    expect(backend.macApplied[0]).toMatchObject({ providers: [{ name: 'Care to Care', match_id: null }, { name: 'Bolton Clarke Wynnum', match_id: 'bolton-clarke' }] });

    await user.click(await screen.findByRole('button', { name: 'See them in Find' }));
    const bar = screen.getByRole('region', { name: 'Providers from My Aged Care' });
    expect(bar).toHaveTextContent('2 providers from My Aged Care');
    // Find works from the family's list…
    await waitFor(() => expect(screen.getByRole('article', { name: 'Bolton Clarke' })).toBeInTheDocument());
    expect(screen.queryByRole('article', { name: 'Anglicare Southern Queensland' })).not.toBeInTheDocument();
    // …or everyone, on request.
    await user.click(within(bar).getByRole('button', { name: 'Everyone in the catalogue' }));
    expect(await screen.findByRole('article', { name: 'Anglicare Southern Queensland' })).toBeInTheDocument();
  });
});

describe('Provider page: prices on My Aged Care', () => {
  it('lists every published price, with rates by time of day and prices that look wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ members: [] })));
    const server = memoryServer(family());
    const backend = memoryBackend(server);
    const { loadSeedData } = await import('../data/load');
    const bolton = loadSeedData().providers.find((p) => p.id === 'bolton-clarke')!;
    backend.edits = [
      {
        ...bolton,
        phone: '1300 221 122',
        based_in: 'BRISBANE CITY QLD 4000',
        mac: {
          as_at: '2026-11-02',
          services: [],
          share_url: null,
          prices: [
            { service: 'Individual social support', unit: 'hour', standard: 71.25, non_standard: 'not_offered', saturday: 'not_offered', sunday: 'not_offered', public_holiday: 'not_offered' },
            { service: 'Meal delivery', unit: 'meal', standard: 75.45 },
            { service: 'Continence management (non-clinical)', unit: 'hour', standard: 1.1, flag: '$1.1 an hour looks wrong: check with the provider' },
            { service: 'Nutrition supports', unit: 'hour', standard: null },
          ],
        },
      },
    ];
    await renderApp('/providers/bolton-clarke', { server, backend });
    const section = screen.getByRole('region', { name: 'Prices on My Aged Care' });
    expect(section).toHaveTextContent('Based in Brisbane City QLD 4000 · 1300 221 122');
    const row = (name: string) => within(section).getByRole('rowheader', { name: new RegExp(name) }).parentElement!;
    expect(row('Individual social support')).toHaveTextContent('$71.25 an hourNot offeredNot offeredNot offeredNot offered');
    expect(row('Meal delivery')).toHaveTextContent('$75.45 a meal');
    expect(row('Continence')).toHaveTextContent('looks wrong');
    expect(row('Nutrition supports')).toHaveTextContent('Not published');
  });
});
