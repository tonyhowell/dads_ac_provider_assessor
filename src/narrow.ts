import type { Match, Verdict } from './matching';
import type { Provider } from './types';
import { mentionsDisallowedFees } from './flags';

// Narrowing the provider list (Find, basic and advanced): filters on what's known for every provider — distance,
// organisation type, size (government funding), compliance, the data we hold — with a count beside each choice.

export type OrgKind = 'nfp' | 'forprofit' | 'government' | 'other';
export const ORG_KINDS: { id: OrgKind; label: string }[] = [
  { id: 'nfp', label: 'Not-for-profit' },
  { id: 'forprofit', label: 'For-profit' },
  { id: 'government', label: 'Government' },
  { id: 'other', label: 'Not stated' },
];

/** "Not-for-profit (Religious)", "For-profit (Private)", "Government (State)"… */
export function orgKind(type: string | null | undefined): OrgKind {
  const t = (type ?? '').toLowerCase();
  if (/not[\s-]*for[\s-]*profit|\bnfp\b|charit|religious|community[\s-]*based/.test(t)) return 'nfp';
  if (/for[\s-]*profit|private|\bpty\b/.test(t)) return 'forprofit';
  if (/government|council|\bstate\b|local\s*gov/.test(t)) return 'government';
  return 'other';
}

/** Size by total Australian Government funding a year (across all the organisation's aged care services). */
export type SizeBand = 'small' | 'medium' | 'large' | 'very_large' | 'unknown';
export const SIZE_BANDS: { id: SizeBand; label: string; hint: string }[] = [
  { id: 'small', label: 'Small', hint: 'under $5 million a year' },
  { id: 'medium', label: 'Medium', hint: '$5–50 million' },
  { id: 'large', label: 'Large', hint: '$50–250 million' },
  { id: 'very_large', label: 'Very large', hint: 'over $250 million' },
  { id: 'unknown', label: 'Not known', hint: 'no funding figure' },
];
export function sizeBand(funding: number | null | undefined): SizeBand {
  if (funding === null || funding === undefined) return 'unknown';
  if (funding < 5e6) return 'small';
  if (funding < 50e6) return 'medium';
  if (funding < 250e6) return 'large';
  return 'very_large';
}
/** "$12.4m", "$310m", "$850k". */
export function fundingText(funding: number | null | undefined): string | null {
  if (funding === null || funding === undefined) return null;
  if (funding >= 1e9) return `$${(funding / 1e9).toFixed(1)}b`;
  if (funding >= 1e6) return `$${funding >= 1e8 ? Math.round(funding / 1e6) : (funding / 1e6).toFixed(1)}m`;
  return `$${Math.round(funding / 1e3)}k`;
}

export type ComplianceState = 'clean' | 'findings' | 'serious' | 'checking' | 'unchecked';

/** What we know about a provider beyond the match itself. */
export interface Facts {
  /** Kilometres to its nearest outlet (or served postcode); null when we don't know where it is. */
  km: number | null;
  /** Its listed service area includes home. */
  serves: boolean;
  compliance: ComplianceState;
  /** At least one published rate. */
  prices: boolean;
  /** What they say publicly has been checked. */
  claims: boolean;
  feeFlags: boolean;
  size: SizeBand;
  org: OrgKind;
}

export type DataHeld = 'prices' | 'claims' | 'compliance';

export interface NarrowFilters {
  /** Only providers with an outlet within this many km (null = any distance). */
  radiusKm: number | null;
  org: OrgKind[];
  sizes: SizeBand[];
  /** Checked, with no sanctions or non-compliance. */
  cleanRecord: boolean;
  /** Advanced: data we must hold. */
  data: DataHeld[];
  /** Advanced: quarterly cost at most (AUD). */
  maxQuarterly: number | null;
  /** Advanced: fit verdicts to show. */
  verdicts: Verdict[];
  /** Advanced: no extra fees mentioned on their price list. */
  noFeeFlags: boolean;
}

export const DEFAULT_NARROW: NarrowFilters = { radiusKm: null, org: [], sizes: [], cleanRecord: false, data: [], maxQuarterly: null, verdicts: [], noFeeFlags: false };
export const RADII = [5, 10, 20, 40] as const;

export function providerFacts(
  p: Provider,
  input: { km: number | null; serves: boolean; compliance?: { status: string; result: { findings: { kind: string }[] } | null } | undefined; claims: boolean },
): Facts {
  const findings = input.compliance?.status === 'ready' ? (input.compliance.result?.findings ?? []) : null;
  const compliance: ComplianceState =
    input.compliance?.status === 'running'
      ? 'checking'
      : findings === null
        ? 'unchecked'
        : findings.some((f) => f.kind === 'sanction' || f.kind === 'non_compliance')
          ? 'serious'
          : findings.length
            ? 'findings'
            : 'clean';
  const rates = [p.rn, p.en, p.pc, p.domestic, p.social, p.respite, p.gardening, p.care_mgmt];
  return {
    km: input.km,
    serves: input.serves,
    compliance,
    prices: rates.some((r) => r !== null && r !== undefined),
    claims: input.claims,
    feeFlags: p.flags.some((f) => mentionsDisallowedFees(f)),
    size: sizeBand(p.gov_funding),
    org: orgKind(p.type),
  };
}

type Key = keyof NarrowFilters;

/** Does it pass every filter (except `skip`, for counting the choices of that filter)? */
export function narrowPasses(m: Match, facts: Facts, f: NarrowFilters, skip?: Key): boolean {
  if (skip !== 'radiusKm' && f.radiusKm !== null && !(facts.km !== null ? facts.km <= f.radiusKm : facts.serves)) return false;
  if (skip !== 'org' && f.org.length && !f.org.includes(facts.org)) return false;
  if (skip !== 'sizes' && f.sizes.length && !f.sizes.includes(facts.size)) return false;
  if (skip !== 'cleanRecord' && f.cleanRecord && !(facts.compliance === 'clean' || facts.compliance === 'findings')) return false;
  if (skip !== 'data' && f.data.some((d) => (d === 'prices' ? !facts.prices : d === 'claims' ? !facts.claims : facts.compliance === 'unchecked' || facts.compliance === 'checking'))) return false;
  if (skip !== 'maxQuarterly' && f.maxQuarterly !== null && !(m.verdict !== 'quote' && m.cost.quarterly_cost <= f.maxQuarterly)) return false;
  if (skip !== 'verdicts' && f.verdicts.length && !f.verdicts.includes(m.verdict)) return false;
  if (skip !== 'noFeeFlags' && f.noFeeFlags && facts.feeFlags) return false;
  return true;
}

export interface Row {
  m: Match;
  facts: Facts;
}

/** How many would show if this filter were set to `value` (the other filters as they are). */
export function countWith<K extends Key>(rows: Row[], f: NarrowFilters, key: K, value: NarrowFilters[K], extra: (r: Row) => boolean = () => true): number {
  const next = { ...f, [key]: value };
  return rows.filter((r) => extra(r) && narrowPasses(r.m, r.facts, next)).length;
}

/** How many have this one choice of a multi-choice filter (ignoring that filter's other choices). */
export function countChoice(rows: Row[], f: NarrowFilters, key: 'org' | 'sizes' | 'data' | 'verdicts', value: string, extra: (r: Row) => boolean = () => true): number {
  return rows.filter((r) => extra(r) && narrowPasses(r.m, r.facts, { ...f, [key]: [value] })).length;
}

/** How many are still unknown to us in some way that bulk research would fill in. */
export const needsResearch = (facts: Facts) => !facts.prices || !facts.claims || facts.compliance === 'unchecked';

/** A rough cost for bulk research (US dollars): price list read, compliance check, public claims. */
export const RESEARCH_COST_EACH_USD = 0.25;
export const RESEARCH_MAX = 25;

/** In words: which narrowing filters hide this provider. */
export function narrowReasons(m: Match, facts: Facts, f: NarrowFilters): string[] {
  const out: string[] = [];
  if (f.radiusKm !== null && !narrowPasses(m, facts, { ...DEFAULT_NARROW, radiusKm: f.radiusKm })) out.push(facts.km === null ? 'Distance not known' : `Over ${f.radiusKm} km away`);
  if (f.org.length && !f.org.includes(facts.org)) out.push(ORG_KINDS.find((o) => o.id === facts.org)!.label);
  if (f.sizes.length && !f.sizes.includes(facts.size)) out.push(`Size: ${SIZE_BANDS.find((b) => b.id === facts.size)!.label.toLowerCase()}`);
  if (f.cleanRecord && !narrowPasses(m, facts, { ...DEFAULT_NARROW, cleanRecord: true })) out.push(facts.compliance === 'serious' ? 'Sanctions or non-compliance found' : 'Compliance record not checked yet');
  if (f.data.length && !narrowPasses(m, facts, { ...DEFAULT_NARROW, data: f.data })) out.push('Missing data you asked for');
  if (f.maxQuarterly !== null && !narrowPasses(m, facts, { ...DEFAULT_NARROW, maxQuarterly: f.maxQuarterly })) out.push('Over your cost limit');
  if (f.verdicts.length && !f.verdicts.includes(m.verdict)) out.push('Fit not in your choice');
  if (f.noFeeFlags && facts.feeFlags) out.push('Mentions extra fees');
  return out;
}
