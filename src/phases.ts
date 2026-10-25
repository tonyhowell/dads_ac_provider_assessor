import { isAnswered } from './lookingFor';
import type { SeedData } from './data/load';
import { entriesAt, type AppState } from './state/reducer';
import { CRITERIA, failedMustQuestions, scoreKey } from './scoring';

// Four phases the user can name out loud (UI-SPEC §4.2). Never locked: completion only informs.

export interface Screen {
  id: string;
  label: string;
  to: string;
  /** Route prefixes that belong to this screen. */
  match: string[];
  done: (s: AppState, seed: SeedData) => boolean;
}

export interface Phase {
  n: number;
  name: string;
  screens: Screen[];
}

const allAnswered = (s: AppState, seed: SeedData) =>
  seed.boundingGroups.flatMap((g) => g.questions).every((q) => isAnswered(s.answers[q.id]));

export const PHASES: Phase[] = [
  {
    n: 1,
    name: 'Your situation',
    screens: [
      { id: 'about', label: 'About you', to: '/', match: ['/'], done: (s) => !!s.participant },
      { id: 'budget', label: 'Your budget', to: '/overview', match: ['/overview'], done: (s) => !!s.participant },
      { id: 'matters', label: "What I'm looking for", to: '/bounding', match: ['/bounding'], done: allAnswered },
    ],
  },
  {
    n: 2,
    name: 'Compare',
    screens: [
      { id: 'costs', label: 'Compare costs', to: '/costs', match: ['/costs'], done: (s) => !!s.participant },
      { id: 'providers', label: 'Providers', to: '/providers', match: ['/providers'], done: (s) => s.selection.length > 0 },
    ],
  },
  {
    n: 3,
    name: 'Choose who to meet',
    screens: [{ id: 'selection', label: 'Choose who to meet', to: '/selection', match: ['/selection'], done: (s) => entriesAt(s, 'interview').length >= 2 }],
  },
  {
    n: 4,
    name: 'Interview & decide',
    screens: [
      {
        id: 'pack',
        label: 'Interview questions',
        to: '/interview-pack',
        match: ['/interview-pack'],
        done: (s, seed) => {
          const ids = entriesAt(s, 'interview').map((e) => e.provider_id);
          return ids.length > 0 && ids.every((id) => failedMustQuestions(id, seed.interviewSections, s.responses).length === 0);
        },
      },
      { id: 'interviews', label: 'Interviews', to: '/interviews', match: ['/interviews'], done: (s) => s.interviews.some((i) => i.notes) },
      {
        id: 'scoring',
        label: 'Score and decide',
        to: '/scoring',
        match: ['/scoring', '/summary'],
        done: (s) => {
          const ids = entriesAt(s, 'interview').map((e) => e.provider_id);
          return ids.length > 0 && s.decisionNotes.trim() !== '' && ids.every((id) => CRITERIA.every((c) => s.scores[scoreKey(id, c.id)] !== undefined));
        },
      },
    ],
  },
];

export type PhaseState = 'not-started' | 'in-progress' | 'done';

export function phaseState(p: Phase, s: AppState, seed: SeedData): PhaseState {
  const done = p.screens.map((sc) => sc.done(s, seed));
  if (done.every(Boolean)) return 'done';
  return done.some(Boolean) ? 'in-progress' : 'not-started';
}

/** The phase and screen a route belongs to. */
export function locate(path: string): { phase: Phase; screen: Screen } | undefined {
  for (const phase of PHASES) {
    for (const screen of phase.screens) {
      if (screen.match.some((m) => (m === '/' ? path === '/' : path === m || path.startsWith(m + '/')))) return { phase, screen };
    }
  }
  return undefined;
}
