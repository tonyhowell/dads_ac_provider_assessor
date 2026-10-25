import { describe, expect, it } from 'vitest';
import { deriveBudget, loadSeedData, parseSeedData, pricesMissing, SeedDataError } from '../data/load';
import { categoryFromLabel, latestDateIn, nameKey, slugify, statusFromLabel } from '../data/normalise';

const rates = { rn: null, en: null, pc: null, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null };
const validRaw = () => ({
  providers: [
    {
      provider: 'Example Care (North)', type: null, outlet: null, ...rates, rn: 120, pc: 80,
      prices_as_at: '1 Jul 2026 (updated 22 Sep 2026)', veteran_fit: null, flags: 'Minimum 1 hour; travel extra', source_url: 'https://example.org/prices',
    },
  ] as Record<string, unknown>[],
  benchmark: [{ provider: 'IHACPA', ...rates }],
  budgets: [{ classification: 'HCP L1', quarterly: 2823.55 }],
  contributions: [{ status: 'Full pensioner', clinical: 0, ind_low: 0.05, ind_high: 0.05, ev_low: 0.175, ev_high: 0.175 }],
  samplePlan: [{ service: 'Personal care', key: 'pc', hours_per_week: 3, category: 'Clinical (from 1 Oct 2026)' }],
  shortlist: [],
  boundingGroups: [{ group: 'G', questions: [{ id: 'B1', text: 'Q', informs_sections: ['A'], note: null }] }],
  interviewSections: [],
});

describe('starter-pack data', () => {
  const seed = loadSeedData();

  it('loads every file', () => {
    expect(seed.providers).toHaveLength(7);
    expect(seed.benchmark.pc).toBe(103.11);
    expect(seed.boundingGroups.flatMap((g) => g.questions)).toHaveLength(27);
    expect(seed.interviewSections.flatMap((s) => s.questions)).toHaveLength(74);
    expect(seed.samplePlan).toHaveLength(5);
    expect(seed.shortlist).toHaveLength(6);
  });

  it('keeps the published budget figures and adds the transitioned HCP levels', () => {
    expect(seed.budgets.find((b) => b.classification === '2')).toEqual({ classification: '2', quarterly: 4120.89, annual: 16483.55, for_services: 3708.8 });
    expect(seed.budgets.map((b) => b.classification)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', 'HCP L1', 'HCP L2', 'HCP L3', 'HCP L4']);
  });

  it('maps contribution labels to statuses', () => {
    expect(seed.contributions.map((c) => c.key)).toEqual(['full_pensioner', 'part_pensioner', 'self_funded']);
  });

  it('normalises provider records', () => {
    const bolton = seed.providers.find((p) => p.id === 'bolton-clarke')!;
    expect(bolton.prices_as_at).toBe('1 Jul 2026 (schedule updated 22 Sep 2026)');
    expect(bolton.prices_as_at_date).toBe('2026-09-22');
    expect(bolton.flags).toEqual(['Gardening min. not stated', 'AT 10% admin (cap $500), home mods 15% (cap $1,500)']);
    expect(seed.providers.find((p) => p.id === 'carers-link')!.prices_as_at_date).toBeNull();
  });

  it('detects when no prices are loaded', () => {
    expect(pricesMissing(seed.providers)).toBe(false);
    expect(pricesMissing(seed.providers.filter((p) => p.rn === null && p.pc === null))).toBe(true);
  });
});

describe('parseSeedData', () => {
  it('normalises the starter-pack layout', () => {
    const seed = parseSeedData(validRaw());
    expect(seed.providers[0]).toMatchObject({ id: 'example-care-north', flags: ['Minimum 1 hour', 'travel extra'], prices_as_at_date: '2026-09-22' });
    expect(seed.benchmark.provider).toBe('IHACPA');
    expect(seed.samplePlan[0].category).toBe('clinical');
    expect(seed.budgets[0]).toMatchObject({ annual: 11294.2 });
  });

  it('reports the file and field of invalid data', () => {
    const raw = validRaw();
    raw.providers[0].rn = 'expensive';
    try {
      parseSeedData(raw);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SeedDataError);
      expect((e as SeedDataError).file).toBe('providers.json');
      expect((e as SeedDataError).issues[0]).toMatch(/^0\.rn/);
    }
  });

  it('rejects unknown labels and duplicate providers', () => {
    expect(() => parseSeedData({ ...validRaw(), contributions: [{ status: 'Millionaire', clinical: 0, ind_low: 0, ind_high: 0, ev_low: 0, ev_high: 0 }] })).toThrow(/unrecognised status/);
    expect(() => parseSeedData({ ...validRaw(), samplePlan: [{ service: 'X', key: 'pc', hours_per_week: 1, category: 'Luxury' }] })).toThrow(/unrecognised category/);
    const raw = validRaw();
    raw.providers.push({ ...raw.providers[0] });
    expect(() => parseSeedData(raw)).toThrow(/duplicate id/);
  });

  it('derives missing budget amounts with the 10% care-management deduction', () => {
    const b = deriveBudget({ classification: 'HCP L3', quarterly: 10808.3 }, '2026-10-25');
    expect(b.annual).toBeCloseTo(43233.2);
    expect(b.for_services).toBeCloseTo(9727.47);
  });
});

describe('normalise helpers', () => {
  it('finds the latest date in free text', () => {
    expect(latestDateIn('1 Jul 2026 (schedule updated 22 Sep 2026)')).toBe('2026-09-22');
    expect(latestDateIn('10 Aug 2026 guide (tiered helper model)')).toBe('2026-08-10');
    expect(latestDateIn('Schedule on My Aged Care (date to confirm)')).toBeNull();
    expect(latestDateIn('2026-10-25')).toBe('2026-10-25');
  });
  it('maps labels', () => {
    expect(categoryFromLabel('Clinical (from 1 Oct 2026)')).toBe('clinical');
    expect(categoryFromLabel('Everyday living')).toBe('everyday');
    expect(statusFromLabel('Self-funded retiree / means not disclosed')).toBe('self_funded');
    expect(slugify('BlueCare (UnitingCare QLD)')).toBe('bluecare-unitingcare-qld');
    expect(nameKey('Carers Link (reserve)')).toBe('carers link');
  });
});
