import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { memoryBackend, memoryServer, renderApp, testApplication } from './renderApp';
import { loadSeedData } from '../data/load';
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

describe('For providers (profile)', () => {
  it('saves profile details as you go, and shows DVA details for card holders', async () => {
    const user = userEvent.setup();
    const participant = { id: 'p', name: '', suburb: 'Wynnum', postcode: '4178', pension_status: 'full_pensioner' as const, ind_rate: null, ev_rate: null, dva_card: 'gold' as const, nwop: false, classification: '5', lifetime_contributions_paid: 0 };
    const { server } = await renderApp('/', { server: memoryServer({ ...emptyState(), participant }) });
    await user.type(screen.getByLabelText('Preferred name'), 'Bill');
    await user.tab();
    await waitFor(() => expect(server.state.profile?.preferred_name).toBe('Bill'));
    await user.click(screen.getByLabelText('PTSD'));
    await user.click(screen.getByLabelText('DVA community nursing'));
    await waitFor(() => expect(server.state.profile).toMatchObject({ dva_conditions: ['ptsd'], dva_services: ['nursing'] }));
    expect(screen.getByText(/We don't ask for DVA file or card numbers/)).toBeInTheDocument();
  });
});

describe('Relative costs', () => {
  it('shows the headline, plan costs and contributions for the reference plan', async () => {
    const server = memoryServer({ ...emptyState(), serviceDate: '2026-10-25' });
    await renderApp('/costs', { server });
    await userEvent.setup().selectOptions(screen.getByLabelText('Providers to compare'), 'all');

    expect(screen.getByText('Cheapest').parentElement).toHaveTextContent('Cheapest$12,500Right at Home Brisbane Bayside South');
    expect(screen.getByText('Dearest').parentElement).toHaveTextContent('Dearest$14,239BlueCare (UnitingCare QLD)');
    expect(screen.getByText('Difference').parentElement).toHaveTextContent('13.9%');
    const pay = screen.getByRole('region', { name: "What you'd pay" });
    const bolton = within(within(pay).getByRole('table')).getAllByRole('row').find((r) => r.textContent?.startsWith('Bolton Clarke'))!;
    expect(bolton).toHaveTextContent('$12,701');
    expect(bolton).toHaveTextContent('$784 to $4,373');
    expect(screen.getByText(/They're left out of the comparison/)).toHaveTextContent('Five Good Friends (Brisbane East & Bayside), Carers Link, Envigor Brisbane Bayside');
  });

  it('saves plan edits for everyone', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/costs');
    const plan = screen.getByRole('button', { name: /Your care plan/ });
    expect(plan).toHaveTextContent('5 services');
    await user.click(plan);
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
  it('site admins add a provider to the common catalogue, with its service area', async () => {
    const user = userEvent.setup();
    const { backend } = await renderApp('/providers/new');
    await user.type(screen.getByLabelText('Provider name'), 'Example Home Care');
    await user.type(screen.getByLabelText('Personal care'), '99.5');
    await user.type(screen.getByLabelText('Prices as at'), '20 Oct 2026');
    await user.type(screen.getByLabelText('Postcodes served'), '4178, 4150 - 4169');
    await user.type(screen.getByLabelText('Price list link'), 'not a link');
    await user.click(screen.getByRole('button', { name: 'Add provider' }));
    expect(screen.getByRole('alert')).toHaveTextContent('full web address');
    await user.clear(screen.getByLabelText('Price list link'));
    await user.click(screen.getByRole('button', { name: 'Add provider' }));

    expect(await screen.findByRole('heading', { name: 'Example Home Care' })).toBeInTheDocument();
    expect(backend.edits[0]).toMatchObject({ id: 'example-home-care', pc: 99.5, prices_as_at_date: '2026-10-20', postcodes_served: ['4178', '4150-4169'] });
  });

  it('site admins edit a starter-pack provider for everyone, and can undo it', async () => {
    const user = userEvent.setup();
    const { backend } = await renderApp('/providers/bolton-clarke/edit');
    expect(screen.getByText('Changes apply to every application straight away.')).toBeInTheDocument();
    const pc = screen.getByLabelText('Personal care');
    expect(pc).toHaveValue('126');
    await user.clear(pc);
    await user.type(pc, '130');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changed from the starter data')).toBeInTheDocument();
    expect(screen.getByText('Personal care', { selector: 'dt' }).parentElement).toHaveTextContent('$130.00 /hr');

    await user.click(screen.getByRole('button', { name: 'Undo changes' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: 'Undo changes' }));
    await waitFor(() => expect(backend.edits).toEqual([]));
  });

  it('site admins import providers from pasted CSV, including postcodes served', async () => {
    const user = userEvent.setup();
    const { backend } = await renderApp('/admin/providers/import', { waitForNav: false });
    // userEvent treats { and [ as special keys, so paste the text.
    await user.click(screen.getByLabelText('Or paste CSV'));
    await user.paste('provider,pc,prices_as_at,postcodes_served\nNew Co,101,1 Oct 2026,4178; 4179\nBolton Clarke,128,24 Oct 2026,\n,5,,');
    expect(screen.getByText('Line 4: Provider name is missing.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import 2 providers (skip 1)' }));
    expect(await screen.findByRole('link', { name: /Add provider/ })).toBeInTheDocument();
    expect(backend.edits.map((p) => [p.id, p.pc, p.postcodes_served])).toEqual([
      ['new-co', 101, ['4178', '4179']],
      ['bolton-clarke', 128, []],
    ]);
  });

  it('contributors suggest corrections for an administrator to review', async () => {
    const user = userEvent.setup();
    const { backend } = await renderApp('/providers/bolton-clarke/edit', { user: { id: 'u2', username: 'sam', display_name: 'Sam', role: 'member' }, role: 'contributor' });
    expect(screen.getByRole('heading', { name: 'Suggest a correction to Bolton Clarke' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Personal care'));
    await user.type(screen.getByLabelText('Personal care'), '130');
    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Say where the new information comes from');
    await user.type(screen.getByLabelText('Where does this come from?'), 'Price list dated 1 Nov');
    await user.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(await screen.findByText(/your suggestion has been sent for review/)).toBeInTheDocument();
    expect(backend.edits).toEqual([]);
    expect(backend.suggestions[0]).toMatchObject({ provider_id: 'bolton-clarke', note: 'Price list dated 1 Nov', proposed: { pc: 130 } });
  });

  it('records special rates a provider offered this applicant, costed in this application only', async () => {
    const user = userEvent.setup();
    const { server, backend } = await renderApp('/providers/bolton-clarke');
    await user.click(screen.getByRole('button', { name: /Special rates for Dad – Wynnum/ }));
    await user.click(screen.getByRole('button', { name: 'Add special rates' }));
    await user.type(screen.getByLabelText('Domestic assistance'), '95');
    await user.click(screen.getByRole('button', { name: 'Save special rates' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Say what they offered');
    await user.type(screen.getByLabelText('What did they offer?'), 'Veteran rate, confirmed by email');
    await user.click(screen.getByRole('button', { name: 'Save special rates' }));
    await waitFor(() => expect(server.state.specialRates['bolton-clarke']).toMatchObject({ rates: { domestic: 95 }, note: 'Veteran rate, confirmed by email' }));
    expect(screen.getAllByText('Domestic assistance', { selector: 'dt' })[0].parentElement).toHaveTextContent('Special rate for you');
    expect(backend.edits).toEqual([]);
  });

  it("hides providers outside the applicant's postcode unless asked", async () => {
    const user = userEvent.setup();
    const backend = memoryBackend(memoryServer(), 'coordinator', { ...testApplication, postcode: '4178' });
    const bolton = loadSeedData().providers.find((p) => p.id === 'bolton-clarke')!;
    const carers = loadSeedData().providers.find((p) => p.id === 'carers-link')!;
    backend.edits = [
      { ...bolton, postcodes_served: ['4100-4120'] },
      { ...carers, postcodes_served: ['4178'] },
    ];
    await renderApp('/providers?view=all', { backend });
    expect(screen.queryByRole('heading', { name: 'Bolton Clarke' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Carers Link' }).closest('li')!).getByText('Serves 4178')).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Envigor Brisbane Bayside' }).closest('li')!).getByText('Area not confirmed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 1 provider outside 4178' }));
    expect(within(screen.getByRole('heading', { name: 'Bolton Clarke' }).closest('li')!).getByText('Outside 4178')).toBeInTheDocument();
  });

  it('flags providers that mention travel or admin fees', async () => {
    await renderApp('/providers?view=all');
    const card = screen.getByRole('heading', { name: 'Right at Home Brisbane Bayside South' }).closest('li')!;
    expect(within(card).getByText('Possible extra fee')).toBeInTheDocument();
  });
});

describe("What I'm looking for", () => {
  it('drops a section when the chosen answer rules it out, or when marked not relevant', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/bounding');
    const counter = () => screen.getByText(/Your interview pack:/);
    expect(counter()).toHaveTextContent('74 questions');
    // Section O (respite and carer support, 3 should questions) is covered only by B6.1.
    const group = screen.getByRole('button', { name: /Home, household and carers/ });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    await user.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'true');
    const b61 = screen.getByText(/Who do you live with/).closest('li')!;
    await user.click(within(b61).getByLabelText('I live alone and no one cares for me'));
    expect(counter()).toHaveTextContent('71 questions');
    await waitFor(() => expect(server.state.answers['B6.1']).toMatchObject({ answer: 'alone', not_relevant: true }));
    await user.click(within(b61).getByLabelText('With a partner or family member who cares for me'));
    expect(counter()).toHaveTextContent('74 questions');

    await user.click(within(b61).getByRole('button', { name: 'Not relevant to me' }));
    expect(counter()).toHaveTextContent('71 questions');
    await user.click(within(b61).getByRole('button', { name: /Marked not relevant to me — undo/ }));
    expect(counter()).toHaveTextContent('74 questions');
  });

  it('takes several answers where allowed, up to a limit, plus detail in your own words', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/bounding');
    await user.click(screen.getByRole('button', { name: /What matters most/ }));
    const b81 = screen.getByText(/Which of these matter most to you/).closest('li')!;
    for (const label of ['The same workers', 'Understanding of veterans', 'A local organisation']) await user.click(within(b81).getByLabelText(label));
    expect(within(b81).getByLabelText('The lowest price')).toBeDisabled();
    expect(within(b81).getByText(/You've chosen 3/)).toBeInTheDocument();
    await waitFor(() => expect(server.state.answers['B8.1'].choices).toEqual(['continuity', 'veteran', 'local']));

    await user.click(within(b81).getByRole('button', { name: /Add more detail/ }));
    await user.type(within(b81).getByLabelText('More detail'), 'Same two workers, please');
    await user.tab();
    await waitFor(() => expect(server.state.answers['B8.1'].notes).toBe('Same two workers, please'));
  });

  it('drafts a summary with Claude, which the family can edit', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/bounding', {
      server: memoryServer({
        ...emptyState(),
        answers: { 'B3.2': { answer: 'essential', not_relevant: false }, 'B1.4': { answer: 'no', not_relevant: false }, 'B6.3': { answer: 'family', not_relevant: false } },
      }),
    });
    await user.click(screen.getByRole('button', { name: /Draft my summary with Claude/ }));
    expect(await screen.findByText(/sends the same worker each week/)).toBeInTheDocument();
    expect(screen.getByText('Unannounced visits')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Summary'));
    await user.type(screen.getByLabelText('Summary'), 'Same worker every week, please.');
    await user.click(screen.getByRole('button', { name: 'Save summary' }));
    await waitFor(() => expect(server.state.lookingFor).toMatchObject({ summary: 'Same worker every week, please.', edited: true }));
    expect(screen.getByText('Edited by the family')).toBeInTheDocument();
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

    await user.click(screen.getByText(/^C\. /, { selector: 'button span' }));
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
