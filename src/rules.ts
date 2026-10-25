import type { Category } from './types';

// Program rules (SPEC §3) as dated config. Each rule is a list of values with the date
// they take effect; `ruleAt` returns the value in force on a given date.
// When a rule changes (indexation, reform), append a new entry — never edit history.

export interface RateBand {
  ind_low: number;
  ind_high: number;
  ev_low: number;
  ev_high: number;
}

export interface Dated<T> {
  effective_from: string; // YYYY-MM-DD
  value: T;
  source?: string;
}

export const RULES = {
  careManagementShare: [{ effective_from: '2025-11-01', value: 0.1 }] as Dated<number>[],
  carryOverCap: [
    { effective_from: '2025-11-01', value: { floor: 1000, share: 0.1 } },
  ] as Dated<{ floor: number; share: number }>[],
  lifetimeCapStandard: [{ effective_from: '2026-09-20', value: 140652.8 }] as Dated<number>[],
  lifetimeCapNwop: [{ effective_from: '2026-09-20', value: 88934.57 }] as Dated<number>[],
  personalCareCategory: [
    { effective_from: '2025-11-01', value: 'independence' },
    {
      effective_from: '2026-10-01',
      value: 'clinical',
      source: 'https://www.myagedcare.gov.au/news-and-updates/support-home-personal-care-contribution-changes',
    },
  ] as Dated<Category>[],
  /**
   * No-worse-off contribution bands (SPEC §3.3) for people approved for a Home Care Package on or
   * before 12 Sep 2024. Full pensioners pay nothing; others pay up to 25% in each non-clinical category.
   */
  nwopContributionBands: [
    {
      effective_from: '2025-11-01',
      value: {
        full_pensioner: { ind_low: 0, ind_high: 0, ev_low: 0, ev_high: 0 },
        other: { ind_low: 0, ind_high: 0.25, ev_low: 0, ev_high: 0.25 },
      },
    },
  ] as Dated<{ full_pensioner: RateBand; other: RateBand }>[],
  /** Providers must review prices at least every two months. */
  priceStalenessDays: [{ effective_from: '2025-11-01', value: 60 }] as Dated<number>[],
} as const;

export type RuleName = keyof typeof RULES;
type RuleValue<K extends RuleName> = (typeof RULES)[K][number]['value'];

export function ruleAt<K extends RuleName>(name: K, date: string | Date): RuleValue<K> {
  const iso = typeof date === 'string' ? date : toIsoDate(date);
  const entries = [...RULES[name]].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  let current: (typeof entries)[number] | undefined;
  for (const entry of entries) {
    if (entry.effective_from <= iso) current = entry;
  }
  if (!current) throw new Error(`No ${name} rule in force on ${iso}`);
  return current.value as RuleValue<K>;
}

export function toIsoDate(d: Date): string {
  // Australia/Sydney calendar date, so "today" matches what the user sees.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d);
}
