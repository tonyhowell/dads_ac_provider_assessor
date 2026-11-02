import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { benchmarkCard } from '../calc';
import { bestCombinations, passes, rankForServices, VERDICT_SHORT, type Match, type MatchFilters, type ServiceMatch } from '../matching';
import { formatAud, formatRate } from '../format';
import { hoursText } from '../components/ui/Form';
import { Icon } from '../components/ui/Icon';
import { NextStepCard, ResolutionCard } from '../components/ui/Cards';
import { CheckAllClaims } from '../components/Claims';
import { FitMeter, InsightPanel, LevelIcon, priorityWords, ShortlistBar, ShortlistButton, useMatches, useParamLink, VerdictText } from '../components/Finder';
import { SIDE_PANEL_MIN, useMinWidth, usePhone } from '../components/useMinWidth';
import { ProvidersScreen } from './ProvidersScreen';
import { servesArea } from '../area';
import { distanceText, useDistances, type Nearest } from '../geo';
import { DEFAULT_NARROW, narrowPasses, narrowReasons, providerFacts, type NarrowFilters, type Row } from '../narrow';
import { MapView } from '../components/MapView';
import { QuickReasons } from '../components/Shortlisting';
import { NarrowSteps } from '../components/Narrow';
import { MacSource } from '../components/MacImport';
import { AdvancedFind } from './AdvancedFind';
import type { PlanItem, RateKey } from '../types';

// "Find providers" (v4): one page, two ways to look — one provider for the whole plan, or the best provider
// for each service — with the insight panel beside every list. Phones get a reduced version: one thing per
// screen, words instead of scores, the top three first.

type View = 'plan' | 'service' | 'all' | 'filtered' | 'table';

export function FindProvidersScreen() {
  const [params] = useSearchParams();
  const view = params.get('view') as View | null;
  if (view === 'all') return <ProvidersScreen />;
  if (view === 'service') return <ByService />;
  if (view === 'filtered') return <FilteredOut />;
  if (view === 'table') return <AdvancedFind />;
  // Find opens on the map and the ranked list (improvement plan 2.1).
  return <WholePlan />;
}

function RankedOn({ priorities }: { priorities: string[] }) {
  if (priorities.length === 0)
    return (
      <ResolutionCard status="info" title="Tell us what matters most" actions={<Link to="/gather/matters" className="btn">Choose what matters most</Link>}>
        <p>We rank providers on your top three priorities. Until you choose them, we rank on prices only.</p>
      </ResolutionCard>
    );
  return (
    <p>
      Ranked on {priorityWords(priorities).map((w, i) => (
        <span key={w}>
          {i > 0 && (i === priorities.length - 1 ? ' and ' : ', ')}
          <b>{w.toLowerCase()}</b>
        </span>
      ))}
      . <Link to="/gather/matters">Change</Link>
    </p>
  );
}

function ViewSwitch({ view }: { view: 'plan' | 'service' }) {
  const link = useParamLink();
  return (
    <div role="group" aria-label="How to look" className="inline-flex">
      <Link to={link({ view: 'plan', p: null })} aria-current={view === 'plan' ? 'page' : undefined} className={`btn rounded-r-none ${view === 'plan' ? 'btn-selected' : ''}`}>
        Whole plan
      </Link>
      <Link to={link({ view: 'service', p: null })} aria-current={view === 'service' ? 'page' : undefined} className={`btn -ml-px rounded-l-none ${view === 'service' ? 'btn-selected' : ''}`}>
        By service
      </Link>
    </div>
  );
}

/** Basic (guided narrowing beside the ranked list) or advanced (the filter table). Not on phones. */
export function ModeSwitch({ mode }: { mode: 'basic' | 'advanced' }) {
  const link = useParamLink();
  return (
    <div role="group" aria-label="Find mode" className="inline-flex">
      <Link to={link({ view: null, p: null })} aria-current={mode === 'basic' ? 'page' : undefined} className={`btn rounded-r-none ${mode === 'basic' ? 'btn-selected' : ''}`}>
        Basic
      </Link>
      <Link to={link({ view: 'table', p: null })} aria-current={mode === 'advanced' ? 'page' : undefined} className={`btn -ml-px rounded-l-none ${mode === 'advanced' ? 'btn-selected' : ''}`}>
        Advanced
      </Link>
    </div>
  );
}

const DEFAULT_FILTERS: MatchFilters = { coverage: null, noDealBreakers: false, withinBudget: false, veteran: false };

const FILTER_WORDS: { key: keyof MatchFilters; label: string; value: MatchFilters[keyof MatchFilters] }[] = [
  { key: 'coverage', label: 'Prices for all services', value: 'all' },
  { key: 'coverage', label: 'Prices for all but one service', value: 'most' },
  { key: 'noDealBreakers', label: 'No deal-breakers found', value: true },
  { key: 'withinBudget', label: 'Within budget', value: true },
  { key: 'veteran', label: 'Veteran experience', value: true },
];

function Refine({ filters, setFilters, outside, showOutside, setShowOutside, anyWithinBudget }: RefineProps) {
  const [open, setOpen] = useState(false);
  const active = FILTER_WORDS.filter((f) => filters[f.key] === f.value);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" aria-expanded={open} aria-controls="refine-panel" onClick={() => setOpen(!open)}>
          Refine{active.length ? ` · ${active.length} on` : ''} <Icon name="chevronDown" size={18} />
        </button>
        {active.map((f) => (
          <button key={f.label} type="button" className="chip chip-outline min-h-[var(--target-min)]" onClick={() => setFilters({ ...filters, [f.key]: f.key === 'coverage' ? null : false })}>
            {f.label} <Icon name="close" size={16} />
            <span className="sr-only">: remove filter</span>
          </button>
        ))}
      </div>
      {open && (
        <div id="refine-panel" className="card grid gap-4 md:grid-cols-2">
          <fieldset>
            <legend className="label">Services</legend>
            {(
              [
                [null, 'Any'],
                ['most', 'Prices for all but one'],
                ['all', 'Prices for all of them'],
              ] as const
            ).map(([v, label]) => (
              <label key={label} className="flex min-h-[var(--target-min)] items-center gap-3">
                <input type="radio" name="coverage" checked={(filters.coverage ?? null) === v} onChange={() => setFilters({ ...filters, coverage: v })} /> {label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="label">Only show providers</legend>
            <label className="flex min-h-[var(--target-min)] items-center gap-3">
              <input type="checkbox" checked={!!filters.noDealBreakers} onChange={(e) => setFilters({ ...filters, noDealBreakers: e.target.checked })} /> With none of your deal-breakers found
            </label>
            <label className="flex min-h-[var(--target-min)] items-center gap-3">
              <input type="checkbox" checked={!!filters.veteran} onChange={(e) => setFilters({ ...filters, veteran: e.target.checked })} /> With veteran experience
            </label>
            {anyWithinBudget && (
              <label className="flex min-h-[var(--target-min)] items-center gap-3">
                <input type="checkbox" checked={!!filters.withinBudget} onChange={(e) => setFilters({ ...filters, withinBudget: e.target.checked })} /> Within your budget
              </label>
            )}
            {outside > 0 && (
              <label className="flex min-h-[var(--target-min)] items-center gap-3">
                <input type="checkbox" checked={showOutside} onChange={(e) => setShowOutside(e.target.checked)} /> Include {outside} outside your area
              </label>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}

interface RefineProps {
  filters: MatchFilters;
  setFilters: (f: MatchFilters) => void;
  outside: number;
  showOutside: boolean;
  setShowOutside: (v: boolean) => void;
  anyWithinBudget: boolean;
}

/** Phones: three quick toggles instead of the Refine panel. */
function QuickToggles({ filters, setFilters, anyWithinBudget }: Pick<RefineProps, 'filters' | 'setFilters' | 'anyWithinBudget'>) {
  const toggles: [string, boolean, () => void][] = [
    ['All services', filters.coverage === 'all', () => setFilters({ ...filters, coverage: filters.coverage === 'all' ? null : 'all' })],
    ['No deal-breakers', !!filters.noDealBreakers, () => setFilters({ ...filters, noDealBreakers: !filters.noDealBreakers })],
  ];
  if (anyWithinBudget) toggles.push(['Within budget', !!filters.withinBudget, () => setFilters({ ...filters, withinBudget: !filters.withinBudget })]);
  return (
    <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Quick filters">
      {toggles.map(([label, on, flip]) => (
        <button key={label} type="button" className="btn btn-sm whitespace-nowrap" aria-pressed={on} onClick={flip}>
          {on && <Icon name="check" size={16} />} {label}
        </button>
      ))}
    </div>
  );
}

const FILTERS_KEY = 'sah-assessor:find-filters';
function readFilters(): MatchFilters {
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_FILTERS;
  }
}

const NARROW_KEY = 'sah-assessor:find-narrow';
const SCOPE_KEY = 'sah-assessor:find-scope';
function readNarrow(): NarrowFilters {
  try {
    return { ...DEFAULT_NARROW, ...JSON.parse(sessionStorage.getItem(NARROW_KEY) ?? '{}') };
  } catch {
    return DEFAULT_NARROW;
  }
}
const keep = (key: string, value: unknown) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: filters just don't persist */
  }
};

/**
 * Filters (kept for this browser session, so basic, advanced and the filtered-out page agree), the facts behind
 * them for every provider in the area, and what they leave.
 */
export function useFinderState() {
  const { state, areaPostcode, nearPostcodes } = useApp();
  const { compliance, claims } = useSession();
  const [filters, setFiltersState] = useState<MatchFilters>(readFilters);
  const setFilters = (f: MatchFilters) => {
    setFiltersState(f);
    keep(FILTERS_KEY, f);
  };
  const [narrow, setNarrowState] = useState<NarrowFilters>(readNarrow);
  const setNarrow = (f: NarrowFilters) => {
    setNarrowState(f);
    keep(NARROW_KEY, f);
  };
  const [showOutside, setShowOutside] = useState(false);
  const back = useMemo(() => new Set(state.find.broughtBack), [state.find.broughtBack]);
  // Providers found on My Aged Care for this family: they serve the family's area (My Aged Care says so), and
  // Find starts from them unless the family chooses to see everyone in the catalogue.
  const macIds = useMemo(() => new Set(state.find.mac?.provider_ids ?? []), [state.find.mac?.provider_ids]);
  const [scopeChoice, setScopeState] = useState<'mac' | 'all'>(() => {
    try {
      return sessionStorage.getItem(SCOPE_KEY) === '"all"' ? 'all' : 'mac';
    } catch {
      return 'mac';
    }
  });
  const setScope = (v: 'mac' | 'all') => {
    setScopeState(v);
    keep(SCOPE_KEY, v);
  };
  const scope: 'mac' | 'all' = macIds.size ? scopeChoice : 'all';
  const found = useMatches(showOutside || back.size > 0 || macIds.size > 0);
  const anyWithinBudget = found.matches.some((m) => m.verdict !== 'quote' && m.cost.over_budget !== null && m.cost.over_budget <= 0);
  const inScope = (m: Match) => scope === 'all' || macIds.has(m.provider.id);
  const inArea = (m: Match) => inScope(m) && (macIds.has(m.provider.id) || showOutside || servesArea(m.provider, areaPostcode, nearPostcodes) !== 'outside');
  const allProviders = useMemo(() => found.matches.map((m) => m.provider), [found.matches]);
  const dist = useDistances(state.participant?.suburb ?? null, areaPostcode, allProviders);
  const rows: Row[] = useMemo(
    () =>
      found.matches.map((m) => ({
        m,
        facts: providerFacts(m.provider, {
          km: dist.near.get(m.provider.id)?.km ?? null,
          serves: macIds.has(m.provider.id) || servesArea(m.provider, areaPostcode, nearPostcodes) === 'serves',
          compliance: compliance.get(m.provider.id),
          claims: claims.get(m.provider.id)?.status === 'ready' && !!claims.get(m.provider.id)?.claims,
        }),
      })),
    [found.matches, dist.near, areaPostcode, nearPostcodes, compliance, claims, macIds],
  );
  /** In the area and through the match filters: what the narrowing filters (and their counts) work on. */
  const base = rows.filter((r) => inArea(r.m) && passes(r.m, filters));
  const shownRows = rows.filter((r) => back.has(r.m.provider.id) || (inArea(r.m) && passes(r.m, filters) && narrowPasses(r.m, r.facts, narrow)));
  const shown = shownRows.map((r) => r.m);
  return { ...found, filters, setFilters, narrow, setNarrow, showOutside, setShowOutside, anyWithinBudget, shown, shownRows, base, rows, dist, outside: found.outside, back, macIds, scope, setScope };
}

/** The selected provider (from `?p=`), its place in the list and the next one. */
function useSelected(list: Match[]) {
  const [params] = useSearchParams();
  const id = params.get('p');
  const i = list.findIndex((m) => m.provider.id === id);
  return i < 0 ? null : { match: list[i], position: `${i + 1} of ${list.length}`, next: list[i + 1] };
}

function WholePlan() {
  const phone = usePhone();
  const side = useMinWidth(SIDE_PANEL_MIN);
  const link = useParamLink();
  const f = useFinderState();
  const [showAll, setShowAll] = useState(false);
  const [phoneMap, setPhoneMap] = useState(false);
  const ranked = f.shown.filter((m) => m.verdict !== 'quote');
  const quotes = f.shown.filter((m) => m.verdict === 'quote');
  const hidden = f.matches.length - f.shown.length + f.outside;
  const selected = useSelected(f.shown);
  const closeTo = link({ p: null });
  const dist = f.dist;
  const mapProviders = useMemo(
    () => f.shown.map((m) => ({ id: m.provider.id, name: m.provider.provider, places: dist.places.get(m.provider.id) ?? [], selected: selected?.match.provider.id === m.provider.id })),
    [f.shown, dist.places, selected],
  );
  const navigate = useNavigate();
  const onSelect = useCallback((id: string) => navigate(link({ p: id })), [navigate, link]);
  const onMap = mapProviders.filter((p) => p.places.length).length;

  if (selected && !side) {
    // One thing per screen below the side-panel width; phones get the reduced version.
    return <InsightPanel match={selected.match} position={selected.position} next={selected.next} closeTo={closeTo} compact={phone} />;
  }

  const map = (
    <div className="space-y-2">
      <MapView home={dist.home} providers={mapProviders} onSelect={onSelect} label="Map of providers near home" />
      <p className="small">
        {onMap} of {f.shown.length} providers on the map, placed by suburb. {dist.home ? 'The white circle is home.' : 'Add your suburb and postcode in Gather to show home.'}
      </p>
    </div>
  );
  const visible = phone && !showAll ? ranked.slice(0, 3) : ranked;
  const card = (m: Match, rank?: number) =>
    phone ? (
      <PhoneCard match={m} distance={dist.near.get(m.provider.id) ?? null} broughtBack={f.back.has(m.provider.id)} />
    ) : (
      <MatchCard match={m} rank={rank} selected={selected?.match.provider.id === m.provider.id} distance={dist.near.get(m.provider.id) ?? null} broughtBack={f.back.has(m.provider.id)} />
    );

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1>{phone ? 'Your best matches' : 'Providers that fit your plan'}</h1>
        {!phone && <RankedOn priorities={f.priorities} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!phone && <ModeSwitch mode="basic" />}
        {!phone && <ViewSwitch view="plan" />}
        {phone ? <QuickToggles {...f} /> : <Refine {...f} />}
        {!phone && <CheckAllClaims providerIds={f.matches.map((m) => m.provider.id)} />}
        {phone && (
          <div role="group" aria-label="Show as" className="inline-flex">
            <button type="button" className="btn btn-sm rounded-r-none" aria-pressed={!phoneMap} onClick={() => setPhoneMap(false)}>
              List
            </button>
            <button type="button" className="btn btn-sm -ml-px rounded-l-none" aria-pressed={phoneMap} onClick={() => setPhoneMap(true)}>
              Map
            </button>
          </div>
        )}
      </div>
      {!phone && f.priorities.length > 0 && ranked.filter((m) => !m.checked).length * 2 > ranked.length && (
        <p className="tone-info rounded-[var(--radius-control)] p-3">
          Most of these haven't been checked against what you're looking for yet, so many show “Not enough known”. Check what they say publicly to rank them properly.
        </p>
      )}
      {!f.anyWithinBudget && !phone && f.budget && <p className="text-[0.95rem]">All of them cost more than your budget at your planned hours.</p>}
      <MacSource f={f} />
      {phone ? (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Narrow down ({f.shownRows.length} left)</summary>
          <div className="mt-3">
            <NarrowSteps f={f} />
          </div>
        </details>
      ) : (
        <NarrowSteps f={f} />
      )}

      {phone && phoneMap ? (
        map
      ) : (
        <div className={!phone ? 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_26rem]' : ''}>
          <div className="space-y-3">
            <ol className="space-y-3" aria-label="Matches">
              {visible.map((m, i) => (
                <li key={m.provider.id}>{card(m, i + 1)}</li>
              ))}
            </ol>
            {phone && !showAll && ranked.length > 3 && (
              <button type="button" className="btn w-full" onClick={() => setShowAll(true)}>
                Show {ranked.length - 3} more
              </button>
            )}
            {quotes.length > 0 && (phone ? showAll || ranked.length <= 3 : true) && (
              <details className="card" open={!phone && ranked.length === 0}>
                <summary className="cursor-pointer font-semibold">
                  {quotes.length} need{quotes.length === 1 ? 's' : ''} a quote — {quotes.map((m) => m.provider.provider).join(', ')}
                </summary>
                <ul className="mt-3 space-y-3">
                  {quotes.map((m) => (
                    <li key={m.provider.id}>{card(m)}</li>
                  ))}
                </ul>
              </details>
            )}
            {ranked.length + quotes.length === 0 && <p className="card">No providers match these filters.</p>}
            {hidden > 0 && (
              <p className="card flex flex-wrap items-center justify-between gap-2">
                <span>
                  {hidden} provider{hidden === 1 ? ' is' : 's are'} not shown: filtered out, outside your area, or a low match.
                </span>
                <Link to={link({ view: 'filtered', p: null })} className="btn">
                  See who and why
                </Link>
              </p>
            )}
            {!phone && (
              <p className="text-[0.95rem]">
                <Link to="?view=all">Look up a provider by name</Link>
              </p>
            )}
          </div>
          {!phone && (
            <div className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain" data-side-panel>
              {selected && side ? <InsightPanel match={selected.match} position={selected.position} next={selected.next} closeTo={closeTo} /> : map}
            </div>
          )}
        </div>
      )}

      {!phone && (
        <NextStepCard
          done="Shortlist the providers worth a closer look."
          next="compare your shortlist and choose who to meet"
          back={{ to: '/gather/brief', label: 'Your brief' }}
          forward={{ to: '/compare', label: 'Compare your shortlist' }}
        />
      )}
      <ShortlistBar />
    </section>
  );
}

function ServiceChips({ match }: { match: Match }) {
  return (
    <ul className="flex flex-wrap gap-1 text-[0.9rem]" aria-label="Services">
      {match.covered.map((s) => (
        <li key={s} className="chip chip-good">
          {s}
        </li>
      ))}
      {match.missing.map((s) => (
        <li key={s} className="chip chip-neutral">
          No price: {s}
        </li>
      ))}
    </ul>
  );
}

function MatchCard({ match, rank, selected, distance = null, broughtBack = false }: { match: Match; rank?: number; selected: boolean; distance?: Nearest | null; broughtBack?: boolean }) {
  const link = useParamLink();
  const p = match.provider;
  const where = distanceText(distance);
  return (
    <article className={`card space-y-2 ${selected ? 'border-2 border-[var(--charcoal)] shadow-[inset_4px_0_0_var(--amber)]' : ''}`} aria-label={p.provider}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[1.25rem]">
          {rank && <span className="mr-2">{rank}</span>}
          <Link to={link({ p: p.id })}>{p.provider}</Link>
        </h2>
        <FitMeter match={match} />
      </div>
      {(where || broughtBack) && (
        <p className="flex flex-wrap items-center gap-2 text-[0.95rem]">
          {where && (
            <span className="inline-flex items-center gap-1">
              <Icon name="pin" size={16} /> {where}
            </span>
          )}
          {broughtBack && <span className="chip chip-outline">Brought back</span>}
        </p>
      )}
      {match.reasons.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {match.reasons.map((r) => (
            <li key={r.priority} className="flex items-center gap-1">
              <LevelIcon level={r.level} /> {r.label}
            </li>
          ))}
        </ul>
      )}
      {match.cautions.map((c) => (
        <p key={c.text} className="flex items-center gap-1 text-[var(--caution)]">
          <Icon name="triangle" size={18} /> {c.dealBreaker ? 'One of your deal-breakers: extra fees' : 'Mentions extra fees'}
        </p>
      ))}
      <ComplianceLine providerId={p.id} />
      <ServiceChips match={match} />
      <QuickReasons providerId={p.id} compact />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{match.verdict === 'quote' ? 'No published prices' : <><b>{formatAud(match.cost.quarterly_cost)}</b> a quarter</>}</span>
        <div className="flex flex-wrap gap-2">
          <ShortlistButton match={match} />
          <Link to={link({ p: p.id })} className={`btn ${selected ? 'btn-selected' : ''}`} aria-current={selected ? 'true' : undefined}>
            Insight <span className="sr-only">: {p.provider}</span> <Icon name="chevronRight" size={18} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function PhoneCard({ match, distance = null, broughtBack = false }: { match: Match; distance?: Nearest | null; broughtBack?: boolean }) {
  const where = distanceText(distance);
  const link = useParamLink();
  const { state } = useApp();
  const on = state.selection.some((e) => e.provider_id === match.provider.id);
  return (
    <Link to={link({ p: match.provider.id })} className="card flex flex-col gap-1 text-[var(--charcoal)] no-underline">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[1.2rem] font-bold">{match.provider.provider}</span>
        <span className="whitespace-nowrap">
          <VerdictText verdict={match.verdict} short /> ›
        </span>
      </span>
      <span>{match.summary}</span>
      <span className="text-[0.95rem]">
        {match.verdict === 'quote' ? 'Needs a quote' : `${formatAud(match.cost.quarterly_cost)} a quarter`}
        {on && ' · Shortlisted'}
        {broughtBack && ' · Brought back'}
      </span>
      {where && <span className="text-[0.95rem]">{where}</span>}
    </Link>
  );
}

// ---- By service ----

function ByService() {
  const phone = usePhone();
  const side = useMinWidth(SIDE_PANEL_MIN);
  const { plan, seed, state, dispatch, canEdit } = useApp();
  const { watchPriceChecks } = useSession();
  const [params, setParams] = useSearchParams();
  const link = useParamLink();
  const f = useFinderState();
  const services = plan.filter((i) => i.hours_per_week > 0);
  const chosenKeys = (params.get('s') ?? '').split(',').filter((k) => services.some((i) => i.key === k)) as RateKey[];
  const keys: RateKey[] = chosenKeys.length ? (phone ? chosenKeys.slice(0, 1) : chosenKeys) : services.slice(0, 1).map((i) => i.key);
  const items = keys.map((k) => services.find((i) => i.key === k)!).filter(Boolean);
  const guide = useMemo(() => benchmarkCard(seed.benchmark), [seed.benchmark]);
  const rows = useMemo(() => rankForServices(f.shown, items, guide), [f.shown, items, guide]);
  const combos = useMemo(() => bestCombinations(rows, items), [rows, items]);
  const [showAll, setShowAll] = useState(false);
  const selected = useSelected(rows.map((r) => r.match));
  const closeTo = link({ p: null });
  const pickedCount = services.filter((i) => state.servicePicks[i.key]).length;

  const setKeys = (next: RateKey[]) => {
    const n = new URLSearchParams(params);
    n.set('s', next.join(','));
    n.delete('p');
    setParams(n);
    setShowAll(false);
  };
  const toggleKey = (k: RateKey) => setKeys(keys.includes(k) ? (keys.length > 1 ? keys.filter((x) => x !== k) : keys) : services.map((i) => i.key).filter((x) => x === k || keys.includes(x)));
  const pick = (key: RateKey, providerId: string | null) => {
    dispatch({ type: 'servicePick/set', key, providerId });
    if (providerId && !state.selection.some((e) => e.provider_id === providerId)) {
      dispatch({ type: 'selection/add', providerId, at: new Date().toISOString() });
      watchPriceChecks();
    }
  };

  if (selected && !side) {
    const row = rows.find((r) => r.match.provider.id === selected.match.provider.id)!;
    return (
      <InsightPanel
        match={selected.match}
        position={selected.position}
        next={selected.next}
        closeTo={closeTo}
        compact={phone}
        extra={!phone ? <ServicePrices row={row} /> : undefined}
      />
    );
  }

  const visible = phone && !showAll ? rows.slice(0, 3) : rows;
  const nextService = services.find((i) => !state.servicePicks[i.key] && !keys.includes(i.key)) ?? services[(services.findIndex((i) => i.key === keys[0]) + 1) % services.length];

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        {!phone && (
          <Link to="?" className="btn-quiet">
            <Icon name="arrowLeft" size={20} /> How you look
          </Link>
        )}
        <h1>{phone ? 'Best for one service' : 'The best provider for each service'}</h1>
        {!phone && <p>Pick one service, or several to compare together.</p>}
      </div>

      {phone ? (
        <div>
          <label htmlFor="service-pick" className="block text-[0.95rem]">
            Service {services.findIndex((i) => i.key === keys[0]) + 1} of {services.length} · {pickedCount} chosen
          </label>
          <select id="service-pick" className="input text-[1.3rem] font-bold" value={keys[0]} onChange={(e) => setKeys([e.target.value as RateKey])}>
            {services.map((i) => (
              <option key={i.key} value={i.key}>
                {i.service}
                {state.servicePicks[i.key] ? ' ✓' : ''}
              </option>
            ))}
          </select>
          <p className="mt-1">{hoursText(items[0].hours_per_week)} a week · best first</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ViewSwitch view="service" />
            <Refine {...f} />
          </div>
          <fieldset>
            <legend className="label">Services to compare</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {services.map((i) => (
                <button key={i.key} type="button" className="btn" aria-pressed={keys.includes(i.key)} onClick={() => toggleKey(i.key)}>
                  {keys.includes(i.key) && <Icon name="check" size={18} />} {i.service} · {hoursText(i.hours_per_week)}
                  {state.servicePicks[i.key] && !keys.includes(i.key) && <span className="text-[var(--good)]"> · chosen</span>}
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}

      <div className={!phone ? 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_26rem]' : ''}>
        <div className="space-y-3">
          <ol className="space-y-3" aria-label={`Providers for ${items.map((i) => i.service.toLowerCase()).join(' and ')}`}>
            {visible.map((r, i) => (
              <li key={r.match.provider.id}>
                <ServiceCard row={r} rank={i + 1} items={items} phone={phone} selected={selected?.match.provider.id === r.match.provider.id} pick={canEdit ? pick : undefined} />
              </li>
            ))}
          </ol>
          {phone && !showAll && rows.length > 3 && (
            <button type="button" className="btn w-full" onClick={() => setShowAll(true)}>
              Show {rows.length - 3} more
            </button>
          )}
          {phone && <p className="text-[0.95rem]">Support at Home pays one provider. If you mix, one arranges the others — ask about it at interview.</p>}
        </div>
        {!phone && (
          <div className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain" data-side-panel>
            {selected ? (
              <InsightPanel
                match={selected.match}
                position={selected.position}
                next={selected.next}
                closeTo={closeTo}
                extra={<ServicePrices row={rows.find((r) => r.match.provider.id === selected.match.provider.id)!} />}
              />
            ) : (
              <>
                {items.length > 1 && (combos.single || combos.mix) && (
                  <section className="card space-y-2" aria-labelledby="combos">
                    <h2 id="combos" className="text-[1.15rem]">
                      Best combinations
                    </h2>
                    {combos.single && (
                      <div className="rounded-[var(--radius-control)] border border-[var(--rule)] p-3">
                        <p className="font-semibold">{combos.single.label}</p>
                        <p>{formatAud(combos.single.weekly)} a week · one team</p>
                      </div>
                    )}
                    {combos.mix && (
                      <div className="rounded-[var(--radius-control)] border border-[var(--rule)] p-3">
                        <p className="font-semibold">{combos.mix.label}</p>
                        <p>
                          {formatAud(combos.mix.weekly)} a week{combos.single && ` · saves ${formatAud(combos.single.weekly - combos.mix.weekly)}`}
                        </p>
                        <p className="text-[var(--caution)]">One must agree to subcontract the other</p>
                      </div>
                    )}
                  </section>
                )}
                <p className="tone-info rounded-[var(--radius-control)] p-3">
                  Support at Home pays one provider. If you choose different providers per service, one becomes your main provider and arranges the others as subcontractors. Ask about
                  this at interview.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {phone ? (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 bg-[var(--header-bg)] px-4 py-3 text-[var(--on-dark)]">
          <span>
            <b>
              {pickedCount} of {services.length}
            </b>{' '}
            services chosen
          </span>
          {pickedCount === services.length || !nextService ? (
            <Link to="/compare" className="btn btn-primary">
              Compare ›
            </Link>
          ) : (
            <button type="button" className="btn btn-primary whitespace-nowrap" onClick={() => setKeys([nextService.key])}>
              Next service ›
            </button>
          )}
        </div>
      ) : (
        <ShortlistBar>
          <b>Your picks</b>
          {services.map((i) => {
            const id = state.servicePicks[i.key];
            const name = id && f.matches.find((m) => m.provider.id === id)?.provider.provider;
            return (
              <span key={i.key} className={`chip ${name ? 'bg-[var(--amber-tint)] text-[var(--charcoal)]' : 'border border-dashed border-[var(--on-dark-quiet)]'}`}>
                {i.service}: {name || 'not yet'}
              </span>
            );
          })}
        </ShortlistBar>
      )}
    </section>
  );
}

function ServicePrices({ row }: { row: ServiceMatch }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {row.prices.map((p) => (
        <li key={p.key} className="well text-[0.95rem]">
          {p.service}{' '}
          {p.rate === null ? (
            <span>· no published price</span>
          ) : (
            <>
              <b>{formatRate(p.rate)}/hr</b> <GuideDiff rate={p.rate} guide={p.guide} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function GuideDiff({ rate, guide }: { rate: number; guide: number | null }) {
  if (!guide) return null;
  const d = rate - guide;
  if (Math.abs(d) < 0.5) return <span>· at the guide</span>;
  return <span className={d > 0 ? 'text-[var(--caution)]' : 'text-[var(--good)]'}>· {d > 0 ? `${formatAud(d)} above` : `${formatAud(-d)} below`} the guide</span>;
}

function ServiceCard({
  row,
  rank,
  items,
  phone,
  selected,
  pick,
}: {
  row: ServiceMatch;
  rank: number;
  items: PlanItem[];
  phone: boolean;
  selected: boolean;
  pick?: (key: RateKey, providerId: string | null) => void;
}) {
  const { state } = useApp();
  const link = useParamLink();
  const m = row.match;
  const p = m.provider;
  const offered = items.filter((i) => p[i.key] !== null);
  const verdictFor = row.offered === 0 ? 'No published price' : row.offered < items.length ? `Prices ${row.offered} of ${items.length}` : null;

  const pickButtons = pick && offered.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {offered.map((i) => {
        const on = state.servicePicks[i.key] === p.id;
        return (
          <button key={i.key} type="button" className="btn btn-sm" aria-pressed={on} onClick={() => pick(i.key, on ? null : p.id)}>
            {on && <Icon name="check" size={16} />} {on ? 'Chosen' : 'Choose'}
            {(items.length > 1 || !phone) && ` for ${i.service.toLowerCase()}`}
            <span className="sr-only">: {p.provider}</span>
          </button>
        );
      })}
    </div>
  );

  if (phone) {
    const rate = p[items[0].key];
    return (
      <article className="card space-y-1" aria-label={p.provider}>
        <div className="flex items-baseline justify-between gap-2">
          <Link to={link({ p: p.id })} className="text-[1.2rem] font-bold">
            {p.provider}
          </Link>
          <span>{m.verdict === 'quote' ? 'Quote' : VERDICT_SHORT[m.verdict]}</span>
        </div>
        <p>{m.summary}</p>
        <div className="flex items-center justify-between gap-2">
          <span>{rate === null ? 'No published price' : <><b>{formatRate(rate)}</b> an hour</>}</span>
          {pickButtons}
        </div>
      </article>
    );
  }

  return (
    <article className={`card space-y-2 ${selected ? 'border-2 border-[var(--charcoal)] shadow-[inset_4px_0_0_var(--amber)]' : ''}`} aria-label={p.provider}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[1.2rem]">
          <span className="mr-2">{rank}</span>
          <Link to={link({ p: p.id })}>{p.provider}</Link>
        </h2>
        <span>
          {verdictFor ?? <VerdictText verdict={m.verdict} />}
          {m.verdict !== 'quote' && m.verdict !== 'unclear' && !verdictFor && <span> · {row.score}</span>}
        </span>
      </div>
      <p>{m.summary}</p>
      <ServicePrices row={row} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {pickButtons}
        <Link to={link({ p: p.id })} className={`btn btn-sm ${selected ? 'btn-selected' : ''}`}>
          Insight <span className="sr-only">: {p.provider}</span> <Icon name="chevronRight" size={16} />
        </Link>
      </div>
    </article>
  );
}

// ---- Who's not in the list, and why (improvement plan 2.3) ----

const FILTER_REASON: { key: keyof MatchFilters; test: (m: Match, f: MatchFilters) => boolean; words: string }[] = [
  { key: 'coverage', test: (m, f) => !passes(m, { coverage: f.coverage }), words: 'No published price for some of your services' },
  { key: 'noDealBreakers', test: (m, f) => !!f.noDealBreakers && !passes(m, { noDealBreakers: true }), words: 'Hidden because a deal-breaker was found' },
  { key: 'withinBudget', test: (m, f) => !!f.withinBudget && !passes(m, { withinBudget: true }), words: 'Costs more than your budget' },
  { key: 'veteran', test: (m, f) => !!f.veteran && !passes(m, { veteran: true }), words: 'No veteran experience found' },
];

function FilteredOut() {
  const { state, dispatch, canEdit, areaPostcode, nearPostcodes } = useApp();
  const link = useParamLink();
  const f = useFinderState();
  const all = useMatches(true).matches;
  const shownIds = new Set(f.shown.map((m) => m.provider.id));
  const providers = useMemo(() => all.map((m) => m.provider), [all]);
  const dist = useDistances(state.participant?.suburb ?? null, areaPostcode, providers);
  const bringBack = (id: string, back: boolean) => dispatch({ type: 'find/bringBack', providerId: id, back });

  const factsById = new Map(f.rows.map((r) => [r.m.provider.id, r.facts]));
  const groups: { id: string; title: string; why: string; rows: { m: Match; detail: string }[] }[] = [
    {
      id: 'filters',
      title: 'Hidden by your filters',
      why: 'The filters you set to narrow the list.',
      rows: all
        .filter((m) => !shownIds.has(m.provider.id))
        .flatMap((m) => {
          const facts = factsById.get(m.provider.id);
          const why = [...FILTER_REASON.filter((r) => r.test(m, f.filters)).map((r) => r.words), ...(facts ? narrowReasons(m, facts, f.narrow) : [])];
          return why.length ? [{ m, detail: why.join('; ') }] : [];
        }),
    },
    {
      id: 'dealbreakers',
      title: 'Deal-breakers found',
      why: 'Something you said would end it. Read the evidence and judge for yourself.',
      rows: all.flatMap((m) => {
        const c = m.cautions.filter((x) => x.dealBreaker);
        return c.length ? [{ m, detail: c.map((x) => x.text).join('; ') }] : [];
      }),
    },
    {
      id: 'outside',
      title: 'Outside your area',
      why: "Their service area doesn't include your postcode.",
      rows: all
        .filter((m) => servesArea(m.provider, areaPostcode, nearPostcodes) === 'outside')
        .sort((a, b) => (dist.near.get(a.provider.id)?.km ?? Infinity) - (dist.near.get(b.provider.id)?.km ?? Infinity))
        .map((m) => ({ m, detail: distanceText(dist.near.get(m.provider.id) ?? null) ?? `Doesn't list ${areaPostcode}` })),
    },
    {
      id: 'low',
      title: 'Low match',
      why: 'Ranked weak, or too little is known yet. A promising one may just need checking.',
      rows: all.filter((m) => m.verdict === 'weak' || m.verdict === 'unclear').map((m) => ({ m, detail: m.summary })),
    },
  ];

  return (
    <section className="space-y-6">
      <Link to={link({ view: null })} className="btn-quiet">
        <Icon name="arrowLeft" size={20} /> Providers that fit
      </Link>
      <div className="space-y-1">
        <h1>Who's not in your list, and why</h1>
        <p>Bring a provider back to put it in your list whatever the filters, so you can look closer or shortlist it.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {groups.map((g) => (
          <a key={g.id} href={`#group-${g.id}`} className="well no-underline">
            <span className="block text-[1.5rem] font-bold">{g.rows.length}</span>
            <span className="block">{g.title}</span>
          </a>
        ))}
      </div>
      {state.find.broughtBack.length > 0 && (
        <section aria-labelledby="group-back" className="card space-y-2">
          <h2 id="group-back" className="text-[1.2rem]">
            Brought back ({state.find.broughtBack.length})
          </h2>
          <ul className="space-y-2">
            {state.find.broughtBack.map((id) => {
              const m = all.find((x) => x.provider.id === id);
              if (!m) return null;
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={link({ view: null, p: id })}>{m.provider.provider}</Link>
                  {canEdit && (
                    <button type="button" className="btn btn-sm" onClick={() => bringBack(id, false)}>
                      Let the filters decide again <span className="sr-only">: {m.provider.provider}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.id} id={`group-${g.id}`} aria-labelledby={`h-${g.id}`} className="space-y-2">
          <h2 id={`h-${g.id}`} className="text-[1.2rem]">
            {g.title} ({g.rows.length})
          </h2>
          <p>{g.why}</p>
          {g.rows.length === 0 ? (
            <p className="card">None.</p>
          ) : (
            <ul className="space-y-2">
              {g.rows.slice(0, GROUP_LIMIT).map(({ m, detail }) => {
                const inList = shownIds.has(m.provider.id);
                return (
                  <li key={m.provider.id} className="card flex flex-wrap items-start justify-between gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{m.provider.provider}</span>
                      <span className="block">{detail}</span>
                      <span className="small block">
                        <VerdictText verdict={m.verdict} />
                        {m.verdict !== 'quote' && ` · ${formatAud(m.cost.quarterly_cost)} a quarter`}
                      </span>
                    </span>
                    {inList ? (
                      <Link to={link({ view: null, p: m.provider.id })} className="btn btn-sm">
                        In your list — open <span className="sr-only">: {m.provider.provider}</span>
                      </Link>
                    ) : (
                      canEdit && (
                        <button type="button" className="btn btn-sm" onClick={() => bringBack(m.provider.id, true)}>
                          Bring back <span className="sr-only">: {m.provider.provider}</span>
                        </button>
                      )
                    )}
                  </li>
                );
              })}
              {g.rows.length > GROUP_LIMIT && <li className="small">and {g.rows.length - GROUP_LIMIT} more{g.id === 'outside' ? ', further away' : ''}.</li>}
            </ul>
          )}
        </section>
      ))}
    </section>
  );
}

/** Most providers listed in each filtered-out group (the government list adds many far-away providers). */
const GROUP_LIMIT = 50;

/** A warning on the card when the Commission's record shows sanctions or non-compliance. */
function ComplianceLine({ providerId }: { providerId: string }) {
  const { compliance } = useSession();
  const serious = (compliance.get(providerId)?.result?.findings ?? []).filter((f) => f.kind === 'sanction' || f.kind === 'non_compliance').length;
  if (!serious) return null;
  return (
    <p className="flex items-center gap-1 text-[var(--caution)]">
      <Icon name="triangle" size={18} /> {serious} compliance finding{serious === 1 ? '' : 's'} from the Quality and Safety Commission
    </p>
  );
}
