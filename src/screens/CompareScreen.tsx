import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { formatAud } from '../format';
import { Icon } from '../components/ui/Icon';
import { NextStepCard, ScreenHeader } from '../components/ui/Cards';
import { LevelIcon, useMatches, VerdictText } from '../components/Finder';
import { usePhone } from '../components/useMinWidth';
import { entriesAt } from '../state/reducer';
import { useApplicantTopics } from '../components/Claims';
import type { Match } from '../matching';

// Compare the shortlist (v4): the same page for both ways of looking. Side by side on wider screens,
// stacked cards on phones. Ticking "Interview them?" moves a provider to the interview list.

export function CompareScreen() {
  const { state, dispatch, canEdit } = useApp();
  const { claims } = useSession();
  const topics = useApplicantTopics();
  const phone = usePhone();
  const { matches, priorities } = useMatches(true);
  const shortlist = state.selection.map((e) => ({ entry: e, match: matches.find((m) => m.provider.id === e.provider_id) })).filter((x): x is { entry: typeof x.entry; match: Match } => !!x.match);
  const interviewing = entriesAt(state, 'interview').length;

  const setInterview = (m: Match, on: boolean) =>
    dispatch({ type: 'selection/stage', providerId: m.provider.id, stage: on ? 'interview' : 'refine', at: new Date().toISOString() });
  const isInterview = (m: Match) => state.selection.find((e) => e.provider_id === m.provider.id)?.stage === 'interview';
  const relevantClaims = (m: Match) => (claims.get(m.provider.id)?.claims?.items ?? []).filter((i) => topics.get(i.question_id)?.relevant).length;
  const relevantTopics = [...topics.values()].filter((t) => t.relevant).length;
  const notes = (m: Match) => state.notes.filter((n) => n.provider_id === m.provider.id);

  const toggle = (m: Match) =>
    canEdit ? (
      <label className="flex min-h-[52px] items-center justify-between gap-3 font-semibold">
        Interview them
        <input type="checkbox" className="h-6 w-6" checked={isInterview(m)} onChange={(e) => setInterview(m, e.target.checked)} />
        <span className="sr-only">: {m.provider.provider}</span>
      </label>
    ) : (
      <span>{isInterview(m) ? 'To interview' : 'Not chosen yet'}</span>
    );

  if (shortlist.length === 0) {
    return (
      <section className="space-y-6">
        <ScreenHeader title="Compare your shortlist" purpose="Shortlist providers first, then compare them here." />
        <p className="card">
          Nothing on your shortlist yet. <Link to="/providers?view=plan">Find providers</Link>
        </p>
      </section>
    );
  }

  const continueBar = (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-3 bg-[var(--header-bg)] px-4 py-3 text-[var(--on-dark)]">
      <span>
        <b>{interviewing}</b> to interview{!phone && ' · two or three is usually enough'}
      </span>
      <Link to="/interview-pack" className={`btn btn-primary ${interviewing === 0 ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={interviewing === 0}>
        Interview {interviewing === 1 ? '1 provider' : `${interviewing} providers`} <Icon name="arrowRight" size={20} />
      </Link>
    </div>
  );

  if (phone) {
    return (
      <section className="space-y-3">
        <h1>Who do you want to meet?</h1>
        <p>Two or three is usually enough.</p>
        {shortlist.map(({ match: m }) => (
          <article key={m.provider.id} className={`card space-y-1 ${isInterview(m) ? 'border-2 border-[var(--charcoal)]' : ''}`} aria-label={m.provider.provider}>
            <h2 className="text-[1.2rem]">{m.provider.provider}</h2>
            {m.reasons
              .filter((r) => r.level === 'yes')
              .slice(0, 2)
              .map((r) => (
                <p key={r.priority} className="flex gap-2">
                  <LevelIcon level="yes" /> {r.label}
                </p>
              ))}
            <p className="flex gap-2">
              <LevelIcon level={m.missing.length ? 'partly' : 'yes'} /> {m.missing.length ? `Prices for ${m.covered.length} of ${m.covered.length + m.missing.length} services` : 'Prices for all your services'}
            </p>
            <p className="flex gap-2">
              {m.verdict === 'quote' ? (
                <>
                  <LevelIcon level="unknown" /> Needs a quote
                </>
              ) : (
                <>
                  <LevelIcon level={(m.cost.over_budget ?? 0) > 0 ? 'partly' : 'yes'} /> {formatAud(m.cost.quarterly_cost)} a quarter
                  {(m.cost.over_budget ?? 0) > 0 && `, ${formatAud(m.cost.over_budget!)} over budget`}
                </>
              )}
            </p>
            <div className="border-t border-[var(--rule)]">{toggle(m)}</div>
          </article>
        ))}
        <p className="text-[0.9rem]">The side-by-side comparison is on a bigger screen.</p>
        {continueBar}
      </section>
    );
  }

  const row = (label: string, cell: (m: Match) => ReactNode) => (
    <tr>
      <th scope="row">{label}</th>
      {shortlist.map(({ match: m }) => (
        <td key={m.provider.id}>{cell(m)}</td>
      ))}
    </tr>
  );

  return (
    <section className="space-y-6">
      <ScreenHeader title="Compare your shortlist" purpose="Your shortlist side by side. Tick the ones you want to interview — two or three is usually enough." helpTopic="selection" />
      <div className="overflow-x-auto">
        <table className="data-table compare-table">
          <thead>
            <tr>
              <td />
              {shortlist.map(({ match: m }) => (
                <th key={m.provider.id} scope="col" className="min-w-[13rem]">
                  <Link to={`/providers?view=plan&p=${m.provider.id}`}>{m.provider.provider}</Link>
                  <span className="block font-normal">
                    <VerdictText verdict={m.verdict} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row('Services priced', (m) => (m.missing.length ? `${m.covered.length} of ${m.covered.length + m.missing.length} · no price for ${m.missing.join(', ').toLowerCase()}` : `All ${m.covered.length}`))}
            {row('Cost a quarter', (m) =>
              m.verdict === 'quote' ? (
                'Needs a quote'
              ) : (
                <>
                  <b>{formatAud(m.cost.quarterly_cost)}</b>
                  {m.cost.over_budget !== null && (
                    <span className={`block text-[0.95rem] ${m.cost.over_budget > 0 ? 'text-[var(--caution)]' : 'text-[var(--good)]'}`}>
                      {m.cost.over_budget > 0 ? `${formatAud(m.cost.over_budget)} over budget` : `${formatAud(-m.cost.over_budget)} within budget`}
                    </span>
                  )}
                </>
              ),
            )}
            {priorities.map((p, i) =>
              row(shortlist[0].match.reasons[i]?.label ?? p, (m) => {
                const r = m.reasons[i];
                return r ? (
                  <span className="flex gap-1">
                    <LevelIcon level={r.level} /> <span>{r.level === 'unknown' ? (r.detail.startsWith('Not checked') ? 'Not checked yet' : 'Not stated') : r.detail}</span>
                  </span>
                ) : null;
              }),
            )}
            {row('Watch out for', (m) => (m.cautions.length ? m.cautions.map((c) => <span key={c.text} className="block text-[var(--caution)]">{c.text}</span>) : 'None found'))}
            {row('Public claims', (m) => (claims.get(m.provider.id)?.claims ? `${relevantClaims(m)} of ${relevantTopics} topics` : 'Not checked yet'))}
            {row('Your notes', (m) => {
              const n = notes(m);
              return n.length ? <span className="text-[0.95rem]">“{n[n.length - 1].text.slice(0, 80)}{n[n.length - 1].text.length > 80 ? '…' : ''}”</span> : 'None yet';
            })}
            <tr className="bg-[var(--amber-tint)]">
              <th scope="row">Interview them?</th>
              {shortlist.map(({ match: m }) => (
                <td key={m.provider.id}>{toggle(m)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <Link to="/providers?view=plan">Add another to compare</Link> · <Link to="/selection/scan">Rank and add reasons on the selection board</Link>
      </p>
      <NextStepCard
        done={`${interviewing} provider${interviewing === 1 ? '' : 's'} to interview.`}
        next="prepare your interview questions"
        back={{ to: '/providers?view=plan', label: 'Find providers' }}
        forward={{ to: '/interview-pack', label: 'Continue to interview questions' }}
      />
      {continueBar}
    </section>
  );
}
