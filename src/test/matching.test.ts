import { describe, expect, it } from 'vitest';
import { benchmarkCard, contributionRates, planCost } from '../calc';
import { loadSeedData } from '../data/load';
import { bestCombinations, lookingForInputs, matchProvider, passes, rankForServices, rankMatches, type MatchContext } from '../matching';
import type { BoundingAnswer, Claims } from '../types';

const seed = loadSeedData();
const bench = benchmarkCard(seed.benchmark);
const rates = contributionRates(null, seed.contributions, '2026-11-01');
const budget = seed.budgets.find((b) => b.classification === '5')!;
const plan = seed.samplePlan;
const cost = (id: string) => planCost(seed.providers.find((p) => p.id === id)!, bench, plan, rates, '2026-11-01', budget);
const provider = (id: string) => seed.providers.find((p) => p.id === id)!;
const choices = (...c: string[]): BoundingAnswer => ({ answer: '', choices: c, notes: '', not_relevant: false });

const ctx = (answers: Record<string, BoundingAnswer>, claims = new Map<string, Claims | null>()): MatchContext => ({
  plan,
  answers,
  claims,
  benchmarkCost: planCost(bench, bench, plan, rates, '2026-11-01', budget),
  areaPostcode: '4178',
});

const match = (id: string, c: MatchContext) => matchProvider(provider(id), cost(id), c);

describe('matching providers to what the family is looking for', () => {
  it('reads priorities in the order chosen, up to three, and the deal-breakers', () => {
    const { priorities, dealBreakers } = lookingForInputs({ 'B8.1': choices('veteran', 'continuity', 'local', 'price'), 'B8.3': choices('fees'), 'B3.1': choices('unannounced') });
    expect(priorities).toEqual(['veteran', 'continuity', 'local']);
    expect([...dealBreakers]).toEqual(['fees', 'unannounced']);
  });

  it('credits reviewed provider data and public claims, with their source', () => {
    const claims = new Map<string, Claims | null>([
      [
        'bolton-clarke',
        { website: null, overview: '', items: [{ question_id: 'C1', status: 'stated', claim: 'A small regular team for each client', quote: '', source_url: 'https://example.org/team', source_title: 'Our care' }] },
      ],
    ]);
    const m = match('bolton-clarke', ctx({ 'B8.1': choices('continuity', 'veteran') }, claims));
    expect(m.reasons.map((r) => [r.priority, r.level, r.source?.kind])).toEqual([
      ['continuity', 'yes', 'claim'],
      ['veteran', 'yes', 'catalogue'],
    ]);
    expect(m.reasons[0].source?.url).toBe('https://example.org/team');
    expect(m.verdict).toBe('strong');
    expect(m.summary).toMatch(/^Says it keeps the same workers and understands veterans\./);
  });

  it("doesn't count what we couldn't find against a provider, and says when too little is known", () => {
    const m = match('anglicare-southern-queensland', ctx({ 'B8.1': choices('continuity', 'veteran') }));
    expect(m.reasons.every((r) => r.level === 'unknown')).toBe(true);
    expect(m.reasons[0].detail).toBe('Not checked yet');
    expect(m.verdict).toBe('unclear');
    // Coverage and price still count: all services priced.
    expect(m.parts.find((p) => p.label === 'Prices for your services')).toMatchObject({ got: 15, max: 15 });
  });

  it('puts providers without published prices in a "needs a quote" group, last', () => {
    const c = ctx({ 'B8.1': choices('veteran') });
    const ranked = rankMatches(['five-good-friends-brisbane-east-bayside', 'bolton-clarke', 'bluecare-unitingcare-qld'].map((id) => match(id, c)));
    expect(ranked.map((m) => m.provider.id)).toEqual(['bolton-clarke', 'bluecare-unitingcare-qld', 'five-good-friends-brisbane-east-bayside']);
    expect(ranked[2].verdict).toBe('quote');
    expect(ranked[1].missing).toEqual(['Gardening', 'Registered nurse review']);
  });

  it('marks fee flags as a deal-breaker only when the family named fees', () => {
    const plain = match('anglicare-southern-queensland', ctx({}));
    expect(plain.cautions).toHaveLength(1);
    expect(plain.cautions[0].dealBreaker).toBe(false);
    expect(passes(plain, { noDealBreakers: true })).toBe(true);
    const strict = match('anglicare-southern-queensland', ctx({ 'B8.3': choices('fees') }));
    expect(strict.cautions[0].dealBreaker).toBe(true);
    expect(passes(strict, { noDealBreakers: true })).toBe(false);
  });

  it('filters on services priced and budget', () => {
    const c = ctx({});
    const blue = match('bluecare-unitingcare-qld', c);
    expect(passes(blue, { coverage: 'all' })).toBe(false);
    expect(passes(blue, { coverage: 'most' })).toBe(false); // 3 of 5
    const rah = match('right-at-home-brisbane-bayside-south', c);
    expect(passes(rah, { coverage: 'most' })).toBe(true); // 4 of 5
    expect(passes(rah, { withinBudget: true })).toBe(false);
  });

  it('ranks providers for chosen services and compares one provider with the cheapest mix', () => {
    const c = ctx({ 'B8.1': choices('veteran') });
    const matches = ['bolton-clarke', 'right-at-home-brisbane-bayside-south', 'anglicare-southern-queensland', 'bluecare-unitingcare-qld'].map((id) => match(id, c));
    const items = plan.filter((i) => i.key === 'pc' || i.key === 'gardening');
    const rows = rankForServices(matches, items, bench);
    expect(rows[0].match.provider.id).toBe('bolton-clarke');
    expect(rows.slice(-2).map((r) => r.offered)).toEqual([1, 1]);
    const { single, mix } = bestCombinations(rows, items);
    expect(single).toMatchObject({ weekly: 126 * 3 + 113 * 0.5 });
    expect(mix?.label).toBe('Right at Home Brisbane Bayside South + Bolton Clarke');
    expect(mix?.weekly).toBe(116 * 3 + 113 * 0.5);
  });
});
