import type { BoundingAnswer, Claims, PlanItem, Provider, RateKey } from './types';
import type { PlanCost, RateCard } from './calc';
import { mentionsDisallowedFees } from './flags';
import { servesArea } from './area';
import { suggestedPriceScore } from './scoring';

// Finding providers (v4): rank providers against what the family is looking for, and say why.
// A fit is built only from things we can point to — the family's reviewed provider data, published
// prices, and the provider's own public claims. Anything we couldn't find scores nothing, but is
// never counted against the provider; the verdict says so when too little is known.

export const PRIORITY_IDS = ['continuity', 'price', 'clinical', 'flexibility', 'local', 'veteran'] as const;
export type PriorityId = (typeof PRIORITY_IDS)[number];

/** Short words for each priority, as the family chose them in "What I'm looking for" (B8.1). */
export const PRIORITY_LABELS: Record<PriorityId, string> = {
  continuity: 'The same workers',
  price: 'The lowest price',
  clinical: 'Strong nursing care',
  flexibility: 'Flexible times',
  local: 'A local organisation',
  veteran: 'Understanding of veterans',
};

/** Points for the first, second and third priority. */
export const PRIORITY_POINTS = [30, 25, 20];
export const COVERAGE_POINTS = 15;
export const PRICE_POINTS = 10;

/** Interview questions whose public claims count as evidence for each priority. */
const CLAIM_TOPICS: Record<Exclude<PriorityId, 'price'>, string[]> = {
  continuity: ['C1', 'C2', 'C5'],
  clinical: ['D1', 'D5', 'D3'],
  flexibility: ['A1', 'C6', 'G6'],
  local: ['A2', 'N3', 'L4'],
  veteran: ['E1', 'E2', 'E4', 'F1'],
};

export type Level = 'yes' | 'partly' | 'unknown' | 'no';
export type Verdict = 'strong' | 'good' | 'partial' | 'weak' | 'unclear' | 'quote';

export const VERDICT_WORDS: Record<Verdict, string> = {
  strong: 'Strong match',
  good: 'Good match',
  partial: 'Partial match',
  weak: 'Weak match',
  unclear: 'Not enough known',
  quote: 'Needs a quote',
};
/** One word, for phones. */
export const VERDICT_SHORT: Record<Verdict, string> = { strong: 'Strong', good: 'Good', partial: 'Partial', weak: 'Weak', unclear: 'Unknown', quote: 'Quote' };

export interface Source {
  kind: 'claim' | 'catalogue' | 'price' | 'area';
  title: string;
  url: string | null;
}

export interface Reason {
  priority: PriorityId;
  label: string;
  level: Level;
  /** What we found, in a few words. */
  detail: string;
  source: Source | null;
}

export interface Caution {
  text: string;
  /** True when it is one of the family's deal-breakers. */
  dealBreaker: boolean;
  source: Source | null;
}

export interface ScorePart {
  label: string;
  got: number;
  max: number;
}

export interface Match {
  provider: Provider;
  /** 0–100. */
  score: number;
  verdict: Verdict;
  reasons: Reason[];
  cautions: Caution[];
  parts: ScorePart[];
  /** Plan services with a published price. */
  covered: string[];
  /** Plan services without a published price (offered or not, we can't tell). */
  missing: string[];
  cost: PlanCost;
  /** One sentence: the strongest reasons, or what's missing. */
  summary: string;
  /** Claims have been checked for this provider. */
  checked: boolean;
}

export interface MatchContext {
  plan: PlanItem[];
  answers: Record<string, BoundingAnswer>;
  claims: Map<string, Claims | null>;
  benchmarkCost: PlanCost;
  areaPostcode: string | null;
}

/** The family's priorities in the order they chose them, and the deal-breakers they named. */
export function lookingForInputs(answers: Record<string, BoundingAnswer>) {
  const priorities = (answers['B8.1']?.choices ?? []).filter((c): c is PriorityId => (PRIORITY_IDS as readonly string[]).includes(c)).slice(0, 3);
  const dealBreakers = new Set([...(answers['B8.3']?.choices ?? []), ...(answers['B3.1']?.choices ?? [])]);
  return { priorities, dealBreakers };
}

const LEVEL_SHARE: Record<Level, number> = { yes: 1, partly: 0.5, unknown: 0, no: 0 };
const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;

function claimEvidence(claims: Claims | null | undefined, topics: string[]): { level: Level; detail: string; source: Source } | null {
  const items = (claims?.items ?? []).filter((i) => topics.includes(i.question_id));
  const best = items.find((i) => i.status === 'stated') ?? items[0];
  if (!best) return null;
  return {
    level: best.status === 'stated' ? 'yes' : 'partly',
    detail: best.claim,
    source: { kind: 'claim', title: best.source_title || 'Their website', url: best.source_url },
  };
}

const catalogue: Source = { kind: 'catalogue', title: 'Provider data', url: null };

/** What we can show for one priority at one provider. */
export function priorityReason(priority: PriorityId, provider: Provider, cost: PlanCost, ctx: MatchContext): Reason {
  const label = PRIORITY_LABELS[priority];
  const unknown = (detail: string): Reason => ({ priority, label, level: 'unknown', detail, source: null });
  if (priority === 'price') {
    const s = ctx.benchmarkCost.quarterly_cost > 0 && cost.benchmark_filled.length < cost.lines.length ? suggestedPriceScore(cost.quarterly_cost, ctx.benchmarkCost.quarterly_cost) : null;
    if (s === null) return unknown('No published prices for your services');
    const v = (cost.quarterly_cost - ctx.benchmarkCost.quarterly_cost) / ctx.benchmarkCost.quarterly_cost;
    const source: Source = { kind: 'price', title: 'Published prices', url: provider.source_url };
    if (s >= 4) return { priority, label, level: 'yes', detail: `${pct(v)} below the price guide for your plan`, source };
    if (s === 3) return { priority, label, level: 'partly', detail: 'Close to the price guide for your plan', source };
    return { priority, label, level: 'no', detail: `${pct(v)} above the price guide for your plan`, source };
  }
  const claim = claimEvidence(ctx.claims.get(provider.id), CLAIM_TOPICS[priority]);
  if (claim?.level === 'yes') return { priority, label, ...claim };
  const fit = provider.veteran_fit ?? '';
  let fromData: Reason | null = null;
  if (priority === 'veteran' && /^strong/i.test(fit)) fromData = { priority, label, level: 'yes', detail: fit.replace(/^strong:\s*/i, ''), source: catalogue };
  else if (priority === 'veteran' && /veteran|dva|rsl/i.test(fit) && !/ask about/i.test(fit)) fromData = { priority, label, level: 'partly', detail: fit, source: catalogue };
  else if (priority === 'continuity' && /continuity|same worker|chosen helper/i.test(fit)) fromData = { priority, label, level: 'partly', detail: fit, source: catalogue };
  else if (priority === 'local' && /\blocal\b/i.test(fit)) fromData = { priority, label, level: 'partly', detail: fit, source: catalogue };
  else if (priority === 'local' && servesArea(provider, ctx.areaPostcode) === 'serves')
    fromData = { priority, label, level: 'partly', detail: `Serves ${ctx.areaPostcode}`, source: { kind: 'area', title: 'Service area', url: null } };
  else if (priority === 'clinical' && provider.rn !== null && provider.en !== null)
    fromData = { priority, label, level: 'partly', detail: 'Publishes its own nurse prices', source: { kind: 'price', title: 'Published prices', url: provider.source_url } };
  if (fromData?.level === 'yes') return fromData;
  if (claim) return { priority, label, ...claim };
  return fromData ?? unknown(ctx.claims.get(provider.id) ? 'Not stated publicly — ask at interview' : 'Not checked yet');
}

/** Things to watch, with the family's deal-breakers marked. */
export function cautionsFor(provider: Provider, dealBreakers: Set<string>): Caution[] {
  const out: Caution[] = [];
  const feeFlag = provider.flags.find((f) => mentionsDisallowedFees(f));
  if (feeFlag) out.push({ text: `Mentions extra fees: ${feeFlag}`, dealBreaker: dealBreakers.has('fees'), source: catalogue });
  return out;
}

const SHORT_YES: Record<PriorityId, string> = {
  continuity: 'keeps the same workers',
  price: 'costs less than the price guide',
  clinical: 'has strong nursing',
  flexibility: 'offers flexible times',
  local: 'is local',
  veteran: 'understands veterans',
};

function sentence(m: Pick<Match, 'reasons' | 'cautions' | 'verdict' | 'missing' | 'covered' | 'checked'>): string {
  if (m.verdict === 'quote') return "Prices aren't published, so you'll need a quote.";
  const yes = m.reasons.filter((r) => r.level === 'yes').map((r) => SHORT_YES[r.priority]);
  const head = yes.length ? `Says it ${yes.slice(0, 2).join(' and ')}.` : m.checked ? 'Says little publicly about what matters to you.' : 'Not much is known yet.';
  const caution = m.cautions.find((c) => c.dealBreaker) ?? m.cautions[0];
  if (caution) return `${head} Watch: extra fees.`;
  if (m.missing.length) return `${head} No price for ${m.missing.length === 1 ? m.missing[0].toLowerCase() : `${m.missing.length} services`}.`;
  return head;
}

/** How well one provider fits the whole plan. */
export function matchProvider(provider: Provider, cost: PlanCost, ctx: MatchContext): Match {
  const { priorities, dealBreakers } = lookingForInputs(ctx.answers);
  const reasons = priorities.map((p) => priorityReason(p, provider, cost, ctx));
  const parts: ScorePart[] = reasons.map((r, i) => ({ label: r.label, got: PRIORITY_POINTS[i] * LEVEL_SHARE[r.level], max: PRIORITY_POINTS[i] }));
  const priced = ctx.plan.filter((i) => i.hours_per_week > 0);
  const covered = priced.filter((i) => provider[i.key] !== null).map((i) => i.service);
  const missing = priced.filter((i) => provider[i.key] === null).map((i) => i.service);
  parts.push({ label: 'Prices for your services', got: priced.length ? (COVERAGE_POINTS * covered.length) / priced.length : 0, max: COVERAGE_POINTS });
  if (!priorities.includes('price')) {
    const price = priorityReason('price', provider, cost, ctx);
    const s = price.level === 'unknown' ? 0 : (suggestedPriceScore(cost.quarterly_cost, ctx.benchmarkCost.quarterly_cost)! - 1) / 4;
    parts.push({ label: 'Price against the guide', got: PRICE_POINTS * s, max: PRICE_POINTS });
  }
  const got = parts.reduce((t, p) => t + p.got, 0);
  const max = parts.reduce((t, p) => t + p.max, 0);
  const score = max > 0 ? Math.round((got / max) * 100) : 0;
  const unknownWeight = reasons.reduce((t, r, i) => t + (r.level === 'unknown' ? PRIORITY_POINTS[i] : 0), 0);
  const priorityWeight = reasons.reduce((t, _r, i) => t + PRIORITY_POINTS[i], 0);
  const cautions = cautionsFor(provider, dealBreakers);
  const verdict: Verdict =
    covered.length === 0
      ? 'quote'
      : priorityWeight > 0 && unknownWeight * 2 > priorityWeight
        ? 'unclear'
        : score >= 80
          ? 'strong'
          : score >= 60
            ? 'good'
            : score >= 40
              ? 'partial'
              : 'weak';
  const checked = !!ctx.claims.get(provider.id);
  const m = { provider, score, verdict, reasons, cautions, parts, covered, missing, cost, checked, summary: '' };
  m.summary = sentence(m);
  return m;
}

const VERDICT_ORDER: Record<Verdict, number> = { strong: 0, good: 1, partial: 2, unclear: 3, weak: 4, quote: 5 };

/** Ranked whole-plan matches: best fit first, providers needing a quote last. */
export function rankMatches(matches: Match[]): Match[] {
  return [...matches].sort(
    (a, b) => Number(a.verdict === 'quote') - Number(b.verdict === 'quote') || b.score - a.score || VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.cost.quarterly_cost - b.cost.quarterly_cost,
  );
}

export interface MatchFilters {
  /** 'all': a price for every service; 'most': all but one. */
  coverage?: 'all' | 'most' | null;
  noDealBreakers?: boolean;
  withinBudget?: boolean;
  veteran?: boolean;
}

export function passes(m: Match, f: MatchFilters): boolean {
  const total = m.covered.length + m.missing.length;
  if (f.coverage === 'all' && m.missing.length > 0) return false;
  if (f.coverage === 'most' && m.covered.length < Math.max(1, total - 1)) return false;
  if (f.noDealBreakers && m.cautions.some((c) => c.dealBreaker)) return false;
  if (f.withinBudget && !(m.cost.over_budget !== null && m.cost.over_budget <= 0 && m.verdict !== 'quote')) return false;
  if (f.veteran && !/^strong/i.test(m.provider.veteran_fit ?? '') && !m.reasons.some((r) => r.priority === 'veteran' && r.level === 'yes')) return false;
  return true;
}

// ---- The best provider for each service ----

export interface ServicePrice {
  key: RateKey;
  service: string;
  hours_per_week: number;
  rate: number | null;
  guide: number | null;
}

export interface ServiceMatch {
  match: Match;
  prices: ServicePrice[];
  /** How many of the chosen services have a published price. */
  offered: number;
  /** Rank score for the chosen services: the provider's fit, plus its price for these services. */
  score: number;
  /** Weekly cost of the chosen services at published prices, or null if any is unpriced. */
  weekly: number | null;
}

/** Providers ranked for one or more chosen services. */
export function rankForServices(matches: Match[], items: PlanItem[], guide: RateCard): ServiceMatch[] {
  const rows = matches.map((match): ServiceMatch => {
    const prices = items.map((i) => ({ key: i.key, service: i.service, hours_per_week: i.hours_per_week, rate: match.provider[i.key], guide: guide[i.key] }));
    const offered = prices.filter((p) => p.rate !== null).length;
    const priced = prices.filter((p) => p.rate !== null && p.guide);
    const vs = priced.length ? priced.reduce((t, p) => t + (p.rate! - p.guide!) / p.guide!, 0) / priced.length : null;
    // 10% under the guide earns the full 10 points; 10% over earns none.
    const priceScore = vs === null ? 0 : Math.max(0, Math.min(10, 5 - vs * 50));
    const weekly = offered === prices.length ? prices.reduce((t, p) => t + p.rate! * p.hours_per_week, 0) : null;
    return { match, prices, offered, score: Math.round(match.score * 0.9 + priceScore), weekly };
  });
  return rows.sort((a, b) => b.offered - a.offered || b.score - a.score || (a.weekly ?? Infinity) - (b.weekly ?? Infinity));
}

export interface Combination {
  label: string;
  providers: { key: RateKey; provider: Provider }[];
  weekly: number;
}

/** One provider for every chosen service, against the cheapest mix. Null when there's nothing to compare. */
export function bestCombinations(rows: ServiceMatch[], items: PlanItem[]): { single: Combination | null; mix: Combination | null } {
  const good = (r: ServiceMatch) => ['strong', 'good'].includes(r.match.verdict);
  const singles = rows.filter((r) => r.weekly !== null);
  const bestSingle = singles.find(good) ?? singles[0];
  const single: Combination | null = bestSingle
    ? { label: `${bestSingle.match.provider.provider} for ${items.length > 1 ? 'all' : 'it'}`, providers: items.map((i) => ({ key: i.key, provider: bestSingle.match.provider })), weekly: bestSingle.weekly! }
    : null;
  const picks = items.map((i) => {
    const cheapest = rows
      .filter((r) => r.match.provider[i.key] !== null)
      .sort((a, b) => a.match.provider[i.key]! - b.match.provider[i.key]!)[0];
    return cheapest ? { key: i.key, provider: cheapest.match.provider, cost: cheapest.match.provider[i.key]! * i.hours_per_week } : null;
  });
  if (items.length < 2 || picks.some((p) => !p)) return { single, mix: null };
  const distinct = [...new Set(picks.map((p) => p!.provider.id))];
  if (distinct.length < 2) return { single, mix: null };
  const mix: Combination = {
    label: distinct.map((id) => picks.find((p) => p!.provider.id === id)!.provider.provider).join(' + '),
    providers: picks.map((p) => ({ key: p!.key, provider: p!.provider })),
    weekly: picks.reduce((t, p) => t + p!.cost, 0),
  };
  return { single, mix: single && mix.weekly >= single.weekly ? null : mix };
}
