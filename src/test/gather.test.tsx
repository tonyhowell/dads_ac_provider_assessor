import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gathered, memoryServer, renderApp, testUser } from './renderApp';
import { emptyState } from '../state/reducer';
import { missingForFind } from '../gather';

/** Answers the app's own API calls in these tests. */
function stubApi(routes: Record<string, (body: unknown) => unknown>) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      const route = Object.keys(routes).find((r) => path.endsWith(r));
      if (route) return Response.json(routes[route](body));
      return Response.json({ members: [] });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Gather', () => {
  it('walks through the steps with progress, and opens Find once the essentials are in', async () => {
    const user = userEvent.setup();
    await renderApp('/gather/situation');
    expect(screen.getByRole('heading', { level: 1, name: 'Situation' })).toBeInTheDocument();
    expect(screen.getByText('Gather · step 1 of 7')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'All Gather steps' });
    expect(within(steps).getAllByRole('link').map((l) => l.textContent)).toEqual([
      '1SituationNot done',
      '2MoneyNot done',
      '3Care planNot done',
      '4Needs and homeNot done',
      '5What mattersNot done',
      '6About meNot done',
      '7BriefNot done',
    ]);
    await user.click(screen.getByRole('link', { name: /Next: Money/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Money' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Steps' })).toHaveTextContent('Opens after Gather');
  });

  it('knows what Find still needs', () => {
    expect(missingForFind(emptyState()).map((m) => m.step)).toEqual(['situation', 'plan', 'matters', 'matters']);
    expect(missingForFind(gathered())).toEqual([]);
  });

  it('reads a support plan, lets the family check each service, and saves it as the care plan', async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      '/support-plan': () => ({
        plan: {
          document_kind: 'Support plan',
          classification: '6',
          services: [
            { name: 'Personal care - showering', key: 'pc', hours_per_week: 2, frequency: '1 hr x 2 per week', start_date: null },
            { name: 'Personal care - dressing', key: 'pc', hours_per_week: 1.5, frequency: '30 min x 3', start_date: null },
            { name: 'Cleaning', key: 'domestic', hours_per_week: 1, frequency: '1 hr weekly', start_date: null },
            { name: 'Meals on wheels', key: null, hours_per_week: null, frequency: '5 meals a week', start_date: null },
          ],
          notes: ['Cleaning is fortnightly in the first month'],
        },
      }),
    });
    const { server } = await renderApp('/gather/plan', { server: memoryServer({ ...gathered(), plan: null, gather: { ...emptyState().gather } }) });
    const file = screen.getByLabelText('Document');
    expect(file).toBeDisabled();
    await user.click(screen.getByLabelText(/happy for this document to be read by Claude/));
    await user.upload(file, new File(['%PDF-1.4 fake'], 'plan.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('heading', { name: 'Check what we read from your support plan' })).toBeInTheDocument();
    expect(calls.find((c) => c.path.endsWith('/support-plan'))!.body).toMatchObject({ name: 'plan.pdf', mime: 'application/pdf' });
    expect(screen.getByText('Cleaning is fortnightly in the first month')).toBeInTheDocument();
    expect(screen.getByLabelText('Include Meals on wheels')).not.toBeChecked();
    await user.click(screen.getByLabelText('Update your level from 5 to 6'));
    await user.click(screen.getByLabelText('Update your level from 5 to 6'));
    await user.click(screen.getByRole('button', { name: 'Use these 3 services' }));
    await waitFor(() =>
      expect(server.state.plan).toEqual([
        { service: 'Personal care', key: 'pc', hours_per_week: 3.5, category: 'clinical' },
        { service: 'Domestic assistance', key: 'domestic', hours_per_week: 1, category: 'everyday' },
      ]),
    );
    expect(server.state.gather.planSource).toBe('support_plan');
    expect(server.state.participant!.classification).toBe('6');
    expect(screen.getByText('From your support plan')).toBeInTheDocument();
  });

  it('enters services by hand when there is no support plan yet, marked unconfirmed', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/gather/plan');
    await user.click(screen.getByRole('button', { name: /No support plan yet/ }));
    await waitFor(() => expect(server.state.gather.planSource).toBe('manual'));
    expect(server.state.plan).toHaveLength(5);
    expect(screen.getByText(/Entered by hand — unconfirmed/)).toBeInTheDocument();
  });

  it('suggests answers from a family conversation, each accepted or skipped', async () => {
    const user = userEvent.setup();
    stubApi({
      '/gather/conversation': () => ({
        suggestions: [
          { question_id: 'B8.1', choices: ['continuity', 'veteran'], detail: 'Dad wants the same two workers', quote: 'he hates new faces' },
          { question_id: 'B8.3', choices: ['late'], detail: '', quote: 'if they keep turning up late' },
        ],
      }),
    });
    const { server } = await renderApp('/gather/matters');
    await user.click(screen.getByRole('button', { name: /Record a family conversation/ }));
    await user.type(screen.getByLabelText('What was said'), 'We talked about Dad. He hates new faces and the same workers matter, and lateness would end it.');
    await user.click(screen.getByRole('button', { name: 'Suggest answers' }));
    expect(await screen.findByText('2 suggested answers to check')).toBeInTheDocument();
    expect(screen.getByText('“he hates new faces”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Accept\s*: Which of these matter most/ }));
    await waitFor(() => expect(server.state.answers['B8.1']).toMatchObject({ choices: ['continuity', 'veteran'], notes: 'Dad wants the same two workers' }));
    await user.click(screen.getByRole('button', { name: /Skip\s*: What would make you end/ }));
    expect(server.state.answers['B8.3']).toBeUndefined();
    expect(screen.getByText('All suggestions handled.')).toBeInTheDocument();
  });

  it('shows the brief on one page, confirmed by the coordinator, with comments', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/gather/brief', { server: memoryServer(gathered()) });
    const brief = screen.getByRole('article', { name: 'Assessment brief' });
    expect(within(brief).getByText('Lives in').nextSibling).toHaveTextContent('Exampleton 4000');
    expect(within(brief).getByText('Top priorities').nextSibling).toHaveTextContent('The same workers');
    expect(within(brief).getByText('Deal-breakers').nextSibling).toHaveTextContent('Late or missed visits');
    expect(within(brief).getByRole('heading', { name: /Care plan \(entered by hand, unconfirmed\)/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm the brief' }));
    await waitFor(() => expect(server.state.gather.brief.confirmed_at).not.toBeNull());
    await user.type(screen.getByLabelText('Add a comment'), 'Looks right to me');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(server.state.gather.brief.comments.map((c) => c.text)).toEqual(['Looks right to me']));
    expect(screen.getByRole('link', { name: /Continue to Find/ })).toBeInTheDocument();
  });

  it('gives the applicant a simpler view of their own steps', async () => {
    await renderApp('/gather/matters', { server: memoryServer({ ...emptyState(), gather: { ...emptyState().gather, applicantUserId: testUser.id } }) });
    expect(screen.getByText(/These are your questions/)).toBeInTheDocument();
    expect(screen.getByText('Gather · step 1 of 3')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'All Gather steps' })).getAllByRole('link').map((l) => l.textContent?.replace(/^\d/, ''))).toEqual([
      'What mattersNot done',
      'About meNot done',
      'BriefNot done',
    ]);
  });
});
