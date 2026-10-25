import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext';
import { categoryFor } from '../calc';
import { RATE_KEYS } from '../schemas';
import { RATE_LABELS } from '../labels';
import type { Category, PlanItem, RateKey } from '../types';
import { HoursStepper, hoursText } from './ui/Form';
import { Expander } from './ui/Expander';
import { Term } from './ui/Help';
import { Icon } from './ui/Icon';
import { ResolutionCard } from './ui/Cards';
import { useFieldHelp } from './ui/useFieldHelp';

export const CATEGORY_LABELS: Record<Category, string> = { clinical: 'Clinical', independence: 'Independence', everyday: 'Everyday living' };

/** Weekly care plan (UI-SPEC §7.4 section A). Changes save for the whole family. */
export function PlanEditor() {
  const { state, seed, dispatch, plan, serviceDate } = useApp();
  const fh = useFieldHelp();
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
    <Expander
      icon="list"
      title="Your care plan"
      summary={rows.length ? `${rows.length} service${rows.length === 1 ? '' : 's'} · ${hoursText(rows.reduce((n, r) => n + r.hours_per_week, 0))} a week${state.plan ? '' : ' (sample plan)'}` : 'Empty — add services to cost'}
      aside={<span className="no-print font-medium underline underline-offset-2">Change</span>}
      defaultOpen={rows.length === 0}
    >
      <p>The services you'd use each week. Change the hours to see how the cost changes.</p>

      {rows.length === 0 ? (
        <ResolutionCard
          status="info"
          title="Your care plan is empty, so there's nothing to cost yet"
          actions={
            <>
              <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'plan/set', plan: null })}>
                Start from the sample plan
              </button>
              <button type="button" className="btn" onClick={() => commit([{ service: 'Domestic assistance', key: 'domestic', hours_per_week: 1, category: 'everyday' }])}>
                Add a service
              </button>
            </>
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => {
            const cat = categoryFor(r, serviceDate);
            return (
              <li key={i} className="well space-y-3">
                <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
                  <div>
                    <label htmlFor={`svc-${i}`} className="label">
                      Service
                    </label>
                    <input id={`svc-${i}`} className="input" value={r.service} onChange={(e) => update(i, { service: e.target.value }, false)} onBlur={() => commit(rows)} />
                  </div>
                  <div>
                    <label htmlFor={`key-${i}`} className="label">
                      Priced as
                    </label>
                    <select id={`key-${i}`} className="input" value={r.key} onChange={(e) => update(i, { key: e.target.value as RateKey })}>
                      {RATE_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {RATE_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    {r.key === 'pc' ? (
                      <>
                        <p className="label">Kind of service</p>
                        <p className="py-2">{CATEGORY_LABELS[cat]}</p>
                        <p className="small">Personal care counts as Clinical (free) from 1 October 2026.</p>
                      </>
                    ) : (
                      <>
                        <label htmlFor={`cat-${i}`} className="label">
                          {i === 0 ? <Term id="categories">Kind of service</Term> : 'Kind of service'}
                        </label>
                        <select id={`cat-${i}`} className="input" value={r.category} onChange={(e) => update(i, { category: e.target.value as Category })}>
                          {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                            <option key={c} value={c}>
                              {CATEGORY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <label htmlFor={`hrs-${i}`} className="label">
                      Hours a week for {r.service || 'this service'}
                    </label>
                    {i === 0 && <span className="hint">{fh('hours').hint}</span>}
                    <HoursStepper id={`hrs-${i}`} label={`hours of ${r.service}`} value={r.hours_per_week} onChange={(v) => update(i, { hours_per_week: v })} />
                  </div>
                  <button type="button" className="btn btn-danger" onClick={() => commit(rows.filter((_, j) => j !== i))}>
                    <Icon name="octagon" size={20} /> Remove <span className="sr-only">{r.service}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {rows.length > 0 && (
          <button type="button" className="btn" onClick={() => commit([...rows, { service: 'New service', key: 'domestic', hours_per_week: 1, category: 'everyday' }])}>
            <Icon name="plus" size={20} /> Add a service
          </button>
        )}
        {state.plan && rows.length > 0 && (
          <button type="button" className="btn" onClick={() => dispatch({ type: 'plan/set', plan: null })}>
            Go back to the sample plan
          </button>
        )}
      </div>
      <p className="muted">
        Weekday prices. Hourly services are charged in 15-minute steps; providers may set minimum visit lengths. Sample plan: {seed.samplePlan.length} services.
      </p>
    </Expander>
  );
}
