import { SELECTION_STAGES } from '../schemas';
import type { Action } from './actions';
import { nameKey } from '../data/normalise';
import type { Interview, Provider, ProviderNote, SelectionEntry, SelectionStage, ShortlistSeed } from '../types';

export interface AppState {
  version: 3;
  notes: ProviderNote[];
  /** Providers the user has selected, each at one stage. Array order within a stage is the rank. */
  selection: SelectionEntry[];
  interviews: Interview[];
}

export type { Action };

export const STAGE_LABELS: Record<SelectionStage, string> = {
  scan: 'Initial scan',
  refine: 'Refinement',
  interview: 'Interview shortlist',
};

export const nextStage = (s: SelectionStage): SelectionStage | undefined => SELECTION_STAGES[SELECTION_STAGES.indexOf(s) + 1];
export const prevStage = (s: SelectionStage): SelectionStage | undefined => SELECTION_STAGES[SELECTION_STAGES.indexOf(s) - 1];

/** Entries at one stage, in rank order. */
export const entriesAt = (state: AppState, stage: SelectionStage) => state.selection.filter((e) => e.stage === stage);

export function initialState(seedShortlist: ShortlistSeed[], providers: Provider[], now: string): AppState {
  // The seed shortlist (SPEC §4) is the ranked list of providers to interview.
  const byName = new Map(providers.map((p) => [nameKey(p.provider), p.id]));
  const selection = [...seedShortlist]
    .sort((a, b) => a.rank - b.rank)
    .flatMap((s): SelectionEntry[] => {
      const id = byName.get(nameKey(s.provider));
      return id ? [{ provider_id: id, stage: 'interview', why: s.why, watch: s.watch, added_at: now, stage_changed_at: now }] : [];
    });
  return { version: 3, notes: [], selection, interviews: [] };
}

interface StateV1 {
  version: 1;
  notes: ProviderNote[];
  shortlist: { provider_id: string; why: string; watch: string; added_at: string }[];
  interviews: Interview[];
}

/** Provider ids from the placeholder seed data, mapped to the ids derived from the starter pack. */
const LEGACY_PROVIDER_IDS: Record<string, string> = {
  'anglicare-sq': 'anglicare-southern-queensland',
  bluecare: 'bluecare-unitingcare-qld',
  'right-at-home-bayside-south': 'right-at-home-brisbane-bayside-south',
};

function remapProviderIds(s: Omit<AppState, 'version'>): Omit<AppState, 'version'> {
  const id = (p: string) => LEGACY_PROVIDER_IDS[p] ?? p;
  return {
    ...s,
    notes: s.notes.map((n) => ({ ...n, provider_id: id(n.provider_id) })),
    selection: s.selection.map((e) => ({ ...e, provider_id: id(e.provider_id) })),
    interviews: s.interviews.map((i) => ({ ...i, provider_id: id(i.provider_id) })),
  };
}

/**
 * Upgrades saved state to the current version.
 * v1 → v2: the single shortlist becomes the interview stage. v2 → v3: placeholder provider ids are remapped.
 */
export function migrate(saved: unknown): AppState | undefined {
  const s = saved as { version?: number } | undefined;
  if (s?.version === 3) return s as AppState;
  if (s?.version === 2) return { ...remapProviderIds(s as unknown as AppState), version: 3 };
  if (s?.version === 1) {
    const v1 = s as StateV1;
    return migrate({
      version: 3,
      notes: v1.notes,
      interviews: v1.interviews,
      selection: v1.shortlist.map((e) => ({ ...e, stage: 'interview', stage_changed_at: e.added_at })),
    });
  }
  return undefined;
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

    case 'selection/add':
      if (state.selection.some((e) => e.provider_id === action.providerId)) return state;
      return {
        ...state,
        selection: [
          ...state.selection,
          { provider_id: action.providerId, stage: 'scan', why: '', watch: '', added_at: action.at, stage_changed_at: action.at },
        ],
      };
    case 'selection/remove':
      return { ...state, selection: state.selection.filter((e) => e.provider_id !== action.providerId) };
    case 'selection/stage': {
      const entry = state.selection.find((e) => e.provider_id === action.providerId);
      if (!entry || entry.stage === action.stage) return state;
      // A provider entering a stage goes to the bottom of that stage's ranking.
      return {
        ...state,
        selection: [
          ...state.selection.filter((e) => e !== entry),
          { ...entry, stage: action.stage, stage_changed_at: action.at },
        ],
      };
    }
    case 'selection/move': {
      // toIndex is a position within the provider's current stage.
      const entry = state.selection.find((e) => e.provider_id === action.providerId);
      if (!entry) return state;
      const peers = entriesAt(state, entry.stage);
      const from = peers.indexOf(entry);
      const to = Math.max(0, Math.min(peers.length - 1, action.toIndex));
      if (from === to) return state;
      const reordered = [...peers];
      reordered.splice(from, 1);
      reordered.splice(to, 0, entry);
      // Write the reordered peers back into the slots the stage already occupies.
      let i = 0;
      return { ...state, selection: state.selection.map((e) => (e.stage === entry.stage ? reordered[i++] : e)) };
    }
    case 'selection/update':
      return {
        ...state,
        selection: state.selection.map((e) =>
          e.provider_id === action.providerId ? { ...e, why: action.why ?? e.why, watch: action.watch ?? e.watch } : e,
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
