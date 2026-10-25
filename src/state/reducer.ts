import type { Interview, InterviewNotes, Provider, ProviderNote, ShortlistEntry, ShortlistSeed } from '../types';

export interface AppState {
  version: 1;
  notes: ProviderNote[];
  /** The user's down-selected providers, in rank order. */
  shortlist: ShortlistEntry[];
  interviews: Interview[];
}

export type Action =
  | { type: 'note/add'; note: ProviderNote }
  | { type: 'note/edit'; id: string; text: string; at: string }
  | { type: 'note/delete'; id: string }
  | { type: 'shortlist/add'; providerId: string; at: string }
  | { type: 'shortlist/remove'; providerId: string }
  | { type: 'shortlist/move'; providerId: string; toIndex: number }
  | { type: 'shortlist/update'; providerId: string; why?: string; watch?: string }
  | { type: 'interview/save'; interview: Interview }
  | { type: 'interview/notes'; id: string; notes: InterviewNotes; at: string }
  | { type: 'interview/delete'; id: string };

export function initialState(seedShortlist: ShortlistSeed[], providers: Provider[], now: string): AppState {
  const byName = new Map(providers.map((p) => [p.provider.toLowerCase(), p.id]));
  const shortlist = [...seedShortlist]
    .sort((a, b) => a.rank - b.rank)
    .flatMap((s): ShortlistEntry[] => {
      const id = byName.get(s.provider.toLowerCase());
      return id ? [{ provider_id: id, why: s.why, watch: s.watch, added_at: now }] : [];
    });
  return { version: 1, notes: [], shortlist, interviews: [] };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'note/add':
      return { ...state, notes: [...state.notes, action.note] };
    case 'note/edit':
      return {
        ...state,
        notes: state.notes.map((n) => (n.id === action.id ? { ...n, text: action.text, updated_at: action.at } : n)),
      };
    case 'note/delete':
      return { ...state, notes: state.notes.filter((n) => n.id !== action.id) };

    case 'shortlist/add':
      if (state.shortlist.some((e) => e.provider_id === action.providerId)) return state;
      return {
        ...state,
        shortlist: [...state.shortlist, { provider_id: action.providerId, why: '', watch: '', added_at: action.at }],
      };
    case 'shortlist/remove':
      return { ...state, shortlist: state.shortlist.filter((e) => e.provider_id !== action.providerId) };
    case 'shortlist/move': {
      const from = state.shortlist.findIndex((e) => e.provider_id === action.providerId);
      if (from < 0) return state;
      const to = Math.max(0, Math.min(state.shortlist.length - 1, action.toIndex));
      if (from === to) return state;
      const next = [...state.shortlist];
      const [entry] = next.splice(from, 1);
      next.splice(to, 0, entry);
      return { ...state, shortlist: next };
    }
    case 'shortlist/update':
      return {
        ...state,
        shortlist: state.shortlist.map((e) =>
          e.provider_id === action.providerId
            ? { ...e, why: action.why ?? e.why, watch: action.watch ?? e.watch }
            : e,
        ),
      };

    case 'interview/save': {
      const exists = state.interviews.some((i) => i.id === action.interview.id);
      return {
        ...state,
        interviews: exists
          ? state.interviews.map((i) => (i.id === action.interview.id ? action.interview : i))
          : [...state.interviews, action.interview],
      };
    }
    case 'interview/notes':
      return {
        ...state,
        interviews: state.interviews.map((i) =>
          i.id === action.id ? { ...i, notes: action.notes, notes_generated_at: action.at } : i,
        ),
      };
    case 'interview/delete':
      return {
        ...state,
        interviews: state.interviews.filter((i) => i.id !== action.id),
        // Notes saved from the interview stay — they are the user's record — but lose the link.
        notes: state.notes.map((n) => (n.interview_id === action.id ? { ...n, interview_id: undefined } : n)),
      };
  }
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
