import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { entriesAt } from '../state/reducer';
import { usePlanCosts } from '../components/usePlanCosts';
import { CRITERIA, effectiveWeights, failedMustQuestions, rank } from '../scoring';
import { formatAud, formatDate, formatDateTime, formatPercent } from '../format';
import { toIsoDate } from '../rules';
import { hoursText } from '../components/ui/Form';
import { CATEGORY_LABELS } from '../components/PlanEditor';
import { categoryFor } from '../calc';
import { Icon } from '../components/ui/Icon';

const STATUS: Record<string, string> = { full_pensioner: 'Full pensioner', part_pensioner: 'Part pensioner', self_funded: 'Self-funded' };
const CARD: Record<string, string> = { gold: 'DVA Gold Card', white: 'DVA White Card', none: 'No DVA card' };

/** One place to catch up on the decision (UI-SPEC §5.9). Printable. */
export function SummaryScreen() {
  const { state, seed, providers, plan, serviceDate } = useApp();
  const shortlist = entriesAt(state, 'interview').flatMap((e) => {
    const p = providers.find((x) => x.id === e.provider_id);
    return p ? [{ provider: p, entry: e }] : [];
  });
  const { budget, benchmark, byProvider, rates } = usePlanCosts(shortlist.map((s) => s.provider));
  const weights = effectiveWeights(state.weights);
  const ranked = rank(shortlist.map((s) => s.provider), state.scores, weights);
  const p = state.participant;
  const openNotes = state.screenNotes.filter((n) => !n.done);

  return (
    <article className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link to="/scoring" className="btn-quiet">
          <Icon name="arrowLeft" size={20} /> Back to scores
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>
      <header className="space-y-1">
        <h1>Decision summary</h1>
        <p>
          Support at Home provider choice{p?.name ? ` for ${p.name}` : ''} · prepared {formatDate(toIsoDate(new Date()))}
        </p>
      </header>

      <Section title="The situation">
        {p ? (
          <ul className="list-disc space-y-1 pl-6">
            <li>
              {p.suburb} {p.postcode} · {p.classification.startsWith('HCP') ? `Transitioned Home Care Package level ${p.classification.replace('HCP L', '')}` : `Support at Home level ${p.classification}`}
            </li>
            <li>
              {STATUS[p.pension_status]}
              {p.nwop ? ' · no-worse-off' : ''} · {CARD[p.dva_card]}
            </li>
            <li>
              Pays: Clinical 0% · Independence {range(rates.ind_low, rates.ind_high)} · Everyday living {range(rates.ev_low, rates.ev_high)}
            </li>
            {budget && (
              <li>
                Budget {formatAud(budget.quarterly)} a quarter; <strong>{formatAud(budget.for_services)}</strong> for services after care management
              </li>
            )}
          </ul>
        ) : (
          <p>Not set up yet.</p>
        )}
      </Section>

      <Section title="The care plan (each week)">
        <ul className="list-disc space-y-1 pl-6">
          {plan.map((i) => (
            <li key={i.service}>
              {i.service}: {hoursText(i.hours_per_week)} ({CATEGORY_LABELS[categoryFor(i, serviceDate)]})
            </li>
          ))}
        </ul>
        <p>At guide prices: {formatAud(benchmark.quarterly_cost)} a quarter.</p>
      </Section>

      <Section title="Providers interviewed">
        {shortlist.length === 0 ? (
          <p>None yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col" className="num">
                    Plan cost a quarter
                  </th>
                  <th scope="col" className="num">
                    You'd pay a quarter
                  </th>
                  <th scope="col" className="num">
                    Overall score
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => {
                  const c = byProvider.find((x) => x.provider.id === r.provider.id)!.cost;
                  const failed = failedMustQuestions(r.provider.id, seed.interviewSections, state.responses).length;
                  return (
                    <tr key={r.provider.id}>
                      <th scope="row" className="text-left font-normal">
                        {r.provider.provider}
                        {failed > 0 && <span className="block">✕ {failed} must-ask question{failed === 1 ? '' : 's'} not answered in writing</span>}
                      </th>
                      <td className="num">
                        {formatAud(c.quarterly_cost)}
                        {budget && <span className="block">{c.quarterly_cost > budget.for_services ? `over by ${formatAud(c.quarterly_cost - budget.for_services)}` : `under by ${formatAud(budget.for_services - c.quarterly_cost)}`}</span>}
                      </td>
                      <td className="num">{Math.round(c.contrib_low) === Math.round(c.contrib_high) ? formatAud(c.contrib_low) : `${formatAud(c.contrib_low)}–${formatAud(c.contrib_high)}`}</td>
                      <td className="num">{r.total === null ? '—' : `${r.total.toFixed(1)} / 5`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">Overall score weights: {CRITERIA.map((c) => `${c.label} ×${weights[c.id]}`).join(', ')}.</p>
      </Section>

      {shortlist.map(({ provider, entry }) => {
        const interviews = state.interviews.filter((i) => i.provider_id === provider.id && i.notes);
        if (!entry.why && !entry.watch && interviews.length === 0) return null;
        return (
          <Section key={provider.id} title={provider.provider}>
            {entry.why && <p>Why chosen: {entry.why}</p>}
            {entry.watch && <p>Watch for: {entry.watch}</p>}
            {interviews.map((i) => (
              <div key={i.id} className="space-y-1">
                <p className="font-semibold">Interview {formatDateTime(i.started_at)}</p>
                <p>{i.notes!.summary}</p>
                {i.notes!.concerns.length > 0 && <p>Concerns: {i.notes!.concerns.join('; ')}</p>}
              </div>
            ))}
          </Section>
        );
      })}

      <Section title="Decision">{state.decisionNotes ? <p className="whitespace-pre-wrap">{state.decisionNotes}</p> : <p>No decision recorded yet.</p>}</Section>

      {openNotes.length > 0 && (
        <Section title="Still open">
          <ul className="list-disc space-y-1 pl-6">
            {openNotes.map((n) => (
              <li key={n.id}>
                {n.text} <span className="muted">({n.author ?? 'family'}, {formatDateTime(n.created_at)})</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="small">
        General information only — not financial or legal advice. Prices as collected by the family; check with each provider, My Aged Care and DVA before deciding.
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card print-keep space-y-2">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const range = (lo: number, hi: number) => (lo === hi ? formatPercent(lo) : `${formatPercent(lo)}–${formatPercent(hi)}`);
