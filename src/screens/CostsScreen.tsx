import { servesArea } from '../area';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { usePlanCosts, type ProviderCost } from '../components/usePlanCosts';
import { PlanEditor } from '../components/PlanEditor';
import { PriceCell, PriceProvenance } from '../components/Price';
import { headline, type PlanCost } from '../calc';
import { RATE_KEYS } from '../schemas';
import { RATE_LABELS } from '../labels';
import { formatAud, formatDate, formatPercent, formatRate } from '../format';
import { toIsoDate } from '../rules';
import { DependencyCard, NextStepCard, ResolutionCard, ScreenHeader } from '../components/ui/Cards';
import { Explain, Term, WhyNumber, type WhyLine } from '../components/ui/Help';
import { StatusText } from '../components/ui/Status';
import { hoursText } from '../components/ui/Form';
import { Expander } from '../components/ui/Expander';
import { StatRow, StatTile } from '../components/ui/Visual';

type Scope = 'selected' | 'interview' | 'all';
type Period = 'quarter' | 'year' | 'week';
const PERIOD: Record<Period, { factor: number; word: string }> = {
  quarter: { factor: 1, word: 'a quarter' },
  year: { factor: 4, word: 'a year' },
  week: { factor: 1 / 13, word: 'a week' },
};

export function CostsScreen() {
  const { state, providers, seed, dispatch, serviceDate, plan, canEdit, areaPostcode } = useApp();
  const [scope, setScope] = useState<Scope>(state.selection.length > 0 ? 'selected' : 'all');
  const [period, setPeriod] = useState<Period>('quarter');
  const { factor, word } = PERIOD[period];

  const shown = useMemo(() => {
    const stageOf = new Map(state.selection.map((e) => [e.provider_id, e.stage]));
    // "All" means all in the applicant's area: providers that list other postcodes only are left out.
    if (scope === 'all') return providers.filter((p) => servesArea(p, areaPostcode) !== 'outside');
    return providers.filter((p) => (scope === 'interview' ? stageOf.get(p.id) === 'interview' : stageOf.has(p.id)));
  }, [providers, state.selection, scope, areaPostcode]);

  const { rates, budget, benchmark, byProvider } = usePlanCosts(shown);
  // A provider with no published price for any service in the plan would just repeat the guide price.
  const priced = byProvider.filter((r) => r.cost.lines.some((l) => l.hours_per_week > 0 && !l.filled_from_benchmark && l.price !== null));
  const unpublished = byProvider.filter((r) => !priced.includes(r));
  const top = headline(priced.map((r) => ({ name: r.provider.provider, quarterly_cost: r.cost.quarterly_cost })));
  const allOver = budget && priced.length > 0 && priced.every((r) => (r.cost.over_budget ?? 0) > 0);
  const money = (n: number) => formatAud(n * factor);

  return (
    <section className="space-y-6">
      <ScreenHeader title="Compare the cost of your care plan" purpose="See what your care plan would cost at each provider, and what you'd pay yourself." helpTopic="costs" />

      {!state.participant && (
        <DependencyCard to="/" action="Add your details" minutes={2}>
          To compare costs with your budget, we need your level and pension. Until then, costs show the full range of what people pay.
        </DependencyCard>
      )}

      {top && (
        <StatRow>
          <StatTile icon="arrowDown" label="Cheapest" value={money(top.cheapest.quarterly_cost)} sub={top.cheapest.name} highlight />
          <StatTile icon="arrowUp" label="Dearest" value={money(top.dearest.quarterly_cost)} sub={top.dearest.name} />
          <StatTile label="Difference" value={formatPercent(top.spread)} sub={`between cheapest and dearest, ${word}`} />
          {budget && <StatTile icon="dollar" label="Your services budget" value={money(budget.for_services)} sub={word} />}
        </StatRow>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="cost-scope" className="label">
            Providers to compare
          </label>
          <select id="cost-scope" className="input" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            <option value="selected">The ones on my list</option>
            <option value="interview">Providers to interview</option>
            <option value="all">{areaPostcode ? `All providers serving ${areaPostcode}` : 'All providers'}</option>
          </select>
        </div>
        <fieldset>
          <legend className="label">Show costs</legend>
          <div className="mt-1 flex flex-wrap gap-1">
            {(['week', 'quarter', 'year'] as Period[]).map((p) => (
              <button key={p} type="button" aria-pressed={period === p} className="btn" onClick={() => setPeriod(p)}>
                Per {p}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="cost-date" className="label">
            Services starting
          </label>
          <input id="cost-date" type="date" className="input" value={serviceDate} disabled={!canEdit} onChange={(e) => e.target.value && dispatch({ type: 'settings/serviceDate', date: e.target.value })} />
        </div>
        {canEdit && state.serviceDate && state.serviceDate !== toIsoDate(new Date()) && (
          <button type="button" className="btn" onClick={() => dispatch({ type: 'settings/serviceDate', date: null })}>
            Use today
          </button>
        )}
      </div>

      {allOver && (
        <ResolutionCard
          status="stop"
          title="Your plan costs more than your budget at every provider"
          moreLabel="What are my options?"
          more={
            <ul className="list-disc space-y-1 pl-6">
              <li>Lower the hours of services you could do without, or that family could help with (in "Your care plan" below).</li>
              <li>If you hold a DVA card, ask DVA whether Veterans' Home Care could cover cleaning, gardening or respite.</li>
              <li>Up to $1,000 or 10% of your budget can carry over each quarter. Ask your provider how much you have.</li>
              <li>If your needs have grown, ask My Aged Care about a reassessment.</li>
            </ul>
          }
        />
      )}

      <CostChart priced={priced} benchmark={benchmark} forServices={budget?.for_services ?? null} factor={factor} word={word} />

      {unpublished.length > 0 && (
        <ResolutionCard
          status="caution"
          title={`${unpublished.length} provider${unpublished.length === 1 ? " hasn't" : "s haven't"} published prices for your plan`}
          moreLabel="Which ones?"
          more={
            <p>
              {unpublished.map((r) => r.provider.provider).join(', ')}. They're left out of the comparison. Ask them to cost your plan at interview (question G7).
            </p>
          }
        />
      )}

      <PlanEditor />

      <section className="card space-y-3" aria-labelledby="pay-heading">
        <h2 id="pay-heading">What you'd pay</h2>
        <p>
          Plan cost and your <Term id="contribution">contribution</Term> at each provider, {word}.
        </p>
        {rates.basis !== 'fixed' && rates.basis !== 'assessed' && (
          <Explain question="Why a range?">
            <p>Until your exact contribution rates are known, we show the lowest and highest you could pay for your pension status.</p>
          </Explain>
        )}
        <div className="hidden overflow-x-auto md:block">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col" className="num">
                  Plan cost
                </th>
                <th scope="col" className="num">
                  Compared with your budget
                </th>
                <th scope="col" className="num">
                  You'd pay
                </th>
              </tr>
            </thead>
            <tbody>
              {priced.map((r) => (
                <CostRow key={r.provider.id} name={r.provider.provider} id={r.provider.id} cost={r.cost} factor={factor} word={word} special={!!r.provider.special_rates?.length} />
              ))}
              <CostRow name="Guide price (benchmark)" cost={benchmark} factor={factor} word={word} />
            </tbody>
          </table>
        </div>
        <ul className="space-y-3 md:hidden">
          {[...priced.map((r) => ({ name: r.provider.provider, id: r.provider.id as string | undefined, cost: r.cost, special: !!r.provider.special_rates?.length })), { name: 'Guide price (benchmark)', id: undefined, cost: benchmark, special: false }].map((r) => (
            <li key={r.name} className="well space-y-1">
              <h3>{r.id ? <Link to={`/providers/${r.id}`}>{r.name}</Link> : r.name}</h3>
              {r.special && <span className="chip chip-good">★ Includes special rates for you</span>}
              <p className="text-2xl font-semibold tabular-nums">
                <CostWhy name={r.name} cost={r.cost} factor={factor} word={word} />
              </p>
              <BudgetStatus cost={r.cost} factor={factor} word={word} />
              <p>You'd pay {payRange(r.cost, factor)} {word}</p>
              {r.cost.benchmark_filled.length > 0 && <StatusText status="caution">{r.cost.benchmark_filled.join(', ')} filled from guide price</StatusText>}
            </li>
          ))}
        </ul>
        <p className="muted">Costed for services from {formatDate(serviceDate)}. A quarter is 13 weeks.</p>
      </section>

      <Expander icon="dollar" title="Hourly prices compared with the guide price" summary={`${shown.length} provider${shown.length === 1 ? '' : 's'}: ▲ more than 5% above, ▼ more than 5% below`}>
        <p>
          Each provider's hourly price compared with the <Term id="benchmark">guide price</Term>.
        </p>
        <Explain question="What is the guide price?">
          <p>The price the Independent Health and Aged Care Pricing Authority (IHACPA) advises for 2026-27. It's advice, not a cap: providers set their own prices.</p>
        </Explain>
        <div className="hidden overflow-x-auto md:block">
          <table className="data-table min-w-[56rem]">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-[1] bg-[var(--sunken)]">
                  Provider
                </th>
                {RATE_KEYS.map((k) => (
                  <th key={k} scope="col" className="num">
                    {RATE_LABELS[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="sticky left-0 z-[1] bg-[var(--surface)] text-left font-normal">
                  Guide price
                </th>
                {RATE_KEYS.map((k) => (
                  <td key={k} className="num">
                    {formatRate(seed.benchmark[k])} /hr
                  </td>
                ))}
              </tr>
              {shown.map((p) => (
                <tr key={p.id}>
                  <th scope="row" className="sticky left-0 z-[1] bg-[var(--surface)] text-left font-normal">
                    <Link to={`/providers/${p.id}`}>{p.provider}</Link>
                    <span className="block">
                      <PriceProvenance provider={p} />
                    </span>
                  </th>
                  {RATE_KEYS.map((k) => (
                    <td key={k} className="num">
                      <PriceCell rate={p[k]} guide={seed.benchmark[k]} special={p.special_rates?.includes(k)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-3 md:hidden">
          {shown.map((p) => (
            <li key={p.id} className="well space-y-2">
              <h3>
                <Link to={`/providers/${p.id}`}>{p.provider}</Link>
              </h3>
              <PriceProvenance provider={p} />
              <dl className="space-y-2">
                {RATE_KEYS.filter((k) => plan.some((i) => i.key === k) || p[k] !== null).map((k) => (
                  <div key={k} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-t border-[var(--rule)] pt-2">
                    <dt>{RATE_LABELS[k]}</dt>
                    <dd className="min-w-0 text-right">
                      <PriceCell rate={p[k]} guide={seed.benchmark[k]} special={p.special_rates?.includes(k)} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </Expander>

      <NextStepCard
        done={priced.length ? `You've compared ${priced.length} provider${priced.length === 1 ? '' : 's'} on cost.` : 'Look through the providers near you.'}
        next="look at providers' details, flags and notes"
        back={{ to: '/bounding', label: 'What matters to you' }}
        forward={{ to: '/providers', label: 'Continue to providers' }}
      />
    </section>
  );
}

function costLines(cost: PlanCost, factor: number): WhyLine[] {
  return cost.lines.map((l) => ({
    label: l.service,
    working: l.price === null ? 'No price' : `${formatRate(l.price)} × ${hoursText(l.hours_per_week)} × ${factor === 1 ? '13 weeks' : factor === 4 ? '52 weeks' : '1 week'}`,
    value: formatAud(l.quarterly_cost * factor),
    note: l.filled_from_benchmark ? 'filled from guide price' : l.price === null ? 'not priced' : undefined,
  }));
}

function CostWhy({ name, cost, factor, word }: { name: string; cost: PlanCost; factor: number; word: string }) {
  const { budget } = usePlanCosts([]);
  const total: WhyLine[] = [{ label: 'Total', value: formatAud(cost.quarterly_cost * factor) }];
  if (budget && cost.over_budget !== null) {
    total.push({ label: 'Your services budget', value: formatAud(budget.for_services * factor) });
    total.push({ label: cost.over_budget > 0 ? 'Over budget by' : 'Under budget by', value: formatAud(Math.abs(cost.over_budget) * factor) });
  }
  return (
    <WhyNumber
      figure={
        <span>
          {formatAud(cost.quarterly_cost * factor)} <span className="text-base font-normal">{word}</span>
        </span>
      }
      title={`${name} — plan cost ${word}`}
      lines={costLines(cost, factor)}
      total={total}
      footer="A quarter is 13 weeks. Services with no published price use the guide price."
    />
  );
}

function BudgetStatus({ cost, factor, word }: { cost: PlanCost; factor: number; word: string }) {
  if (cost.over_budget === null) return <span className="muted">Add your level to compare with your budget</span>;
  return cost.over_budget > 0 ? (
    <StatusText status="stop">
      {formatAud(cost.over_budget * factor)} over budget {word}
    </StatusText>
  ) : (
    <StatusText status="good">
      {formatAud(-cost.over_budget * factor)} under budget {word}
    </StatusText>
  );
}

function CostRow({ name, id, cost, factor, word, special = false }: { name: string; id?: string; cost: PlanCost; factor: number; word: string; special?: boolean }) {
  return (
    <tr>
      <th scope="row" className="text-left font-normal">
        {id ? <Link to={`/providers/${id}`}>{name}</Link> : name}
        {special && (
          <span className="block">
            <span className="chip chip-good">★ Includes special rates for you</span>
          </span>
        )}
        {cost.benchmark_filled.length > 0 && (
          <span className="block">
            <StatusText status="caution">{cost.benchmark_filled.join(', ')} filled from guide price</StatusText>
          </span>
        )}
      </th>
      <td className="num">
        <CostWhy name={name} cost={cost} factor={factor} word={word} />
      </td>
      <td className="num">
        <BudgetStatus cost={cost} factor={factor} word={word} />
      </td>
      <td className="num">{payRange(cost, factor)}</td>
    </tr>
  );
}

const payRange = (c: PlanCost, f: number) => (Math.round(c.contrib_low * f) === Math.round(c.contrib_high * f) ? formatAud(c.contrib_low * f) : `${formatAud(c.contrib_low * f)} to ${formatAud(c.contrib_high * f)}`);

/**
 * Cost-vs-budget chart (UI-SPEC §6.7): one bar per provider, cheapest first, names beside the bars,
 * values printed on the bars, over-budget bars hatched and labelled, the budget as a labelled dashed line.
 */
function CostChart({ priced, benchmark, forServices, factor, word }: { priced: ProviderCost[]; benchmark: PlanCost; forServices: number | null; factor: number; word: string }) {
  const [asTable, setAsTable] = useState(false);
  const rows = [
    ...priced.map((r) => ({ name: r.provider.provider, cost: r.cost.quarterly_cost, guide: false })),
    { name: 'Benchmark (guide only)', cost: benchmark.quarterly_cost, guide: true },
  ].sort((a, b) => a.cost - b.cost);
  if (rows.every((r) => r.cost === 0)) return null;
  const max = Math.max(...rows.map((r) => r.cost), forServices ?? 0) * 1.02;
  const pct = (n: number) => `${(n / max) * 100}%`;

  return (
    <figure className="card space-y-3" aria-labelledby="chart-caption">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption id="chart-caption">
          <h2>Plan cost at each provider, {word}</h2>
        </figcaption>
        <button type="button" className="btn no-print" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
          {asTable ? 'Show as chart' : 'Show as table'}
        </button>
      </div>
      {forServices !== null && <p>The dashed line is your services budget. Bars past it are over budget.</p>}

      <div className={asTable ? 'hidden' : 'print:hidden'} aria-hidden={asTable}>
        <div className="relative space-y-3 pt-8">
          {forServices !== null && (
            <div className="pointer-events-none absolute inset-y-0 left-0 right-0 sm:left-[13rem]" aria-hidden>
              <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-[var(--charcoal)]" style={{ left: pct(forServices) }}>
                <span className="absolute -top-1 left-1 text-[0.875rem] font-semibold whitespace-nowrap" style={{ transform: forServices / max > 0.6 ? 'translateX(calc(-100% - 0.5rem))' : undefined }}>
                  Your services budget {formatAud(forServices * factor)}
                </span>
              </div>
            </div>
          )}
          {rows.map((r) => {
            const over = forServices !== null && r.cost > forServices;
            return (
              <div key={r.name} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[12.25rem_1fr]">
                <span className={`text-[0.95rem] leading-tight ${r.guide ? 'text-[var(--grey)]' : 'font-medium'}`}>{r.name}</span>
                <div className="relative h-9">
                  <div
                    className={`h-full rounded-r-[4px] ${r.guide ? 'bg-[var(--grey)]' : over ? 'hatch-stop-bg' : 'bg-[var(--charcoal)]'}`}
                    style={{ width: pct(r.cost) }}
                  />
                  <span className="absolute top-1/2 -translate-y-1/2 pl-2 text-[0.95rem] font-semibold whitespace-nowrap tabular-nums" style={{ left: pct(r.cost), transform: r.cost / max > 0.7 ? 'translate(calc(-100% - 0.75rem), -50%)' : undefined }}>
                    <span className={r.cost / max > 0.7 ? 'rounded bg-[var(--surface)] px-1' : ''}>
                      {formatAud(r.cost * factor)}
                      {over && ` · Over by ${formatAud((r.cost - forServices!) * factor)}`}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={asTable ? 'overflow-x-auto' : 'hidden overflow-x-auto print:block'}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col" className="num">
                Plan cost {word}
              </th>
              {forServices !== null && (
                <th scope="col" className="num">
                  Compared with your budget
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row" className="text-left font-normal">
                  {r.name}
                </th>
                <td className="num">{formatAud(r.cost * factor)}</td>
                {forServices !== null && (
                  <td className="num">
                    {r.cost > forServices ? <StatusText status="stop">Over by {formatAud((r.cost - forServices) * factor)}</StatusText> : <StatusText status="good">Under by {formatAud((forServices - r.cost) * factor)}</StatusText>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
