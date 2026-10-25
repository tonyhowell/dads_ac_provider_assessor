import { SELECTION_STAGES } from '../schemas';
import type { Action } from './actions';
import { nameKey } from '../data/normalise';
import type {
  BoundingAnswer,
  CustomQuestion,
  Interview,
  InterviewResponse,
  Participant,
  PlanItem,
  Provider,
  ProviderNote,
  SelectionEntry,
  SelectionStage,
  ShortlistSeed,
} from '../types';
import { responseKey, scoreKey } from '../scoring';

export interface AppState {
  version: 4;
  notes: ProviderNote[];
  /** Providers the user has selected, each at one stage. Array order within a stage is the rank. */
  selection: SelectionEntry[];
  interviews: Interview[];
  participant: Participant | null;
  /** The family's care plan. Null = use the sample plan from the seed data. */
  plan: PlanItem[] | null;
  /** Date services are costed at (decides the personal-care category). Null = today. */
  serviceDate: string | null;
  /** Providers added by the family, or seed providers they corrected. Replaces the seed record with the same id. */
  providerEdits: Provider[];
  /** Bounding answers by question id. */
  answers: Record<string, BoundingAnswer>;
  customQuestions: CustomQuestion[];
  /** Interview responses keyed `${providerId}::${questionId}`. */
  responses: Record<string, InterviewResponse>;
  /** Scores 1–5 keyed `${providerId}::${criterion}`. */
  scores: Record<string, number>;
  /** Criterion weights the family changed from the SPEC defaults. */
  weights: Record<string, number>;
  decisionNotes: string;
}

/** Fields added in v4, at their starting values. */
const V4_DEFAULTS = {
  participant: null,
  plan: null,
  serviceDate: null,
  providerEdits: [],
  answers: {},
  customQuestions: [],
  responses: {},
  scores: {},
  weights: {},
  decisionNotes: '',
} satisfies Omit<AppState, 'version' | 'notes' | 'selection' | 'interviews'>;

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

/** State with nothing in it yet. */
export const emptyState = (): AppState => ({ version: 4, notes: [], selection: [], interviews: [], ...V4_DEFAULTS });

export function initialState(seedShortlist: ShortlistSeed[], providers: Provider[], now: string): AppState {
  // The seed shortlist (SPEC §4) is the ranked list of providers to interview.
  const byName = new Map(providers.map((p) => [nameKey(p.provider), p.id]));
  const selection = [...seedShortlist]
    .sort((a, b) => a.rank - b.rank)
    .flatMap((s): SelectionEntry[] => {
      const id = byName.get(nameKey(s.provider));
      return id ? [{ provider_id: id, stage: 'interview', why: s.why, watch: s.watch, added_at: now, stage_changed_at: now }] : [];
    });
  return { version: 4, notes: [], selection, interviews: [], ...V4_DEFAULTS };
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

function remapProviderIds<S extends Pick<AppState, 'notes' | 'selection' | 'interviews'>>(s: S): S {
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
 * v3 → v4: participant, plan, provider edits, questions, responses and scoring are added, empty.
 */
export function migrate(saved: unknown): AppState | undefined {
  const s = saved as { version?: number } | undefined;
  if (s?.version === 4) return s as AppState;
  if (s?.version === 3) return { ...V4_DEFAULTS, ...(s as object), version: 4 } as unknown as AppState;
  if (s?.version === 2) return migrate({ ...remapProviderIds(s as unknown as AppState), version: 3 });
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

    case 'participant/set':
      return { ...state, participant: action.participant };
    case 'plan/set':
      return { ...state, plan: action.plan };
    case 'settings/serviceDate':
      return { ...state, serviceDate: action.date };
    case 'provider/upsert':
      return { ...state, providerEdits: [...state.providerEdits.filter((p) => p.id !== action.provider.id), action.provider] };
    case 'provider/import': {
      const ids = new Set(action.providers.map((p) => p.id));
      return { ...state, providerEdits: [...state.providerEdits.filter((p) => !ids.has(p.id)), ...action.providers] };
    }
    case 'provider/revert':
      return { ...state, providerEdits: state.providerEdits.filter((p) => p.id !== action.id) };
    case 'bounding/answer':
      return { ...state, answers: { ...state.answers, [action.questionId]: action.answer } };
    case 'question/add':
      return { ...state, customQuestions: [...state.customQuestions.filter((q) => q.id !== action.question.id), action.question] };
    case 'question/delete': {
      const responses = Object.fromEntries(Object.entries(state.responses).filter(([k]) => !k.endsWith(`::${action.id}`)));
      return { ...state, customQuestions: state.customQuestions.filter((q) => q.id !== action.id), responses };
    }
    case 'response/set': {
      const key = responseKey(action.providerId, action.questionId);
      const prev = state.responses[key] ?? { text: '', satisfactory: null };
      const next = { text: action.text ?? prev.text, satisfactory: action.satisfactory === undefined ? prev.satisfactory : action.satisfactory };
      return { ...state, responses: { ...state.responses, [key]: next } };
    }
    case 'score/set': {
      const key = scoreKey(action.providerId, action.criterion);
      const scores = { ...state.scores };
      if (action.score === null) delete scores[key];
      else scores[key] = action.score;
      return { ...state, scores };
    }
    case 'weight/set':
      return { ...state, weights: { ...state.weights, [action.criterion]: action.weight } };
    case 'decision/set':
      return { ...state, decisionNotes: action.text };
  }
}

/** Seed providers with the family's edits applied, plus providers they added. */
export function effectiveProviders(seed: Provider[], edits: Provider[]): Provider[] {
  const byId = new Map(edits.map((p) => [p.id, p]));
  const merged = seed.map((p) => byId.get(p.id) ?? p);
  const seedIds = new Set(seed.map((p) => p.id));
  return [...merged, ...edits.filter((p) => !seedIds.has(p.id))];
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
