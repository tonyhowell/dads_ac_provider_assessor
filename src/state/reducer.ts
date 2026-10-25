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
  ScreenNote,
  SelectionStage,
  SpecialRate,
  ApplicantProfile,
  StoredSummary,
  DossierSection,
  ShortlistSeed,
  RateKey,
} from '../types';
import { responseKey, scoreKey } from '../scoring';

export interface AppState {
  version: 7;
  notes: ProviderNote[];
  /** Providers the user has selected, each at one stage. Array order within a stage is the rank. */
  selection: SelectionEntry[];
  interviews: Interview[];
  participant: Participant | null;
  /** The family's care plan. Null = use the sample plan from the seed data. */
  plan: PlanItem[] | null;
  /** Date services are costed at (decides the personal-care category). Null = today. */
  serviceDate: string | null;
  /** Special rates providers have offered this applicant, by provider id. Applied over the common catalogue. */
  specialRates: Record<string, SpecialRate>;
  /** What providers should know about the applicant (v7). */
  profile: ApplicantProfile | null;
  /** Claude's draft of what the applicant is looking for, edited by the family (v7). */
  lookingFor: StoredSummary | null;
  /** Sections the family includes when printing a provider dossier (v7). */
  dossierSections: DossierSection[];
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
  /** Notes left on screens for the family. */
  screenNotes: ScreenNote[];
}

/** Fields added in v4, at their starting values. */
const V4_DEFAULTS = {
  participant: null,
  plan: null,
  serviceDate: null,
  answers: {},
  customQuestions: [],
  responses: {},
  scores: {},
  weights: {},
  decisionNotes: '',
  screenNotes: [],
} satisfies Omit<AppState, 'version' | 'notes' | 'selection' | 'interviews' | 'specialRates' | 'profile' | 'lookingFor' | 'dossierSections'>;

export type { Action };

export const STAGE_LABELS: Record<SelectionStage, string> = {
  scan: 'Initial scan',
  refine: 'Refinement',
  interview: 'Providers to interview',
};

export const nextStage = (s: SelectionStage): SelectionStage | undefined => SELECTION_STAGES[SELECTION_STAGES.indexOf(s) + 1];
export const prevStage = (s: SelectionStage): SelectionStage | undefined => SELECTION_STAGES[SELECTION_STAGES.indexOf(s) - 1];

/** Entries at one stage, in rank order. */
export const entriesAt = (state: AppState, stage: SelectionStage) => state.selection.filter((e) => e.stage === stage);

/** State with nothing in it yet. */
/** Fields added in v7, at their starting values. Budget and contribution figures stay out of the dossier unless chosen. */
const V7_DEFAULTS = {
  profile: null,
  lookingFor: null,
  dossierSections: ['profile', 'dva', 'plan', 'looking_for', 'answers', 'claims'] as DossierSection[],
};

export const emptyProfile = (): ApplicantProfile => ({
  preferred_name: '',
  contact_name: '',
  contact_relationship: '',
  contact_phone: '',
  contact_email: '',
  communication: [],
  communication_other: '',
  languages: '',
  dva_conditions: [],
  dva_conditions_other: '',
  dva_services: [],
  dva_services_detail: '',
  current_supports: '',
  anything_else: '',
});

export const emptyState = (): AppState => ({ version: 7, notes: [], selection: [], interviews: [], ...V4_DEFAULTS, specialRates: {}, ...V7_DEFAULTS });

export function initialState(seedShortlist: ShortlistSeed[], providers: Provider[], now: string): AppState {
  // The seed shortlist (SPEC §4) is the ranked list of providers to interview.
  const byName = new Map(providers.map((p) => [nameKey(p.provider), p.id]));
  const selection = [...seedShortlist]
    .sort((a, b) => a.rank - b.rank)
    .flatMap((s): SelectionEntry[] => {
      const id = byName.get(nameKey(s.provider));
      return id ? [{ provider_id: id, stage: 'interview', why: s.why, watch: s.watch, added_at: now, stage_changed_at: now }] : [];
    });
  return { version: 7, notes: [], selection, interviews: [], ...V4_DEFAULTS, specialRates: {}, ...V7_DEFAULTS };
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
 * v4 → v5: responses get "answered well?" (yes/partly/no) and "in writing"; screen notes are added.
 * v5 → v6: provider edits leave the family's state for the common catalogue (the server moves them first;
 * see `legacyProviderEdits`), and special rates are added.
 * v6 → v7: the applicant profile, the "What I'm looking for" summary and dossier choices are added.
 */
export function migrate(saved: unknown): AppState | undefined {
  const s = saved as { version?: number } | undefined;
  if (s?.version === 7) return s as AppState;
  if (s?.version === 6) return { ...V7_DEFAULTS, ...(s as unknown as Omit<AppState, 'version'>), version: 7 };
  if (s?.version === 5) {
    const { providerEdits: _moved, ...rest } = s as unknown as Omit<AppState, 'version' | 'specialRates'> & { providerEdits?: Provider[] };
    return migrate({ ...rest, specialRates: {}, version: 6 });
  }
  if (s?.version === 4) {
    // v4 → v5: responses gain "answered well?" and "in writing"; screen notes start empty.
    const v4 = s as unknown as Omit<AppState, 'version' | 'responses' | 'screenNotes'> & { responses: Record<string, { text: string; satisfactory: boolean | null }> };
    const responses = Object.fromEntries(
      Object.entries(v4.responses).map(([k, r]) => [k, { text: r.text, rating: r.satisfactory === null ? null : r.satisfactory ? 'yes' : 'no', in_writing: r.text.trim() !== '' } as InterviewResponse]),
    );
    return migrate({ ...v4, responses, screenNotes: [], version: 5 });
  }
  if (s?.version === 3) return migrate({ ...V4_DEFAULTS, ...(s as object), screenNotes: undefined, version: 4 });
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
    case 'selection/restore': {
      if (state.selection.some((e) => e.provider_id === action.entry.provider_id)) return state;
      const selection = [...state.selection];
      selection.splice(Math.min(action.index, selection.length), 0, action.entry);
      return { ...state, selection };
    }
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
    case 'profile/update':
      return { ...state, profile: { ...(state.profile ?? emptyProfile()), ...action.patch } };
    case 'lookingFor/set':
      return { ...state, lookingFor: action.summary };
    case 'dossier/sections':
      return { ...state, dossierSections: action.sections };
    case 'specialRate/set':
      return { ...state, specialRates: { ...state.specialRates, [action.providerId]: action.rate } };
    case 'specialRate/clear': {
      const specialRates = { ...state.specialRates };
      delete specialRates[action.providerId];
      return { ...state, specialRates };
    }
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
      const prev = state.responses[key] ?? { text: '', rating: null, in_writing: false };
      const next: InterviewResponse = {
        text: action.text ?? prev.text,
        rating: action.rating === undefined ? prev.rating : action.rating,
        in_writing: action.in_writing ?? prev.in_writing,
      };
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
    case 'screenNote/add':
      return { ...state, screenNotes: [...state.screenNotes.filter((n) => n.id !== action.note.id), action.note] };
    case 'screenNote/done':
      return { ...state, screenNotes: state.screenNotes.map((n) => (n.id === action.id ? { ...n, done: action.done } : n)) };
    case 'screenNote/delete':
      return { ...state, screenNotes: state.screenNotes.filter((n) => n.id !== action.id) };
  }
}

/** Provider edits held in saved state before v6, for the server to move into the common catalogue. */
export function legacyProviderEdits(saved: unknown): Provider[] {
  const edits = (saved as { providerEdits?: unknown } | undefined)?.providerEdits;
  return Array.isArray(edits) ? (edits as Provider[]) : [];
}

/** Applies an application's special rates over the catalogue, marking which rates were replaced. */
export function withSpecialRates(providers: Provider[], special: Record<string, SpecialRate>): Provider[] {
  return providers.map((p) => {
    const sr = special[p.id];
    if (!sr) return p;
    const keys = (Object.keys(sr.rates) as RateKey[]).filter((k) => sr.rates[k] !== undefined);
    if (!keys.length) return p;
    return { ...p, ...Object.fromEntries(keys.map((k) => [k, sr.rates[k]])), special_rates: keys };
  });
}

/** Starter-pack providers with the catalogue's edits applied, plus providers added to the catalogue. */
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
