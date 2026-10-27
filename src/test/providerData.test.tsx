import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryBackend, memoryServer, renderApp } from './renderApp';
import { emptyState, type AppState } from '../state/reducer';

const AT = '2026-10-20T00:00:00.000Z';
const shortlisted = (...ids: string[]): AppState => ({ ...emptyState(), selection: ids.map((provider_id) => ({ provider_id, stage: 'scan' as const, why: '', watch: '', added_at: AT, stage_changed_at: AT })) });

afterEach(() => vi.unstubAllGlobals());

describe('provider data after shortlisting', () => {
  it('shows the price read and offers to enrich', async () => {
    const user = userEvent.setup();
    const server = memoryServer(shortlisted('carers-link'));
    const backend = memoryBackend(server);
    backend.priceRows = [
      { provider_id: 'carers-link', status: 'failed', stage: null, outcome: null, error: 'Finding the price list: no published price list was found — ask the provider for one', started_at: AT, finished_at: AT },
    ];
    await renderApp('/providers/carers-link', { server, backend });
    const box = await screen.findByRole('region', { name: 'What we know about Carers Link' });
    expect(await within(box).findByText(/Couldn't read their prices — Finding the price list: no published price list/)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Try again' }));
    expect(backend.priceRequests).toEqual(['carers-link']);
    expect(await within(box).findByText(/Reading their prices…/)).toBeInTheDocument();

    await user.click(within(box).getByRole('button', { name: /Enrich this provider/ }));
    expect(backend.claimRequests).toEqual([{ providerId: 'carers-link', refresh: false }]);
    expect(await within(box).findByText(/Checking what they say publicly/)).toBeInTheDocument();
  });

  it('offers to update when the provider has been enriched before', async () => {
    const user = userEvent.setup();
    const server = memoryServer(shortlisted('bolton-clarke'));
    const backend = memoryBackend(server);
    backend.claimRows = [{ provider_id: 'bolton-clarke', status: 'ready', claims: { website: null, overview: '', items: [] }, error: null, started_at: AT, finished_at: AT }];
    await renderApp('/providers/bolton-clarke', { server, backend });
    const box = await screen.findByRole('region', { name: 'What we know about Bolton Clarke' });
    expect(await within(box).findByText(/0 claims found, checked/)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: /Update/ }));
    expect(backend.claimRequests).toEqual([{ providerId: 'bolton-clarke', refresh: true }]);
  });

  it("isn't shown for providers that aren't shortlisted", async () => {
    await renderApp('/providers/bolton-clarke');
    expect(screen.queryByRole('region', { name: /What we know about/ })).not.toBeInTheDocument();
  });
});

describe('loading from the government list', () => {
  it("reads a CSV, ticks the applications' regions, and adds the new providers", async () => {
    const user = userEvent.setup();
    const posted: { providers: unknown[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        if (path === '/api/admin/applications') return Response.json({ applications: [{ postcode: '4178', status: 'active' }] });
        if (path === '/api/admin/providers/load') {
          const body = JSON.parse(String(init!.body));
          posted.push(body);
          return Response.json({ added: body.providers.map((p: { id: string }) => p.id), providers: body.providers, updated_at: AT });
        }
        return Response.json({ suggestions: [] });
      }),
    );
    await renderApp('/admin/providers/load', { waitForNav: false });
    const csv = [
      'Aged care service list - QLD',
      'Service Name,Physical Address Suburb,Physical Address Post Code,Care Type,Provider Name,Organisation Type,Aged Care Planning Region',
      'Bayside Home Support,Wynnum,4178,Home Care,Bayside Care Pty Ltd,For-profit,Brisbane South',
      'Bolton Clarke Wynnum,Wynnum,4178,Home Care,RSL Care RDNS Limited,Not-for-profit,Brisbane South',
      'Seaside Residential,Wynnum,4178,Residential,Seaside Ltd,For-profit,Brisbane South',
      'Northside Care,Chermside,4032,Home Care,Northside Ltd,For-profit,Brisbane North',
    ].join('\n');
    await user.upload(screen.getByLabelText('Service list (.xlsx or .csv)'), new File([csv], 'qld.csv', { type: 'text/csv' }));
    expect(await screen.findByLabelText('Provider name')).toHaveDisplayValue('Provider Name');
    expect(await screen.findByLabelText(/Brisbane South/)).toBeChecked();
    expect(screen.getByLabelText(/Brisbane North/)).not.toBeChecked();
    expect(screen.getByText(/providers? in the area/)).toHaveTextContent('2 providers in the area: 1 to add, 1 already in the catalogue.');
    await user.click(screen.getByRole('button', { name: 'Add 1 provider' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ providers: [{ id: 'bayside-care-pty-ltd', provider: 'Bayside Care Pty Ltd', locations: ['Wynnum 4178'], origin: { kind: 'gen', note: 'qld.csv, Brisbane South' } }] });
    expect(await screen.findByText('1 provider added')).toBeInTheDocument();
  });
});
