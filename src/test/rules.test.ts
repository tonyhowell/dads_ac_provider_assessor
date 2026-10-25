import { describe, expect, it } from 'vitest';
import { ruleAt, toIsoDate } from '../rules';

describe('ruleAt', () => {
  it('switches personal care to Clinical on 1 Oct 2026', () => {
    expect(ruleAt('personalCareCategory', '2026-09-30')).toBe('independence');
    expect(ruleAt('personalCareCategory', '2026-10-01')).toBe('clinical');
  });

  it('returns current program values', () => {
    expect(ruleAt('careManagementShare', '2026-10-25')).toBe(0.1);
    expect(ruleAt('lifetimeCapStandard', '2026-10-25')).toBe(140652.8);
    expect(ruleAt('lifetimeCapNwop', '2026-10-25')).toBe(88934.57);
    expect(ruleAt('priceStalenessDays', '2026-10-25')).toBe(60);
  });

  it('throws before a rule exists', () => {
    expect(() => ruleAt('careManagementShare', '2020-01-01')).toThrow(/No careManagementShare rule/);
  });

  it('uses the Sydney calendar date', () => {
    // 14:30 UTC on 25 Oct is 01:30 on 26 Oct in Sydney (AEDT, UTC+11).
    expect(toIsoDate(new Date('2026-10-25T14:30:00Z'))).toBe('2026-10-26');
  });
});

describe('price staleness', async () => {
  const { isStale } = await import('../components/Price');
  it('flags prices more than 60 days old', () => {
    expect(isStale('2026-10-25', '2026-12-24')).toBe(false);
    expect(isStale('2026-10-25', '2026-12-25')).toBe(true);
  });
});
