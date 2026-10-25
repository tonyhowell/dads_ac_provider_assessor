import type { InterviewResponse, InterviewSection } from './types';

// SPEC §7: score each interviewed provider 1–5 on weighted criteria.

export const CRITERIA = [
  { id: 'veteran', label: 'Veteran / PTSD capability', weight: 2 },
  { id: 'continuity', label: 'Continuity of workers', weight: 2 },
  { id: 'clinical', label: 'Clinical depth', weight: 2 },
  { id: 'care_mgmt', label: 'Care-management quality', weight: 1 },
  { id: 'local', label: 'Local availability', weight: 1 },
  { id: 'price', label: 'Price vs benchmark', weight: 1 },
  { id: 'contract', label: 'Contract terms', weight: 1 },
  { id: 'dva', label: 'DVA coordination', weight: 1 },
] as const;

export type CriterionId = (typeof CRITERIA)[number]['id'];
export const CRITERION_IDS = CRITERIA.map((c) => c.id) as [CriterionId, ...CriterionId[]];

export const scoreKey = (providerId: string, criterion: string) => `${providerId}::${criterion}`;
export const responseKey = (providerId: string, questionId: string) => `${providerId}::${questionId}`;

export function effectiveWeights(overrides: Record<string, number>): Record<CriterionId, number> {
  return Object.fromEntries(CRITERIA.map((c) => [c.id, overrides[c.id] ?? c.weight])) as Record<CriterionId, number>;
}

export interface WeightedResult {
  /** Weighted average of the scored criteria, on the 1–5 scale. Null when nothing is scored. */
  total: number | null;
  scored: number;
}

/** Weighted total for one provider. Unscored criteria are left out rather than counted as zero. */
export function weightedTotal(providerId: string, scores: Record<string, number>, weights: Record<CriterionId, number>): WeightedResult {
  let sum = 0;
  let weightSum = 0;
  let scored = 0;
  for (const c of CRITERIA) {
    const s = scores[scoreKey(providerId, c.id)];
    const w = weights[c.id];
    if (s === undefined || w <= 0) continue;
    sum += s * w;
    weightSum += w;
    scored += 1;
  }
  return { total: weightSum > 0 ? sum / weightSum : null, scored };
}

/** Providers ranked by weighted total, highest first. Unscored providers come last, in their given order. */
export function rank<T extends { id: string }>(providers: T[], scores: Record<string, number>, weights: Record<CriterionId, number>) {
  return providers
    .map((p, i) => ({ provider: p, ...weightedTotal(p.id, scores, weights), order: i }))
    .sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.order - b.order);
}

/**
 * SPEC §7: a provider that fails to answer any "must" question in writing is flagged "disqualify?".
 * A must question counts as failed when it has no written response or the family marked the answer unsatisfactory.
 */
export function failedMustQuestions(providerId: string, sections: InterviewSection[], responses: Record<string, InterviewResponse>): string[] {
  return sections
    .flatMap((s) => s.questions)
    .filter((q) => q.priority === 'must')
    .filter((q) => {
      const r = responses[responseKey(providerId, q.id)];
      return !r || !r.text.trim() || r.satisfactory === false;
    })
    .map((q) => q.id);
}

/**
 * Suggested "price vs benchmark" score from how a provider's plan cost compares with the benchmark plan cost.
 * 10%+ below → 5, 5–10% below → 4, within 5% → 3, 5–10% above → 2, 10%+ above → 1.
 */
export function suggestedPriceScore(planCost: number, benchmarkPlanCost: number): number | null {
  if (planCost <= 0 || benchmarkPlanCost <= 0) return null;
  const v = (planCost - benchmarkPlanCost) / benchmarkPlanCost;
  if (v <= -0.1) return 5;
  if (v <= -0.05) return 4;
  if (v < 0.05) return 3;
  if (v < 0.1) return 2;
  return 1;
}
