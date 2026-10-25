import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { includedSections, interviewPack, packQuestionCount } from '../questions';
import { CommitTextarea } from '../components/CommitTextarea';
import type { BoundingAnswer } from '../types';

const CHOICES = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['unsure', 'Unsure'],
] as const;

export function BoundingScreen() {
  const { seed, state, dispatch } = useApp();
  const included = includedSections(seed.boundingGroups, seed.interviewSections, state.answers);
  const count = packQuestionCount(interviewPack(seed.interviewSections, included, state.customQuestions));
  const total = packQuestionCount(interviewPack(seed.interviewSections, new Set(seed.interviewSections.map((s) => s.code)), state.customQuestions));
  const sectionName = new Map(seed.interviewSections.map((s) => [s.code, s.section]));
  const answered = seed.boundingGroups.flatMap((g) => g.questions).filter((q) => state.answers[q.id]?.answer || state.answers[q.id]?.not_relevant).length;
  const totalBounding = seed.boundingGroups.reduce((n, g) => n + g.questions.length, 0);

  const save = (questionId: string, patch: Partial<BoundingAnswer>) => {
    const prev = state.answers[questionId] ?? { answer: '', notes: '', not_relevant: false };
    dispatch({ type: 'bounding/answer', questionId, answer: { ...prev, ...patch } });
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Bounding questions</h1>
        <p className="muted mt-1">
          Answer these as a family before the interviews. Mark a question "not relevant" to drop the interview sections it covers; a section is dropped
          only when every question that covers it is not relevant. "Must" questions are always asked.
        </p>
      </div>

      <div className="card sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2" aria-live="polite">
        <p>
          <strong className="tabular-nums">{count}</strong> of {total} interview questions included · {included.size} of {seed.interviewSections.length} sections
        </p>
        <p className="muted text-sm">
          {answered} of {totalBounding} answered · <Link to="/interview-pack">Open the interview pack</Link>
        </p>
      </div>

      <div className="space-y-3">
        {seed.boundingGroups.map((g, gi) => {
          const done = g.questions.filter((q) => state.answers[q.id]?.answer || state.answers[q.id]?.not_relevant).length;
          return (
            <details key={g.group} className="card" open={gi === 0}>
              <summary className="cursor-pointer font-semibold">
                {g.group} <span className="muted font-normal">({done} of {g.questions.length} answered)</span>
              </summary>
              <ol className="mt-3 space-y-4">
                {g.questions.map((q) => {
                  const a = state.answers[q.id];
                  return (
                    <li key={q.id} className="space-y-2 border-t border-slate-200 pt-3 first:border-t-0 first:pt-0 dark:border-slate-800">
                      <p className="font-medium">
                        <span className="muted mr-1 font-normal">{q.id}</span> {q.text}
                      </p>
                      <p className="muted text-xs">
                        {q.informs_sections.length
                          ? `Covers: ${q.informs_sections.map((c) => `${c} ${sectionName.get(c) ?? ''}`.trim()).join(' · ')}`
                          : q.note
                            ? `Note: ${q.note}`
                            : 'Background only'}
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <fieldset className="flex flex-wrap gap-3">
                          <legend className="sr-only">Answer to {q.id}</legend>
                          {CHOICES.map(([v, label]) => (
                            <label key={v} className="flex items-center gap-1">
                              <input type="radio" name={`ans-${q.id}`} checked={a?.answer === v} onChange={() => save(q.id, { answer: v })} />
                              {label}
                            </label>
                          ))}
                        </fieldset>
                        {q.informs_sections.length > 0 && (
                          <label className="ml-auto flex items-center gap-1 text-sm">
                            <input type="checkbox" checked={!!a?.not_relevant} onChange={(e) => save(q.id, { not_relevant: e.target.checked })} />
                            Not relevant
                          </label>
                        )}
                      </div>
                      <label htmlFor={`notes-${q.id}`} className="sr-only">
                        Notes for {q.id}
                      </label>
                      <CommitTextarea id={`notes-${q.id}`} className="input min-h-14 text-sm" value={a?.notes ?? ''} onCommit={(v) => save(q.id, { notes: v })} />
                    </li>
                  );
                })}
              </ol>
            </details>
          );
        })}
      </div>
    </section>
  );
}
