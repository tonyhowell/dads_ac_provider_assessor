import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryServer, renderApp } from './renderApp';
import { emptyState, type AppState } from '../state/reducer';

const AT = '2026-10-20T00:00:00.000Z';
const lookingFor = (over: Partial<AppState> = {}): AppState => ({
  ...emptyState(),
  answers: { 'B8.1': { answer: '', choices: ['veteran', 'continuity'], notes: '', not_relevant: false }, 'B8.3': { answer: '', choices: ['fees'], notes: '', not_relevant: false } },
  ...over,
});

/** Pretends the window is a phone: every min-width query is false. */
function asPhone() {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: !/min-width/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
}

afterEach(() => vi.unstubAllGlobals());

describe('Find providers: whole plan', () => {
  it('starts with the two ways to look and ranks on what the family chose', async () => {
    const user = userEvent.setup();
    await renderApp('/providers', { server: memoryServer(lookingFor()) });
    expect(screen.getByRole('heading', { level: 1, name: 'Find providers that fit' })).toBeInTheDocument();
    expect(screen.getByText(/Ranked on/)).toHaveTextContent('Ranked on understanding of veterans and the same workers. Change');
    await user.click(screen.getByRole('link', { name: /One provider for my whole plan/ }));

    const cards = await screen.findAllByRole('article');
    expect(within(cards[0]).getByRole('heading')).toHaveTextContent('1Bolton Clarke');
    expect(within(cards[0]).getByText('Partial match')).toBeInTheDocument(); // veterans known; the same workers not checked yet
    // Its flags mention an admin fee, one of the family's deal-breakers: shown, and hidden only when asked.
    expect(within(cards[0]).getByText('One of your deal-breakers: extra fees')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Refine/ }));
    await user.click(screen.getByLabelText('With none of your deal-breakers found'));
    expect(screen.queryByRole('article', { name: 'Bolton Clarke' })).not.toBeInTheDocument();
    expect(screen.getByText(/hidden by your filters/)).toHaveTextContent('3 hidden by your filters');
    await user.click(screen.getByRole('button', { name: 'Show them' }));
    expect(screen.getByRole('article', { name: 'Bolton Clarke' })).toBeInTheDocument();
    // Providers with no published prices sit in their own group.
    expect(screen.getByText(/need a quote —/)).toHaveTextContent('3 need a quote — Five Good Friends');
  });

  it('shortlists from the list and explains a provider in the insight panel', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/providers?view=plan', { server: memoryServer(lookingFor()) });
    await user.click(screen.getByRole('button', { name: 'Shortlist: Bolton Clarke' }));
    await waitFor(() => expect(server.state.selection.map((e) => e.provider_id)).toEqual(['bolton-clarke']));
    expect(screen.getByRole('button', { name: 'Shortlisted: Bolton Clarke' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('link', { name: /Insight\s*: Bolton Clarke/ }));
    const panel = screen.getByRole('region', { name: 'Bolton Clarke' });
    expect(within(panel).getByText('Insight · 1 of 7')).toBeInTheDocument();
    expect(within(panel).getAllByText('Understanding of veterans').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Provider data').length).toBeGreaterThan(0);
    expect(within(panel).getByText('Not checked yet')).toBeInTheDocument();
    await user.click(within(panel).getByRole('tab', { name: 'Cost' }));
    expect(within(panel).getByRole('tabpanel')).toHaveTextContent('a quarter');
    const next = within(panel).getByRole('link', { name: /^Next: / });
    const name = next.textContent!.replace(/^Next: /, '').trim();
    await user.click(next);
    expect(screen.getByRole('region', { name })).toHaveTextContent('Insight · 2 of 7');
    await user.click(screen.getByRole('link', { name: 'Close insight' }));
    expect(screen.queryByRole('region', { name })).not.toBeInTheDocument();
  });

  it('asks for priorities when none are chosen', async () => {
    await renderApp('/providers?view=plan');
    expect(screen.getByText('Tell us what matters most')).toBeInTheDocument();
  });
});

describe('Find providers: by service', () => {
  it('ranks for the chosen services, compares combinations and records picks', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/providers?view=service&s=pc,gardening', { server: memoryServer(lookingFor({ answers: {} })) });
    expect(screen.getByRole('button', { name: /Personal care/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Gardening/ })).toHaveAttribute('aria-pressed', 'true');
    const combos = screen.getByRole('region', { name: 'Best combinations' });
    expect(within(combos).getByText('Right at Home Brisbane Bayside South + Bolton Clarke')).toBeInTheDocument();

    const bolton = screen.getByRole('article', { name: 'Bolton Clarke' });
    expect(within(bolton).getByText(/Gardening/)).toHaveTextContent('$113.00/hr');
    await user.click(within(bolton).getByRole('button', { name: /Choose for gardening/ }));
    await waitFor(() => expect(server.state.servicePicks).toEqual({ gardening: 'bolton-clarke' }));
    expect(server.state.selection.map((e) => e.provider_id)).toEqual(['bolton-clarke']);
    expect(screen.getByText('Gardening: Bolton Clarke')).toBeInTheDocument();
    await user.click(within(bolton).getByRole('button', { name: /Chosen for gardening/ }));
    await waitFor(() => expect(server.state.servicePicks).toEqual({}));
  });
});

describe('Compare your shortlist', () => {
  it('compares side by side and chooses who to interview', async () => {
    const user = userEvent.setup();
    const shortlist = ['bolton-clarke', 'right-at-home-brisbane-bayside-south'].map((provider_id) => ({ provider_id, stage: 'scan' as const, why: '', watch: '', added_at: AT, stage_changed_at: AT }));
    const { server } = await renderApp('/compare', { server: memoryServer(lookingFor({ selection: shortlist })) });
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /Bolton Clarke/ })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Understanding of veterans' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('checkbox', { name: /Interview them\s*: Bolton Clarke/ })[0]);
    await waitFor(() => expect(server.state.selection.find((e) => e.provider_id === 'bolton-clarke')?.stage).toBe('interview'));
    expect(screen.getByRole('link', { name: /Interview 1 provider/ })).toBeInTheDocument();
  });
});

describe('Find providers on a phone', () => {
  it('shows a reduced list, the top three first, and one provider per screen', async () => {
    asPhone();
    const user = userEvent.setup();
    await renderApp('/providers?view=plan', { server: memoryServer(lookingFor({ answers: { 'B8.1': { answer: '', choices: ['veteran'], notes: '', not_relevant: false } } })) });
    expect(screen.getByRole('heading', { level: 1, name: 'Your best matches' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refine/ })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Quick filters' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('listitem')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));

    await user.click(screen.getByRole('link', { name: /Bolton Clarke/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Bolton Clarke' })).toBeInTheDocument();
    expect(screen.getByText('Scores, full prices and the dossier are on a bigger screen.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows the shortlist as stacked cards', async () => {
    asPhone();
    const shortlist = [{ provider_id: 'bolton-clarke', stage: 'interview' as const, why: '', watch: '', added_at: AT, stage_changed_at: AT }];
    await renderApp('/compare', { server: memoryServer(lookingFor({ selection: shortlist })) });
    expect(screen.getByRole('heading', { level: 1, name: 'Who do you want to meet?' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Interview them/ })).toBeChecked();
  });
});
