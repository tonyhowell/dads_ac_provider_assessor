import { describe, expect, it, vi } from 'vitest';
import { mustQuestions, notesToText, requestInterviewNotes } from '../interviews';

const notes = {
  summary: 'Experienced with veterans.',
  strengths: ['Same worker most weeks'],
  concerns: ['Mentioned a $15 travel fee'],
  commitments: [],
  pricing_mentions: ['Personal care $85/hr weekdays'],
  follow_up_questions: [],
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('notesToText', () => {
  it('includes the summary and only non-empty sections', () => {
    const text = notesToText(notes, 'Interview 25 Oct 2026');
    expect(text).toContain('Experienced with veterans.');
    expect(text).toContain('Concerns:\n- Mentioned a $15 travel fee');
    expect(text).not.toContain('Commitments made');
  });
});

describe('mustQuestions', () => {
  it('returns only must questions', () => {
    expect(
      mustQuestions([
        { code: 'A', section: 'Intro', questions: [
          { id: 'A1', text: 'Must ask', priority: 'must' },
          { id: 'A2', text: 'Nice to ask', priority: 'should' },
        ] },
      ]),
    ).toEqual(['Must ask']);
  });
});

describe('requestInterviewNotes', () => {
  const body = { provider_name: 'Example Care', interview_date: '25 Oct 2026', transcript: 'x'.repeat(30) };

  it('posts the transcript and returns validated notes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { notes }));
    await expect(requestInterviewNotes(body, fetchImpl)).resolves.toEqual(notes);
    expect(fetchImpl).toHaveBeenCalledWith('/api/interview-notes', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(body);
  });

  it('surfaces the server error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'Notes generation is not configured' }));
    await expect(requestInterviewNotes(body, fetchImpl)).rejects.toThrow('Notes generation is not configured');
  });

  it('rejects malformed notes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { notes: { summary: 1 } }));
    await expect(requestInterviewNotes(body, fetchImpl)).rejects.toThrow(/unexpected format/);
  });

  it('explains a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(requestInterviewNotes(body, fetchImpl)).rejects.toThrow(/couldn't reach the server/);
  });
});
