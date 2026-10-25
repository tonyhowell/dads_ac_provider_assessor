import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { includedSections, interviewPack, packQuestionCount } from '../questions';
import { CommitTextarea } from '../components/CommitTextarea';
import { NextStepCard, ScreenHeader } from '../components/ui/Cards';
import { ChoiceCards } from '../components/ui/Form';
import { Explain } from '../components/ui/Help';
import { Icon } from '../components/ui/Icon';
import type { BoundingAnswer } from '../types';

type Answer = 'yes' | 'no' | 'unsure';

export function BoundingScreen() {
  const { seed, state, dispatch } = useApp();
  const included = includedSections(seed.boundingGroups, seed.interviewSections, state.answers);
  const pack = interviewPack(seed.interviewSections, included, state.customQuestions);
  const count = packQuestionCount(pack);
  const sectionName = new Map(seed.interviewSections.map((s) => [s.code, s.section]));
  const isAnswered = (id: string) => !!(state.answers[id]?.answer || state.answers[id]?.not_relevant);
  const [open, setOpen] = useState<Set<string>>(() => new Set([seed.boundingGroups[0]?.group]));

  const save = (questionId: string, patch: Partial<BoundingAnswer>) => {
    const prev = state.answers[questionId] ?? { answer: '', notes: '', not_relevant: false };
    dispatch({ type: 'bounding/answer', questionId, answer: { ...prev, ...patch } });
  };
  const toggle = (g: string) => setOpen((o) => (o.has(g) ? new Set([...o].filter((x) => x !== g)) : new Set([...o, g])));

  return (
    <section className="space-y-6">
      <ScreenHeader title="What matters to you" purpose="Answer these so your interview questions fit your needs. You can skip any question." helpTopic="what-matters" />

      <div className="card sticky top-2 z-10 flex flex-wrap items-center gap-2 border-2 border-[var(--charcoal)]/20" aria-live="polite">
        <Icon name="note" />
        <p>
          Your interview pack: <strong className="tabular-nums">{count} questions</strong> in {pack.length} sections (all must-ask questions are always included).
        </p>
      </div>

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
                <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(g.group)} className="flex min-h-14 w-full items-center gap-3 p-4 text-left">
                  <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} />
                  <span className="min-w-0 flex-1 text-[1.2rem] font-semibold">{g.group}</span>
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
                        <ChoiceCards<Answer>
                          legend={
                            <>
                              <span className="muted mr-1 font-normal">{q.id}</span> {q.text}
                            </>
                          }
                          name={`ans-${q.id}`}
                          value={(a?.answer as Answer) || null}
                          onChange={(v) => save(q.id, { answer: v })}
                          columns={3}
                          choices={[
                            { value: 'yes', label: 'Yes' },
                            { value: 'no', label: 'No' },
                            { value: 'unsure', label: 'Not sure' },
                          ]}
                        />
                        {a?.answer === 'unsure' && <p>We'll keep these interview questions in, just in case.</p>}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          {q.informs_sections.length > 0 && (
                            <button type="button" className="btn-quiet" aria-pressed={!!a?.not_relevant} onClick={() => save(q.id, { not_relevant: !a?.not_relevant })}>
                              <Icon name={a?.not_relevant ? 'check' : 'close'} size={20} />
                              {a?.not_relevant ? 'Marked not relevant to me — undo' : 'Not relevant to me'}
                            </button>
                          )}
                        </div>
                        <Explain question="Why we ask">
                          {q.informs_sections.length ? (
                            <p>
                              Your answer shapes these interview sections: {q.informs_sections.map((c) => `${c} (${sectionName.get(c) ?? c})`).join(', ')}. Marking it not relevant drops a section only when every
                              question that covers it is not relevant.
                            </p>
                          ) : (
                            <p>{q.note ? `This helps ${q.note}.` : 'This is background for the family; it doesn\'t change the interview questions.'}</p>
                          )}
                        </Explain>
                        <div>
                          <label htmlFor={`notes-${q.id}`} className="label">
                            Notes (optional)
                          </label>
                          <CommitTextarea id={`notes-${q.id}`} className="input min-h-16" value={a?.notes ?? ''} onCommit={(v) => save(q.id, { notes: v })} />
                        </div>
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
