import { describe, expect, it } from 'vitest';
import { deriveBudget, loadSeedData, parseSeedData, pricesMissing, SeedDataError } from '../data/load';

const validRaw = () => ({
  providers: [
    {
      id: 'example', provider: 'Example Care', type: null, outlet: null,
      rn: 120, en: null, pc: 80, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null,
      prices_as_at: '2026-10-25', veteran_fit: null, flags: [], source_url: 'https://example.org/prices',
    },
  ],
  benchmark: { provider: 'IHACPA', rn: null, en: null, pc: null, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null },
  budgets: [{ classification: 'HCP L1', quarterly: 2823.55 }],
  contributions: [],
  samplePlan: [],
  shortlist: [],
  boundingGroups: [],
  interviewSections: [],
});

describe('seed data', () => {
  it('loads and validates the committed seed files', () => {
    const seed = loadSeedData();
    expect(seed.providers.length).toBeGreaterThan(0);
    expect(seed.budgets.map((b) => b.classification)).toContain('HCP L4');
  });

  it('derives budget fields with the 10% care-management deduction', () => {
    const b = deriveBudget('HCP L3', 10808.3, '2026-10-25');
    expect(b.annual).toBeCloseTo(43233.2);
    expect(b.for_services).toBeCloseTo(9727.47);
  });

  it('reports the file and field of invalid data', () => {
    const raw = validRaw();
    raw.providers[0].prices_as_at = '25/10/2026';
    expect(() => parseSeedData(raw)).toThrow(SeedDataError);
    try {
      parseSeedData(raw);
    } catch (e) {
      expect((e as SeedDataError).file).toBe('providers.json');
      expect((e as SeedDataError).issues[0]).toMatch(/^0\.prices_as_at/);
    }
  });

  it('rejects duplicate provider ids', () => {
    const raw = validRaw();
    raw.providers.push({ ...raw.providers[0] });
    expect(() => parseSeedData(raw)).toThrow(/duplicate id/);
  });

  it('detects when no prices are loaded', () => {
    expect(pricesMissing(parseSeedData(validRaw()).providers)).toBe(false);
    expect(pricesMissing(loadSeedData().providers)).toBe(true);
  });
});
