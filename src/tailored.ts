import type { SeedData } from './data/load';
import type { AppState } from './state/reducer';
import type { ComplianceRow } from './backend';
import type { Claims, Provider } from './types';
import { includedSections, interviewPack } from './questions';
import { mentionsDisallowedFees } from './flags';
import type { Match, PriorityId } from './matching';

// Tailored interview questions for one provider (improvement plan 3.2): built from the predefined question
// list, with the ones that matter most for this provider brought to the front — priorities with nothing found
// publicly, claims to confirm, compliance findings and price questions — plus the family's own questions.

export type TailoredKind = 'gap' | 'confirm' | 'compliance' | 'price' | 'must' | 'custom' | 'pack';

export interface TailoredQuestion {
  id: string;
  section: string;
  text: string;
  must: boolean;
  kind: TailoredKind;
  /** Why it's in the focus list, in a few words. */
  why: string | null;
  /** What the provider already says about it, to confirm. */
  theySay: string | null;
}

/** Interview sections or question ids that test each priority. */
const PRIORITY_QUESTIONS: Record<PriorityId, string[]> = {
  continuity: ['C'],
  clinical: ['D'],
  flexibility: ['A1', 'C6', 'G6'],
  local: ['A1', 'A2', 'N3'],
  veteran: ['E', 'F1'],
  price: ['G1', 'G2', 'G7'],
};
const matchesTopic = (topics: string[], qid: string, section: string) => topics.some((t) => t === qid || t === section);

export function tailoredQuestions(input: { seed: SeedData; state: AppState; provider: Provider; match: Match | undefined; claims: Claims | null | undefined; compliance: ComplianceRow | undefined }) {
  const { seed, state, provider, match, claims, compliance } = input;
  const pack = interviewPack(seed.interviewSections, includedSections(seed.boundingGroups, seed.interviewSections, state.answers), state.customQuestions, provider.id);
  const claimFor = new Map<string, { claim: string; status: string }>();
  for (const i of claims?.items ?? []) if (!claimFor.has(i.question_id) || i.status === 'stated') claimFor.set(i.question_id, { claim: i.claim, status: i.status });
  const gaps = (match?.reasons ?? []).filter((r) => r.level !== 'yes');

  const focus: TailoredQuestion[] = [];
  const rest: TailoredQuestion[] = [];
  for (const section of pack) {
    for (const q of section.questions) {
      const custom = state.customQuestions.find((c) => c.id === q.id);
      const said = claimFor.get(q.id);
      const gap = gaps.find((g) => matchesTopic(PRIORITY_QUESTIONS[g.priority], q.id, section.code));
      const base = { id: q.id, section: section.code, text: q.text, must: q.priority === 'must', theySay: said?.claim ?? null };
      if (custom?.provider_id === provider.id) focus.push({ ...base, kind: 'custom', why: `Your question for ${provider.provider}` });
      else if (gap) focus.push({ ...base, kind: 'gap', why: `Your priority “${gap.label}”: ${gap.level === 'unknown' ? 'nothing found publicly' : gap.level === 'partly' ? 'only partly shown' : 'not met'}` });
      else if (said?.status === 'partly') focus.push({ ...base, kind: 'confirm', why: 'They only partly answer this publicly: ask them to confirm' });
      else if (q.priority === 'must') focus.push({ ...base, kind: 'must', why: 'Must-ask: get the answer in writing' });
      else rest.push({ ...base, kind: custom ? 'custom' : 'pack', why: null });
    }
  }

  // Questions this provider's own record raises.
  const extra: TailoredQuestion[] = [];
  (compliance?.result?.findings ?? []).forEach((f, i) =>
    extra.push({
      id: `comp-${i}`,
      section: 'L',
      text: `The Quality and Safety Commission recorded: ${f.text}${f.date ? ` (${f.date})` : ''}. What happened, and what has changed since?`,
      must: f.kind === 'sanction' || f.kind === 'non_compliance',
      kind: 'compliance',
      why: 'From their compliance record',
      theySay: null,
    }),
  );
  (match?.missing ?? []).forEach((service, i) =>
    extra.push({ id: `price-${i}`, section: 'G', text: `What is your hourly price for ${service.toLowerCase()}?`, must: true, kind: 'price', why: 'No published price', theySay: null }),
  );
  provider.flags.filter((f) => mentionsDisallowedFees(f)).forEach((flag, i) =>
    extra.push({ id: `fee-${i}`, section: 'G', text: `Your price list mentions “${flag}”. Will this apply to us, and what would it cost?`, must: true, kind: 'price', why: 'A possible extra fee', theySay: null }),
  );

  const order: Record<TailoredKind, number> = { compliance: 0, price: 1, gap: 2, confirm: 3, custom: 4, must: 5, pack: 6 };
  return { focus: [...extra, ...focus].sort((a, b) => order[a.kind] - order[b.kind]), rest };
}

/** A calendar file (.ics) for an interview. Times are Australia/Sydney local time. */
export function interviewIcs(input: { provider: string; date: string; time: string; mode: string; place: string; attendees: string }): string {
  const [y, m, d] = input.date.split('-');
  const [hh, mm] = (input.time || '10:00').split(':');
  const start = `${y}${m}${d}T${hh.padStart(2, '0')}${mm.padStart(2, '0')}00`;
  const endHour = String(Math.min(23, Number(hh) + 1)).padStart(2, '0');
  const end = `${y}${m}${d}T${endHour}${mm.padStart(2, '0')}00`;
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Quantivate//Provider Assessor//EN',
    'BEGIN:VEVENT',
    `UID:${start}-${input.provider.replace(/\W+/g, '')}@assessor.quantivate.com.au`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
    `DTSTART;TZID=Australia/Sydney:${start}`,
    `DTEND;TZID=Australia/Sydney:${end}`,
    `SUMMARY:${esc(`Interview: ${input.provider}`)}`,
    `LOCATION:${esc(input.mode === 'phone' ? 'Phone' : input.mode === 'video' ? 'Video call' : input.place)}`,
    `DESCRIPTION:${esc(`Attending: ${input.attendees || 'family'}. Questions and briefing are in Provider Assessor.`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** An email to the provider: intro and the questions to answer in writing. */
export function packEmail(input: { provider: string; applicant: string; date: string; time: string; questions: TailoredQuestion[]; from: string }): { subject: string; body: string } {
  const when = input.date ? ` on ${new Date(`${input.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}${input.time ? ` at ${input.time}` : ''}` : '';
  const lines = input.questions.map((q, i) => `${i + 1}. ${q.text}`);
  return {
    subject: `Support at Home interview questions — ${input.applicant}`,
    body: [
      `Hello ${input.provider} team,`,
      '',
      `Thank you for meeting with us${when}. To help us prepare, we've attached a short summary about ${input.applicant} (please keep it private).`,
      '',
      'We would be grateful if you could answer these questions in writing, before or at the interview:',
      '',
      ...lines,
      '',
      'Kind regards,',
      input.from,
    ].join('\n'),
  };
}
