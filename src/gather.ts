import type { SeedData } from './data/load';
import { isAnswered } from './lookingFor';
import { GATHER_STEPS, type AppState, type GatherStep } from './state/reducer';

// The Gather stage (improvement plan, package 1): seven steps, and the essentials Find needs before it opens.

export interface GatherStepInfo {
  step: GatherStep;
  label: string;
  /** What the step is for, in one line. */
  purpose: string;
  done: (s: AppState, seed: SeedData) => boolean;
  /** Steps the applicant answers in their own view. */
  forApplicant?: boolean;
}

const needsGroups = (seed: SeedData) => seed.boundingGroups.filter((g) => g.group !== 'What matters most');
export const mattersGroup = (seed: SeedData) => seed.boundingGroups.find((g) => g.group === 'What matters most');

const prioritiesDone = (s: AppState) => (s.answers['B8.1']?.choices?.length ?? 0) > 0;
const dealBreakersDone = (s: AppState) => isAnswered(s.answers['B8.3']);
const planDone = (s: AppState) => !!s.plan && s.plan.some((i) => i.hours_per_week > 0);

export const GATHER: GatherStepInfo[] = [
  { step: 'situation', label: 'Situation', purpose: 'Where you live, your level, pension and DVA card.', done: (s) => !!s.participant },
  { step: 'money', label: 'Money', purpose: 'Your budget each quarter and what you pay.', done: (s) => !!s.participant },
  { step: 'plan', label: 'Care plan', purpose: 'The services and hours from your support plan.', done: planDone },
  {
    step: 'needs',
    label: 'Needs and home',
    purpose: 'The help you need, feeling safe at home, money, household and family.',
    done: (s, seed) => needsGroups(seed).every((g) => g.questions.every((q) => isAnswered(s.answers[q.id]))),
  },
  { step: 'matters', label: 'What matters', purpose: 'Your top priorities, must-haves and deal-breakers.', done: (s) => prioritiesDone(s) && dealBreakersDone(s), forApplicant: true },
  { step: 'about', label: 'About me', purpose: 'What providers should know about you.', done: (s) => !!s.profile && !!(s.profile.preferred_name || s.profile.contact_name), forApplicant: true },
  { step: 'brief', label: 'Brief', purpose: 'One page that sums it all up, confirmed by the family.', done: (s) => !!s.gather.brief.confirmed_at },
];

export const stepInfo = (step: GatherStep) => GATHER.find((g) => g.step === step)!;
export const stepPath = (step: GatherStep) => `/gather/${step}`;
export const isGatherStep = (x: string | undefined): x is GatherStep => (GATHER_STEPS as readonly string[]).includes(x ?? '');
export { needsGroups };

export interface Missing {
  label: string;
  why: string;
  step: GatherStep;
}

/** What Find still needs from Gather. Empty means Find is open. */
export function missingForFind(s: AppState): Missing[] {
  const out: Missing[] = [];
  if (!s.participant) out.push({ label: 'Your level, budget and pension', why: 'to work out what each provider would cost you', step: 'situation' });
  if (!planDone(s)) out.push({ label: 'Your care plan', why: 'to price and match providers on the services you need', step: 'plan' });
  if (!prioritiesDone(s)) out.push({ label: 'Your top priorities', why: 'to rank providers on what matters to you', step: 'matters' });
  if (!dealBreakersDone(s)) out.push({ label: 'Your deal-breakers', why: 'to flag providers with something you would not accept', step: 'matters' });
  return out;
}
