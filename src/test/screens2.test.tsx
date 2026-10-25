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
    await user.selectOptions(screen.getByRole('combobox', { name: /Your level/ }), '5');
    await user.click(screen.getByLabelText(/Part pensioner/));
    await user.click(screen.getByLabelText('Gold Card'));

    // Out-of-band assessed rates block saving, with an error summary.
    await user.type(screen.getByLabelText('Independence rate'), '60');
    await user.type(screen.getByLabelText('Everyday living rate'), '40');
    await user.click(screen.getByRole('button', { name: 'Save my details' }));
    expect(screen.getByText(/Please fix this before saving/)).toBeInTheDocument();
    expect(screen.getAllByText(/Your rates should be between 5% and 50%/).length).toBeGreaterThan(0);
    expect(server.state.participant).toBeNull();
    await user.clear(screen.getByLabelText('Independence rate'));
    await user.type(screen.getByLabelText('Independence rate'), '20');

    const summary = screen.getByRole('complementary', { name: 'Your summary' });
    expect(within(summary).getByText(/for your services each quarter/)).toHaveTextContent('$9,182');
    expect(within(summary).getByText(/Veterans' Home Care/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save my details' }));

    await waitFor(() => expect(server.state.participant).toMatchObject({ suburb: 'Exampleton', classification: '5', pension_status: 'part_pensioner', ind_rate: 0.2, ev_rate: 0.4, dva_card: 'gold' }));
  });
});

describe('Relative costs', () => {
  it('shows the headline, plan costs and contributions for the reference plan', async () => {
    const server = memoryServer({ ...emptyState(), serviceDate: '2026-10-25' });
    await renderApp('/costs', { server });
    await userEvent.setup().selectOptions(screen.getByLabelText('Providers to compare'), 'all');

    expect(screen.getByText(/Your plan costs between/)).toHaveTextContent(
      'Your plan costs between $12,500 and $14,239 a quarter — a difference of 13.9%. The cheapest is Right at Home Brisbane Bayside South.',
    );
    const pay = screen.getByRole('region', { name: "What you'd pay" });
    const bolton = within(within(pay).getByRole('table')).getAllByRole('row').find((r) => r.textContent?.startsWith('Bolton Clarke'))!;
    expect(bolton).toHaveTextContent('$12,701');
    expect(bolton).toHaveTextContent('$784 to $4,373');
    expect(screen.getByText(/They're left out of the comparison/)).toHaveTextContent('Five Good Friends (Brisbane East & Bayside), Carers Link, Envigor Brisbane Bayside');
  });

  it('saves plan edits for everyone', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/costs');
    const hours = screen.getByLabelText('Hours a week for Domestic assistance');
    await user.clear(hours);
    await user.type(hours, '4');
    await user.tab();
    await waitFor(() => expect(server.state.plan?.find((i) => i.key === 'domestic')?.hours_per_week).toBe(4));
    await user.click(screen.getByRole('button', { name: 'Go back to the sample plan' }));
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
    expect(screen.getByText('Personal care', { selector: 'dt' }).nextElementSibling).toHaveTextContent('$130.00 /hr');

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
    expect(await screen.findByRole('heading', { name: 'Look up providers near you' })).toBeInTheDocument();
    expect(server.state.providerEdits.map((p) => [p.id, p.pc])).toEqual([
      ['new-co', 101],
      ['bolton-clarke', 128],
    ]);
  });

  it('flags providers that mention travel or admin fees', async () => {
    await renderApp('/providers');
    const card = screen.getByRole('heading', { name: 'Right at Home Brisbane Bayside South' }).closest('li')!;
    expect(within(card).getByText('Possible extra fee')).toBeInTheDocument();
  });
});

describe('Bounding questions', () => {
  it('drops a section only when every covering question is not relevant, live', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/bounding');
    const counter = () => screen.getByText(/Your interview pack:/);
    expect(counter()).toHaveTextContent('74 questions');
    // Section O (respite and carer support, 3 should questions) is covered only by B6.1.
    const group = screen.getByRole('button', { name: /Home, household and carers/ });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    await user.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'true');
    const b61 = screen.getByText(/Does he live alone/).closest('li')!;
    await user.click(within(b61).getByRole('button', { name: 'Not relevant to me' }));
    expect(counter()).toHaveTextContent('71 questions');
    await user.click(within(b61).getByLabelText('No'));
    await waitFor(() => expect(server.state.answers['B6.1']).toMatchObject({ answer: 'no', not_relevant: true }));
    await user.click(within(b61).getByRole('button', { name: /Marked not relevant to me — undo/ }));
    expect(counter()).toHaveTextContent('74 questions');
  });
});

describe('Interview pack and scoring', () => {
  it('records answers per provider and adds custom questions', async () => {
    const user = userEvent.setup();
    const server = memoryServer(shortlisted('bolton-clarke', 'anglicare-southern-queensland'));
    await renderApp('/interview-pack', { server });

    // Label and role queries over the whole pack are slow, so find the field by id and work within its question.
    const answer = document.getElementById('resp-A1')!;
    expect(answer).toHaveAccessibleName("Bolton Clarke's answer to A1");
    const a1 = () => within(document.getElementById('resp-A1')!.closest('li')!);
    await user.click(answer);
    await user.paste('Yes, within two weeks');
    await user.click(within(a1().getByRole('group', { name: 'Answered well? (A1)' })).getByRole('button', { name: 'Yes' }));
    await user.click(a1().getByLabelText(/Got it in writing/));
    await waitFor(() => expect(server.state.responses['bolton-clarke::A1']).toEqual({ text: 'Yes, within two weeks', rating: 'yes', in_writing: true }));
    // Pressing the selected rating again clears it.
    await user.click(within(a1().getByRole('group', { name: 'Answered well? (A1)' })).getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(server.state.responses['bolton-clarke::A1'].rating).toBeNull());

    await user.click(within(screen.getByRole('navigation', { name: "Provider you're interviewing" })).getByRole('button', { name: /Anglicare Southern Queensland/ }));
    expect(document.getElementById('resp-A1')).toHaveAccessibleName("Anglicare Southern Queensland's answer to A1");
    expect(document.getElementById('resp-A1')).toHaveValue('');

    await user.click(screen.getByText(/Add your own question to section C/));
    const add = document.getElementById('add-C')!;
    expect(add).toHaveAccessibleName('Your question for section C');
    await user.click(add);
    await user.paste('Can we meet the workers first?');
    await user.click(within(add.closest('form')!).getByRole('button', { name: 'Add question' }));
    expect(await screen.findByText('Can we meet the workers first?')).toBeInTheDocument();
    expect(server.state.customQuestions).toMatchObject([{ section: 'C', text: 'Can we meet the workers first?' }]);
  }, 15_000);

  it('ranks providers by weighted score and flags unanswered must questions', async () => {
    const user = userEvent.setup();
    const server = memoryServer(shortlisted('bolton-clarke', 'anglicare-southern-queensland'));
    await renderApp('/scoring', { server });

    await user.click(within(screen.getByRole('group', { name: 'Veteran / PTSD capability score for Bolton Clarke' })).getByRole('button', { name: /^5/ }));
    // Bolton's plan is ~10% above benchmark: suggested price score 1.
    await user.click(screen.getByRole('button', { name: /Use the suggested score: 1 \(Poor\)/ }));
    await user.click(screen.getByRole('button', { name: /^Anglicare Southern Queensland/ }));
    await user.click(within(screen.getByRole('group', { name: 'Veteran / PTSD capability score for Anglicare Southern Queensland' })).getByRole('button', { name: /^3/ }));
    // (5×2 + 1×1) ÷ 3 = 3.67
    const ranking = screen.getByRole('region', { name: 'How they compare' });
    const items = within(ranking).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/Bolton Clarke.*3\.7 out of 5/);
    expect(items[1]).toHaveTextContent(/Anglicare Southern Queensland.*3\.0 out of 5/);
    expect(items[0]).toHaveTextContent('Disqualify? 11 must-ask questions not answered in writing');
    expect(server.state.scores).toEqual({ 'bolton-clarke::veteran': 5, 'anglicare-southern-queensland::veteran': 3, 'bolton-clarke::price': 1 });
  });

  it('prints one section per shortlisted provider', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const server = memoryServer({
      ...shortlisted('bolton-clarke', 'carers-link'),
      responses: { 'bolton-clarke::A1': { text: 'Two weeks', rating: 'yes', in_writing: true } },
    });
    await renderApp('/interview-pack/print', { server, waitForNav: false });
    const [bolton, carers] = screen.getAllByRole('table');
    expect(within(bolton).getByRole('heading', { level: 2 })).toHaveTextContent('Bolton Clarke');
    expect(within(carers).getByRole('heading', { level: 2 })).toHaveTextContent('Carers Link');
    const a1 = within(bolton).getByText('A1').closest('li')!;
    expect(a1).toHaveTextContent('Two weeks');
    expect(a1).toHaveTextContent('Got it in writing ☑');
    expect(within(carers).getByText('A1').closest('li')).toHaveTextContent('Got it in writing ☐');
    expect(within(bolton).getByText(/not financial or legal advice/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Print or save as PDF' }));
    expect(print).toHaveBeenCalled();
  });
});
