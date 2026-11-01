import { useState, type ReactNode } from 'react';
import { useApp } from '../state/AppContext';
import { useAuth } from '../auth/AuthContext';
import { usePlanCosts } from './usePlanCosts';
import { answerLabels } from '../lookingFor';
import { mattersGroup, missingForFind } from '../gather';
import { formatAud, formatDate, formatDateTime, formatPercent } from '../format';
import { hoursText } from './ui/Form';
import { newId } from '../state/reducer';
import { Icon } from './ui/Icon';

// Gather step 7: the assessment brief — one page that sums up the situation, money, care plan and what matters.
// The coordinator confirms it; the applicant (and family) can read it and comment. It prints on one page.

interface Member {
  user_id: string;
  display_name: string;
  role: string;
}

const CARD: Record<string, string> = { gold: 'Gold Card', white: 'White Card', none: 'No DVA card' };

export function BriefStep({ members }: { members: Member[] }) {
  const { state, seed, plan, role, canEdit, dispatch, application } = useApp();
  const { rates, budget, benchmark } = usePlanCosts([]);
  const [comment, setComment] = useState('');
  const p = state.participant;
  const profile = state.profile;
  const group = mattersGroup(seed)!;
  const q = (id: string) => group.questions.find((x) => x.id === id) ?? seed.boundingGroups.flatMap((g) => g.questions).find((x) => x.id === id)!;
  const priorities = answerLabels(q('B8.1'), state.answers['B8.1']);
  const dealBreakers = answerLabels(q('B8.3'), state.answers['B8.3']);
  const stressors = answerLabels(q('B3.1'), state.answers['B3.1']).filter((l) => !/nothing/i.test(l));
  const lf = state.lookingFor;
  const missing = missingForFind(state);
  const confirmed = state.gather.brief;
  const applicant = members.find((m) => m.user_id === state.gather.applicantUserId);
  const pension = seed.contributions.find((c) => c.key === p?.pension_status)?.status;
  const name = profile?.preferred_name || p?.name || application.name;
  const over = benchmark.over_budget;

  const addComment = () => {
    if (!comment.trim()) return;
    dispatch({ type: 'gather/briefComment', comment: { id: newId(), author: '', text: comment.trim(), at: new Date().toISOString() } });
    setComment('');
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        {confirmed.confirmed_at ? (
          <span className="chip chip-good">
            <Icon name="check" size={16} /> Confirmed by {confirmed.confirmed_by} · {formatDateTime(confirmed.confirmed_at)}
          </span>
        ) : (
          <span className="chip chip-caution">Not confirmed yet</span>
        )}
        {role === 'coordinator' && (
          <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'gather/briefConfirm', at: new Date().toISOString(), by: '' })}>
            {confirmed.confirmed_at ? 'Confirm again' : 'Confirm the brief'}
          </button>
        )}
        <button type="button" className="btn" onClick={() => window.print()}>
          Print
        </button>
        {missing.length > 0 && <span>Still needed: {missing.map((m) => m.label.toLowerCase()).join(', ')}.</span>}
      </div>

      <article className="card print-pack space-y-4" aria-label="Assessment brief">
        <header className="border-b-2 border-[var(--charcoal)] pb-2">
          <p className="small">Assessment brief · {formatDate(new Date().toISOString().slice(0, 10))}</p>
          <h2 className="text-[1.5rem]">{name}</h2>
          {applicant && <p className="small">Applicant: {applicant.display_name}</p>}
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <BriefPart title="Situation">
            <Facts
              rows={[
                ['Lives in', p ? `${p.suburb} ${p.postcode}` : null],
                ['Support at Home level', p?.classification ?? null],
                ['Pension', pension ?? null],
                ['DVA', p ? CARD[p.dva_card] : null],
                ['Contact for providers', profile?.contact_name ? `${profile.contact_name}${profile.contact_relationship ? ` (${profile.contact_relationship})` : ''}` : null],
              ]}
            />
          </BriefPart>
          <BriefPart title="Money">
            <Facts
              rows={[
                ['Budget each quarter', budget ? formatAud(budget.quarterly) : null],
                ['For services', budget ? formatAud(budget.for_services) : null],
                ['Contribution rates', p ? `Independence ${formatPercent(rates.ind_low)}${rates.ind_high !== rates.ind_low ? `–${formatPercent(rates.ind_high)}` : ''}, everyday ${formatPercent(rates.ev_low)}${rates.ev_high !== rates.ev_low ? `–${formatPercent(rates.ev_high)}` : ''}` : null],
                ['Plan at price-guide rates', state.plan ? `${formatAud(benchmark.quarterly_cost)} a quarter${over !== null ? (over > 0 ? `, ${formatAud(over)} over budget` : `, ${formatAud(-over)} under budget`) : ''}` : null],
              ]}
            />
          </BriefPart>
        </div>

        <BriefPart title={`Care plan${state.gather.planSource === 'manual' ? ' (entered by hand, unconfirmed)' : state.gather.planSource === 'support_plan' ? ' (from the support plan)' : ''}`}>
          {state.plan ? (
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {plan
                .filter((i) => i.hours_per_week > 0)
                .map((i) => (
                  <li key={i.key}>
                    {i.service}: {hoursText(i.hours_per_week)} a week
                  </li>
                ))}
            </ul>
          ) : (
            <p>Not set yet.</p>
          )}
        </BriefPart>

        <BriefPart title="What matters">
          {lf?.summary && <p className="italic">“{lf.summary}”</p>}
          <div className="grid gap-4 sm:grid-cols-3">
            <List title="Top priorities" items={priorities} ordered />
            <List title="Must-haves" items={lf?.must_haves ?? []} />
            <List title="Deal-breakers" items={[...dealBreakers, ...stressors.map((s) => `Stressful: ${s.toLowerCase()}`)]} />
          </div>
        </BriefPart>
      </article>

      <section className="no-print card space-y-2" aria-labelledby="brief-comments">
        <h2 id="brief-comments" className="text-[1.15rem]">
          Comments
        </h2>
        {confirmed.comments.length ? (
          <ul className="space-y-2">
            {confirmed.comments.map((c) => (
              <li key={c.id} className="well">
                <p>{c.text}</p>
                <p className="small">
                  {c.author} · {formatDateTime(c.at)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No comments yet.</p>
        )}
        {canEdit && (
          <div className="space-y-2">
            <label htmlFor="brief-comment" className="label">
              Add a comment
            </label>
            <textarea id="brief-comment" className="input min-h-20" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button type="button" className="btn" disabled={!comment.trim()} onClick={addComment}>
              Add comment
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function BriefPart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="border-b border-[var(--rule)] text-[1.1rem]">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, string | null][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium">{k}</dt>
          <dd>{v ?? <span className="small">Not set yet</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function List({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <div>
      <h4 className="font-semibold">{title}</h4>
      {items.length ? (
        <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5`}>
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </Tag>
      ) : (
        <p className="small">None yet</p>
      )}
    </div>
  );
}

/** The coordinator says which member is the person being assessed (they get a simpler view of their steps). */
export function ApplicantPicker({ members }: { members: Member[] }) {
  const { state, role, dispatch } = useApp();
  const { user } = useAuth();
  if (role !== 'coordinator' || members.length < 2) return null;
  return (
    <div className="card flex flex-wrap items-center gap-3">
      <label htmlFor="applicant" className="font-medium">
        Who is being assessed?
      </label>
      <select id="applicant" className="input w-auto" value={state.gather.applicantUserId ?? ''} onChange={(e) => dispatch({ type: 'gather/applicant', userId: e.target.value || null })}>
        <option value="">Not one of the members</option>
        {members
          .filter((m) => m.user_id !== user?.id)
          .map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.display_name}
            </option>
          ))}
      </select>
      <span className="small">They'll see a simpler view of “What matters” and “About me”, in larger text, and can speak their answers. They need contributor access to answer.</span>
    </div>
  );
}
