import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { assessedRatesValid, contributionRates } from '../calc';
import { dvaPrompts } from '../dva';
import { ruleAt } from '../rules';
import { formatAud, formatPercent } from '../format';
import type { Participant } from '../types';

type Status = 'full_pensioner' | 'part_pensioner' | 'self_funded';

const STATUS_LABELS: Record<Status, string> = {
  full_pensioner: 'Full pensioner',
  part_pensioner: 'Part pensioner or Commonwealth Seniors Health Card holder',
  self_funded: 'Self-funded retiree, or means not disclosed',
};

interface Draft {
  name: string;
  suburb: string;
  postcode: string;
  pension_status: Status;
  ind_pct: string;
  ev_pct: string;
  dva_card: Participant['dva_card'];
  nwop: boolean;
  classification: string;
  paid: string;
}

const toDraft = (p: Participant | null): Draft => ({
  name: p?.name ?? '',
  suburb: p?.suburb ?? '',
  postcode: p?.postcode ?? '',
  pension_status: (p?.pension_status as Status) ?? 'full_pensioner',
  ind_pct: p?.ind_rate != null ? String(+(p.ind_rate * 100).toFixed(2)) : '',
  ev_pct: p?.ev_rate != null ? String(+(p.ev_rate * 100).toFixed(2)) : '',
  dva_card: p?.dva_card ?? 'none',
  nwop: p?.nwop ?? false,
  classification: p?.classification ?? '',
  paid: p ? String(p.lifetime_contributions_paid) : '0',
});

const pct = (s: string) => (s.trim() === '' ? null : Number(s) / 100);

function toParticipant(d: Draft): Participant {
  return {
    id: 'participant',
    name: d.name.trim(),
    suburb: d.suburb.trim(),
    postcode: d.postcode.trim(),
    pension_status: d.pension_status,
    ind_rate: pct(d.ind_pct),
    ev_rate: pct(d.ev_pct),
    dva_card: d.dva_card,
    nwop: d.nwop,
    classification: d.classification,
    lifetime_contributions_paid: Number(d.paid) || 0,
  };
}

export function ParticipantScreen() {
  const { state, seed, dispatch, plan, serviceDate } = useApp();
  const [draft, setDraft] = useState<Draft>(() => toDraft(state.participant));
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };

  const participant = toParticipant(draft);
  const rates = contributionRates(participant, seed.contributions, serviceDate);
  const needsAssessedRates = draft.pension_status === 'part_pensioner' || (draft.nwop && draft.pension_status !== 'full_pensioner');
  const band = draft.nwop
    ? ruleAt('nwopContributionBands', serviceDate)[draft.pension_status === 'full_pensioner' ? 'full_pensioner' : 'other']
    : seed.contributions.find((c) => c.key === draft.pension_status)!;
  const ratesEntered = draft.ind_pct.trim() !== '' || draft.ev_pct.trim() !== '';
  const ratesInvalid = needsAssessedRates && ratesEntered && !assessedRatesValid(participant, band);

  const errors: string[] = [];
  if (!draft.suburb.trim()) errors.push('Enter the suburb.');
  if (!/^\d{4}$/.test(draft.postcode.trim())) errors.push('Enter a 4-digit postcode.');
  if (!draft.classification) errors.push('Choose the classification.');
  if (ratesInvalid) {
    errors.push(
      `Assessed rates must be within ${formatPercent(band.ind_low)}–${formatPercent(band.ind_high)} (Independence) and ${formatPercent(band.ev_low)}–${formatPercent(band.ev_high)} (Everyday living).`,
    );
  }
  if (Number(draft.paid) < 0 || Number.isNaN(Number(draft.paid))) errors.push('Contributions paid must be a dollar amount.');

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (errors.length) return;
    dispatch({ type: 'participant/set', participant });
    setSaved(true);
  };

  const budget = seed.budgets.find((b) => b.classification === draft.classification);
  const prompts = dvaPrompts(participant, plan);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Participant setup</h1>
        <p className="muted mt-1">
          The details that decide the budget and what he pays. Only what the calculations need is collected; the name is optional.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <form onSubmit={save} className="card space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="p-name" label="Name (optional)" className="sm:col-span-3">
              <input id="p-name" className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="First name or how the family refers to him" />
            </Field>
            <Field id="p-suburb" label="Suburb" className="sm:col-span-2">
              <input id="p-suburb" className="input" value={draft.suburb} onChange={(e) => set('suburb', e.target.value)} />
            </Field>
            <Field id="p-postcode" label="Postcode">
              <input id="p-postcode" className="input" inputMode="numeric" maxLength={4} value={draft.postcode} onChange={(e) => set('postcode', e.target.value)} />
            </Field>
          </div>

          <Field id="p-class" label="Classification (from the Notice of Decision)">
            <select id="p-class" className="input" value={draft.classification} onChange={(e) => set('classification', e.target.value)}>
              <option value="">Choose…</option>
              <optgroup label="Support at Home ongoing classifications">
                {seed.budgets.filter((b) => !b.classification.startsWith('HCP')).map((b) => (
                  <option key={b.classification} value={b.classification}>
                    Classification {b.classification} — {formatAud(b.quarterly)} a quarter
                  </option>
                ))}
              </optgroup>
              <optgroup label="Transitioned Home Care Package">
                {seed.budgets.filter((b) => b.classification.startsWith('HCP')).map((b) => (
                  <option key={b.classification} value={b.classification}>
                    {b.classification.replace('HCP L', 'Level ')} — {formatAud(b.quarterly)} a quarter
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>

          <fieldset className="space-y-2">
            <legend className="muted">Pension status (as assessed by DVA or Services Australia)</legend>
            {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
              <label key={s} className="flex items-start gap-2">
                <input type="radio" name="status" className="mt-1" checked={draft.pension_status === s} onChange={() => set('pension_status', s)} />
                <span>{STATUS_LABELS[s]}</span>
              </label>
            ))}
          </fieldset>

          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={draft.nwop} onChange={(e) => set('nwop', e.target.checked)} />
            <span>
              Approved for a Home Care Package on or before 12 September 2024
              <span className="muted block">The no-worse-off principle gives lower contribution rates and a lower lifetime cap.</span>
            </span>
          </label>

          {needsAssessedRates && (
            <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <legend className="px-1 font-medium">Assessed contribution rates</legend>
              <p className="muted">From the contribution letter (DVA assesses DVA pensioners). Leave blank until the letter arrives; costs then show the full range.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="p-ind" label={`Independence (${formatPercent(band.ind_low)}–${formatPercent(band.ind_high)})`}>
                  <PercentInput id="p-ind" value={draft.ind_pct} onChange={(v) => set('ind_pct', v)} invalid={ratesInvalid} />
                </Field>
                <Field id="p-ev" label={`Everyday living (${formatPercent(band.ev_low)}–${formatPercent(band.ev_high)})`}>
                  <PercentInput id="p-ev" value={draft.ev_pct} onChange={(v) => set('ev_pct', v)} invalid={ratesInvalid} />
                </Field>
              </div>
            </fieldset>
          )}

          <fieldset className="space-y-2">
            <legend className="muted">DVA card</legend>
            {(
              [
                ['gold', 'Gold Card'],
                ['white', 'White Card (specific conditions)'],
                ['none', 'No DVA card'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="dva" checked={draft.dva_card === v} onChange={() => set('dva_card', v)} />
                {label}
              </label>
            ))}
          </fieldset>

          <Field id="p-paid" label="Non-clinical contributions paid to date (aged care, lifetime)">
            <div className="flex items-center gap-1">
              <span aria-hidden>$</span>
              <input id="p-paid" className="input max-w-40" inputMode="decimal" value={draft.paid} onChange={(e) => set('paid', e.target.value)} />
            </div>
          </Field>

          {errors.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300" aria-live="polite">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={errors.length > 0}>
              Save participant
            </button>
            {saved && (
              <span role="status" className="text-sm">
                Saved. <Link to="/costs">See relative costs</Link>
              </span>
            )}
          </div>
        </form>

        <aside className="space-y-4" aria-label="What this means">
          <section className="card space-y-2" aria-labelledby="rates-heading">
            <h2 id="rates-heading" className="font-semibold">
              Contribution rates
            </h2>
            <table className="w-full text-sm">
              <tbody>
                <RateRow label="Clinical (incl. personal care from 1 Oct 2026)" low={0} high={0} />
                <RateRow label="Independence" low={rates.ind_low} high={rates.ind_high} />
                <RateRow label="Everyday living" low={rates.ev_low} high={rates.ev_high} />
              </tbody>
            </table>
            <p className="muted">
              {rates.basis === 'fixed' && 'Fixed for this status.'}
              {rates.basis === 'assessed' && 'From the assessed rates entered.'}
              {rates.basis === 'range' && 'A range until the assessed rates are entered.'}
            </p>
          </section>

          {budget && (
            <section className="card space-y-1" aria-labelledby="budget-heading">
              <h2 id="budget-heading" className="font-semibold">
                Budget
              </h2>
              <p className="text-sm">
                {formatAud(budget.quarterly)} a quarter ({formatAud(budget.annual)} a year), of which <strong>{formatAud(budget.for_services)}</strong> is
                available for services after the 10% care-management deduction.
              </p>
              <Link to="/overview" className="text-sm">
                More on the budget and rules
              </Link>
            </section>
          )}

          {prompts.length > 0 && (
            <section className="card space-y-2" aria-labelledby="dva-heading">
              <h2 id="dva-heading" className="font-semibold">
                DVA: worth checking
              </h2>
              <ul className="list-disc space-y-2 pl-5 text-sm">
                {prompts.map((p) => (
                  <li key={p.id}>{p.text}</li>
                ))}
              </ul>
              <p className="muted text-xs">These are prompts, not advice on eligibility. DVA decides what it funds.</p>
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}

function Field({ id, label, className = '', children }: { id: string; label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="muted block">
        {label}
      </label>
      {children}
    </div>
  );
}

function PercentInput({ id, value, onChange, invalid }: { id: string; value: string; onChange: (v: string) => void; invalid: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <input id={id} className="input max-w-28" inputMode="decimal" value={value} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} />
      <span aria-hidden>%</span>
    </div>
  );
}

function RateRow({ label, low, high }: { label: string; low: number; high: number }) {
  return (
    <tr className="border-t border-slate-200 first:border-t-0 dark:border-slate-800">
      <th scope="row" className="py-1 pr-3 text-left font-normal">
        {label}
      </th>
      <td className="py-1 text-right tabular-nums">{low === high ? formatPercent(low) : `${formatPercent(low)}–${formatPercent(high)}`}</td>
    </tr>
  );
}
