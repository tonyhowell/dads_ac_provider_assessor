import { InterviewNotesSchema } from './schemas';
import type { InterviewNotes, InterviewSection } from './types';

export interface NotesRequestBody {
  provider_name: string;
  interview_date: string;
  transcript: string;
  questions?: string[];
}

/** Calls the local API server, which holds the Claude API key. */
export async function requestInterviewNotes(body: NotesRequestBody, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<InterviewNotes> {
  let res: Response;
  try {
    res = await fetchImpl('/api/interview-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error("We couldn't reach the server. Check your internet connection.");
  }
  const json = (await res.json().catch(() => ({}))) as { notes?: unknown; error?: string };
  if (!res.ok) throw new Error(json.error ?? `Notes request failed (${res.status}).`);
  const parsed = InterviewNotesSchema.safeParse(json.notes);
  if (!parsed.success) throw new Error('The notes came back in an unexpected format.');
  return parsed.data;
}

/** "Must" questions from the interview pack, so the notes can flag any left unanswered. */
export function mustQuestions(sections: InterviewSection[]): string[] {
  return sections.flatMap((s) => s.questions.filter((q) => q.priority === 'must').map((q) => q.text));
}

const NOTE_SECTIONS: [keyof Omit<InterviewNotes, 'summary'>, string][] = [
  ['strengths', 'Strengths'],
  ['concerns', 'Concerns'],
  ['commitments', 'Commitments made'],
  ['pricing_mentions', 'Prices and fees mentioned'],
  ['follow_up_questions', 'Follow up'],
];

export function notesSections(notes: InterviewNotes) {
  return NOTE_SECTIONS.map(([key, label]) => ({ key, label, items: notes[key] })).filter((s) => s.items.length > 0);
}

/** Plain-text version for saving into the provider's assessment notes. */
export function notesToText(notes: InterviewNotes, heading: string): string {
  const parts = [heading, '', notes.summary];
  for (const s of notesSections(notes)) {
    parts.push('', `${s.label}:`, ...s.items.map((i) => `- ${i}`));
  }
  return parts.join('\n');
}
