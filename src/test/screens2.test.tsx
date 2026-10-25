import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { memoryServer, renderApp } from './renderApp';
import { emptyState, type AppState } from '../state/reducer';

const shortlisted = (...ids: string[]): AppState => ({
  ...emptyState(),
  selection: ids.map((provider_id) => ({ provider_id, stage: 'interview' as const, why: '', watch: '', added_at: 'x', stage_changed_at: 'x' })),
});

describe('Participant setup', () => {
  it('saves the participant and shows their rates, budget and DVA prompts', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/');
    await user.type(screen.getByLabelText('Suburb'), 'Exampleton');
    await user.type(screen.getByLabelText('Postcode'), '4000');
    await user.selectOptions(screen.getByLabelText(/Classification \(from the Notice/), '5');
    await user.click(screen.getByLabelText(/Part pensioner/));
    await user.click(screen.getByLabelText('Gold Card'));

    // Out-of-band assessed rates block saving.
    await user.type(screen.getByLabelText(/^Independence \(/), '60');
    await user.type(screen.getByLabelText(/^Everyday living \(/), '40');
    expect(screen.getByRole('button', { name: 'Save participant' })).toBeDisabled();
    expect(screen.getByText(/Assessed rates must be within 5%–50%/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Independence \(/));
    await user.type(screen.getByLabelText(/^Independence \(/), '20');

    expect(screen.getByText(/of which/)).toHaveTextContent('$9,182');
    expect(screen.getByText(/Veterans' Home Care/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save participant' }));

    await waitFor(() => expect(server.state.participant).toMatchObject({ suburb: 'Exampleton', classification: '5', pension_status: 'part_pensioner', ind_rate: 0.2, ev_rate: 0.4, dva_card: 'gold' }));
  });
});

describe('Relative costs', () => {
  it('shows the headline, plan costs and contributions for the reference plan', async () => {
    const server = memoryServer({ ...emptyState(), serviceDate: '2026-10-25' });
    await renderApp('/costs', { server });
    await userEvent.setup().selectOptions(screen.getByLabelText('Providers'), 'all');

    expect(screen.getByText('Cheapest for this plan').parentElement).toHaveTextContent('$12,500Right at Home Brisbane Bayside South');
    expect(screen.getByText('Dearest for this plan').parentElement).toHaveTextContent('$14,239BlueCare (UnitingCare QLD)');
    const bolton = screen.getAllByRole('row').find((r) => r.textContent?.startsWith('Bolton Clarke') && r.textContent.includes('$12,701'))!;
    expect(bolton).toHaveTextContent('$784–$4,373');
    expect(screen.getByText(/No published rates for this plan/).parentElement).toHaveTextContent('Five Good Friends (Brisbane East & Bayside), Carers Link, Envigor Brisbane Bayside');
  });

  it('saves plan edits for everyone', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/costs');
    const hours = screen.getByLabelText('Hours a week for Domestic assistance');
    await user.clear(hours);
    await user.type(hours, '4');
    await user.tab();
    await waitFor(() => expect(server.state.plan?.find((i) => i.key === 'domestic')?.hours_per_week).toBe(4));
    await user.click(screen.getByRole('button', { name: 'Reset to sample plan' }));
    await waitFor(() => expect(server.state.plan).toBeNull());
  });
});

describe('Providers: add, edit, import', () => {
  it('adds a provider through the form', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/providers/new');
    await user.type(screen.getByLabelText('Provider name'), 'Example Home Care');
    await user.type(screen.getByLabelText('Personal care'), '99.5');
    await user.type(screen.getByLabelText('Prices as at'), '20 Oct 2026');
    await user.type(screen.getByLabelText('Price list link'), 'not a link');
    await user.click(screen.getByRole('button', { name: 'Add provider' }));
    expect(screen.getByRole('alert')).toHaveTextContent('full web address');
    await user.clear(screen.getByLabelText('Price list link'));
    await user.click(screen.getByRole('button', { name: 'Add provider' }));

    expect(await screen.findByRole('heading', { name: 'Example Home Care' })).toBeInTheDocument();
    expect(server.state.providerEdits[0]).toMatchObject({ id: 'example-home-care', pc: 99.5, prices_as_at_date: '2026-10-20' });
  });

  it('edits a starter-pack provider and can undo it', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/providers/bolton-clarke/edit');
    const pc = screen.getByLabelText('Personal care');
    expect(pc).toHaveValue('126');
    await user.clear(pc);
    await user.type(pc, '130');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Edited by the family')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Personal care/ })).toHaveTextContent('$130.00');

    await user.click(screen.getByRole('button', { name: 'Undo changes' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: 'Undo changes' }));
    await waitFor(() => expect(server.state.providerEdits).toEqual([]));
  });

  it('imports providers from pasted CSV', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/providers/import');
    // userEvent treats { and [ as special keys, so paste the text.
    await user.click(screen.getByLabelText('Or paste CSV'));
    await user.paste('provider,pc,prices_as_at\nNew Co,101,1 Oct 2026\nBolton Clarke,128,24 Oct 2026\n,5,');
    expect(screen.getByText('Line 4: Provider name is missing.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import 2 providers (skip 1)' }));
    expect(await screen.findByRole('heading', { name: 'Providers' })).toBeInTheDocument();
    expect(server.state.providerEdits.map((p) => [p.id, p.pc])).toEqual([
      ['new-co', 101],
      ['bolton-clarke', 128],
    ]);
  });

  it('flags providers that mention travel or admin fees', async () => {
    await renderApp('/providers');
    const card = screen.getByRole('heading', { name: 'Right at Home Brisbane Bayside South' }).closest('li')!;
    expect(within(card).getByText(/Check fees/)).toBeInTheDocument();
  });
});

describe('Bounding questions', () => {
  it('drops a section only when every covering question is not relevant, live', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/bounding');
    expect(screen.getByText(/of 74 interview questions included/)).toHaveTextContent('74 of 74');
    // Section O (respite and carer support, 3 should questions) is covered only by B6.1.
    await user.click(screen.getByText(/Home, household and carers/));
    const b61 = screen.getByText(/Does he live alone/).closest('li')!;
    await user.click(within(b61).getByLabelText('Not relevant'));
    expect(screen.getByText(/of 74 interview questions included/)).toHaveTextContent('71 of 74');
    await user.click(within(b61).getByLabelText('No'));
    await waitFor(() => expect(server.state.answers['B6.1']).toMatchObject({ answer: 'no', not_relevant: true }));
  });
});

describe('Interview pack and scoring', () => {
  it('records answers per provider and adds custom questions', async () => {
    const user = userEvent.setup();
    const server = memoryServer(shortlisted('bolton-clarke', 'anglicare-southern-queensland'));
    await renderApp('/interview-pack', { server });

    await user.click(screen.getByLabelText('Answer to A1'));
    await user.paste('Yes, within two weeks');
    await user.selectOptions(screen.getByLabelText('Satisfactory?', { selector: '#sat-A1' }), 'yes');
    await waitFor(() => expect(server.state.responses['bolton-clarke::A1']).toEqual({ text: 'Yes, within two weeks', satisfactory: true }));

    await user.click(screen.getByRole('button', { name: /Anglicare Southern Queensland/ }));
    expect(screen.getByLabelText('Answer to A1')).toHaveValue('');

    await user.click(screen.getByLabelText('Add a question to section C'));
    await user.paste('Can we meet the workers first?');
    await user.click(within(screen.getByLabelText('Add a question to section C').closest('form')!).getByRole('button', { name: 'Add question' }));
    expect(await screen.findByText('Can we meet the workers first?')).toBeInTheDocument();
    expect(server.state.customQuestions).toMatchObject([{ section: 'C', text: 'Can we meet the workers first?' }]);
  }, 15_000);

  it('ranks providers by weighted score and flags unanswered must questions', async () => {
    const user = userEvent.setup();
    const server = memoryServer(shortlisted('bolton-clarke', 'anglicare-southern-queensland'));
    await renderApp('/scoring', { server });

    await user.selectOptions(screen.getByLabelText('Veteran / PTSD capability score for Bolton Clarke'), '5');
    await user.selectOptions(screen.getByLabelText('Veteran / PTSD capability score for Anglicare Southern Queensland'), '3');
    // Bolton's plan is ~10% above benchmark: suggested price score 1.
    await user.click(screen.getByRole('button', { name: 'Use suggested 1 for Bolton Clarke' }));
    // (5×2 + 1×1) ÷ 3 = 3.67
    const ranking = screen.getByRole('heading', { name: 'Ranking' }).parentElement!;
    const items = within(ranking).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Bolton Clarke3.67 / 5');
    expect(items[1]).toHaveTextContent('Anglicare Southern Queensland3.00 / 5');
    expect(items[0]).toHaveTextContent('Disqualify? 11 must questions not answered in writing');
    expect(server.state.scores).toEqual({ 'bolton-clarke::veteran': 5, 'anglicare-southern-queensland::veteran': 3, 'bolton-clarke::price': 1 });
  });

  it('prints the pack with a column per shortlisted provider', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const server = memoryServer({
      ...shortlisted('bolton-clarke', 'carers-link'),
      responses: { 'bolton-clarke::A1': { text: 'Two weeks', satisfactory: true } },
    });
    await renderApp('/interview-pack/print', { server, waitForNav: false });
    const tableA = screen.getByRole('heading', { name: /A\. Eligibility/ }).nextElementSibling as HTMLElement;
    expect(within(tableA).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['#', 'Question', 'Bolton Clarke', 'Carers Link']);
    expect(within(tableA).getByRole('row', { name: /A1/ })).toHaveTextContent('Two weeks');
    expect(screen.getByText(/not financial or legal advice/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Print or save as PDF' }));
    expect(print).toHaveBeenCalled();
  });
});
