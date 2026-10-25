import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { PriceProvenance } from '../components/Price';
import { StageControls } from '../components/StageControls';
import { mentionsDisallowedFees } from '../flags';
import { STAGE_LABELS } from '../state/reducer';
import { SELECTION_STAGES } from '../schemas';
import type { SelectionStage } from '../types';

type SortKey = 'name' | 'notes';
type StageFilter = 'all' | 'none' | SelectionStage;

export function ProvidersScreen() {
  const { providers, state } = useApp();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const stageOf = useMemo(() => new Map(state.selection.map((e) => [e.provider_id, e.stage])), [state.selection]);

  const noteCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of state.notes) m.set(n.provider_id, (m.get(n.provider_id) ?? 0) + 1);
    return m;
  }, [state.notes]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = providers.filter(
      (p) =>
        (!q || [p.provider, p.outlet, p.type, ...p.flags].some((v) => v?.toLowerCase().includes(q))) &&
        (stageFilter === 'all' || (stageOf.get(p.id) ?? 'none') === stageFilter),
    );
    return filtered.sort((a, b) =>
      sort === 'notes'
        ? (noteCounts.get(b.id) ?? 0) - (noteCounts.get(a.id) ?? 0) || a.provider.localeCompare(b.provider)
        : a.provider.localeCompare(b.provider),
    );
  }, [providers, query, sort, noteCounts, stageFilter, stageOf]);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Providers</h1>
        <div className="flex gap-2">
          <Link to="/providers/new" className="btn no-underline hover:no-underline">
            Add provider
          </Link>
          <Link to="/providers/import" className="btn no-underline hover:no-underline">
            Import CSV
          </Link>
        </div>
      </div>
      <p className="muted mt-1">
        All providers that service the area. Add the ones worth a first look to the initial scan, then narrow them down on the{' '}
        <Link to="/selection">Selection</Link> page. Keep notes on each provider as you assess them.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor="provider-search" className="muted block">
            Search
          </label>
          <input
            id="provider-search"
            type="search"
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, outlet or flag"
          />
        </div>
        <div>
          <label htmlFor="provider-stage" className="muted block">
            Stage
          </label>
          <select id="provider-stage" className="input" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as StageFilter)}>
            <option value="all">All</option>
            <option value="none">Not selected</option>
            {SELECTION_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="provider-sort" className="muted block">
            Sort by
          </label>
          <select id="provider-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="notes">Most notes</option>
          </select>
        </div>
      </div>

      <p className="muted mt-3" aria-live="polite">
        {rows.length} of {providers.length} providers · {state.selection.length} selected
      </p>

      <ul className="mt-3 space-y-3">
        {rows.map((p) => (
          <li key={p.id} className="card flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">
                <Link to={`/providers/${p.id}`}>{p.provider}</Link>
              </h2>
              {(p.outlet || p.type) && <p className="muted">{[p.type, p.outlet].filter(Boolean).join(' · ')}</p>}
              <PriceProvenance provider={p} />
              {mentionsDisallowedFees(...p.flags) && (
                <p className="mt-1 text-sm font-medium text-orange-800 dark:text-orange-200">Check fees: mentions travel or admin charges</p>
              )}
              {p.flags.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1" aria-label="Flags">
                  {p.flags.map((f) => (
                    <li key={f} className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                      {f}
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted mt-1">
                {noteCounts.get(p.id) ?? 0} note{noteCounts.get(p.id) === 1 ? '' : 's'}
              </p>
            </div>
            <StageControls provider={p} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
