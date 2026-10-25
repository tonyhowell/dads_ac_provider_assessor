import { useRef, useState, type FormEvent } from 'react';
import { useApp } from '../state/AppContext';
import { assessedRatesValid, contributionRates } from '../calc';
import { dvaPrompts } from '../dva';
import { ruleAt } from '../rules';
import { formatAud, formatPercent } from '../format';
import type { Participant } from '../types';
import { NextStepCard, ResolutionCard, ScreenHeader } from '../components/ui/Cards';
import { ChoiceCards, Field } from '../components/ui/Form';
import { Explain, Term } from '../components/ui/Help';
import { Icon } from '../components/ui/Icon';
import { Expander, MoreText } from '../components/ui/Expander';
import { Meter, ShareRing } from '../components/ui/Visual';
import { useFieldHelp } from '../components/ui/useFieldHelp';
import { useFirstRun, WelcomeScreen } from '../components/Welcome';

type Status = 'full_pensioner' | 'part_pensioner' | 'self_funded';
type Nwop = 'yes' | 'no' | 'unsure';

interface Draft {
  name: string;
  suburb: string;
  postcode: string;
  pension_status: Status;
  ind_pct: string;
  ev_pct: string;
  noLetter: boolean;
  dva_card: Participant['dva_card'];
  nwop: Nwop;
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
  noLetter: !!p && p.ind_rate == null && p.ev_rate == null,
  dva_card: p?.dva_card ?? 'none',
  nwop: p?.nwop ? 'yes' : p?.nwop_unsure ? 'unsure' : 'no',
  classification: p?.classification ?? '',
  paid: p ? String(p.lifetime_contributions_paid) : '0',
});

const pct = (s: string) => (s.trim() === '' ? null : Number(s) / 100);

function toParticipant(d: Draft, needsRates: boolean): Participant {
  const useRange = !needsRates || d.noLetter;
  return {
    id: 'participant',
    name: d.name.trim(),
    suburb: d.suburb.trim(),
    postcode: d.postcode.trim(),
    pension_status: d.pension_status,
    ind_rate: useRange ? null : pct(d.ind_pct),
    ev_rate: useRange ? null : pct(d.ev_pct),
    dva_card: d.dva_card,
    nwop: d.nwop === 'yes',
    nwop_unsure: d.nwop === 'unsure',
    classification: d.classification,
    lifetime_contributions_paid: Number(d.paid.replace(/[$,\s]/g, '')) || 0,
  };
}

type FieldKey = 'suburb' | 'postcode' | 'classification' | 'rates' | 'paid';

export function ParticipantScreen() {
  const [firstRun, startApp] = useFirstRun();
  if (firstRun) return <WelcomeScreen onStart={startApp} />;
  return <ParticipantForm />;
}

function ParticipantForm() {
  const { state, seed, dispatch, plan, serviceDate } = useApp();
  const fh = useFieldHelp();
  const [draft, setDraft] = useState<Draft>(() => toDraft(state.participant));
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };
  const touch = (k: FieldKey) => setTouched((t) => ({ ...t, [k]: true }));

  const nwop = draft.nwop === 'yes';
  const needsRates = draft.pension_status === 'part_pensioner' || (nwop && draft.pension_status !== 'full_pensioner');
  const participant = toParticipant(draft, needsRates);
  const rates = contributionRates(participant, seed.contributions, serviceDate);
  const band = nwop
    ? ruleAt('nwopContributionBands', serviceDate)[draft.pension_status === 'full_pensioner' ? 'full_pensioner' : 'other']
    : seed.contributions.find((c) => c.key === draft.pension_status)!;

  const errors: Partial<Record<FieldKey, string>> = {};
  if (!draft.suburb.trim()) errors.suburb = 'Enter the suburb where you live.';
  if (!/^\d{4}$/.test(draft.postcode.trim())) errors.postcode = 'Enter a 4-digit postcode, for example 4178.';
  if (!draft.classification) errors.classification = 'Choose your level from your approval letter.';
  if (needsRates && !draft.noLetter) {
    if (draft.ind_pct.trim() === '' || draft.ev_pct.trim() === '') errors.rates = 'Enter both rates from your letter, or tick "I don\'t have my letter yet".';
    else if (!assessedRatesValid(participant, band))
      errors.rates = `Your rates should be between ${formatPercent(band.ind_low)} and ${formatPercent(band.ind_high)} for Independence, and ${formatPercent(band.ev_low)} and ${formatPercent(band.ev_high)} for Everyday living. Check the numbers on your letter.`;
  }
  if (Number.isNaN(Number(draft.paid.replace(/[$,\s]/g, ''))) || Number(draft.paid.replace(/[$,\s]/g, '')) < 0) errors.paid = 'Enter a dollar amount, for example 1,250. Enter 0 if none.';
  const shown = (k: FieldKey) => (touched[k] || submitted ? errors[k] : undefined);
  const errorList = Object.entries(errors) as [FieldKey, string][];

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (errorList.length) {
      summaryRef.current?.focus();
      return;
    }
    dispatch({ type: 'participant/set', participant });
    setSaved(true);
  };

  const budget = seed.budgets.find((b) => b.classification === draft.classification);
  const prompts = dvaPrompts(participant, plan);
  const ongoing = seed.budgets.filter((b) => !b.classification.startsWith('HCP'));
  const transitioned = seed.budgets.filter((b) => b.classification.startsWith('HCP'));
  const unchanged = state.participant && JSON.stringify(state.participant) === JSON.stringify(participant);

  return (
    <section className="space-y-6">
      <ScreenHeader title="Tell us about your situation" purpose="So we can work out your budget and what you'll pay." helpTopic="about-you" />

      <ResolutionCard
        status="info"
        title="Shared only with your family"
        moreLabel="Who can see this?"
        more={<p>Your details are seen only by family members invited to this assessment. We ask only what's needed to work out costs. Your name is optional.</p>}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,var(--wrap-form))_minmax(0,1fr)]">
        <form onSubmit={save} className="space-y-6" noValidate>
          {submitted && errorList.length > 0 && (
            <div ref={summaryRef} tabIndex={-1} role="alert" className="card tone-stop border-l-4">
              <p className="status status-stop font-semibold">
                <Icon name="octagon" /> Please fix {errorList.length === 1 ? 'this' : `these ${errorList.length} things`} before saving
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-6">
                {errorList.map(([k, msg]) => (
                  <li key={k}>
                    <a href={`#field-${k}`}>{msg}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <fieldset className="card space-y-4">
            <legend className="sr-only">Where you live</legend>
            <h2 className="flex items-center gap-2">
              <Icon name="pin" size={26} /> Where you live
            </h2>
            <Field label="Your first name (optional)" hint="So the app can use your name. Leave it blank if you prefer.">
              {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} autoComplete="given-name" />}
            </Field>
            <span id="field-suburb" />
            <span id="field-postcode" />
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label={fh('suburb').label} hint={fh('suburb').hint} error={shown('suburb')}>
                {({ id, describedBy, invalid }) => (
                  <input id={id} aria-describedby={describedBy} aria-invalid={invalid} className="input" value={draft.suburb} onChange={(e) => set('suburb', e.target.value)} onBlur={() => touch('suburb')} autoComplete="address-level2" />
                )}
              </Field>
              <Field label={fh('postcode').label} hint={fh('postcode').hint} error={shown('postcode')}>
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    className="input"
                    inputMode="numeric"
                    maxLength={4}
                    value={draft.postcode}
                    onChange={(e) => set('postcode', e.target.value)}
                    onBlur={() => touch('postcode')}
                    autoComplete="postal-code"
                  />
                )}
              </Field>
            </div>
          </fieldset>

          <fieldset className="card space-y-4">
            <legend className="sr-only">Your approval</legend>
            <h2 className="flex items-center gap-2">
              <Icon name="calendar" size={26} /> Your approval
            </h2>
            <span id="field-classification" />
            <Field
              label={
                <>
                  Your level (<Term id="classification">classification</Term>)
                </>
              }
              hint={fh('classification').hint}
              error={shown('classification')}
            >
              {({ id, describedBy, invalid }) => (
                <select id={id} aria-describedby={describedBy} aria-invalid={invalid} className="input" value={draft.classification} onChange={(e) => set('classification', e.target.value)} onBlur={() => touch('classification')}>
                  <option value="">Choose your level…</option>
                  <optgroup label="Support at Home levels">
                    {ongoing.map((b) => (
                      <option key={b.classification} value={b.classification}>
                        Level {b.classification} — {formatAud(b.quarterly)} a quarter
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Transitioned Home Care Package">
                    {transitioned.map((b) => (
                      <option key={b.classification} value={b.classification}>
                        Package level {b.classification.replace('HCP L', '')} — {formatAud(b.quarterly)} a quarter
                      </option>
                    ))}
                  </optgroup>
                </select>
              )}
            </Field>
            <ChoiceCards<Nwop>
              legend={fh('nwop').label}
              hint={fh('nwop').hint}
              name="nwop"
              value={draft.nwop}
              onChange={(v) => set('nwop', v)}
              columns={3}
              choices={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
                { value: 'unsure', label: "I'm not sure" },
              ]}
            />
            {draft.nwop === 'unsure' && <p>We'll work out costs without the no-worse-off rates for now. Your approval letter or My Aged Care can tell you.</p>}
            <Explain question="How do I know?">
              <p>
                The <Term id="no-worse-off">no-worse-off principle</Term> applies if you were approved for a Home Care Package on or before 12 September 2024. Your old
                approval letter shows the date, or ask My Aged Care on 1800 200 422.
              </p>
            </Explain>
          </fieldset>

          <fieldset className="card space-y-4">
            <legend className="sr-only">Your pension</legend>
            <h2 className="flex items-center gap-2">
              <Icon name="dollar" size={26} /> Your pension
            </h2>
            <ChoiceCards<Status>
              legend={fh('pension_status').label}
              hint={fh('pension_status').hint}
              name="status"
              value={draft.pension_status}
              onChange={(v) => set('pension_status', v)}
              choices={[
                { value: 'full_pensioner', label: 'Full pensioner' },
                { value: 'part_pensioner', label: 'Part pensioner, or Commonwealth Seniors Health Card holder' },
                { value: 'self_funded', label: 'Self-funded retiree, or prefer not to share my means' },
              ]}
            />
            {needsRates && (
              <div className="well space-y-3">
                <span id="field-rates" />
                <p className="label">{fh('assessed_rates').label}</p>
                <MoreText text={fh('assessed_rates').hint ?? ''} className="hint" />
                <label className="flex min-h-[var(--target-min)] items-center gap-3">
                  <input type="checkbox" checked={draft.noLetter} onChange={(e) => set('noLetter', e.target.checked)} />
                  I don't have my letter yet — use a range for now
                </label>
                {!draft.noLetter && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Independence rate" hint={`Between ${formatPercent(band.ind_low)} and ${formatPercent(band.ind_high)}`} error={shown('rates')}>
                      {({ id, describedBy, invalid }) => <PercentInput id={id} describedBy={describedBy} invalid={invalid} value={draft.ind_pct} onChange={(v) => set('ind_pct', v)} onBlur={() => touch('rates')} />}
                    </Field>
                    <Field label="Everyday living rate" hint={`Between ${formatPercent(band.ev_low)} and ${formatPercent(band.ev_high)}`}>
                      {({ id, describedBy, invalid }) => <PercentInput id={id} describedBy={describedBy} invalid={invalid || !!shown('rates')} value={draft.ev_pct} onChange={(v) => set('ev_pct', v)} onBlur={() => touch('rates')} />}
                    </Field>
                  </div>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="card space-y-4">
            <legend className="sr-only">DVA card</legend>
            <h2 className="flex items-center gap-2">
              <Icon name="card" size={26} /> DVA card
            </h2>
            <ChoiceCards<Participant['dva_card']>
              legend={
                <>
                  <Term id="dva-card">{fh('dva_card').label}</Term>
                </>
              }
              hint={fh('dva_card').hint}
              name="dva"
              value={draft.dva_card}
              onChange={(v) => set('dva_card', v)}
              columns={3}
              choices={[
                { value: 'gold', label: 'Gold Card' },
                { value: 'white', label: 'White Card', description: 'For specific conditions' },
                { value: 'none', label: 'No DVA card' },
              ]}
            />
          </fieldset>

          <fieldset className="card space-y-4">
            <legend className="sr-only">Contributions paid so far</legend>
            <h2 className="flex items-center gap-2">
              <Icon name="clock" size={26} /> Contributions paid so far
            </h2>
            <span id="field-paid" />
            <Field label={fh('paid').label} hint={fh('paid').hint} error={shown('paid')}>
              {({ id, describedBy, invalid }) => (
                <div className="flex items-center gap-2">
                  <span aria-hidden className="text-lg">
                    $
                  </span>
                  <input id={id} aria-describedby={describedBy} aria-invalid={invalid} className="input max-w-48 tabular-nums" inputMode="decimal" value={draft.paid} onChange={(e) => set('paid', e.target.value)} onBlur={() => touch('paid')} />
                </div>
              )}
            </Field>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={`btn ${unchanged ? '' : 'btn-primary'}`}>
              Save my details
            </button>
            {saved && (
              <span role="status" className="status status-good">
                <Icon name="check" /> Saved
              </span>
            )}
          </div>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Your summary">
          <section className="card space-y-3">
            <h2>Your summary</h2>
            <h3>What you pay for each service</h3>
            <ul className="space-y-2">
              {(
                [
                  ['Clinical care', 0, 0],
                  ['Independence', rates.ind_low, rates.ind_high],
                  ['Everyday living', rates.ev_low, rates.ev_high],
                ] as const
              ).map(([label, lo, hi]) => (
                <li key={label} className="flex items-center gap-3">
                  <ShareRing share={hi} size={44} label={`${label}: you pay ${range(lo, hi)}`} />
                  <span className="min-w-0 flex-1 leading-tight">{label}</span>
                  {lo !== hi && <span className="text-[0.95rem] font-semibold tabular-nums">{range(lo, hi)}</span>}
                </li>
              ))}
            </ul>
            <Explain question="Why these rates?">
              <p>
                <Term id="categories">Clinical care</Term> (nursing, and personal care from 1 October 2026) is free. For the other two kinds of service you pay a share of
                the price, set by your pension status.
              </p>
              <p>
                {rates.basis === 'fixed' && 'Your rates are fixed for your pension status.'}
                {rates.basis === 'assessed' && 'These are the rates from your contribution letter.'}
                {rates.basis === 'range' && 'Until you enter the rates from your letter, we show the lowest and highest you could pay.'}
              </p>
            </Explain>
            {budget && (
              <>
                <h3>Your budget</h3>
                <p>
                  <span className="figure block">{formatAud(budget.for_services)}</span> for your services each quarter
                </p>
                <Meter value={budget.for_services} max={budget.quarterly} label={`${formatAud(budget.for_services)} of ${formatAud(budget.quarterly)} goes to services; 10% goes to care management`} />
                <p className="small">From {formatAud(budget.quarterly)}, after 10% care management.</p>
              </>
            )}
          </section>
          {prompts.length > 0 && (
            <Expander icon="shield" title="Worth checking with DVA" summary={`${prompts.length} thing${prompts.length === 1 ? '' : 's'} to ask about`}>
              <ul className="list-disc space-y-2 pl-5">
                {prompts.map((p) => (
                  <li key={p.id}>{p.text}</li>
                ))}
              </ul>
            </Expander>
          )}
        </aside>
      </div>

      <NextStepCard
        done={state.participant ? 'Your details are saved.' : 'Save your details to work out your budget.'}
        next="see your budget and the rules that affect it"
        forward={{ to: '/overview', label: 'Continue to your budget' }}
        primary={!!unchanged}
      />
    </section>
  );
}

function PercentInput({ id, describedBy, invalid, value, onChange, onBlur }: { id: string; describedBy?: string; invalid: boolean; value: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <input id={id} aria-describedby={describedBy} aria-invalid={invalid} className="input w-28 tabular-nums" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
      <span aria-hidden className="text-lg">
        %
      </span>
    </div>
  );
}

const range = (lo: number, hi: number) => (lo === hi ? formatPercent(lo) : `${formatPercent(lo)} to ${formatPercent(hi)}`);
