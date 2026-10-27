import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { benchmarkCard } from '../calc';
import { bestCombinations, passes, rankForServices, VERDICT_SHORT, type Match, type MatchFilters, type ServiceMatch } from '../matching';
import { formatAud, formatRate } from '../format';
import { hoursText } from '../components/ui/Form';
import { Icon } from '../components/ui/Icon';
import { NextStepCard, ResolutionCard, ScreenHeader } from '../components/ui/Cards';
import { CheckAllClaims } from '../components/Claims';
import { FitMeter, InsightPanel, LevelIcon, priorityWords, ShortlistBar, ShortlistButton, useMatches, useParamLink, VerdictText } from '../components/Finder';
import { SIDE_PANEL_MIN, useMinWidth, usePhone } from '../components/useMinWidth';
import { ProvidersScreen } from './ProvidersScreen';
import type { PlanItem, RateKey } from '../types';

// "Find providers" (v4): one page, two ways to look — one provider for the whole plan, or the best provider
// for each service — with the insight panel beside every list. Phones get a reduced version: one thing per
// screen, words instead of scores, the top three first.

type View = 'plan' | 'service' | 'all';

export function FindProvidersScreen() {
  const [params] = useSearchParams();
  const view = params.get('view') as View | null;
  if (view === 'all') return <ProvidersScreen />;
  if (view === 'plan') return <WholePlan />;
  if (view === 'service') return <ByService />;
  return <Start />;
}

function Start() {
  const { plan, areaPostcode } = useApp();
  const phone = usePhone();
  const { matches, priorities, outside } = useMatches();
  const services = plan.filter((i) => i.hours_per_week > 0);
  return (
    <section className="space-y-6">
      {phone ? (
        <h1>Find providers</h1>
      ) : (
        <ScreenHeader title="Find providers that fit" purpose="Tell us how you'd like to look, and we'll rank providers against what you're looking for." helpTopic="providers" />
      )}
      <p>
        {matches.length} provider{matches.length === 1 ? '' : 's'} {areaPostcode ? `serve near ${areaPostcode}` : 'to look at'}
        {outside > 0 && !phone && ` (${outside} more outside your area)`}. How do you want to look?
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Link to="?view=plan" className="card btn-selected flex flex-col gap-1 no-underline">
          <span className="text-[1.25rem] font-bold">{phone ? 'One provider for everything' : 'One provider for my whole plan'}</span>
          <span>{phone ? `Best matches for all ${services.length} services` : `Providers that offer all or most of your ${services.length} services, best fit first, with the reasons why.`}</span>
          <span className="font-semibold text-[var(--good)]">{phone ? 'Recommended' : 'Recommended: Support at Home pays one provider'}</span>
        </Link>
        <Link to="?view=service" className="card flex flex-col gap-1 no-underline">
          <span className="text-[1.25rem] font-bold">{phone ? 'Best for one service' : 'The best provider for each service'}</span>
          <span>{phone ? 'Like personal care, one at a time' : 'Pick one or more services, compare who does each best, then build your list.'}</span>
        </Link>
      </div>
      {!phone && (
        <div className="card space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[1.2rem]">Your services</h2>
            <Link to="/costs">Change your plan</Link>
          </div>
          <p>{services.map((i) => `${i.service} ${hoursText(i.hours_per_week)}`).join(' · ')}</p>
        </div>
      )}
      <RankedOn priorities={priorities} />
      <p className="text-[0.95rem]">
        <Link to="?view=all">Look up a provider by name</Link>
      </p>
    </section>
  );
}

function RankedOn({ priorities }: { priorities: string[] }) {
  if (priorities.length === 0)
    return (
      <ResolutionCard status="info" title="Tell us what matters most" actions={<Link to="/bounding" className="btn">Choose what matters most</Link>}>
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
      . <Link to="/bounding">Change</Link>
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

function useFinderState() {
  const [filters, setFilters] = useState<MatchFilters>(DEFAULT_FILTERS);
  const [showOutside, setShowOutside] = useState(false);
  const found = useMatches(showOutside);
  const anyWithinBudget = found.matches.some((m) => m.verdict !== 'quote' && m.cost.over_budget !== null && m.cost.over_budget <= 0);
  const shown = found.matches.filter((m) => passes(m, filters));
  return { ...found, filters, setFilters, showOutside, setShowOutside, anyWithinBudget, shown, outside: found.outside };
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
  const ranked = f.shown.filter((m) => m.verdict !== 'quote');
  const quotes = f.shown.filter((m) => m.verdict === 'quote');
  const hidden = f.matches.length - f.shown.length;
  const selected = useSelected(f.shown);
  const closeTo = link({ p: null });

  if (selected && !side) {
    // One thing per screen below the side-panel width; phones get the reduced version.
    return <InsightPanel match={selected.match} position={selected.position} next={selected.next} closeTo={closeTo} compact={phone} />;
  }

  const visible = phone && !showAll ? ranked.slice(0, 3) : ranked;
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        {!phone && (
          <Link to="?" className="btn-quiet">
            <Icon name="arrowLeft" size={20} /> How you look
          </Link>
        )}
        <h1>{phone ? 'Your best matches' : 'Your best matches for the whole plan'}</h1>
        {!phone && <RankedOn priorities={f.priorities} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!phone && <ViewSwitch view="plan" />}
        {phone ? <QuickToggles {...f} /> : <Refine {...f} />}
        {!phone && <CheckAllClaims providerIds={f.matches.map((m) => m.provider.id)} />}
      </div>
      {!phone && f.priorities.length > 0 && ranked.filter((m) => !m.checked).length * 2 > ranked.length && (
        <p className="tone-info rounded-[var(--radius-control)] p-3">
          Most of these haven't been checked against what you're looking for yet, so many show “Not enough known”. Check what they say publicly to rank them properly.
        </p>
      )}
      {!f.anyWithinBudget && !phone && f.budget && <p className="text-[0.95rem]">All of them cost more than your budget at your planned hours.</p>}

      <div className={selected && side ? 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_26rem]' : ''}>
        <div className="space-y-3">
          <ol className="space-y-3" aria-label="Matches">
            {visible.map((m, i) => (
              <li key={m.provider.id}>{phone ? <PhoneCard match={m} /> : <MatchCard match={m} rank={i + 1} selected={selected?.match.provider.id === m.provider.id} />}</li>
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
                  <li key={m.provider.id}>{phone ? <PhoneCard match={m} /> : <MatchCard match={m} selected={selected?.match.provider.id === m.provider.id} />}</li>
                ))}
              </ul>
            </details>
          )}
          {ranked.length + quotes.length === 0 && <p className="card">No providers match these filters.</p>}
          {hidden > 0 && (
            <p className="text-[0.95rem]">
              {hidden} hidden by your filters.{' '}
              <button type="button" className="btn-quiet" onClick={() => f.setFilters({ coverage: null, noDealBreakers: false, withinBudget: false, veteran: false })}>
                Show them
              </button>
            </p>
          )}
        </div>
        {selected && side && (
          <div className="sticky top-4">
            <InsightPanel match={selected.match} position={selected.position} next={selected.next} closeTo={closeTo} />
          </div>
        )}
      </div>

      {!phone && (
        <NextStepCard
          done="Shortlist the providers worth a closer look."
          next="compare your shortlist and choose who to meet"
          back={{ to: '/costs', label: 'Compare costs' }}
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

function MatchCard({ match, rank, selected }: { match: Match; rank?: number; selected: boolean }) {
  const link = useParamLink();
  const p = match.provider;
  return (
    <article className={`card space-y-2 ${selected ? 'border-2 border-[var(--charcoal)] shadow-[inset_4px_0_0_var(--amber)]' : ''}`} aria-label={p.provider}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[1.25rem]">
          {rank && <span className="mr-2">{rank}</span>}
          <Link to={link({ p: p.id })}>{p.provider}</Link>
        </h2>
        <FitMeter match={match} />
      </div>
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
      <ServiceChips match={match} />
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

function PhoneCard({ match }: { match: Match }) {
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
      </span>
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
          <div className="space-y-3 lg:sticky lg:top-4">
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
