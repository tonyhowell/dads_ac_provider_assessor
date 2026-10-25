import type { BoundingAnswer, BoundingGroup } from './types';

// "What I'm looking for in a provider": helpers shared by the questionnaire, scoring, the summary and the dossier.

export type LookingForQuestion = BoundingGroup['questions'][number];

/** Questions without their own options keep the original Yes / No / Not sure. */
export const YES_NO: { value: string; label: string; rules_out?: boolean }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
];

export const optionsFor = (q: LookingForQuestion) => q.options ?? YES_NO;

export const isAnswered = (a: BoundingAnswer | undefined) => !!(a && (a.answer || a.choices?.length || a.not_relevant || a.notes?.trim()));

/** The chosen answers as words. An answer from before the options existed is kept as written. */
export function answerLabels(q: LookingForQuestion, a: BoundingAnswer | undefined): string[] {
  if (!a) return [];
  const opts = optionsFor(q);
  const label = (v: string) => opts.find((o) => o.value === v)?.label ?? v;
  if (q.type === 'multi') return (a.choices ?? []).map(label);
  return a.answer ? [label(a.answer)] : [];
}

/** Whether the chosen answers rule the question's interview sections out. */
export function rulesOut(q: LookingForQuestion, chosen: string[]): boolean {
  const opts = optionsFor(q);
  return chosen.length > 0 && chosen.every((v) => opts.find((o) => o.value === v)?.rules_out);
}

/** Every answered question as "question: answers — detail", for the summary request and the dossier. */
export function answeredQuestions(groups: BoundingGroup[], answers: Record<string, BoundingAnswer>) {
  return groups.flatMap((g) =>
    g.questions.flatMap((q) => {
      const a = answers[q.id];
      if (!isAnswered(a) || (a!.not_relevant && !answerLabels(q, a).length && !a!.notes?.trim())) return [];
      return [{ group: g.group, id: q.id, question: q.text, answers: answerLabels(q, a), detail: a!.notes?.trim() ?? '' }];
    }),
  );
}
