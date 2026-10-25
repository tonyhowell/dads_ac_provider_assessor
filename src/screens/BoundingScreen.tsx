import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { includedSections, interviewPack, packQuestionCount } from '../questions';
import { OptionalNote } from '../components/OptionalNote';
import { Meter } from '../components/ui/Visual';
import { NextStepCard, ScreenHeader } from '../components/ui/Cards';
import { CheckCards, ChoiceCards } from '../components/ui/Form';
import { LookingForSummary } from '../components/LookingForSummary';
import { isAnswered as answered, optionsFor, rulesOut, type LookingForQuestion } from '../lookingFor';
import { Explain } from '../components/ui/Help';
import { Icon } from '../components/ui/Icon';
import type { BoundingAnswer } from '../types';

export function BoundingScreen() {
  const { seed, state, dispatch, canEdit } = useApp();
  const included = includedSections(seed.boundingGroups, seed.interviewSections, state.answers);
  const pack = interviewPack(seed.interviewSections, included, state.customQuestions);
  const count = packQuestionCount(pack);
  const sectionName = new Map(seed.interviewSections.map((s) => [s.code, s.section]));
  const isAnswered = (id: string) => answered(state.answers[id]);
  const [open, setOpen] = useState<Set<string>>(() => new Set([seed.boundingGroups[0]?.group]));

  const save = (questionId: string, patch: Partial<BoundingAnswer>) => {
    const prev = state.answers[questionId] ?? { answer: '', notes: '', not_relevant: false };
    dispatch({ type: 'bounding/answer', questionId, answer: { ...prev, ...patch } });
  };
  /** Choosing answers also sets "not relevant" when every chosen answer rules the question's sections out. */
  const choose = (q: LookingForQuestion, chosen: string[]) =>
    save(
      q.id,
      q.type === 'multi' ? { choices: chosen, answer: '', not_relevant: rulesOut(q, chosen) } : { answer: chosen[0] ?? '', not_relevant: rulesOut(q, chosen) },
    );
  const toggle = (g: string) => setOpen((o) => (o.has(g) ? new Set([...o].filter((x) => x !== g)) : new Set([...o, g])));

  return (
    <section className="space-y-6">
      <ScreenHeader
        title="What I'm looking for in a provider"
        purpose="Choose the answers that fit, and add detail in your own words. Your interview questions follow from these."
        helpTopic="what-matters"
      />

      <div className="card sticky top-2 z-10 flex flex-wrap items-center gap-2 border-2 border-[var(--charcoal)]/20" aria-live="polite">
        <Icon name="note" />
        <p>
          Your interview pack: <strong className="tabular-nums">{count} questions</strong> in {pack.length} sections (all must-ask questions are always
          included).
        </p>
      </div>

      <LookingForSummary />

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => setOpen(new Set(seed.boundingGroups.map((g) => g.group)))}>
          Open all
        </button>
        <button type="button" className="btn" onClick={() => setOpen(new Set())}>
          Close all
        </button>
      </div>

      <div className="space-y-3">
        {seed.boundingGroups.map((g) => {
          const done = g.questions.filter((q) => isAnswered(q.id)).length;
          const isOpen = open.has(g.group);
          const panelId = `group-${g.group.replace(/\W+/g, '-')}`;
          return (
            <section key={g.group} className="card p-0">
              <h2 className="m-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(g.group)}
                  className="flex min-h-14 w-full items-center gap-3 p-4 text-left"
                >
                  <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[1.2rem] font-semibold">{g.group}</span>
                    <Meter value={done} max={g.questions.length} className="mt-1 max-w-48" />
                  </span>
                  <span className={`text-base font-normal ${done === g.questions.length ? 'status status-good' : ''}`}>
                    {done === g.questions.length && <Icon name="check" size={18} />}
                    {done} of {g.questions.length} answered
                  </span>
                </button>
              </h2>
              {isOpen && (
                <ol id={panelId} className="space-y-6 px-4 pb-4">
                  {g.questions.map((q) => {
                    const a = state.answers[q.id];
                    return (
                      <li key={q.id} className="space-y-3 border-t border-[var(--rule)] pt-4">
                        <QuestionAnswers q={q} answer={a} disabled={!canEdit} onChoose={(chosen) => choose(q, chosen)} />
                        {(a?.answer === 'unsure' || a?.choices?.includes('unsure')) && <p>We'll keep these interview questions in, just in case.</p>}
                        <div className="flex flex-wrap items-start gap-x-6 gap-y-1">
                          {q.informs_sections.length > 0 && canEdit && (
                            <button
                              type="button"
                              className="btn-quiet"
                              aria-pressed={!!a?.not_relevant}
                              onClick={() => save(q.id, { not_relevant: !a?.not_relevant })}
                            >
                              <Icon name={a?.not_relevant ? 'check' : 'close'} size={20} />
                              {a?.not_relevant ? 'Marked not relevant to me — undo' : 'Not relevant to me'}
                            </button>
                          )}
                          <Explain question="Why we ask">
                            {q.informs_sections.length ? (
                              <p>
                                Your answer shapes these interview sections: {q.informs_sections.map((c) => `${c} (${sectionName.get(c) ?? c})`).join(', ')}.
                                Marking it not relevant drops a section only when every question that covers it is not relevant.
                              </p>
                            ) : (
                              <p>{q.note ? `This helps ${q.note}.` : "This is background for the family; it doesn't change the interview questions."}</p>
                            )}
                          </Explain>
                        </div>
                        <OptionalNote
                          id={`notes-${q.id}`}
                          label="More detail"
                          addLabel="Add more detail in your own words"
                          value={a?.notes ?? ''}
                          readOnly={!canEdit}
                          onCommit={(v) => save(q.id, { notes: v })}
                        />
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          );
        })}
      </div>

      <NextStepCard
        done={`You've answered ${seed.boundingGroups.flatMap((g) => g.questions).filter((q) => isAnswered(q.id)).length} of ${seed.boundingGroups.reduce((n, g) => n + g.questions.length, 0)} questions.`}
        next="compare what your care plan would cost at each provider"
        back={{ to: '/overview', label: 'Your budget' }}
        forward={{ to: '/costs', label: 'Continue to compare costs' }}
      />
    </section>
  );
}

function QuestionAnswers({
  q,
  answer,
  disabled,
  onChoose,
}: {
  q: LookingForQuestion;
  answer: BoundingAnswer | undefined;
  disabled: boolean;
  onChoose: (chosen: string[]) => void;
}) {
  const opts = optionsFor(q);
  const legend = (
    <>
      <span className="muted mr-1 font-normal">{q.id}</span> {q.text}
    </>
  );
  // An answer given before these options existed is shown as it was written until it's changed.
  const earlier = q.type !== 'multi' && answer?.answer && !opts.some((o) => o.value === answer.answer) ? answer.answer : null;
  return (
    <>
      {q.type === 'multi' ? (
        <CheckCards
          legend={legend}
          value={answer?.choices ?? []}
          onChange={onChoose}
          choices={opts}
          max={q.max}
          disabled={disabled}
          columns={opts.length > 4 ? 3 : 2}
        />
      ) : (
        <ChoiceCards<string>
          legend={legend}
          name={`ans-${q.id}`}
          value={answer?.answer || null}
          onChange={(v) => onChoose([v])}
          disabled={disabled}
          columns={opts.length <= 3 ? 3 : 2}
          choices={opts}
        />
      )}
      {earlier && <p className="small">Earlier answer: “{earlier}”. Choose one of the answers above to replace it.</p>}
    </>
  );
}
