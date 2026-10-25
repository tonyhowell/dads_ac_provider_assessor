import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { memoryBackend, memoryServer, renderApp } from './renderApp';
import { emptyState, type AppState } from '../state/reducer';
import type { ClaimsRow } from '../backend';

const AT = '2026-10-20T00:00:00.000Z';

const ready = (providerId: string): ClaimsRow => ({
  provider_id: providerId,
  status: 'ready',
  error: null,
  started_at: AT,
  finished_at: AT,
  claims: {
    website: 'https://www.boltonclarke.com.au',
    overview: 'Large not-for-profit with a veterans service.',
    items: [
      { question_id: 'E1', status: 'stated', claim: 'Has a dedicated veterans team', quote: 'our dedicated veterans team', source_url: 'https://www.boltonclarke.com.au/veterans', source_title: 'Veterans services' },
      { question_id: 'O1', status: 'partly', claim: 'Offers respite', quote: 'respite care', source_url: 'https://www.boltonclarke.com.au/respite', source_title: 'Respite' },
    ],
  },
});

const atStage = (stage: 'scan' | 'interview', ...ids: string[]): AppState => ({
  ...emptyState(),
  selection: ids.map((provider_id) => ({ provider_id, stage, why: '', watch: '', added_at: AT, stage_changed_at: AT })),
});

describe('public claims', () => {
  it("shows a provider's claims for the applicant's topics, with sources", async () => {
    const user = userEvent.setup();
    // Living alone rules out section O (carer respite), so its claim is hidden unless asked for.
    const server = memoryServer({ ...emptyState(), answers: { 'B6.1': { answer: 'alone', not_relevant: true } } });
    const backend = memoryBackend(server);
    backend.claimRows = [ready('bolton-clarke')];
    await renderApp('/providers/bolton-clarke', { server, backend });

    const panel = screen.getByRole('button', { name: /What they say publicly/ });
    expect(panel).toHaveTextContent(/1 of your \d+ topics have a public claim/);
    await user.click(panel);
    expect(screen.getByText('Has a dedicated veterans team')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Veterans services/ })).toHaveAttribute('href', 'https://www.boltonclarke.com.au/veterans');
    expect(screen.queryByText('Offers respite')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show all 2 claims/ }));
    expect(screen.getByText('Offers respite')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Search again/ }));
    expect(backend.claimRequests).toEqual([{ providerId: 'bolton-clarke', refresh: true }]);
    expect(await screen.findByText(/usually takes 2 to 4 minutes/)).toBeInTheDocument();
  });

  it('checks everyone in the initial scan in one go', async () => {
    const user = userEvent.setup();
    const server = memoryServer(atStage('scan', 'bolton-clarke', 'carers-link', 'envigor-brisbane-bayside'));
    const backend = memoryBackend(server);
    backend.claimRows = [ready('bolton-clarke')];
    await renderApp('/selection/scan', { server, backend });
    expect(within(screen.getByRole('link', { name: 'Bolton Clarke' }).closest('li')!).getByText(/2 public claims/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check public claims for all 2' }));
    expect(backend.claimRequests.map((r) => r.providerId)).toEqual(['carers-link', 'envigor-brisbane-bayside']);
  });

  it('shows "They say" under the matching interview question', async () => {
    const server = memoryServer(atStage('interview', 'bolton-clarke'));
    const backend = memoryBackend(server);
    backend.claimRows = [ready('bolton-clarke')];
    await renderApp('/interview-pack', { server, backend });
    // Section E holds E1; open it to see the question.
    await userEvent.setup().click(screen.getByText(/^E\. /, { selector: 'button span' }));
    const lines = screen.getAllByText('They say:').map((el) => el.closest('p')!.textContent);
    expect(lines).toEqual([expect.stringContaining('Has a dedicated veterans team'), expect.stringContaining('Offers respite')]);
  });

  it("doesn't offer searches to viewers", async () => {
    const server = memoryServer(atStage('scan', 'carers-link'));
    await renderApp('/selection/scan', { server, role: 'viewer' });
    expect(screen.queryByRole('button', { name: /Check public claims/ })).not.toBeInTheDocument();
  });
});
