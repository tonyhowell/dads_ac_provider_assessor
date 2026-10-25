import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../state/AppContext';
import { usePlanCosts, type ProviderCost } from '../components/usePlanCosts';
import { PlanEditor } from '../components/PlanEditor';
import { PriceProvenance } from '../components/Price';
import { headline, variance, varianceBand, type PlanCost } from '../calc';
import { RATE_KEYS } from '../schemas';
import { RATE_LABELS } from '../labels';
import { formatAud, formatDate, formatPercent, formatRate } from '../format';
import { toIsoDate } from '../rules';

type Scope = 'selected' | 'interview' | 'all';

export function CostsScreen() {
  const { state, providers, seed, dispatch, serviceDate } = useApp();
  const [scope, setScope] = useState<Scope>(state.selection.length > 0 ? 'selected' : 'all');

  const shown = useMemo(() => {
    const stageOf = new Map(state.selection.map((e) => [e.provider_id, e.stage]));
    if (scope === 'all') return providers;
    return providers.filter((p) => (scope === 'interview' ? stageOf.get(p.id) === 'interview' : stageOf.has(p.id)));
  }, [providers, state.selection, scope]);

  const { rates, budget, benchmark, byProvider } = usePlanCosts(shown);
  // A provider with no published rates for any service in the plan would just show the benchmark again.
  const priced = byProvider.filter((r) => r.cost.lines.some((l) => l.hours_per_week > 0 && !l.filled_from_benchmark && l.price !== null));
  const unpublished = byProvider.filter((r) => !priced.includes(r));
  const top = headline(priced.map((r) => ({ name: r.provider.provider, quarterly_cost: r.cost.quarterly_cost })));

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Relative costs</h1>
        <p className="muted mt-1">
          What the care plan would cost each quarter at each provider, against the budget for services and the IHACPA benchmark.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="cost-scope" className="muted block">
            Providers
          </label>
          <select id="cost-scope" className="input" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            <option value="selected">Selected (any stage)</option>
            <option value="interview">Interview shortlist</option>
            <option value="all">All providers</option>
          </select>
        </div>
        <div>
          <label htmlFor="cost-date" className="muted block">
            Services from
          </label>
          <input
            id="cost-date"
            type="date"
            className="input"
            value={serviceDate}
            onChange={(e) => e.target.value && dispatch({ type: 'settings/serviceDate', date: e.target.value })}
          />
        </div>
        {state.serviceDate && state.serviceDate !== toIsoDate(new Date()) && (
          <button type="button" className="btn" onClick={() => dispatch({ type: 'settings/serviceDate', date: null })}>
            Use today
          </button>
        )}
        <p className="muted text-sm">
          Contributions:{' '}
          {rates.basis === 'general'
            ? 'range from full pensioner to self-funded'
            : `Independence ${range(rates.ind_low, rates.ind_high)}, Everyday living ${range(rates.ev_low, rates.ev_high)}`}
          {!state.participant && (
            <>
              {' '}
              · <Link to="/">set up the participant</Link> for their rates and budget
            </>
          )}
        </p>
      </div>

      {top && (
        <section aria-label="Headline" className="grid gap-3 sm:grid-cols-3">
          <Stat label="Cheapest for this plan" value={formatAud(top.cheapest.quarterly_cost)} detail={top.cheapest.name} />
          <Stat label="Dearest for this plan" value={formatAud(top.dearest.quarterly_cost)} detail={top.dearest.name} />
          <Stat label="Spread" value={formatPercent(top.spread)} detail={`IHACPA benchmark: ${formatAud(benchmark.quarterly_cost)} a quarter`} />
        </section>
      )}

      <CostChart priced={priced} benchmark={benchmark} forServices={budget?.for_services ?? null} />

      {unpublished.length > 0 && (
        <p className="card text-sm">
          <strong>No published rates for this plan:</strong> {unpublished.map((r) => r.provider.provider).join(', ')}. Ask them to cost the sample plan (interview
          question G7).
        </p>
      )}

      <PlanEditor />

      <section className="card space-y-2" aria-labelledby="oop-heading">
        <h2 id="oop-heading" className="font-semibold">
          Cost and out-of-pocket contributions
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left">
                <th scope="col" className="py-1 pr-3">Provider</th>
                <th scope="col" className="py-1 pr-3 text-right">Plan cost a quarter</th>
                <th scope="col" className="py-1 pr-3 text-right">Against budget</th>
                <th scope="col" className="py-1 pr-3 text-right">He pays a quarter</th>
                <th scope="col" className="py-1 text-right">He pays a year</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {priced.map((r) => (
                <CostRow key={r.provider.id} name={<Link to={`/providers/${r.provider.id}`}>{r.provider.provider}</Link>} cost={r.cost} hasBudget={!!budget} />
              ))}
              <CostRow name={seed.benchmark.provider} cost={benchmark} hasBudget={!!budget} muted />
            </tbody>
          </table>
        </div>
        <p className="muted text-xs">
          Services with no published rate are priced at the benchmark and marked ◆. Costed for services from {formatDate(serviceDate)}.
        </p>
      </section>

      <section className="card space-y-2" aria-labelledby="var-heading">
        <h2 id="var-heading" className="font-semibold">
          Rates against the benchmark
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="text-left">
                <th scope="col" className="py-1 pr-3">Provider</th>
                {RATE_KEYS.map((k) => (
                  <th key={k} scope="col" className="py-1 pr-2 text-right">
                    {RATE_LABELS[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr className="border-t border-slate-200 dark:border-slate-800">
                <th scope="row" className="py-1 pr-3 text-left font-normal">
                  {seed.benchmark.provider}
                </th>
                {RATE_KEYS.map((k) => (
                  <td key={k} className="py-1 pr-2 text-right">
                    {formatRate(seed.benchmark[k])}
                  </td>
                ))}
              </tr>
              {shown.map((p) => (
                <tr key={p.id} className="border-t border-slate-200 align-top dark:border-slate-800">
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    <Link to={`/providers/${p.id}`}>{p.provider}</Link>
                    <span className="block text-xs">
                      <PriceProvenance provider={p} />
                    </span>
                  </th>
                  {RATE_KEYS.map((k) => {
                    const v = variance(p[k], seed.benchmark[k]);
                    const band = varianceBand(v);
                    return (
                      <td key={k} className="py-1 pr-2 text-right">
                        {p[k] === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <>
                            {formatRate(p[k])}
                            <span
                              className={`block text-xs ${
                                band === 'above' ? 'font-medium text-red-700 dark:text-red-300' : band === 'below' ? 'font-medium text-green-700 dark:text-green-300' : 'muted'
                              }`}
                            >
                              {v !== null && `${v > 0 ? '+' : ''}${formatPercent(v)}`}
                              {band === 'above' && <span className="sr-only"> above benchmark</span>}
                              {band === 'below' && <span className="sr-only"> below benchmark</span>}
                            </span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted text-xs">More than 5% above the benchmark is red, more than 5% below is green. — = not published.</p>
      </section>
    </section>
  );
}

function CostChart({ priced, benchmark, forServices }: { priced: ProviderCost[]; benchmark: PlanCost; forServices: number | null }) {
  const data = [
    ...priced.map((r) => ({ name: r.provider.provider, cost: r.cost.quarterly_cost, kind: 'provider' as const })),
    { name: 'IHACPA benchmark', cost: benchmark.quarterly_cost, kind: 'benchmark' as const },
  ].sort((a, b) => a.cost - b.cost);
  if (data.every((d) => d.cost === 0)) return null;
  const max = Math.max(...data.map((d) => d.cost), forServices ?? 0);
  const fill = (d: (typeof data)[number]) =>
    d.kind === 'benchmark' ? 'var(--chart-benchmark)' : forServices !== null && d.cost > forServices ? 'var(--chart-over)' : 'var(--chart-bar)';

  return (
    <figure className="card space-y-2" aria-labelledby="chart-caption">
      <figcaption id="chart-caption" className="font-semibold">
        Plan cost per quarter
        {forServices !== null && (
          <span className="muted block text-sm font-normal">
            Dashed line: {formatAud(forServices)} available for services. Bars past it are over budget.
          </span>
        )}
      </figcaption>
      <div style={{ height: Math.max(160, data.length * 44 + 40) }} className="text-xs text-slate-700 dark:text-slate-300">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 72, bottom: 8, left: 8 }} barCategoryGap={10}>
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" domain={[0, Math.ceil((max * 1.05) / 1000) * 1000]} tickFormatter={(v) => formatAud(v)} tick={{ fill: 'currentColor' }} stroke="var(--chart-grid)" />
            <YAxis type="category" dataKey="name" width={150} tick={{ fill: 'currentColor' }} stroke="var(--chart-grid)" interval={0} />
            <Tooltip
              cursor={{ fill: 'var(--chart-grid)', opacity: 0.5 }}
              formatter={(v) => [formatAud(Number(v)), 'Plan cost a quarter']}
              contentStyle={{ borderRadius: 6, fontSize: 12 }}
            />
            <Bar dataKey="cost" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.name} fill={fill(d)} />
              ))}
              <LabelList
                dataKey="cost"
                position="right"
                fill="currentColor"
                formatter={(v) => {
                  const n = Number(v);
                  return forServices !== null && n > forServices ? `${formatAud(n)} · over` : formatAud(n);
                }}
              />
            </Bar>
            {forServices !== null && <ReferenceLine x={forServices} stroke="var(--chart-line)" strokeDasharray="5 4" strokeWidth={1.5} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function CostRow({ name, cost, hasBudget, muted = false }: { name: ReactNode; cost: PlanCost; hasBudget: boolean; muted?: boolean }) {
  const over = cost.over_budget;
  return (
    <tr className={`border-t border-slate-200 dark:border-slate-800 ${muted ? 'text-slate-600 dark:text-slate-400' : ''}`}>
      <th scope="row" className="py-1 pr-3 text-left font-normal">
        {name}
        {cost.benchmark_filled.length > 0 && <span className="muted block text-xs">◆ {cost.benchmark_filled.join(', ')} at benchmark</span>}
        {cost.unpriced.length > 0 && <span className="block text-xs text-red-700 dark:text-red-300">No price for {cost.unpriced.join(', ')}</span>}
      </th>
      <td className="py-1 pr-3 text-right">{formatAud(cost.quarterly_cost)}</td>
      <td className="py-1 pr-3 text-right">
        {!hasBudget || over === null ? (
          <span className="muted">—</span>
        ) : over > 0 ? (
          <span className="font-medium text-orange-700 dark:text-orange-300">{formatAud(over)} over</span>
        ) : (
          <span>{formatAud(-over)} spare</span>
        )}
      </td>
      <td className="py-1 pr-3 text-right">{money(cost.contrib_low, cost.contrib_high)}</td>
      <td className="py-1 text-right">{money(cost.contrib_low * 4, cost.contrib_high * 4)}</td>
    </tr>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="card">
      <p className="muted text-sm">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="muted text-sm">{detail}</p>
    </div>
  );
}

const range = (lo: number, hi: number) => (lo === hi ? formatPercent(lo) : `${formatPercent(lo)}–${formatPercent(hi)}`);
const money = (lo: number, hi: number) => (Math.round(lo) === Math.round(hi) ? formatAud(lo) : `${formatAud(lo)}–${formatAud(hi)}`);
