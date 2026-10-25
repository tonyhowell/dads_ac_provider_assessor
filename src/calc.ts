import { ruleAt, type RateBand } from './rules';
import type { Benchmark, Budget, Category, ContributionRate, Participant, PlanItem, Provider, RateKey } from './types';

// SPEC §5 calculations. Pure functions: no React, no storage.

export const WEEKS_PER_QUARTER = 13;

/** Hourly rates by service, from a provider or the benchmark. */
export type RateCard = Pick<Provider, RateKey>;

/** Contribution rates applied to a plan. Low and high differ when only a range is known. */
export interface ContributionRates extends RateBand {
  /** fixed: set by status · assessed: entered from the DVA/Services Australia letter · range: letter not yet entered */
  basis: 'fixed' | 'assessed' | 'range' | 'general';
}

/** The contribution category a plan item falls in on `serviceDate` (personal care moved to Clinical on 1 Oct 2026). */
export function categoryFor(item: PlanItem, serviceDate: string | Date): Category {
  return item.key === 'pc' ? ruleAt('personalCareCategory', serviceDate) : item.category;
}

export function rateFor(category: Category, rates: RateBand, bound: 'low' | 'high'): number {
  if (category === 'clinical') return 0;
  if (category === 'independence') return bound === 'low' ? rates.ind_low : rates.ind_high;
  return bound === 'low' ? rates.ev_low : rates.ev_high;
}

/**
 * Contribution rates for a participant. With no participant, the range runs from full pensioner
 * (low) to self-funded (high), as in the SPEC's reference table.
 */
export function contributionRates(participant: Participant | null, table: ContributionRate[], onDate: string | Date = new Date()): ContributionRates {
  const row = (key: ContributionRate['key']) => {
    const r = table.find((c) => c.key === key);
    if (!r) throw new Error(`No contribution rates for ${key}`);
    return r;
  };
  if (!participant) {
    const full = row('full_pensioner');
    const self = row('self_funded');
    return { ind_low: full.ind_low, ind_high: self.ind_high, ev_low: full.ev_low, ev_high: self.ev_high, basis: 'general' };
  }

  const band: RateBand = participant.nwop
    ? ruleAt('nwopContributionBands', onDate)[participant.pension_status === 'full_pensioner' ? 'full_pensioner' : 'other']
    : row(participant.pension_status === 'nwop_full_pensioner' ? 'full_pensioner' : participant.pension_status === 'nwop_self_funded' ? 'self_funded' : participant.pension_status);

  if (band.ind_low === band.ind_high && band.ev_low === band.ev_high) return { ...band, basis: 'fixed' };
  const { ind_rate, ev_rate } = participant;
  if (assessedRatesValid(participant, band)) return { ind_low: ind_rate!, ind_high: ind_rate!, ev_low: ev_rate!, ev_high: ev_rate!, basis: 'assessed' };
  return { ...band, basis: 'range' };
}

/** Whether the participant's entered (assessed) rates fall inside their band. */
export function assessedRatesValid(p: Pick<Participant, 'ind_rate' | 'ev_rate'>, band: RateBand): boolean {
  const { ind_rate, ev_rate } = p;
  return (
    ind_rate != null &&
    ev_rate != null &&
    ind_rate >= band.ind_low - 1e-9 &&
    ind_rate <= band.ind_high + 1e-9 &&
    ev_rate >= band.ev_low - 1e-9 &&
    ev_rate <= band.ev_high + 1e-9
  );
}

export interface PlanLine {
  service: string;
  key: RateKey;
  hours_per_week: number;
  category: Category;
  /** Hourly price used: the card's own, else the benchmark's, else null (no price anywhere). */
  price: number | null;
  filled_from_benchmark: boolean;
  quarterly_cost: number;
  contrib_low: number;
  contrib_high: number;
}

export interface PlanCost {
  lines: PlanLine[];
  quarterly_cost: number;
  contrib_low: number;
  contrib_high: number;
  /** quarterly_cost − budget.for_services; positive means over budget. Null without a budget. */
  over_budget: number | null;
  /** budget.for_services ÷ quarterly_cost: how much of the plan the budget covers (1 = exactly). */
  hours_affordable_factor: number | null;
  /** Services priced from the benchmark because the card has no published rate. */
  benchmark_filled: string[];
  /** Services with no price on the card or the benchmark; the totals leave them out. */
  unpriced: string[];
}

/** Quarterly cost of a weekly plan at one provider (SPEC §5). */
export function planCost(
  card: RateCard,
  benchmark: RateCard,
  plan: PlanItem[],
  rates: RateBand,
  serviceDate: string | Date,
  budget: Budget | null = null,
): PlanCost {
  const lines = plan.map((item): PlanLine => {
    const own = card[item.key];
    const price = own ?? benchmark[item.key];
    const category = categoryFor(item, serviceDate);
    const cost = (price ?? 0) * item.hours_per_week * WEEKS_PER_QUARTER;
    return {
      service: item.service,
      key: item.key,
      hours_per_week: item.hours_per_week,
      category,
      price,
      filled_from_benchmark: own === null && price !== null,
      quarterly_cost: cost,
      contrib_low: cost * rateFor(category, rates, 'low'),
      contrib_high: cost * rateFor(category, rates, 'high'),
    };
  });
  const sum = (f: (l: PlanLine) => number) => lines.reduce((t, l) => t + f(l), 0);
  const quarterly_cost = sum((l) => l.quarterly_cost);
  return {
    lines,
    quarterly_cost,
    contrib_low: sum((l) => l.contrib_low),
    contrib_high: sum((l) => l.contrib_high),
    over_budget: budget ? quarterly_cost - budget.for_services : null,
    hours_affordable_factor: budget && quarterly_cost > 0 ? budget.for_services / quarterly_cost : null,
    benchmark_filled: lines.filter((l) => l.filled_from_benchmark).map((l) => l.service),
    unpriced: lines.filter((l) => l.price === null && l.hours_per_week > 0).map((l) => l.service),
  };
}

/** (provider − benchmark) ÷ benchmark. Null when either rate is missing. */
export function variance(providerRate: number | null, benchmarkRate: number | null): number | null {
  if (providerRate === null || benchmarkRate === null || benchmarkRate === 0) return null;
  return (providerRate - benchmarkRate) / benchmarkRate;
}

/** SPEC §5 colouring: more than 5% above the benchmark is "above" (red), more than 5% below is "below" (green). */
export function varianceBand(v: number | null): 'above' | 'below' | 'near' | null {
  if (v === null) return null;
  if (v > 0.05) return 'above';
  if (v < -0.05) return 'below';
  return 'near';
}

export interface Headline<T> {
  cheapest: T & { quarterly_cost: number };
  dearest: T & { quarterly_cost: number };
  /** (dearest − cheapest) ÷ cheapest */
  spread: number;
}

/** Cheapest and dearest plan cost. Pass only fully priced results so the comparison is like for like. */
export function headline<T extends { quarterly_cost: number }>(results: T[]): Headline<T> | null {
  const priced = results.filter((r) => r.quarterly_cost > 0);
  if (priced.length === 0) return null;
  const sorted = [...priced].sort((a, b) => a.quarterly_cost - b.quarterly_cost);
  const cheapest = sorted[0];
  const dearest = sorted[sorted.length - 1];
  return { cheapest, dearest, spread: (dearest.quarterly_cost - cheapest.quarterly_cost) / cheapest.quarterly_cost };
}

/** Lifetime cap on non-clinical contributions that applies to the participant. */
export function lifetimeCap(participant: Pick<Participant, 'nwop'> | null, onDate: string | Date = new Date()): number {
  return participant?.nwop ? ruleAt('lifetimeCapNwop', onDate) : ruleAt('lifetimeCapStandard', onDate);
}

/** Years until the lifetime cap is reached: (cap − paid) ÷ annual contributions. */
export function yearsToCap(cap: number, paid: number, annualContributions: number): number {
  if (paid >= cap) return 0;
  if (annualContributions <= 0) return Infinity;
  return (cap - paid) / annualContributions;
}

/** Unspent funds that can carry over to the next quarter: the greater of $1,000 or 10% of the quarterly budget. */
export function carryOverCap(quarterly: number, onDate: string | Date = new Date()): number {
  const { floor, share } = ruleAt('carryOverCap', onDate);
  return Math.max(floor, quarterly * share);
}

/** Benchmark as a rate card (drops its name). */
export const benchmarkCard = (b: Benchmark): RateCard => ({
  rn: b.rn,
  en: b.en,
  pc: b.pc,
  domestic: b.domestic,
  social: b.social,
  respite: b.respite,
  gardening: b.gardening,
  care_mgmt: b.care_mgmt,
});
