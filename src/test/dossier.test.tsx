import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryBackend, memoryServer, renderApp } from './renderApp';
import { emptyProfile, emptyState, type AppState } from '../state/reducer';

afterEach(() => vi.restoreAllMocks());

const AT = '2026-10-20T00:00:00.000Z';

const filled = (): AppState => ({
  ...emptyState(),
  participant: { id: 'p', name: '', suburb: 'Wynnum', postcode: '4178', pension_status: 'part_pensioner', ind_rate: 0.2, ev_rate: 0.4, dva_card: 'gold', nwop: false, classification: '5', lifetime_contributions_paid: 0 },
  profile: { ...emptyProfile(), preferred_name: 'Bill', contact_name: 'Sam', contact_relationship: 'son', communication: ['hearing'], dva_conditions: ['ptsd'], dva_services: ['nursing'] },
  lookingFor: { summary: "I'm looking for the same worker each week.", priorities: ['Same workers'], must_haves: ['Veteran-aware staff'], deal_breakers: [], generated_at: AT, edited: true },
  answers: { 'B3.2': { answer: 'essential', notes: 'Strangers upset me', not_relevant: false } },
  selection: [{ provider_id: 'bolton-clarke', stage: 'interview', why: 'Veteran heritage', watch: 'SECRET watch note', added_at: AT, stage_changed_at: AT }],
});

describe('provider dossier', () => {
  it('prints what the family chooses, money only when asked, after confirming the share', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const server = memoryServer(filled());
    const backend = memoryBackend(server);
    backend.claimRows = [
      {
        provider_id: 'bolton-clarke', status: 'ready', error: null, started_at: AT, finished_at: AT,
        claims: { website: null, overview: '', items: [{ question_id: 'E1', status: 'stated', claim: 'Has a dedicated veterans team', quote: 'x', source_url: 'https://www.boltonclarke.com.au/veterans', source_title: 'Veterans' }] },
      },
    ];
    await renderApp('/dossier/bolton-clarke', { server, backend, waitForNav: false });

    expect(screen.getByRole('heading', { name: 'About Bill' })).toBeInTheDocument();
    expect(screen.getByText("I'm looking for the same worker each week.")).toBeInTheDocument();
    expect(screen.getByText('PTSD')).toBeInTheDocument();
    expect(screen.getByText(/Hearing loss/)).toBeInTheDocument();
    expect(screen.getByText('“Strangers upset me”')).toBeInTheDocument();
    expect(screen.getByText('Has a dedicated veterans team')).toBeInTheDocument();
    // Never the family's private notes; money off by default.
    expect(screen.queryByText(/SECRET watch note/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'My budget and contributions' })).not.toBeInTheDocument();

    const printButton = screen.getByRole('button', { name: 'Print or save as PDF' });
    expect(printButton).toBeDisabled();
    await user.click(screen.getByLabelText(/My budget and contributions/));
    expect(screen.getByRole('heading', { name: 'My budget and contributions' })).toBeInTheDocument();
    await waitFor(() => expect(server.state.dossierSections).toContain('money'));

    await user.click(screen.getByLabelText(/I'm choosing to share this with Bolton Clarke/));
    await user.click(printButton);
    expect(print).toHaveBeenCalled();
  });
});
