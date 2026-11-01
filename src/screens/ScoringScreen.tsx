import { answerLabels } from '../lookingFor';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { DECISION_STEPS, entriesAt, type DecisionStep } from '../state/reducer';
import { useAuth } from '../auth/AuthContext';
import { combinedScores } from '../family';
import { CRITERIA, effectiveWeights, failedMustQuestions, rank, scoreKey, suggestedPriceScore, type CriterionId } from '../scoring';
import { usePlanCosts } from '../components/usePlanCosts';
import { CommitTextarea } from '../components/CommitTextarea';
import { DependencyCard, ResolutionCard, ScreenHeader } from '../components/ui/Cards';
import { ScoreInput, scoreWord } from '../components/ui/Form';
import { Explain, Term, WhyNumber } from '../components/ui/Help';
import { Chip } from '../components/ui/Status';
import { Meter } from '../components/ui/Visual';

/** "What good looks like" for each criterion (UI-SPEC §6.11). */
const GOOD_LOOKS_LIKE: Record<CriterionId, string> = {
  veteran: 'Trained in trauma-informed care, has supported veterans with PTSD, and records triggers so every worker follows them.',
  continuity: 'Commits to a small team of named workers and tells you ahead of any change.',
  clinical: 'Own nurses, clear clinical accountability and after-hours cover answered by a clinician.',
  care_mgmt: 'A named care partner with a manageable caseload, regular contact and clear reporting.',
  local: 'A local team with capacity to start soon in your suburb.',
  price: 'Prices at or below the guide price, all-inclusive, with clear notice of changes.',
  contract: 'Fair notice and cancellation terms, no exit charges, and the agreement given to you to read first.',
  dva: 'Works with DVA so services aren\'t duplicated and your budget lasts.',
};

const weightWords = (w: number) => (w === 0 ? "doesn't count" : w === 1 ? 'counts once' : w === 2 ? 'counts double' : `counts ${w} times`);

export function ScoringScreen() {
  const { seed, state, providers, dispatch, canEdit } = useApp();
  const { user } = useAuth();
  const shortlist = entriesAt(state, 'interview').flatMap((e) => providers.filter((p) => p.id === e.provider_id));
  const weights = effectiveWeights(state.weights);
  // Everyone scores on their own; the ranking uses the family's combined scores (the applicant's count twice).
  const combined = combinedScores(state);
  const familyScores = combined.scores;
  const mine = (user && state.select.memberScores[user.id]?.scores) || {};
  const setMine = (providerId: string, criterion: CriterionId, score: number | null) =>
    dispatch({ type: 'select/score', userId: user?.id ?? '', name: user?.display_name ?? '', providerId, criterion, score });
  const ranked = rank(shortlist, familyScores, weights);
  const { benchmark, byProvider } = usePlanCosts(shortlist);
  const [currentId, setCurrentId] = useState<string | null>(shortlist[0]?.id ?? null);
  const current = shortlist.find((p) => p.id === currentId) ?? shortlist[0];
  const priceHint = (id: string) => {
    const c = byProvider.find((r) => r.provider.id === id)?.cost;
    const own = c?.lines.some((l) => l.hours_per_week > 0 && !l.filled_from_benchmark && l.price !== null);
    return c && own ? suggestedPriceScore(c.quarterly_cost, benchmark.quarterly_cost) : null;
  };
  const priorities = state.answers['B8.1'];
  const priorityQuestion = seed.boundingGroups.flatMap((g) => g.questions).find((q) => q.id === 'B8.1');

  if (shortlist.length === 0) {
    return (
      <section className="space-y-6">
        <ScreenHeader title="Score each provider you met" purpose="Score the providers you interviewed and see how they compare." helpTopic="scoring" />
        <DependencyCard to="/selection/interview" action="Choose providers to interview" minutes={2}>
          To score providers we need them on your interview list.
        </DependencyCard>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <ScreenHeader title="Score each provider you met" purpose="Score the providers you interviewed and see how they compare." helpTopic="scoring">
        <Link to="/summary" className="btn btn-primary">
          Make the decision summary
        </Link>
      </ScreenHeader>

      {(priorities?.choices?.length || priorities?.answer || priorities?.notes) && (
        <ResolutionCard status="info" title="What matters most to you">
          <p>{[answerLabels(priorityQuestion!, priorities).join(', '), priorities.notes].filter(Boolean).join(' — ')}</p>
        </ResolutionCard>
      )}

      <section className="card space-y-3" aria-labelledby="ranking-heading">
        <h2 id="ranking-heading">How they compare</h2>
        <p>
          The <Term id="overall-score">overall score</Term> is out of 5. It's a guide: the decision is yours.
        </p>
        <ol className="space-y-3">
          {ranked.map((r, i) => {
            const failed = failedMustQuestions(r.provider.id, seed.interviewSections, state.responses);
            return (
              <li key={r.provider.id} className="well flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-2xl font-semibold tabular-nums">{r.total === null ? '–' : i + 1}</span>
                {r.total !== null && <Meter value={r.total} max={5} className="order-last w-full" />}
                <span className="min-w-0 flex-1">
                  <Link to={`/providers/${r.provider.id}`} className="font-semibold">
                    {r.provider.provider}
                  </Link>
                  <span className="block">
                    {r.total === null ? (
                      'Not scored yet'
                    ) : (
                      <WhyNumber
                        figure={<span className="font-semibold">{r.total.toFixed(1)} out of 5</span>}
                        title={`${r.provider.provider} — overall score`}
                        lines={CRITERIA.filter((c) => familyScores[scoreKey(r.provider.id, c.id)] !== undefined && weights[c.id] > 0).map((c) => {
                          const s = familyScores[scoreKey(r.provider.id, c.id)];
                          return { label: c.label, working: `${s} (${scoreWord(s)}) × ${weights[c.id]}`, value: String(s * weights[c.id]) };
                        })}
                        total={[{ label: 'Overall', working: 'total ÷ total of weights', value: r.total.toFixed(2) }]}
                        footer={`${r.scored} of ${CRITERIA.length} criteria scored, combining ${combined.members} ${combined.members === 1 ? 'person' : 'people'}'s scores (the applicant's count twice). Unscored criteria are left out, not counted as zero.`}
                      />
                    )}
                  </span>
                </span>
                {failed.length > 0 && (
                  <Link to="/interview-pack" className="no-underline">
                    <Chip status="stop">
                      Disqualify? {failed.length} must-ask question{failed.length === 1 ? '' : 's'} not answered in writing
                    </Chip>
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card space-y-4" aria-labelledby="scores-heading">
        <h2 id="scores-heading">Your scores</h2>
        <p>Score on your own: everyone's scores are combined above, and big differences are shown so you can talk them through.</p>
        <MemberList />
        <div role="group" aria-label="Provider to score" className="flex flex-wrap gap-2">
          {shortlist.map((p) => {
            const scored = CRITERIA.filter((c) => mine[scoreKey(p.id, c.id)] !== undefined).length;
            return (
              <button key={p.id} type="button" aria-pressed={current?.id === p.id} className="btn" onClick={() => setCurrentId(p.id)}>
                {p.provider} <span className="font-normal">· {scored} of {CRITERIA.length}</span>
              </button>
            );
          })}
        </div>
        {current && (
          <ol className="space-y-5">
            {CRITERIA.map((c) => {
              const value = mine[scoreKey(current.id, c.id)];
              const family = familyScores[scoreKey(current.id, c.id)];
              const differ = combined.differences[scoreKey(current.id, c.id)];
              const hint = c.id === 'price' ? priceHint(current.id) : null;
              return (
                <li key={c.id} className="space-y-2 border-t border-[var(--rule)] pt-4 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <h3>
                      {c.label} <span className="text-base font-normal">({weightWords(weights[c.id])})</span>
                    </h3>
                    {value !== undefined && <span className="font-semibold">{value} · {scoreWord(value)}</span>}
                  </div>
                  <Explain question="What good looks like">
                    <p>{GOOD_LOOKS_LIKE[c.id]}</p>
                  </Explain>
                  <ScoreInput label={`${c.label} score for ${current.provider}`} disabled={!canEdit} value={value} onChange={(score) => setMine(current.id, c.id, score)} />
                  {family !== undefined && (
                    <p className="text-[0.95rem]">
                      Family: {family} out of 5
                      {differ && (
                        <span className="text-[var(--caution)]">
                          {' '}
                          · scores range from {differ.low} to {differ.high} — worth talking through
                        </span>
                      )}
                    </p>
                  )}
                  {hint !== null && value === undefined && canEdit && (
                    <button type="button" className="btn-quiet" onClick={() => setMine(current.id, 'price', hint)}>
                      Use the suggested score: {hint} ({scoreWord(hint)}), from your plan's cost compared with the guide price <span className="sr-only">for {current.provider}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="card space-y-3">
        <Explain question="Change what matters most">
          <p>Make a criterion count more or less. "Doesn't count" leaves it out.</p>
          <ul className="space-y-3">
            {CRITERIA.map((c) => (
              <li key={c.id}>
                <label htmlFor={`w-${c.id}`} className="label">
                  {c.label}
                </label>
                <select id={`w-${c.id}`} className="input max-w-64" disabled={!canEdit} value={weights[c.id]} onChange={(e) => dispatch({ type: 'weight/set', criterion: c.id, weight: Number(e.target.value) })}>
                  {[0, 1, 2, 3].map((w) => (
                    <option key={w} value={w}>
                      {weightWords(w)[0].toUpperCase() + weightWords(w).slice(1)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Explain>
      </section>

      <DecisionRecord shortlist={shortlist} topId={ranked[0]?.total !== null ? ranked[0]?.provider.id : undefined} />

      <ResolutionCard
        status="info"
        title="Before you sign: 3 things to check"
        moreLabel="What are they?"
        more={
          <p>
            Ask for the service agreement in writing (question I1), check the exit and cancellation terms (I2, I3), and confirm prices are all-inclusive (G2).{' '}
            <Link to="/interview-pack">See those questions</Link>.
          </p>
        }
      />
    </section>
  );
}

/** Who has scored, and whose scores count double. */
function MemberList() {
  const { state } = useApp();
  const entries = Object.entries(state.select.memberScores).filter(([, m]) => Object.keys(m.scores).length);
  if (!entries.length) return null;
  return (
    <p className="small">
      Scored so far:{' '}
      {entries.map(([id, m], i) => (
        <span key={id}>
          {i > 0 && ', '}
          {m.name}
          {id === state.gather.applicantUserId && ' (the applicant, counts double)'}
        </span>
      ))}
      .
    </p>
  );
}

const STEP_WORDS: Record<DecisionStep, string> = {
  told_chosen: 'Tell the chosen provider',
  agreement: 'Read and agree the service agreement',
  told_others: 'Tell the other providers',
  start_date: 'Agree a start date',
};

/** The decision: who, why, and the next steps (improvement plan 3.4). */
function DecisionRecord({ shortlist, topId }: { shortlist: { id: string; provider: string }[]; topId?: string }) {
  const { state, dispatch, canEdit } = useApp();
  const d = state.select.decision;
  const chosen = shortlist.find((p) => p.id === d.provider_id);
  return (
    <fieldset disabled={!canEdit} className="card min-w-0 space-y-3" aria-labelledby="decision-heading">
      <h2 id="decision-heading">Your decision</h2>
      <div>
        <label htmlFor="decision-provider" className="label">
          Who you've chosen
        </label>
        <select id="decision-provider" className="input max-w-md" value={d.provider_id ?? ''} onChange={(e) => dispatch({ type: 'select/decision', provider_id: e.target.value || null, at: new Date().toISOString(), by: '' })}>
          <option value="">Not decided yet</option>
          {shortlist.map((p) => (
            <option key={p.id} value={p.id}>
              {p.provider}
              {p.id === topId ? ' (highest score)' : ''}
            </option>
          ))}
        </select>
        {chosen && d.at && <p className="small mt-1">Recorded{d.by ? ` by ${d.by}` : ''} on {new Date(d.at).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}.</p>}
      </div>
      <div>
        <label htmlFor="decision" className="label">
          Why
        </label>
        <span className="hint">Why you chose them, and anything still to check. Saved when you leave the box.</span>
        <CommitTextarea id="decision" className="input min-h-32" value={state.decisionNotes} onCommit={(text) => dispatch({ type: 'decision/set', text })} />
      </div>
      {chosen && (
        <fieldset className="space-y-1">
          <legend className="label">Next steps</legend>
          {DECISION_STEPS.map((step) => (
            <label key={step} className="flex min-h-[var(--target-min)] items-center gap-3">
              <input type="checkbox" checked={d.steps[step]} onChange={(e) => dispatch({ type: 'select/decision', steps: { [step]: e.target.checked } })} />
              {STEP_WORDS[step].replace('the chosen provider', chosen.provider)}
              {step === 'start_date' && (
                <input
                  type="date"
                  aria-label="Start date"
                  className="input ml-2 w-auto"
                  value={d.start_date}
                  onChange={(e) => dispatch({ type: 'select/decision', start_date: e.target.value, steps: { start_date: !!e.target.value } })}
                />
              )}
            </label>
          ))}
        </fieldset>
      )}
    </fieldset>
  );
}
