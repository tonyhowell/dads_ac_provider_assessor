import type { ReactNode } from 'react';
import { useApp } from '../state/AppContext';
import { carryOverCap, lifetimeCap, yearsToCap } from '../calc';
import { usePlanCosts } from '../components/usePlanCosts';
import { formatAud, formatPercent, formatRate } from '../format';
import { DependencyCard, NextStepCard, ResolutionCard, ScreenHeader } from '../components/ui/Cards';
import { Explain, Term, WhyNumber } from '../components/ui/Help';
import { SourceLink } from '../components/Price';

const RECENT_RULES = [
  {
    title: 'Personal care is now free',
    date: '1 October 2026',
    body: 'Personal care moved into the Clinical category, so you pay nothing for it. Before 1 October it had an Independence contribution.',
    url: 'https://www.myagedcare.gov.au/news-and-updates/support-home-personal-care-contribution-changes',
  },
  {
    title: 'No government price caps for now',
    date: '19 May 2026',
    body: 'Planned price caps were put off indefinitely, so providers set their own prices. The guide price is advice, not a limit.',
    url: 'https://www.minterellison.com/articles/support-at-home-program-price-caps-deferred-indefinitely',
  },
];

export function OverviewScreen() {
  const { seed, serviceDate } = useApp();
  const { participant, budget, benchmark, rates } = usePlanCosts([]);
  const cap = lifetimeCap(participant, serviceDate);
  const paid = participant?.lifetime_contributions_paid ?? 0;
  const annual = benchmark.contrib_high * 4;
  const years = yearsToCap(cap, paid, annual);
  const guide = seed.benchmark;
  const careMgmt = budget ? budget.quarterly - budget.for_services : 0;
  const servicesShare = budget ? budget.for_services / budget.quarterly : 0;

  return (
    <section className="space-y-6">
      <ScreenHeader title="See your budget and the rules" purpose="How much you have for services each quarter, what you pay, and the rules behind those numbers." helpTopic="budget" />

      {!budget ? (
        <DependencyCard to="/" action="Add your level" minutes={2}>
          To show your budget we need your level from your My Aged Care approval letter.
        </DependencyCard>
      ) : (
        <section className="card space-y-4" aria-labelledby="budget-h">
          <h2 id="budget-h">Your budget each quarter</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Money for your services" value={formatAud(budget.for_services)} big />
            <Figure label="Quarterly budget" value={formatAud(budget.quarterly)} />
            <Figure label={<Term id="care-management">Care management (10%)</Term>} value={formatAud(careMgmt)} />
            <Figure label={<Term id="carry-over">Most that can carry over</Term>} value={formatAud(carryOverCap(budget.quarterly, serviceDate))} />
          </div>
          <div>
            <div className="flex h-10 overflow-hidden rounded-[var(--radius-control)] border border-[var(--line)]" role="img" aria-label={`Of your ${formatAud(budget.quarterly)} a quarter: ${formatAud(careMgmt)} care management, ${formatAud(budget.for_services)} for services`}>
              <div className="flex items-center bg-[var(--charcoal)] px-2 text-[var(--surface)]" style={{ width: `${servicesShare * 100}%` }}>
                <span className="truncate text-[0.875rem] font-medium">For services</span>
              </div>
              <div className="hatch-bg flex-1" />
            </div>
            <p className="mt-2">
              Of your {formatAud(budget.quarterly)} a quarter: <strong>{formatAud(careMgmt)}</strong> care management (shaded) · <strong>{formatAud(budget.for_services)}</strong> for services.
            </p>
          </div>
          <Explain question="Why is 10% taken off?">
            <p>Your provider keeps 10% of every quarterly budget for care management: planning your care, checking in and reviewing it. The rest pays for services.</p>
          </Explain>
        </section>
      )}

      <section className="card space-y-3" aria-labelledby="pay-h">
        <h2 id="pay-h">What you pay</h2>
        <p>
          You pay a share of each service's price, called your <Term id="contribution">contribution</Term>. It depends on the kind of service.
        </p>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[34rem]">
            <thead>
              <tr>
                <th scope="col">Kind of service</th>
                <th scope="col" className="num">
                  You pay
                </th>
                <th scope="col">For example</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="font-normal">
                  Clinical: nursing, and personal care
                </th>
                <td className="num font-semibold">0%</td>
                <td>Nothing for an hour of personal care.</td>
              </tr>
              <tr>
                <th scope="row" className="font-normal">
                  Independence: social support, respite
                </th>
                <td className="num font-semibold">{range(rates.ind_low, rates.ind_high)}</td>
                <td>{example('an hour of social support', guide.social, rates.ind_low, rates.ind_high)}</td>
              </tr>
              <tr>
                <th scope="row" className="font-normal">
                  Everyday living: cleaning, gardening
                </th>
                <td className="num font-semibold">{range(rates.ev_low, rates.ev_high)}</td>
                <td>{example('an hour of cleaning', guide.domestic, rates.ev_low, rates.ev_high)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">Examples use the guide price. {participant ? '' : 'Rates shown as a range until you add your pension status.'}</p>
      </section>

      <section className="card space-y-3" aria-labelledby="cap-h">
        <h2 id="cap-h">
          <Term id="lifetime-cap">Lifetime cap</Term>
        </h2>
        <p>
          You stop paying non-clinical contributions once you reach <strong>{formatAud(cap)}</strong>
          {participant?.nwop ? ' (no-worse-off cap)' : ''}. The cap is indexed each 20 March and 20 September and is shared with residential care.
        </p>
        {participant && (
          <p className="text-lg">
            At guide prices, your current care plan would reach the cap in{' '}
            <WhyNumber
              className="font-semibold"
              figure={<span>{years === Infinity ? 'never' : years === 0 ? 'already reached' : `about ${Math.round(years)} years`}</span>}
              title="Years until the lifetime cap"
              lines={[
                { label: 'Lifetime cap', value: formatAud(cap) },
                { label: 'Already paid', value: `−${formatAud(paid)}` },
                { label: 'Left to pay', value: formatAud(Math.max(0, cap - paid)) },
                { label: 'You pay a year (highest)', working: `${formatAud(benchmark.contrib_high)} a quarter × 4`, value: formatAud(annual) },
              ]}
              total={[{ label: 'Years to the cap', working: 'left to pay ÷ a year', value: years === Infinity ? 'never' : years.toFixed(1) }]}
              footer="Uses guide prices and the highest rate in your range."
            />
            .
          </p>
        )}
      </section>

      <section aria-labelledby="recent-h" className="space-y-3">
        <h2 id="recent-h">Rules that changed recently</h2>
        {RECENT_RULES.map((r) => (
          <ResolutionCard key={r.title} status="info" title={`${r.title} (from ${r.date})`}>
            <p>
              {r.body} <SourceLink url={r.url} />
            </p>
          </ResolutionCard>
        ))}
        <Explain question="What else should I know?">
          <ul className="list-disc space-y-1 pl-6">
            <li>
              All your services come from one provider (the <Term id="single-provider">single provider rule</Term>), which can subcontract.
            </li>
            <li>Prices must be all-inclusive: no separate travel, admin, package-management or exit fees.</li>
            <li>
              Equipment and home changes (<Term id="at-hm">AT-HM</Term>), restorative care and end-of-life care have separate budgets, not shown here.
            </li>
          </ul>
        </Explain>
      </section>

      <NextStepCard done="You've seen your budget and the rules." next="answer a few questions about what matters to you" back={{ to: '/', label: 'About you' }} forward={{ to: '/bounding', label: 'Continue to what matters' }} />
    </section>
  );
}

function Figure({ label, value, big = false }: { label: ReactNode; value: string; big?: boolean }) {
  return (
    <div className={big ? 'well' : ''}>
      <p>{label}</p>
      <p className={big ? 'figure' : 'text-2xl font-semibold tabular-nums'}>{value}</p>
      <p className="small">a quarter</p>
    </div>
  );
}

const range = (lo: number, hi: number) => (lo === hi ? formatPercent(lo) : `${formatPercent(lo)} to ${formatPercent(hi)}`);

function example(what: string, price: number | null, lo: number, hi: number) {
  if (price === null) return '—';
  const a = formatRate(price * lo);
  const b = formatRate(price * hi);
  return `For ${what} at ${formatRate(price)}, you'd pay ${a === b ? a : `${a} to ${b}`}.`;
}
