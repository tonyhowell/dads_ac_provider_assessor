import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { PriceProvenance } from '../components/Price';
import { ShortlistToggle } from '../components/ShortlistToggle';

type SortKey = 'name' | 'notes';

export function ProvidersScreen() {
  const { seed, state } = useApp();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name');

  const noteCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of state.notes) m.set(n.provider_id, (m.get(n.provider_id) ?? 0) + 1);
    return m;
  }, [state.notes]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = seed.providers.filter(
      (p) => !q || [p.provider, p.outlet, p.type, ...p.flags].some((v) => v?.toLowerCase().includes(q)),
    );
    return filtered.sort((a, b) =>
      sort === 'notes'
        ? (noteCounts.get(b.id) ?? 0) - (noteCounts.get(a.id) ?? 0) || a.provider.localeCompare(b.provider)
        : a.provider.localeCompare(b.provider),
    );
  }, [seed.providers, query, sort, noteCounts]);

  return (
    <section>
      <h1 className="text-2xl font-semibold">Providers</h1>
      <p className="muted mt-1">
        All providers that service the area. Add the ones worth pursuing to your shortlist, and keep notes on each as you assess them.
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
        {rows.length} of {seed.providers.length} providers · {state.shortlist.length} shortlisted
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
            <ShortlistToggle provider={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}
