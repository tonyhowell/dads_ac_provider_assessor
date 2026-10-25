import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { categoryFor } from '../calc';
import { RATE_KEYS } from '../schemas';
import { RATE_LABELS } from '../labels';
import type { Category, PlanItem, RateKey } from '../types';

const CATEGORY_LABELS: Record<Category, string> = { clinical: 'Clinical', independence: 'Independence', everyday: 'Everyday living' };

/** Weekly care plan. Changes save for the whole family when a field is left or a choice is made. */
export function PlanEditor() {
  const { state, dispatch, plan, serviceDate } = useApp();
  const [rows, setRows] = useState<PlanItem[]>(plan);
  useEffect(() => setRows(plan), [plan]);

  const commit = (next: PlanItem[]) => {
    setRows(next);
    dispatch({ type: 'plan/set', plan: next });
  };
  const update = (i: number, patch: Partial<PlanItem>, save = true) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (save) commit(next);
    else setRows(next);
  };

  return (
    <section className="card space-y-3" aria-labelledby="plan-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="plan-heading" className="font-semibold">
          Weekly care plan
        </h2>
        <span className="muted text-sm">{state.plan ? 'Edited plan' : 'Sample plan from the starter pack'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="text-left">
              <th scope="col" className="py-1 pr-2">Service</th>
              <th scope="col" className="py-1 pr-2">Priced as</th>
              <th scope="col" className="py-1 pr-2">Hours a week</th>
              <th scope="col" className="py-1 pr-2">Category</th>
              <th scope="col" className="py-1"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-200 align-top dark:border-slate-800">
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Service ${i + 1}`}
                    className="input"
                    value={r.service}
                    onChange={(e) => update(i, { service: e.target.value }, false)}
                    onBlur={() => commit(rows)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <select aria-label={`Rate for ${r.service || `service ${i + 1}`}`} className="input" value={r.key} onChange={(e) => update(i, { key: e.target.value as RateKey })}>
                    {RATE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {RATE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Hours a week for ${r.service || `service ${i + 1}`}`}
                    className="input max-w-24 tabular-nums"
                    type="number"
                    min={0}
                    step={0.25}
                    value={Number.isNaN(r.hours_per_week) ? '' : r.hours_per_week}
                    onChange={(e) => update(i, { hours_per_week: Math.max(0, Number(e.target.value)) }, false)}
                    onBlur={() => commit(rows)}
                  />
                </td>
                <td className="py-1 pr-2">
                  {r.key === 'pc' ? (
                    <span className="block py-2">
                      {CATEGORY_LABELS[categoryFor(r, serviceDate)]} <span className="muted">(set by date)</span>
                    </span>
                  ) : (
                    <select aria-label={`Category for ${r.service || `service ${i + 1}`}`} className="input" value={r.category} onChange={(e) => update(i, { category: e.target.value as Category })}>
                      {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="py-1">
                  <button type="button" className="btn" onClick={() => commit(rows.filter((_, j) => j !== i))}>
                    Remove <span className="sr-only">{r.service}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => commit([...rows, { service: 'New service', key: 'domestic', hours_per_week: 1, category: 'everyday' }])}>
          Add service
        </button>
        {state.plan && (
          <button type="button" className="btn" onClick={() => dispatch({ type: 'plan/set', plan: null })}>
            Reset to sample plan
          </button>
        )}
      </div>
      <p className="muted text-xs">Weekday rates; hourly services are charged in 15-minute steps and providers may set minimum visits.</p>
    </section>
  );
}
