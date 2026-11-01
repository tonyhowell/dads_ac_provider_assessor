import type { BoundingAnswer, BoundingGroup, CustomQuestion, InterviewSection } from './types';

// SPEC §6: bounding answers decide which interview sections apply.

/**
 * Codes of the interview sections that apply. A section is left out only when every bounding question
 * that informs it is marked "not relevant". Sections no question informs, and unanswered ones, stay in.
 */
export function includedSections(groups: BoundingGroup[], sections: InterviewSection[], answers: Record<string, BoundingAnswer>): Set<string> {
  const informers = new Map<string, string[]>();
  for (const q of groups.flatMap((g) => g.questions)) {
    for (const code of q.informs_sections) informers.set(code, [...(informers.get(code) ?? []), q.id]);
  }
  return new Set(
    sections
      .map((s) => s.code)
      .filter((code) => {
        const qs = informers.get(code);
        return !qs || !qs.every((id) => answers[id]?.not_relevant);
      }),
  );
}

export interface PackQuestion {
  id: string;
  text: string;
  priority: 'must' | 'should';
  custom: boolean;
}

export interface PackSection {
  code: string;
  section: string;
  /** False when the bounding answers rule the section out; its "must" questions still appear. */
  included: boolean;
  questions: PackQuestion[];
}

/** The interview pack: included sections in full, plus "must" questions from excluded sections. */
/** The interview pack. With `providerId`, questions added for that provider are included as well as those for everyone. */
export function interviewPack(sections: InterviewSection[], included: Set<string>, custom: CustomQuestion[], providerId?: string): PackSection[] {
  custom = custom.filter((c) => !c.provider_id || c.provider_id === providerId);
  return sections
    .map((s) => {
      const inc = included.has(s.code);
      const own = s.questions.filter((q) => inc || q.priority === 'must').map((q) => ({ ...q, custom: false }));
      // A question added for one provider is always asked of it; questions for everyone follow the section.
      const extra = custom.filter((c) => c.section === s.code && (inc || c.provider_id)).map((c) => ({ id: c.id, text: c.text, priority: 'should' as const, custom: true }));
      return { code: s.code, section: s.section, included: inc, questions: [...own, ...extra] };
    })
    .filter((s) => s.questions.length > 0);
}

export const packQuestionCount = (pack: PackSection[]) => pack.reduce((n, s) => n + s.questions.length, 0);
