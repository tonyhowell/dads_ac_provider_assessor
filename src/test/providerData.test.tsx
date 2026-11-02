import { act, screen, waitFor, within } from '@testing-library/react';
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

describe('automatic import of the government list', () => {
  it('shows recent imports, saves settings and starts a check', async () => {
    const user = userEvent.setup();
    const calls: { path: string; method: string; body: unknown }[] = [];
    let status = 'done';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ path, method, body });
        if (path === '/api/admin/gen-import' && method === 'GET')
          return Response.json({
            settings: { url: 'https://www.gen-agedcaredata.gov.au/topics/providers-of-aged-care', scope: 'national', auto: true },
            every_hours: 168,
            runs: [
              { id: 'r1', trigger: 'schedule', status, file_url: 'x', as_at: '2026-06-30', stats: { added: 812, updated: 3, missing: 2, providers: 830, home_care: 3400 }, log: [], error: null, started_at: AT, finished_at: AT },
            ],
          });
        if (path === '/api/admin/gen-import' && method === 'PUT') return Response.json({ settings: body });
        if (path === '/api/admin/gen-import/run') {
          status = 'running';
          return Response.json({ started: true }, { status: 202 });
        }
        return Response.json({ suggestions: [], applications: [] });
      }),
    );
    await renderApp('/admin/providers/load', { waitForNav: false });
    const card = await screen.findByRole('region', { name: 'Automatic import' });
    expect(within(card).getByText(/checking every 7 days/)).toBeInTheDocument();
    expect(await within(card).findByText(/812 added, 3 updated, 2 no longer listed · 830 home care providers/)).toBeInTheDocument();

    await user.click(within(card).getByLabelText('Only the regions around active applications'));
    await user.click(within(card).getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ url: 'https://www.gen-agedcaredata.gov.au/topics/providers-of-aged-care', scope: 'regions', auto: true }));

    await user.click(within(card).getByRole('button', { name: 'Check for a new list now' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/api/admin/gen-import/run')?.body).toEqual({ force: false }));
    expect(await within(card).findByRole('button', { name: 'Importing…' })).toBeDisabled();
  });
});

describe('uploading the government list', () => {
  it('imports only when asked, showing upload and processing progress, then the result', async () => {
    const user = userEvent.setup();
    const sentBodies: unknown[] = [];
    let xhr: FakeXhr | null = null;
    class FakeXhr {
      upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 0;
      responseText = '';
      withCredentials = false;
      open() {}
      setRequestHeader() {}
      send(body: string) {
        sentBodies.push(JSON.parse(body));
        xhr = this;
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const settings = { url: 'https://www.gen-agedcaredata.gov.au/topics/providers-of-aged-care', scope: 'national', auto: true };
    const earlier = { id: 'r0', trigger: 'schedule', status: 'failed', file_url: null, as_at: null, stats: {}, log: [], error: 'answered 403.', started_at: AT, finished_at: AT, progress: null };
    let runs: unknown[] = [earlier];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/api/admin/gen-import') return Response.json({ settings, every_hours: 168, runs });
        return Response.json({ suggestions: [], applications: [] });
      }),
    );
    await renderApp('/admin/providers/load', { waitForNav: false });
    const card = await screen.findByRole('region', { name: 'Automatic import' });
    const file = new File([new Uint8Array([0x50, 0x4b, 1, 2])], 'aged-care-service-list-30-june-2025-australia.xlsx');
    await user.upload(within(card).getByLabelText('Or upload the list yourself'), file);
    expect(sentBodies).toHaveLength(0); // nothing happens until asked
    expect(within(card).getByText('aged-care-service-list-30-june-2025-australia.xlsx')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Import this file' }));

    await waitFor(() => expect(xhr).not.toBeNull());
    expect(sentBodies[0]).toMatchObject({ name: 'aged-care-service-list-30-june-2025-australia.xlsx', force: false });
    act(() => xhr!.upload.onprogress!({ lengthComputable: true, loaded: 40, total: 100 }));
    expect(within(card).getByText(/Sending the file \(40%\)/)).toBeInTheDocument();

    runs = [{ ...earlier, id: 'r1', trigger: 'upload', status: 'running', error: null, progress: { stage: 'saving', done: 300, total: 1312, updated_at: AT } }, earlier];
    act(() => {
      xhr!.status = 202;
      xhr!.onload!();
    });
    expect(await within(card).findByText(/Saving changes \(300 of 1,312\)/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(within(card).getByText(/✓ Reading the spreadsheet/)).toBeInTheDocument();

    runs = [{ ...earlier, id: 'r1', trigger: 'upload', status: 'done', error: null, progress: null, stats: { added: 1290, updated: 20, missing: 0, providers: 1310, services: 9000 } }, earlier];
    expect(await within(card).findByText('Import finished', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(within(card).getByText(/1290 providers added, 20 updated, 0 no longer listed/)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Done' }));
    expect(within(card).queryByText('Import finished')).not.toBeInTheDocument();
  }, 15_000);
});
