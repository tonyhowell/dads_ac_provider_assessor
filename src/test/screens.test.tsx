import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryServer, renderApp } from './renderApp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Provider selection', () => {
  it('adds providers to the initial scan from the full list', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/providers');

    const card = screen.getByRole('heading', { name: 'Bolton Clarke' }).closest('li')!;
    await user.click(within(card).getByRole('button', { name: /add to initial scan/i }));

    expect(within(card).getByText('Stage 1: Initial scan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Selection (1)' })).toBeInTheDocument();
    expect(server.state.selection).toMatchObject([{ provider_id: 'bolton-clarke', stage: 'scan' }]);
  });

  it('filters by search and by stage', async () => {
    const user = userEvent.setup();
    await renderApp('/providers');
    await user.type(screen.getByLabelText('Search'), 'anglicare');
    expect(screen.getByText(/1 of 7 providers/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search'));

    const card = screen.getByRole('heading', { name: 'Bolton Clarke' }).closest('li')!;
    await user.click(within(card).getByRole('button', { name: /add to initial scan/i }));
    await user.selectOptions(screen.getByLabelText('Stage'), 'Not selected');
    expect(screen.getByText(/6 of 7 providers/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Stage'), 'Initial scan');
    expect(screen.getByText(/1 of 7 providers/)).toBeInTheDocument();
  });

  it('moves providers through scan → refinement → interview shortlist', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/providers');
    for (const name of ['Bolton Clarke', 'BlueCare (UnitingCare QLD)', 'Anglicare Southern Queensland']) {
      const card = screen.getByRole('heading', { name }).closest('li')!;
      await user.click(within(card).getByRole('button', { name: /add to initial scan/i }));
    }
    await user.click(screen.getByRole('link', { name: 'Selection (3)' }));
    expect(screen.getByRole('link', { name: 'Stage 1: Initial scan, 3 providers' })).toHaveAttribute('aria-current', 'page');

    // Drop one at the scan stage, advance the other two.
    await user.click(screen.getByRole('button', { name: 'Drop Anglicare Southern Queensland' }));
    await user.click(screen.getByRole('button', { name: 'Advance to Refinement : Bolton Clarke' }));
    await user.click(screen.getByRole('button', { name: 'Advance to Refinement : BlueCare (UnitingCare QLD)' }));
    expect(screen.getByText('No providers at this stage.')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Stage 2: Refinement, 2 providers' }));
    await user.type(screen.getByLabelText('Reason for keeping it', { selector: '#why-bolton-clarke' }), 'Published prices');
    await user.click(screen.getByRole('button', { name: 'Advance to Interview shortlist : Bolton Clarke' }));
    await user.click(screen.getByRole('button', { name: 'Advance to Interview shortlist : BlueCare (UnitingCare QLD)' }));

    await user.click(screen.getByRole('link', { name: 'Stage 3: Interview shortlist, 2 providers' }));
    await user.click(screen.getByRole('button', { name: 'Move up BlueCare (UnitingCare QLD)' }));
    await user.type(screen.getByLabelText('Probe at interview', { selector: '#watch-bolton-clarke' }), 'Worker turnover');
    await user.tab(); // notes save when the field loses focus
    await waitFor(() => expect(server.state.selection[1]?.watch).toBe('Worker turnover'));

    const saved = server.state;
    expect(saved.selection.map((e) => [e.provider_id, e.stage])).toEqual([
      ['bluecare-unitingcare-qld', 'interview'],
      ['bolton-clarke', 'interview'],
    ]);
    expect(saved.selection[1]).toMatchObject({ why: 'Published prices', watch: 'Worker turnover' });

    await user.click(screen.getByRole('button', { name: 'Back to Refinement : Bolton Clarke' }));
    expect(server.state.selection.find((e) => e.provider_id === 'bolton-clarke')!.stage).toBe('refine');
  });

  it('redirects the old shortlist URL to the interview stage', async () => {
    await renderApp('/shortlist');
    expect(await screen.findByRole('link', { name: /Stage 3: Interview shortlist/ })).toHaveAttribute('aria-current', 'page');
  });
});

describe('Provider notes', () => {
  it('adds, edits and deletes notes', async () => {
    const user = userEvent.setup();
    await renderApp('/providers/anglicare-southern-queensland');

    await user.type(screen.getByLabelText(/add a note/i), 'Rang intake line, call back Tuesday');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(screen.getByText('Rang intake line, call back Tuesday')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByLabelText('Edit note');
    await user.clear(editor);
    await user.type(editor, 'Call back Wednesday');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Call back Wednesday')).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Call back Wednesday')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('group', { name: 'Delete this note?' })).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('No notes yet.')).toBeInTheDocument();
  });
});

class FakeMediaRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) {}
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

describe('Interview capture', () => {
  it('falls back to a transcript-only interview when the browser cannot record', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/interviews/new/bolton-clarke');
    await user.click(screen.getByRole('button', { name: 'Add interview without recording' }));

    expect(await screen.findByRole('heading', { name: /Interview: Bolton Clarke/ })).toBeInTheDocument();
    expect(screen.getByText(/No live transcript was captured/)).toBeInTheDocument();
    expect(server.state.interviews[0]).toMatchObject({ provider_id: 'bolton-clarke', audio_id: null });
  });

  it('requires consent, records audio locally and opens the review', async () => {
    const user = userEvent.setup();
    const stopTrack = vi.fn();
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
    });

    const { audio, server } = await renderApp('/interviews/new/bolton-clarke');
    const startBtn = screen.getByRole('button', { name: 'Start recording' });
    expect(startBtn).toBeDisabled();

    await user.click(screen.getByLabelText(/has been told it is being recorded/));
    await user.click(startBtn);
    expect(await screen.findByText('Recording')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await user.click(screen.getByRole('button', { name: 'Stop and save' }));

    expect(await screen.findByRole('heading', { name: 'Recording' })).toBeInTheDocument();
    const saved = server.state.interviews[0];
    expect(saved).toMatchObject({ consent_confirmed: true, audio_mime: 'audio/webm' });
    expect(await audio.get(saved.audio_id!)).toBeDefined();
    expect(stopTrack).toHaveBeenCalled();
  });
});

describe('Interview review', () => {
  const seededServer = () =>
    memoryServer({
      version: 3,
      notes: [],
      selection: [],
      interviews: [
        {
          id: 'int-1', provider_id: 'bolton-clarke', started_at: '2026-10-25T00:00:00.000Z', duration_seconds: 0,
          consent_confirmed: true, interviewer: '', audio_id: null, audio_mime: null, transcript: '',
          notes: null, notes_generated_at: null,
        },
      ],
    });

  it('drafts notes from the transcript and saves them to the provider', async () => {
    const user = userEvent.setup();
    const notes = {
      summary: 'They run a dedicated veterans program.',
      strengths: ['Same worker each week'],
      concerns: ['Mentioned a separate travel charge'],
      commitments: [],
      pricing_mentions: [],
      follow_up_questions: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ notes }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const server = seededServer();
    await renderApp('/interviews/int-1', { server });

    const draft = screen.getByRole('button', { name: 'Draft notes from transcript' });
    expect(draft).toBeDisabled();
    await user.type(screen.getByLabelText('Transcript', { selector: 'textarea' }), 'We have a dedicated veterans program and charge travel separately.');
    await user.click(draft);

    expect(await screen.findByText('They run a dedicated veterans program.')).toBeInTheDocument();
    expect(screen.getByText('Mentioned a separate travel charge')).toBeInTheDocument();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ provider_name: 'Bolton Clarke', transcript: expect.stringContaining('veterans program') });

    await user.click(screen.getByRole('button', { name: 'Save to provider notes' }));
    const saved = server.state;
    expect(saved.interviews[0].transcript).toContain('veterans program');
    expect(saved.notes[0]).toMatchObject({ provider_id: 'bolton-clarke', source: 'interview', interview_id: 'int-1' });
    expect(saved.notes[0].text).toContain('Concerns:\n- Mentioned a separate travel charge');
  });

  it('shows the server error when notes cannot be drafted', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Notes generation is not configured' }), { status: 503 })),
    );
    await renderApp('/interviews/int-1', { server: seededServer() });
    await user.type(screen.getByLabelText('Transcript', { selector: 'textarea' }), 'A transcript long enough to send.');
    await user.click(screen.getByRole('button', { name: 'Draft notes from transcript' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Notes generation is not configured'));
  });
});
