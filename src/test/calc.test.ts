import { describe, expect, it } from 'vitest';
import {
  assessedRatesValid,
  benchmarkCard,
  carryOverCap,
  categoryFor,
  contributionRates,
  headline,
  lifetimeCap,
  planCost,
  variance,
  varianceBand,
  yearsToCap,
} from '../calc';
import { loadSeedData } from '../data/load';
import type { Participant, PlanItem } from '../types';

const seed = loadSeedData();
const bench = benchmarkCard(seed.benchmark);
const provider = (name: string) => seed.providers.find((p) => p.provider === name)!;
const participant = (over: Partial<Participant>): Participant => ({
  id: 'p',
  name: '',
  suburb: 'Example',
  postcode: '4000',
  pension_status: 'full_pensioner',
  ind_rate: null,
  ev_rate: null,
  dva_card: 'none',
  nwop: false,
  classification: '5',
  lifetime_contributions_paid: 0,
  ...over,
});
const fullPensioner = contributionRates(participant({ pension_status: 'full_pensioner' }), seed.contributions);
const selfFunded = contributionRates(participant({ pension_status: 'self_funded' }), seed.contributions);
const SERVICE_DATE = '2026-10-25';
/** The SPEC's table rounds halves to even (Anglicare's plan is exactly $12,980.50 → 12,980). */
const roundSpec = (n: number) => {
  const r = Math.round(n);
  return Math.abs(n % 1) > 0.5 - 1e-6 && Math.abs(n % 1) < 0.5 + 1e-6 && r % 2 !== 0 ? r - 1 : r;
};

describe('SPEC §5 reference table (seed data, weekday rates, sample plan, 13 weeks)', () => {
  const rows: [string, number, number, number, string[]][] = [
    ['Right at Home Brisbane Bayside South', 12500, 811, 4525, ['Gardening']],
    ['Bolton Clarke', 12701, 784, 4373, []],
    ['Anglicare Southern Queensland', 12980, 836, 4670, []],
    ['BlueCare (UnitingCare QLD)', 14239, 922, 5167, ['Gardening', 'Registered nurse review']],
  ];

  it.each(rows)('%s', (name, cost, full, self, filled) => {
    const atFull = planCost(provider(name), bench, seed.samplePlan, fullPensioner, SERVICE_DATE);
    const atSelf = planCost(provider(name), bench, seed.samplePlan, selfFunded, SERVICE_DATE);
    expect(roundSpec(atFull.quarterly_cost)).toBe(cost);
    expect(roundSpec(atFull.contrib_low)).toBe(full);
    expect(roundSpec(atSelf.contrib_low)).toBe(self);
    expect(atFull.benchmark_filled.sort()).toEqual(filled.sort());
    expect(atFull.unpriced).toEqual([]);
  });

  it('IHACPA benchmark', () => {
    const atFull = planCost(bench, bench, seed.samplePlan, fullPensioner, SERVICE_DATE);
    const atSelf = planCost(bench, bench, seed.samplePlan, selfFunded, SERVICE_DATE);
    expect(roundSpec(atFull.quarterly_cost)).toBe(11521);
    expect(roundSpec(atFull.contrib_low)).toBe(773);
    expect(roundSpec(atSelf.contrib_low)).toBe(4249);
  });

  it('with no participant, the range runs from full pensioner to self-funded', () => {
    const general = contributionRates(null, seed.contributions);
    const r = planCost(provider('Bolton Clarke'), bench, seed.samplePlan, general, SERVICE_DATE);
    expect([roundSpec(r.contrib_low), roundSpec(r.contrib_high)]).toEqual([784, 4373]);
  });
});

describe('personal care category', () => {
  const pc: PlanItem = { service: 'Personal care', key: 'pc', hours_per_week: 3, category: 'clinical' };
  it('is Independence before 1 Oct 2026 and Clinical from then, whatever the plan says', () => {
    expect(categoryFor(pc, '2026-09-30')).toBe('independence');
    expect(categoryFor(pc, '2026-10-01')).toBe('clinical');
    expect(categoryFor({ ...pc, category: 'independence' }, '2026-10-01')).toBe('clinical');
  });
  it('changes the contribution, not the cost', () => {
    const before = planCost(bench, bench, [pc], fullPensioner, '2026-09-30');
    const after = planCost(bench, bench, [pc], fullPensioner, '2026-10-01');
    expect(before.quarterly_cost).toBe(after.quarterly_cost);
    expect(before.contrib_low).toBeCloseTo(103.11 * 3 * 13 * 0.05);
    expect(after.contrib_low).toBe(0);
  });
});

describe('planCost', () => {
  const budget = seed.budgets.find((b) => b.classification === '5')!;
  it('compares the plan with the services budget', () => {
    const r = planCost(provider('Bolton Clarke'), bench, seed.samplePlan, fullPensioner, SERVICE_DATE, budget);
    expect(r.over_budget).toBeCloseTo(r.quarterly_cost - 9182.09);
    expect(r.over_budget! > 0).toBe(true);
    expect(r.hours_affordable_factor).toBeCloseTo(9182.09 / r.quarterly_cost);
  });
  it('leaves services with no price anywhere out of the totals and lists them', () => {
    const noPrices = { ...bench, gardening: null };
    const r = planCost(provider('Carers Link'), noPrices, seed.samplePlan, fullPensioner, SERVICE_DATE);
    expect(r.unpriced).toEqual(['Gardening']);
    expect(r.lines.find((l) => l.key === 'gardening')!.quarterly_cost).toBe(0);
  });
});

describe('contribution rates', () => {
  const part = (ind: number | null, ev: number | null) => participant({ pension_status: 'part_pensioner', ind_rate: ind, ev_rate: ev });
  it('uses fixed rates for full pensioners and self-funded retirees', () => {
    expect(fullPensioner).toMatchObject({ ind_low: 0.05, ind_high: 0.05, ev_low: 0.175, ev_high: 0.175, basis: 'fixed' });
    expect(selfFunded).toMatchObject({ ind_low: 0.5, ev_high: 0.8, basis: 'fixed' });
  });
  it("uses a part pensioner's assessed rates when they are inside the band", () => {
    expect(contributionRates(part(0.2, 0.4), seed.contributions)).toMatchObject({ ind_low: 0.2, ind_high: 0.2, ev_low: 0.4, ev_high: 0.4, basis: 'assessed' });
  });
  it('falls back to the band when rates are missing or out of range', () => {
    expect(contributionRates(part(null, null), seed.contributions)).toMatchObject({ ind_low: 0.05, ind_high: 0.5, basis: 'range' });
    expect(contributionRates(part(0.6, 0.4), seed.contributions).basis).toBe('range');
    expect(assessedRatesValid({ ind_rate: 0.04, ev_rate: 0.2 }, { ind_low: 0.05, ind_high: 0.5, ev_low: 0.175, ev_high: 0.8 })).toBe(false);
  });
  it('applies no-worse-off rates', () => {
    expect(contributionRates(participant({ nwop: true }), seed.contributions)).toMatchObject({ ind_high: 0, ev_high: 0, basis: 'fixed' });
    expect(contributionRates(participant({ nwop: true, pension_status: 'self_funded' }), seed.contributions)).toMatchObject({ ind_high: 0.25, ev_high: 0.25, basis: 'range' });
    expect(contributionRates(participant({ nwop: true, pension_status: 'self_funded', ind_rate: 0.1, ev_rate: 0.25 }), seed.contributions).basis).toBe('assessed');
  });
});

describe('variance, headline, caps', () => {
  it('colours variance beyond ±5%', () => {
    expect(variance(126, 103.11)).toBeCloseTo(0.222, 3);
    expect(varianceBand(variance(126, 103.11))).toBe('above');
    expect(varianceBand(variance(95, 103.11))).toBe('below');
    expect(varianceBand(variance(105, 103.11))).toBe('near');
    expect(variance(null, 100)).toBeNull();
    expect(varianceBand(null)).toBeNull();
  });

  it('finds the cheapest and dearest plan and the spread', () => {
    const h = headline([
      { name: 'A', quarterly_cost: 12500 },
      { name: 'B', quarterly_cost: 14239 },
      { name: 'C', quarterly_cost: 12701 },
      { name: 'Unpriced', quarterly_cost: 0 },
    ])!;
    expect(h.cheapest.name).toBe('A');
    expect(h.dearest.name).toBe('B');
    expect(h.spread).toBeCloseTo(0.1391, 4);
    expect(headline([])).toBeNull();
  });

  it('works out years to the lifetime cap', () => {
    expect(lifetimeCap(null, '2026-10-25')).toBe(140652.8);
    expect(lifetimeCap({ nwop: true }, '2026-10-25')).toBe(88934.57);
    expect(yearsToCap(140652.8, 10652.8, 3250)).toBeCloseTo(40);
    expect(yearsToCap(100, 100, 50)).toBe(0);
    expect(yearsToCap(100, 0, 0)).toBe(Infinity);
  });

  it('caps carry-over at the greater of $1,000 or 10%', () => {
    expect(carryOverCap(2757.89, '2026-10-25')).toBe(1000);
    expect(carryOverCap(20073.5, '2026-10-25')).toBeCloseTo(2007.35);
  });
});
