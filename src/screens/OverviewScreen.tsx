import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { carryOverCap, lifetimeCap, yearsToCap } from '../calc';
import { usePlanCosts } from '../components/usePlanCosts';
import { formatAud, formatPercent } from '../format';
import { ruleAt } from '../rules';

const KEY_RULES: { title: string; body: string }[] = [
  { title: 'One provider', body: 'All Support at Home services come from one registered provider, which may subcontract.' },
  { title: 'Three contribution categories', body: 'Clinical (always 0%), Independence and Everyday living. Personal care moved to Clinical on 1 October 2026.' },
  { title: 'Care management', body: '10% of each quarterly budget goes to care management before services are paid for.' },
  { title: 'Carry-over', body: 'Unspent funds carry over, up to the greater of $1,000 or 10% of the quarterly budget.' },
  { title: 'No price caps', body: 'Government price caps were deferred indefinitely on 19 May 2026, so providers set their own prices. The IHACPA price is advice, not a cap.' },
  { title: 'All-inclusive prices', body: 'No separate travel, admin, package-management or exit fees. Disclosed mark-ups on purchased items are allowed.' },
  { title: 'Short-term budgets', body: 'Assistive technology and home modifications, the Restorative Care Pathway and the End-of-Life Pathway have separate budgets, not costed here.' },
];

export function OverviewScreen() {
  const { seed, serviceDate } = useApp();
  const { participant, budget, benchmark } = usePlanCosts([]);
  const cap = lifetimeCap(participant, serviceDate);
  const paid = participant?.lifetime_contributions_paid ?? 0;
  const annual = benchmark.contrib_high * 4;
  const years = yearsToCap(cap, paid, annual);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="muted mt-1">How Support at Home works, and what it means for {participant?.name || 'him'}. Rules as verified 25 Oct 2026.</p>
      </div>

      {!participant && (
        <p className="card">
          <Link to="/">Set up the participant</Link> to see their budget, contribution rates and lifetime cap.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {budget && (
          <section className="card space-y-2" aria-labelledby="ov-budget">
            <h2 id="ov-budget" className="font-semibold">
              Budget: {budget.classification.startsWith('HCP') ? budget.classification.replace('HCP L', 'Home Care Package level ') : `classification ${budget.classification}`}
            </h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
              <dt>Quarterly budget</dt>
              <dd className="text-right">{formatAud(budget.quarterly)}</dd>
              <dt>Care management (10%)</dt>
              <dd className="text-right">−{formatAud(budget.quarterly - budget.for_services)}</dd>
              <dt className="font-medium">Available for services each quarter</dt>
              <dd className="text-right font-medium">{formatAud(budget.for_services)}</dd>
              <dt>Annual budget</dt>
              <dd className="text-right">{formatAud(budget.annual)}</dd>
              <dt>Most that can carry over each quarter</dt>
              <dd className="text-right">{formatAud(carryOverCap(budget.quarterly, serviceDate))}</dd>
            </dl>
          </section>
        )}

        <section className="card space-y-2" aria-labelledby="ov-cap">
          <h2 id="ov-cap" className="font-semibold">
            Lifetime cap on contributions
          </h2>
          <p className="text-sm">
            Non-clinical contributions stop once the lifetime cap is reached. The cap is <strong>{formatAud(cap)}</strong>
            {participant?.nwop ? ' (no-worse-off)' : ''} as at 20 Sep 2026, indexed each 20 March and 20 September, and is shared with residential care.
          </p>
          {participant && (
            <p className="text-sm">
              Paid so far: {formatAud(paid)}. At benchmark prices, the current care plan would cost him up to {formatAud(annual)} a year, reaching the cap in{' '}
              <strong>{years === Infinity ? 'never (no contributions)' : years === 0 ? 'already reached' : `about ${years.toFixed(1)} years`}</strong>.
            </p>
          )}
        </section>
      </div>

      <section className="card space-y-2" aria-labelledby="ov-contrib">
        <h2 id="ov-contrib" className="font-semibold">
          Contribution rates by pension status
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th scope="col" className="py-1 pr-4">Status</th>
                <th scope="col" className="py-1 pr-4 text-right">Clinical</th>
                <th scope="col" className="py-1 pr-4 text-right">Independence</th>
                <th scope="col" className="py-1 text-right">Everyday living</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {seed.contributions.map((c) => (
                <tr key={c.status} className="border-t border-slate-200 dark:border-slate-800">
                  <th scope="row" className="py-1 pr-4 text-left font-normal">{c.status}</th>
                  <td className="py-1 pr-4 text-right">{formatPercent(c.clinical)}</td>
                  <td className="py-1 pr-4 text-right">{range(c.ind_low, c.ind_high)}</td>
                  <td className="py-1 text-right">{range(c.ev_low, c.ev_high)}</td>
                </tr>
              ))}
              {(() => {
                const n = ruleAt('nwopContributionBands', serviceDate);
                return (
                  <>
                    <tr className="border-t border-slate-200 dark:border-slate-800">
                      <th scope="row" className="py-1 pr-4 text-left font-normal">No-worse-off: full pensioner</th>
                      <td className="py-1 pr-4 text-right">0%</td>
                      <td className="py-1 pr-4 text-right">{range(n.full_pensioner.ind_low, n.full_pensioner.ind_high)}</td>
                      <td className="py-1 text-right">{range(n.full_pensioner.ev_low, n.full_pensioner.ev_high)}</td>
                    </tr>
                    <tr className="border-t border-slate-200 dark:border-slate-800">
                      <th scope="row" className="py-1 pr-4 text-left font-normal">No-worse-off: others</th>
                      <td className="py-1 pr-4 text-right">0%</td>
                      <td className="py-1 pr-4 text-right">{range(n.other.ind_low, n.other.ind_high)}</td>
                      <td className="py-1 text-right">{range(n.other.ev_low, n.other.ev_high)}</td>
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
        <p className="muted text-xs">Part pensioners pay an assessed rate within the range, set in their contribution letter.</p>
      </section>

      <section className="card" aria-labelledby="ov-rules">
        <h2 id="ov-rules" className="font-semibold">
          Key rules
        </h2>
        <dl className="mt-2 space-y-2">
          {KEY_RULES.map((r) => (
            <div key={r.title}>
              <dt className="font-medium">{r.title}</dt>
              <dd className="text-sm">{r.body}</dd>
            </div>
          ))}
        </dl>
      </section>
    </section>
  );
}

const range = (lo: number, hi: number) => (lo === hi ? formatPercent(lo) : `${formatPercent(lo)}–${formatPercent(hi)}`);
