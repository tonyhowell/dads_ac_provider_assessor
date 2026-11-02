import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { useFinderState, ModeSwitch } from './FindProvidersScreen';
import { ResearchControl } from '../components/Narrow';
import { MacSource } from '../components/MacImport';
import { ShortlistBar } from '../components/Finder';
import { VERDICT_SHORT, type MatchFilters, type Verdict } from '../matching';
import { countChoice, countWith, fundingText, ORG_KINDS, RADII, RESEARCH_MAX, SIZE_BANDS, type ComplianceState, type DataHeld, type NarrowFilters, type Row } from '../narrow';
import { formatAud } from '../format';

// Find, advanced (improvement plan: narrowing): every provider in the area in one sortable table, with filters
// down the side (each choice shows how many it leaves), bulk actions on the ones you tick, and saved views.

const PAGE = 50;
const VIEWS_KEY = 'sah-assessor:find-views';
type SortKey = 'provider' | 'km' | 'size' | 'fit' | 'cost' | 'record';
const FIT_ORDER: Record<Verdict, number> = { strong: 0, good: 1, partial: 2, weak: 3, unclear: 4, quote: 5 };
const RECORD_ORDER: Record<ComplianceState, number> = { clean: 0, findings: 1, checking: 2, unchecked: 3, serious: 4 };
const RECORD_WORDS: Record<ComplianceState, string> = { clean: 'Clean', findings: 'Minor findings', serious: 'Sanctions or non-compliance', checking: 'Checking…', unchecked: 'Not checked' };
const DATA: { id: DataHeld; label: string }[] = [
  { id: 'prices', label: 'Prices' },
  { id: 'claims', label: 'Public claims checked' },
  { id: 'compliance', label: 'Compliance checked' },
];

interface SavedView {
  name: string;
  narrow: NarrowFilters;
  filters: MatchFilters;
}
function readViews(): SavedView[] {
  try {
    const v = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeViews(views: SavedView[]) {
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  } catch {
    /* private mode: views just aren't kept */
  }
}

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

export function AdvancedFind() {
  const f = useFinderState();
  const { state, dispatch, canEdit } = useApp();
  const { watchPriceChecks } = useSession();
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fit', dir: 1 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [views, setViews] = useState<SavedView[]>(readViews);
  const [viewName, setViewName] = useState('');
  const n = f.narrow;
  const set = (patch: Partial<NarrowFilters>) => f.setNarrow({ ...n, ...patch });
  const shortlisted = new Set(state.selection.map((e) => e.provider_id));

  const sorted = useMemo(() => {
    const value = (r: Row): number | string => {
      switch (sort.key) {
        case 'provider':
          return r.m.provider.provider.toLowerCase();
        case 'km':
          return r.facts.km ?? Infinity;
        case 'size':
          return -(r.m.provider.gov_funding ?? -1);
        case 'fit':
          return FIT_ORDER[r.m.verdict] * 1000 - r.m.score;
        case 'cost':
          return r.m.verdict === 'quote' ? Infinity : r.m.cost.quarterly_cost;
        case 'record':
          return RECORD_ORDER[r.facts.compliance];
      }
    };
    return [...f.shownRows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [f.shownRows, sort]);
  const pickedRows = sorted.filter((r) => picked.has(r.m.provider.id));
  const allPicked = sorted.length > 0 && sorted.slice(0, limit).every((r) => picked.has(r.m.provider.id));

  const shortlistPicked = () => {
    const at = new Date().toISOString();
    for (const r of pickedRows) if (!shortlisted.has(r.m.provider.id)) dispatch({ type: 'selection/add', providerId: r.m.provider.id, at });
    watchPriceChecks();
  };
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const next = [...views.filter((v) => v.name !== name), { name, narrow: n, filters: f.filters }];
    setViews(next);
    writeViews(next);
    setViewName('');
  };
  const removeView = (name: string) => {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    writeViews(next);
  };

  const header = (key: SortKey, label: string, className = '') => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={className}>
      <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1>Find providers: advanced</h1>
        <p>Every provider in your area. Filter down the side, sort by any column, tick providers to check, shortlist or compare them.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ModeSwitch mode="advanced" />
        <span className="font-semibold" role="status">
          {sorted.length.toLocaleString('en-AU')} of {f.base.length.toLocaleString('en-AU')} shown
        </span>
      </div>

      <MacSource f={f} />
      <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="card space-y-4" aria-label="Filters">
          <Facet legend="Distance">
            {[null, ...RADII].map((km) => (
              <label key={km ?? 'any'} className="flex min-h-[var(--target-min)] items-center gap-3">
                <input type="radio" name="adv-radius" checked={n.radiusKm === km} onChange={() => set({ radiusKm: km })} />
                {km === null ? 'Any' : `Within ${km} km`} <span className="small">({countWith(f.base, n, 'radiusKm', km)})</span>
              </label>
            ))}
          </Facet>
          <Facet legend="Organisation">
            {ORG_KINDS.map((o) => (
              <Check key={o.id} label={o.label} count={countChoice(f.base, n, 'org', o.id)} checked={n.org.includes(o.id)} onChange={() => set({ org: toggle(n.org, o.id) })} />
            ))}
          </Facet>
          <Facet legend="Size (government funding)">
            {SIZE_BANDS.map((b) => (
              <Check key={b.id} label={`${b.label} · ${b.hint}`} count={countChoice(f.base, n, 'sizes', b.id)} checked={n.sizes.includes(b.id)} onChange={() => set({ sizes: toggle(n.sizes, b.id) })} />
            ))}
          </Facet>
          <Facet legend="Fit">
            {(Object.keys(VERDICT_SHORT) as Verdict[]).map((v) => (
              <Check key={v} label={VERDICT_SHORT[v]} count={countChoice(f.base, n, 'verdicts', v)} checked={n.verdicts.includes(v)} onChange={() => set({ verdicts: toggle(n.verdicts, v) })} />
            ))}
          </Facet>
          <Facet legend="Data we hold">
            {DATA.map((d) => (
              <Check key={d.id} label={d.label} count={countChoice(f.base, n, 'data', d.id)} checked={n.data.includes(d.id)} onChange={() => set({ data: toggle(n.data, d.id) })} />
            ))}
          </Facet>
          <Facet legend="Record and fees">
            <Check label="No sanctions or non-compliance" count={countWith(f.base, n, 'cleanRecord', true)} checked={n.cleanRecord} onChange={() => set({ cleanRecord: !n.cleanRecord })} />
            <Check label="No extra fees mentioned" count={countWith(f.base, n, 'noFeeFlags', true)} checked={n.noFeeFlags} onChange={() => set({ noFeeFlags: !n.noFeeFlags })} />
          </Facet>
          <Facet legend="Against your plan">
            <Check label="Within budget" count={f.base.filter((r) => r.m.cost.over_budget !== null && r.m.cost.over_budget <= 0 && r.m.verdict !== 'quote').length} checked={!!f.filters.withinBudget} onChange={() => f.setFilters({ ...f.filters, withinBudget: !f.filters.withinBudget })} />
            <Check label="No deal-breakers found" count={f.base.filter((r) => !r.m.cautions.some((c) => c.dealBreaker)).length} checked={!!f.filters.noDealBreakers} onChange={() => f.setFilters({ ...f.filters, noDealBreakers: !f.filters.noDealBreakers })} />
            <Check label="Veteran experience" checked={!!f.filters.veteran} onChange={() => f.setFilters({ ...f.filters, veteran: !f.filters.veteran })} />
            <label className="block pt-1">
              <span className="label">Most a quarter (AUD)</span>
              <input
                type="number"
                min={0}
                step={500}
                inputMode="numeric"
                className="input"
                value={n.maxQuarterly ?? ''}
                onChange={(e) => set({ maxQuarterly: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
              />
            </label>
          </Facet>
          <label className="flex min-h-[var(--target-min)] items-center gap-3">
            <input type="checkbox" checked={f.showOutside} onChange={(e) => f.setShowOutside(e.target.checked)} /> Include providers outside your area
          </label>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              f.setNarrow({ radiusKm: null, org: [], sizes: [], cleanRecord: false, data: [], maxQuarterly: null, verdicts: [], noFeeFlags: false });
              f.setFilters({ coverage: null, noDealBreakers: false, withinBudget: false, veteran: false });
            }}
          >
            Clear all filters
          </button>

          <div className="space-y-2 border-t border-[var(--rule)] pt-3">
            <p className="label">Saved views</p>
            {views.length === 0 && <p className="small">Save these filters to come back to them.</p>}
            <ul className="space-y-1">
              {views.map((v) => (
                <li key={v.name} className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      f.setNarrow({ ...n, ...v.narrow });
                      f.setFilters({ ...f.filters, ...v.filters });
                    }}
                  >
                    {v.name}
                  </button>
                  <button type="button" className="btn-quiet small" onClick={() => removeView(v.name)}>
                    Remove <span className="sr-only">view {v.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <label htmlFor="view-name" className="sr-only">
                Name for this view
              </label>
              <input id="view-name" className="input" placeholder="e.g. NFP within 20 km" value={viewName} onChange={(e) => setViewName(e.target.value)} />
              <button type="button" className="btn btn-sm" disabled={!viewName.trim()} onClick={saveView}>
                Save view
              </button>
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-3">
          {canEdit && (
            <div className="card flex flex-wrap items-center gap-3" aria-label="With the ticked providers">
              <span className="font-semibold">{pickedRows.length} ticked</span>
              <button type="button" className="btn btn-sm" disabled={!pickedRows.length} onClick={shortlistPicked}>
                Shortlist
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pickedRows.length < 2}
                onClick={() => {
                  shortlistPicked();
                  navigate('/compare');
                }}
              >
                Compare
              </button>
              <button type="button" className="btn-quiet small" disabled={!pickedRows.length} onClick={() => setPicked(new Set())}>
                Untick all
              </button>
              {pickedRows.length > 0 && (
                <div className="w-full">
                  {pickedRows.length > RESEARCH_MAX ? <p className="small">Tick {RESEARCH_MAX} or fewer to check them in one go.</p> : <ResearchControl rows={pickedRows} label="Check the ticked" />}
                </div>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">Providers, sortable by column</caption>
              <thead>
                <tr>
                  {canEdit && (
                    <th scope="col">
                      <input
                        type="checkbox"
                        aria-label="Tick all shown"
                        checked={allPicked}
                        onChange={() => setPicked(allPicked ? new Set() : new Set(sorted.slice(0, limit).map((r) => r.m.provider.id)))}
                      />
                    </th>
                  )}
                  {header('provider', 'Provider')}
                  {header('km', 'Distance')}
                  <th scope="col">Type</th>
                  {header('size', 'Size')}
                  {header('fit', 'Fit')}
                  {header('cost', 'A quarter')}
                  {header('record', 'Record')}
                  <th scope="col">Data</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, limit).map((r) => {
                  const p = r.m.provider;
                  return (
                    <tr key={p.id}>
                      {canEdit && (
                        <td>
                          <input type="checkbox" aria-label={`Tick ${p.provider}`} checked={picked.has(p.id)} onChange={() => setPicked((s) => new Set(s.has(p.id) ? [...s].filter((x) => x !== p.id) : [...s, p.id]))} />
                        </td>
                      )}
                      <th scope="row" className="font-normal">
                        <Link to={`/providers/${p.id}`}>{p.provider}</Link>
                        {shortlisted.has(p.id) && <span className="chip ml-1">Shortlisted</span>}
                      </th>
                      <td>{r.facts.km === null ? (r.facts.serves ? 'Serves you' : '—') : `${r.facts.km < 10 ? r.facts.km.toFixed(1) : Math.round(r.facts.km)} km`}</td>
                      <td>{ORG_KINDS.find((o) => o.id === r.facts.org)!.label}</td>
                      <td>
                        {SIZE_BANDS.find((b) => b.id === r.facts.size)!.label}
                        {fundingText(p.gov_funding) && <span className="small block">{fundingText(p.gov_funding)}</span>}
                      </td>
                      <td>{VERDICT_SHORT[r.m.verdict]}</td>
                      <td>{r.m.verdict === 'quote' ? 'Ask' : formatAud(r.m.cost.quarterly_cost)}</td>
                      <td>{RECORD_WORDS[r.facts.compliance]}</td>
                      <td className="small">{[r.facts.prices && 'prices', r.facts.claims && 'claims'].filter(Boolean).join(', ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sorted.length === 0 && <p className="card">No providers match these filters.</p>}
          {sorted.length > limit && (
            <button type="button" className="btn w-full" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, sorted.length - limit)} more of {sorted.length - limit}
            </button>
          )}
        </div>
      </div>
      <ShortlistBar />
    </section>
  );
}

function Facet({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Check({ label, count, checked, onChange }: { label: string; count?: number; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex min-h-[var(--target-min)] items-center gap-3">
      <input type="checkbox" checked={checked} onChange={onChange} disabled={!checked && count === 0} />
      <span>
        {label}
        {count !== undefined && <span className="small"> ({count})</span>}
      </span>
    </label>
  );
}
