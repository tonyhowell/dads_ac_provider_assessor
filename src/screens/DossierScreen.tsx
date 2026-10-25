import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp, useProvider } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { usePlanCosts } from '../components/usePlanCosts';
import { useApplicantTopics } from '../components/Claims';
import { includedSections, interviewPack } from '../questions';
import { answeredQuestions } from '../lookingFor';
import { COMMUNICATION_NEEDS, DOSSIER_SECTIONS, DVA_CONDITIONS, DVA_SERVICES } from '../schemas';
import { formatAud, formatDate, formatPercent } from '../format';
import { toIsoDate } from '../rules';
import { hoursText } from '../components/ui/Form';
import { Icon } from '../components/ui/Icon';
import { ResolutionCard } from '../components/ui/Cards';
import type { DossierSection } from '../types';

const SECTION_LABELS: Record<DossierSection, { label: string; hint: string }> = {
  profile: { label: 'About me', hint: 'Preferred name, contact person, communication needs, current supports.' },
  dva: { label: 'DVA details', hint: 'Card type, accepted conditions and DVA services. No DVA numbers.' },
  plan: { label: 'My weekly care plan', hint: 'Services and hours, without costs.' },
  looking_for: { label: "What I'm looking for, in brief", hint: 'The summary you checked.' },
  answers: { label: 'My questionnaire answers', hint: "Your answers to “What I'm looking for in a provider”." },
  questions: { label: 'Questions I will ask you', hint: 'Your interview questions, so they can prepare.' },
  claims: { label: 'What you say publicly — please confirm', hint: "The provider's public claims on your topics, to confirm in writing." },
  money: { label: 'My budget and contributions', hint: 'Your level, quarterly budget and contribution rates. Usually not needed for a quote.' },
};

const labels = (list: readonly (readonly [string, string])[], values: string[]) => values.map((v) => list.find(([k]) => k === v)?.[1] ?? v);

/**
 * A printable dossier for one provider (v3): what the family chooses to share before an interview.
 * Nothing is sent anywhere; the family prints it or saves a PDF and gives it to the provider themselves.
 */
export function DossierScreen() {
  const { providerId } = useParams();
  const provider = useProvider(providerId);
  const { state, seed, plan, canEdit, dispatch, application } = useApp();
  const { claims } = useSession();
  const { rates, budget } = usePlanCosts([]);
  const topics = useApplicantTopics();
  const [sections, setSections] = useState<DossierSection[]>(state.dossierSections);
  const [confirmed, setConfirmed] = useState(false);

  if (!provider) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <ResolutionCard status="caution" title="We couldn't find that provider" actions={<Link to="/providers" className="btn">Back to providers</Link>} />
      </main>
    );
  }

  const on = (s: DossierSection) => sections.includes(s);
  const toggle = (s: DossierSection) => {
    const next = on(s) ? sections.filter((x) => x !== s) : DOSSIER_SECTIONS.filter((x) => x === s || sections.includes(x));
    setSections(next);
    if (canEdit) dispatch({ type: 'dossier/sections', sections: next });
  };

  const p = state.profile;
  const participant = state.participant;
  const name = p?.preferred_name || participant?.name || application.name;
  const card = participant?.dva_card ?? 'none';
  const answers = answeredQuestions(seed.boundingGroups, state.answers);
  const pack = interviewPack(seed.interviewSections, includedSections(seed.boundingGroups, seed.interviewSections, state.answers), state.customQuestions);
  const claimItems = (claims.get(provider.id)?.claims?.items ?? []).filter((i) => topics.get(i.question_id)?.relevant);
  const today = formatDate(toIsoDate(new Date()));

  return (
    <main className="print-pack mx-auto max-w-[56rem] bg-[var(--surface)] p-6 text-[var(--charcoal)]">
      <div className="no-print mb-8 space-y-4">
        <Link to={`/providers/${provider.id}`} className="btn-quiet">
          <Icon name="arrowLeft" size={20} /> {provider.provider}
        </Link>
        <h1>Dossier for {provider.provider}</h1>
        <p>Choose what to include, check it below, then print it or save it as a PDF to give to {provider.provider} before your interview.</p>
        <fieldset className="card space-y-2">
          <legend className="label">What to include</legend>
          {DOSSIER_SECTIONS.map((s) => (
            <label key={s} className="flex min-h-[var(--target-min)] items-start gap-3">
              <input type="checkbox" className="mt-1" checked={on(s)} onChange={() => toggle(s)} />
              <span>
                <span className="block font-medium">{SECTION_LABELS[s].label}</span>
                <span className="block text-[0.95rem]">{SECTION_LABELS[s].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className={`flex min-h-[var(--target-min)] items-start gap-3 rounded-[var(--radius-control)] border p-3 ${confirmed ? 'border-2 border-[var(--charcoal)] bg-[var(--amber-tint)]' : 'border-[var(--line)]'}`}>
          <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            <span className="block font-medium">I'm choosing to share this with {provider.provider}</span>
            <span className="block">It contains personal information. Give it only to this provider, and only what you're comfortable sharing.</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={!confirmed || sections.length === 0} onClick={() => window.print()}>
            Print or save as PDF
          </button>
          {!confirmed && <span>Tick the box above first.</span>}
        </div>
      </div>

      <header className="mb-6 space-y-1 border-b-2 border-[var(--charcoal)] pb-4">
        <p className="text-[0.875rem]">Prepared with Provider Assessor · {today}</p>
        <h2 className="text-[1.75rem]">About {name}</h2>
        <p>For {provider.provider}, before our interview. Please keep this private and use it only to plan and quote for care.</p>
      </header>

      {on('looking_for') && state.lookingFor && (
        <Part title="What I'm looking for">
          <p>{state.lookingFor.summary}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['priorities', 'What matters most'],
                ['must_haves', 'Must haves'],
                ['deal_breakers', 'Deal breakers'],
              ] as const
            ).map(([key, label]) =>
              state.lookingFor![key].length ? (
                <div key={key}>
                  <h4 className="font-semibold">{label}</h4>
                  <ul className="list-disc pl-5">
                    {state.lookingFor![key].map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        </Part>
      )}

      {on('profile') && (
        <Part title="About me">
          <Facts
            rows={[
              ['Preferred name', p?.preferred_name],
              ['Lives in', participant ? [participant.suburb, participant.postcode].filter(Boolean).join(' ') : application.suburb],
              ['Contact person', p?.contact_name && [`${p.contact_name}${p.contact_relationship ? ` (${p.contact_relationship})` : ''}`, p.contact_phone, p.contact_email].filter(Boolean).join(' · ')],
              ['Languages', p?.languages],
              ['Communication', p && [...labels(COMMUNICATION_NEEDS, p.communication), p.communication_other].filter(Boolean).join('; ')],
              ['Help I have now', p?.current_supports],
              ['Also good to know', p?.anything_else],
            ]}
          />
        </Part>
      )}

      {on('dva') && card !== 'none' && (
        <Part title="DVA">
          <Facts
            rows={[
              ['Card', card === 'gold' ? 'Gold Card' : 'White Card'],
              ['Accepted conditions', p && [...labels(DVA_CONDITIONS, p.dva_conditions), p.dva_conditions_other].filter(Boolean).join('; ')],
              ['DVA services now', p && [...labels(DVA_SERVICES, p.dva_services), p.dva_services_detail].filter(Boolean).join('; ')],
            ]}
          />
        </Part>
      )}

      {on('plan') && plan.length > 0 && (
        <Part title="My weekly care plan">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Each week</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((i) => (
                <tr key={i.service}>
                  <td>{i.service}</td>
                  <td>{hoursText(i.hours_per_week)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Part>
      )}

      {on('answers') && answers.length > 0 && (
        <Part title="What I'm looking for in a provider">
          <dl className="space-y-2">
            {answers.map((a) => (
              <div key={a.id} className="print-keep">
                <dt className="font-medium">{a.question}</dt>
                <dd>
                  {a.answers.join(', ')}
                  {a.detail && <span className="block italic">“{a.detail}”</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Part>
      )}

      {on('claims') && claimItems.length > 0 && (
        <Part title="What you say publicly — please confirm in writing">
          <p>We found these on your website or public listings. Please confirm each one, or tell us what's different.</p>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Topic</th>
                <th scope="col">What you say</th>
                <th scope="col">Confirmed?</th>
              </tr>
            </thead>
            <tbody>
              {claimItems.map((i) => (
                <tr key={`${i.question_id}-${i.source_url}`} className="print-keep">
                  <td>{topics.get(i.question_id)?.text}</td>
                  <td>
                    {i.claim}
                    <span className="block text-[0.875rem]">
                      <a href={i.source_url}>{i.source_title || i.source_url}</a>
                    </span>
                  </td>
                  <td>☐ Yes ☐ No</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Part>
      )}

      {on('questions') && (
        <Part title="Questions I will ask you">
          {pack.map((s) => (
            <section key={s.code} className="print-keep mb-3">
              <h4 className="font-semibold">
                {s.code}. {s.section}
              </h4>
              <ol className="list-decimal pl-6">
                {s.questions.map((q) => (
                  <li key={q.id}>
                    {q.priority === 'must' && '■ '}
                    {q.text}
                  </li>
                ))}
              </ol>
            </section>
          ))}
          <p className="text-[0.875rem]">■ = please answer in writing.</p>
        </Part>
      )}

      {on('money') && participant && (
        <Part title="My budget and contributions">
          <Facts
            rows={[
              ['Support at Home level', participant.classification],
              ['Quarterly budget', budget ? `${formatAud(budget.quarterly)} (${formatAud(budget.for_services)} for services after care management)` : null],
              ['Independence contribution', rates.ind_low === rates.ind_high ? formatPercent(rates.ind_low) : `${formatPercent(rates.ind_low)} to ${formatPercent(rates.ind_high)}`],
              ['Everyday living contribution', rates.ev_low === rates.ev_high ? formatPercent(rates.ev_low) : `${formatPercent(rates.ev_low)} to ${formatPercent(rates.ev_high)}`],
            ]}
          />
        </Part>
      )}

      <footer className="print-footer mt-8 border-t border-[var(--rule)] pt-3 text-[0.875rem]">
        Shared by {name}'s family with {provider.provider} only, to plan and quote for care. Please don't pass it on.
      </footer>
    </main>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 space-y-2">
      <h3 className="print-keep border-b border-[var(--charcoal)] pb-1 text-[1.2rem]">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, string | null | undefined | false | ''][] }) {
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  if (!shown.length) return <p>Nothing recorded yet.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[12rem_1fr]">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
