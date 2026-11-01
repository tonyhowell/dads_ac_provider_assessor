import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gathered, memoryServer, renderApp } from './renderApp';
import { emptyState, type AppState } from '../state/reducer';
import { combinedScores, voteResult } from '../family';
import { interviewIcs, packEmail } from '../tailored';

const AT = '2026-11-01T00:00:00.000Z';
const member = (user_id: string, display_name: string, role: string) => ({ user_id, username: display_name.toLowerCase(), display_name, role, enrolled: true, enrolment_expires_at: null, disabled: false, added_at: AT });
const MEMBERS = [member('u1', 'Alex', 'coordinator'), member('u2', 'Sam', 'contributor'), member('u3', 'Jo', 'viewer')];

/** Answers the app's own API calls in these tests. */
function stubApi(routes: Record<string, (body: unknown) => unknown> = {}) {
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      const route = Object.keys(routes).find((r) => path.endsWith(r));
      if (route) return Response.json(routes[route](body));
      return Response.json({ members: MEMBERS });
    }),
  );
  return calls;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const at = (stage: 'scan' | 'refine' | 'interview', ...ids: string[]): AppState['selection'] =>
  ids.map((provider_id) => ({ provider_id, stage, why: '', watch: '', added_at: AT, stage_changed_at: AT }));
const SHORTLIST = ['bolton-clarke', 'anglicare-southern-queensland', 'carers-link'];

describe('Family vote', () => {
  it('counts votes, breaking ties with the applicant’s picks', () => {
    const s = emptyState();
    s.gather.applicantUserId = 'u3';
    s.select.votes = {
      u1: { name: 'Alex', picks: ['a', 'b'], at: AT },
      u2: { name: 'Sam', picks: ['c'], at: AT },
      u3: { name: 'Jo', picks: ['c', 'd'], at: AT },
    };
    const r = voteResult(s, ['a', 'b', 'c', 'd', 'e']);
    expect(r.ranked.map((x) => [x.providerId, x.votes])).toEqual([
      ['c', 2],
      ['d', 1],
      ['a', 1],
      ['b', 1],
      ['e', 0],
    ]);
    expect(r.chosen).toEqual(['c', 'd', 'a']);
  });

  it('hides results until everyone has voted, then moves the choice to “to interview”', async () => {
    const user = userEvent.setup();
    stubApi();
    const server = memoryServer(gathered({ selection: at('scan', ...SHORTLIST) }));
    await renderApp('/compare', { server });
    const vote = await screen.findByRole('region', { name: 'Family vote: who should we meet?' });
    await waitFor(() => expect(within(vote).getByText('0 of 2 voted')).toBeInTheDocument());
    await user.click(within(vote).getByRole('button', { name: /Bolton Clarke/ }));
    await waitFor(() => expect(server.state.select.votes.u1?.picks).toEqual(['bolton-clarke']));
    expect(within(vote).getByText(/waiting for Sam/)).toBeInTheDocument();
    expect(within(vote).queryByText(/The family's choice/)).not.toBeInTheDocument();
  });

  it('shows the result once all have voted, and the coordinator applies it', async () => {
    const user = userEvent.setup();
    stubApi();
    const state = gathered({ selection: at('scan', ...SHORTLIST) });
    state.select.votes = { u1: { name: 'Alex', picks: ['bolton-clarke'], at: AT }, u2: { name: 'Sam', picks: ['bolton-clarke', 'carers-link'], at: AT } };
    const server = memoryServer(state);
    await renderApp('/compare', { server });
    const vote = await screen.findByRole('region', { name: 'Family vote: who should we meet?' });
    expect(await within(vote).findByText(/The family's choice: Bolton Clarke, /)).toBeInTheDocument();
    await user.click(within(vote).getByRole('button', { name: 'Interview these 2' }));
    await waitFor(() => expect(server.state.selection.filter((e) => e.stage === 'interview').map((e) => e.provider_id).sort()).toEqual(['bolton-clarke', 'carers-link']));
    expect(server.state.selection.find((e) => e.provider_id === 'anglicare-southern-queensland')?.stage).toBe('refine');
  });
});

describe('Scores and decision', () => {
  it('averages each member’s scores, the applicant’s counting double, and flags differences', () => {
    const s = emptyState();
    s.gather.applicantUserId = 'u3';
    s.select.memberScores = {
      u1: { name: 'Alex', scores: { 'a::price': 2, 'a::veteran': 4 } },
      u3: { name: 'Jo', scores: { 'a::price': 5 } },
    };
    const c = combinedScores(s);
    expect(c.scores).toEqual({ 'a::price': 4, 'a::veteran': 4 });
    expect(c.differences).toEqual({ 'a::price': { low: 2, high: 5 } });
    expect(c.members).toBe(2);
  });

  it('records the decision and its next steps', async () => {
    const user = userEvent.setup();
    stubApi();
    const server = memoryServer(gathered({ selection: at('interview', 'bolton-clarke', 'carers-link') }));
    await renderApp('/scoring', { server });
    await user.selectOptions(screen.getByLabelText('Who you\'ve chosen'), 'bolton-clarke');
    await waitFor(() => expect(server.state.select.decision.provider_id).toBe('bolton-clarke'));
    await user.click(screen.getByLabelText(/Tell Bolton Clarke/));
    await waitFor(() => expect(server.state.select.decision.steps.told_chosen).toBe(true));
    await user.type(screen.getByLabelText('Start date'), '2026-12-01');
    await waitFor(() => expect(server.state.select.decision).toMatchObject({ start_date: '2026-12-01', steps: { start_date: true } }));
  });
});

describe('Prepare', () => {
  it('saves a booking, tailors the questions, and adds questions for one provider or all', async () => {
    const user = userEvent.setup();
    stubApi();
    const server = memoryServer(gathered({ selection: at('interview', 'bolton-clarke', 'carers-link') }));
    await renderApp('/prepare?p=bolton-clarke', { server });
    expect(screen.getByRole('heading', { level: 1, name: 'Prepare for your interviews' })).toBeInTheDocument();
    const booking = screen.getByRole('form', { name: 'Booking' });
    await user.type(within(booking).getByLabelText('Date'), '2026-11-20');
    await user.type(within(booking).getByLabelText('Time'), '10:30');
    await user.selectOptions(within(booking).getByLabelText('How'), 'phone');
    await user.type(within(booking).getByLabelText("Who's attending"), 'Dad, Sam');
    await user.click(within(booking).getByRole('button', { name: 'Save booking' }));
    await waitFor(() => expect(server.state.select.bookings['bolton-clarke']).toMatchObject({ date: '2026-11-20', time: '10:30', mode: 'phone', attendees: 'Dad, Sam' }));
    expect(within(booking).getByRole('button', { name: /Add to calendar/ })).toBeInTheDocument();
    expect(within(booking).getByRole('link', { name: /Family briefing/ })).toHaveAttribute('href', '/prepare/bolton-clarke/briefing');

    const questions = screen.getByRole('region', { name: 'Questions for Bolton Clarke' });
    // Their priority "the same workers" is a gap to ask about.
    expect(within(questions).getAllByText(/Your priority “The same workers”/).length).toBeGreaterThan(0);

    await user.type(within(questions).getByLabelText('Add your own question'), 'Can Dad keep his Tuesday worker?');
    await user.click(within(questions).getByRole('button', { name: 'Add question' }));
    await waitFor(() => expect(server.state.customQuestions.at(-1)).toMatchObject({ text: 'Can Dad keep his Tuesday worker?', provider_id: 'bolton-clarke' }));
    expect(within(questions).getByText('Can Dad keep his Tuesday worker?')).toBeInTheDocument();

    await user.type(within(questions).getByLabelText('Add your own question'), 'Do you charge for travel?');
    await user.click(within(questions).getByLabelText('Ask every provider'));
    await user.click(within(questions).getByRole('button', { name: 'Add question' }));
    await waitFor(() => expect(server.state.customQuestions.at(-1)).toEqual(expect.not.objectContaining({ provider_id: expect.anything() })));

    // The other provider sees the shared question but not Bolton Clarke's own.
    await user.click(screen.getByRole('button', { name: /Carers Link/ }));
    const other = await screen.findByRole('region', { name: /Questions for Carers Link/ });
    expect(within(other).queryByText('Can Dad keep his Tuesday worker?')).not.toBeInTheDocument();

    const send = screen.getByRole('region', { name: 'Send them the pack' });
    expect(within(send).getByRole('link', { name: /Write the email/ }).getAttribute('href')).toMatch(/^mailto:\?subject=Support%20at%20Home%20interview%20questions/);
  });

  it('builds a calendar file and an email', () => {
    const ics = interviewIcs({ provider: 'Bolton Clarke', date: '2026-11-20', time: '10:30', mode: 'in_person', place: 'Home, Exampleton', attendees: 'Dad, Sam' });
    expect(ics).toContain('DTSTART;TZID=Australia/Sydney:20261120T103000');
    expect(ics).toContain('DTEND;TZID=Australia/Sydney:20261120T113000');
    expect(ics).toContain('LOCATION:Home\\, Exampleton');
    const mail = packEmail({ provider: 'Bolton Clarke', applicant: 'Dad', date: '2026-11-20', time: '10:30', from: 'Alex', questions: [{ id: 'G1', section: 'G', text: 'What is your price?', must: true, kind: 'price', why: null, theySay: null }] });
    expect(mail.subject).toBe('Support at Home interview questions — Dad');
    expect(mail.body).toContain('on Friday 20 November at 10:30');
    expect(mail.body).toContain('1. What is your price?');
  });

  it('prints a family briefing', async () => {
    stubApi();
    await renderApp('/prepare/bolton-clarke/briefing', { server: memoryServer(gathered({ selection: at('interview', 'bolton-clarke') })), waitForNav: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Briefing: Bolton Clarke' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Must ask' })).toBeInTheDocument();
  });
});

describe('Interview checklist', () => {
  it('ticks questions off with a rating and a note', async () => {
    const user = userEvent.setup();
    stubApi();
    const server = memoryServer(gathered({ selection: at('interview', 'bolton-clarke') }));
    await renderApp('/interviews/new/bolton-clarke', { server });
    const list = screen.getByRole('region', { name: 'Question checklist' });
    const first = within(list).getAllByRole('group', { name: /How well was it answered/ })[0];
    const total = within(list).getByText(/answered/, { selector: '[role=status]' }).textContent!;
    expect(total).toMatch(/^0 of \d+ answered/);
    await user.click(within(first).getByRole('button', { name: 'Answered' }));
    await waitFor(() => expect(Object.values(server.state.responses).some((r) => r.rating === 'yes')).toBe(true));
    expect(within(list).getByText(/answered/, { selector: '[role=status]' }).textContent).toMatch(/^1 of \d+ answered/);
  });

  it('opens in phone mode for a phone booking, one question at a time', async () => {
    stubApi();
    const state = gathered({ selection: at('interview', 'bolton-clarke') });
    state.select.bookings['bolton-clarke'] = { date: '2026-11-20', time: '', mode: 'phone', place: '', attendees: '', lead: '', sent: { questions: false, dossier: false, price_list_request: false } };
    await renderApp('/interviews/new/bolton-clarke', { server: memoryServer(state) });
    expect(screen.getByLabelText(/Phone interview mode/)).toBeChecked();
    expect(screen.getByRole('heading', { name: 'For a phone interview' })).toBeInTheDocument();
    expect(screen.getByLabelText('One question at a time')).toHaveTextContent(/Question 1 of \d+ still to ask/);
  });

  it('asks Claude about once a minute which questions the recording has answered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let recognition: { onresult: ((e: unknown) => void) | null } | null = null;
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onend = null;
      onerror = null;
      constructor() {
        recognition = this;
      }
      start() {}
      stop() {}
    }
    class FakeMediaRecorder {
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: () => {} }] }) } });
    let asked: { id: string; text: string }[] = [];
    const calls = stubApi({
      '/gap-check': (body) => {
        asked = (body as { questions: { id: string; text: string }[] }).questions;
        return { answered: [{ question_id: asked[0].id, level: 'yes', answer: 'The same two workers each week' }] };
      },
    });
    await renderApp('/interviews/new/bolton-clarke', { server: memoryServer(gathered({ selection: at('interview', 'bolton-clarke') })) });
    await user.click(screen.getByLabelText(/Everyone on this call has agreed/));
    await user.click(screen.getByRole('button', { name: 'Record' }));
    await screen.findByText(/Recording — stored on this device only/);
    act(() => recognition!.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'We keep the same two workers each week for every client, and we can start in a fortnight.' } }] }));
    expect(calls.some((c) => c.path.endsWith('/gap-check'))).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/gap-check'))).toHaveLength(1));
    expect(await screen.findByText(/Heard: The same two workers each week/)).toBeInTheDocument();
    // No new speech: no new check.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(calls.filter((c) => c.path.endsWith('/gap-check'))).toHaveLength(1);
  });
});
