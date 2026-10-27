import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from './renderApp';
import { duration } from '../screens/AdminEnrichmentScreen';

const AT = '2026-10-27T00:00:00.000Z';
const item = (over: Record<string, unknown>) => ({ part: 'prices', url: null, stage: null, detail: null, outcome: null, error: null, started_at: AT, ms: null, ...over });

function stub(runs: unknown[]) {
  const calls: { path: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? 'GET' });
      const body = path === '/api/admin/enrichment' ? { runs, sources: [], pages: [], configured: true, schedule_hours: null } : path === '/api/admin/enrichment/stop' ? { ok: true } : { suggestions: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Data checks (admin)', () => {
  it('shows a running check: progress, time left, what it is doing, problems, and a way to stop', async () => {
    const user = userEvent.setup();
    const calls = stub([
      {
        id: 'r2', trigger: 'admin', status: 'running', error: null, started_at: new Date(Date.now() - 125_000).toISOString(), finished_at: null, cancel_requested: false, stats: {}, usage: {}, log: [],
        progress: {
          eta_seconds: 240,
          updated_at: new Date().toISOString(),
          skipped: { claims_current: 3, no_price_list: 0 },
          items: [
            item({ id: '1', label: 'Price list · Bolton Clarke', status: 'done', outcome: 'Unchanged', ms: 1000 }),
            item({ id: '2', label: 'Price list · Anglicare', url: 'https://example.org/a.pdf', status: 'failed', error: { stage: 'Download', message: 'no answer within 20 seconds (tried 3 times)' }, ms: 64000 }),
            item({ id: '3', label: 'Price list · BlueCare', status: 'running', stage: 'Downloading', detail: '2.1 MB of 4.0 MB', started_at: new Date().toISOString() }),
            item({ id: '4', label: 'Public claims · Carers Link', part: 'claims', status: 'queued', started_at: null }),
          ],
        },
      },
    ]);
    await renderApp('/admin/data-checks', { waitForNav: false });
    const live = await screen.findByRole('region', { name: 'Checking now' });
    expect(within(live).getByText('2 of 4 checked')).toBeInTheDocument();
    expect(within(live).getByText(/left$/)).toHaveTextContent('About 4 min left');
    expect(within(live).getByText(/started 2 min ago/)).toBeInTheDocument();
    expect(within(live).getByText('Downloading · 2.1 MB of 4.0 MB')).toBeInTheDocument();
    expect(within(live).getByText('Problems so far (1)')).toBeInTheDocument();
    expect(within(live).getByText(/no answer within 20 seconds \(tried 3 times\)/)).toBeInTheDocument();
    expect(within(live).getByText(/3 providers' public claims are still current/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Checking…/ })).toBeDisabled();

    await user.click(within(live).getByRole('button', { name: 'Stop' }));
    await user.click(screen.getByRole('button', { name: 'Stop the check' }));
    expect(calls.some((c) => c.path === '/api/admin/enrichment/stop' && c.method === 'POST')).toBe(true);
  });

  it('lists each item of a finished check, problems first', async () => {
    const user = userEvent.setup();
    stub([
      {
        id: 'r1', trigger: 'schedule', status: 'done', error: null, started_at: AT, finished_at: '2026-10-27T00:06:30.000Z', cancel_requested: false, log: [],
        stats: { prices: { checked: 2, unchanged: 1, changed: 0, errors: 1, suggestions: 0, matched: 0 } },
        usage: { estimated_cost_usd: 0.004 },
        progress: {
          items: [
            item({ id: '1', label: 'Price list · Bolton Clarke', status: 'done', outcome: 'Unchanged', ms: 1000 }),
            item({ id: '2', label: 'Price list · Anglicare', status: 'failed', error: { stage: 'Reading with Claude Haiku', message: 'Claude took too long to answer (tried 4 times)' }, ms: 300000 }),
          ],
        },
      },
    ]);
    await renderApp('/admin/data-checks', { waitForNav: false });
    expect(await screen.findByText(/took 7 min/)).toBeInTheDocument();
    expect(screen.getByText(/1 with problems/)).toBeInTheDocument();
    await user.click(screen.getByText('Each item (2)'));
    expect(screen.getByRole('button', { name: 'Problems (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('table')).toHaveTextContent('Reading with Claude Haiku: Claude took too long to answer (tried 4 times)');
    expect(screen.getByRole('table')).not.toHaveTextContent('Bolton Clarke');
    await user.click(screen.getByRole('button', { name: 'All (2)' }));
    expect(screen.getByRole('table')).toHaveTextContent('Bolton Clarke');
  });

  it('words durations simply', () => {
    expect([duration(45), duration(200), duration(3900)]).toEqual(['45 sec', '3 min', '1 hr 5 min']);
  });
});
