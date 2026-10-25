import { describe, expect, it } from 'vitest';
import { dvaPrompts } from '../dva';
import { mentionsDisallowedFees } from '../flags';
import { loadSeedData } from '../data/load';

const seed = loadSeedData();

describe('DVA prompts', () => {
  it('suggests Veterans Home Care and community nursing for Gold Card holders, without asserting eligibility', () => {
    const prompts = dvaPrompts({ dva_card: 'gold' }, seed.samplePlan);
    expect(prompts.map((p) => p.id)).toEqual(['vhc', 'nursing', 'treatment']);
    expect(prompts[0].text).toContain('domestic assistance, home and garden maintenance and personal care');
    expect(prompts.every((p) => /confirm|ask|separately/i.test(p.text))).toBe(true);
  });
  it('words White Card prompts conditionally', () => {
    expect(dvaPrompts({ dva_card: 'white' }, seed.samplePlan)[0].text).toMatch(/may get .* specific accepted conditions/);
  });
  it('says nothing without a DVA card', () => {
    expect(dvaPrompts({ dva_card: 'none' }, seed.samplePlan)).toEqual([]);
    expect(dvaPrompts(null, seed.samplePlan)).toEqual([]);
  });
});

describe('disallowed fee flags', () => {
  it('catches travel and admin fee mentions in the seed data', () => {
    const flagged = seed.providers.filter((p) => mentionsDisallowedFees(...p.flags)).map((p) => p.id);
    expect(flagged).toEqual(['bolton-clarke', 'anglicare-southern-queensland', 'right-at-home-brisbane-bayside-south']);
  });
  it('ignores unrelated text', () => {
    expect(mentionsDisallowedFees('30-min minimum', null, undefined)).toBe(false);
  });
});
