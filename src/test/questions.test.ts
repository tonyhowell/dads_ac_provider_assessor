import { describe, expect, it } from 'vitest';
import { includedSections, interviewPack, packQuestionCount } from '../questions';
import { effectiveWeights, failedMustQuestions, rank, suggestedPriceScore, weightedTotal } from '../scoring';
import { loadSeedData } from '../data/load';
import type { BoundingAnswer } from '../types';

const seed = loadSeedData();
const notRelevant = (...ids: string[]): Record<string, BoundingAnswer> =>
  Object.fromEntries(ids.map((id) => [id, { answer: '', not_relevant: true }]));

describe('question filtering (SPEC §6)', () => {
  it('includes every section and all 74 questions by default', () => {
    const inc = includedSections(seed.boundingGroups, seed.interviewSections, {});
    expect(inc.size).toBe(17);
    expect(packQuestionCount(interviewPack(seed.interviewSections, inc, []))).toBe(74);
  });

  it('excludes a section only when every question that informs it is not relevant', () => {
    // O is informed only by B6.1 (lives alone / carer).
    expect(includedSections(seed.boundingGroups, seed.interviewSections, notRelevant('B6.1')).has('O')).toBe(false);
    // F is informed by B1.3, B3.3, B4.1, B4.2 and B4.3: one relevant answer keeps it in.
    expect(includedSections(seed.boundingGroups, seed.interviewSections, notRelevant('B1.3', 'B3.3', 'B4.1', 'B4.2')).has('F')).toBe(true);
    expect(includedSections(seed.boundingGroups, seed.interviewSections, notRelevant('B1.3', 'B3.3', 'B4.1', 'B4.2', 'B4.3')).has('F')).toBe(false);
  });

  it('keeps sections no bounding question informs', () => {
    const all = seed.boundingGroups.flatMap((g) => g.questions.map((q) => q.id));
    const inc = includedSections(seed.boundingGroups, seed.interviewSections, notRelevant(...all));
    expect([...inc]).toEqual(['J']);
  });

  it('keeps "must" questions from excluded sections', () => {
    // Section F has one must question (F1) of five.
    const inc = includedSections(seed.boundingGroups, seed.interviewSections, notRelevant('B1.3', 'B3.3', 'B4.1', 'B4.2', 'B4.3'));
    const pack = interviewPack(seed.interviewSections, inc, []);
    const f = pack.find((s) => s.code === 'F')!;
    expect(f.included).toBe(false);
    expect(f.questions.map((q) => q.id)).toEqual(['F1']);
    expect(packQuestionCount(pack)).toBe(70);
  });

  it('adds custom questions to included sections', () => {
    const inc = includedSections(seed.boundingGroups, seed.interviewSections, {});
    const pack = interviewPack(seed.interviewSections, inc, [{ id: 'cq1', section: 'C', text: 'Can we meet the workers first?' }]);
    expect(pack.find((s) => s.code === 'C')!.questions.at(-1)).toEqual({ id: 'cq1', text: 'Can we meet the workers first?', priority: 'should', custom: true });
    expect(packQuestionCount(pack)).toBe(75);
  });
});

describe('scoring (SPEC §7)', () => {
  const weights = effectiveWeights({});

  it('uses the default weights unless changed', () => {
    expect(weights).toMatchObject({ veteran: 2, continuity: 2, clinical: 2, price: 1 });
    expect(effectiveWeights({ price: 3 }).price).toBe(3);
  });

  it('computes a weighted average of scored criteria', () => {
    const scores = { 'a::veteran': 5, 'a::price': 2 };
    // (5×2 + 2×1) ÷ (2 + 1) = 4
    expect(weightedTotal('a', scores, weights)).toEqual({ total: 4, scored: 2 });
    expect(weightedTotal('b', scores, weights)).toEqual({ total: null, scored: 0 });
  });

  it('ranks providers, unscored last', () => {
    const ranked = rank([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { 'a::veteran': 3, 'c::veteran': 5 }, weights);
    expect(ranked.map((r) => r.provider.id)).toEqual(['c', 'a', 'b']);
  });

  it('flags providers that leave a must question unanswered or unsatisfactory', () => {
    const musts = seed.interviewSections.flatMap((s) => s.questions).filter((q) => q.priority === 'must').map((q) => q.id);
    expect(failedMustQuestions('a', seed.interviewSections, {})).toEqual(musts);
    const allAnswered = Object.fromEntries(musts.map((id) => [`a::${id}`, { text: 'Answered in writing', rating: 'yes' as const, in_writing: true }]));
    expect(failedMustQuestions('a', seed.interviewSections, allAnswered)).toEqual([]);
    expect(failedMustQuestions('a', seed.interviewSections, { ...allAnswered, 'a::G2': { text: 'Travel is extra', rating: 'no', in_writing: true } })).toEqual(['G2']);
    expect(failedMustQuestions('a', seed.interviewSections, { ...allAnswered, 'a::G2': { text: 'Said no travel fees', rating: 'yes', in_writing: false } })).toEqual(['G2']);
    expect(failedMustQuestions('a', seed.interviewSections, { ...allAnswered, 'a::G2': { text: 'Mostly', rating: 'partly', in_writing: true } })).toEqual([]);
  });

  it('suggests a price score from the plan cost against the benchmark', () => {
    expect(suggestedPriceScore(11521 * 0.88, 11521)).toBe(5);
    expect(suggestedPriceScore(11521 * 0.93, 11521)).toBe(4);
    expect(suggestedPriceScore(11521, 11521)).toBe(3);
    expect(suggestedPriceScore(11521 * 1.08, 11521)).toBe(2);
    expect(suggestedPriceScore(14239, 11521)).toBe(1);
    expect(suggestedPriceScore(0, 11521)).toBeNull();
  });
});
