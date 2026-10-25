import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { entriesAt, newId } from '../state/reducer';
import { includedSections, interviewPack, packQuestionCount, type PackQuestion } from '../questions';
import { failedMustQuestions, responseKey } from '../scoring';
import { CommitTextarea } from '../components/CommitTextarea';
import { ConfirmButton } from '../components/ConfirmButton';

export function InterviewPackScreen() {
  const { seed, state, providers } = useApp();
  const included = includedSections(seed.boundingGroups, seed.interviewSections, state.answers);
  const pack = interviewPack(seed.interviewSections, included, state.customQuestions);
  const shortlist = entriesAt(state, 'interview').flatMap((e) => providers.filter((p) => p.id === e.provider_id));
  const [providerId, setProviderId] = useState<string | null>(shortlist[0]?.id ?? null);
  const current = shortlist.find((p) => p.id === providerId) ?? shortlist[0] ?? null;
  const answeredCount = (pid: string) => pack.flatMap((s) => s.questions).filter((q) => state.responses[responseKey(pid, q.id)]?.text.trim()).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Interview pack</h1>
          <p className="muted mt-1">
            {packQuestionCount(pack)} questions in {pack.length} sections, filtered by the <Link to="/bounding">bounding answers</Link>. Record each
            provider's answers as you go, or afterwards from the interview notes.
          </p>
        </div>
        <Link to="/interview-pack/print" className="btn no-underline hover:no-underline">
          Printable pack
        </Link>
      </div>

      {shortlist.length === 0 ? (
        <p className="card">
          No providers on the interview shortlist yet. <Link to="/selection/interview">Advance providers to stage 3</Link> to record their answers here.
        </p>
      ) : (
        <nav aria-label="Provider" className="card space-y-2">
          <p className="muted text-sm">Recording answers for</p>
          <div className="flex flex-wrap gap-2">
            {shortlist.map((p) => {
              // "Must" questions are always in the pack, so check them against the full question list.
              const failed = failedMustQuestions(p.id, seed.interviewSections, state.responses);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={current?.id === p.id}
                  className={current?.id === p.id ? 'btn btn-primary' : 'btn'}
                  onClick={() => setProviderId(p.id)}
                >
                  {p.provider}
                  <span className="text-xs opacity-80">
                    {' '}
                    · {answeredCount(p.id)}/{packQuestionCount(pack)}
                    {failed.length > 0 && ` · ${failed.length} must open`}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {pack.map((section) => (
        <section key={section.code} className="card space-y-3" aria-labelledby={`sec-${section.code}`}>
          <h2 id={`sec-${section.code}`} className="font-semibold">
            {section.code}. {section.section}
            {!section.included && <span className="muted ml-2 text-sm font-normal">Ruled out by bounding answers; "must" questions only</span>}
          </h2>
          <ol className="space-y-4">
            {section.questions.map((q) => (
              <QuestionItem key={q.id} q={q} providerId={current?.id ?? null} />
            ))}
          </ol>
          {section.included && <AddQuestion section={section.code} />}
        </section>
      ))}
    </section>
  );
}

function QuestionItem({ q, providerId }: { q: PackQuestion; providerId: string | null }) {
  const { state, dispatch } = useApp();
  const r = providerId ? state.responses[responseKey(providerId, q.id)] : undefined;
  return (
    <li className="space-y-2 border-t border-slate-200 pt-3 first:border-t-0 first:pt-0 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p>
          <span className="muted mr-1">{q.custom ? 'Added' : q.id}</span>
          {q.priority === 'must' && (
            <span className="mr-1 rounded bg-teal-100 px-1.5 text-xs font-semibold text-teal-900 uppercase dark:bg-teal-900 dark:text-teal-100">Must</span>
          )}
          {q.text}
        </p>
        {q.custom && (
          <ConfirmButton className="btn text-xs" prompt="Delete this question and its answers?" confirmLabel="Delete" onConfirm={() => dispatch({ type: 'question/delete', id: q.id })}>
            Delete <span className="sr-only">question</span>
          </ConfirmButton>
        )}
      </div>
      {providerId && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor={`resp-${q.id}`} className="sr-only">
              Answer to {q.custom ? 'added question' : q.id}
            </label>
            <CommitTextarea
              id={`resp-${q.id}`}
              className="input min-h-16 text-sm"
              value={r?.text ?? ''}
              onCommit={(text) => dispatch({ type: 'response/set', providerId, questionId: q.id, text })}
            />
          </div>
          <div>
            <label htmlFor={`sat-${q.id}`} className="muted block text-xs">
              Satisfactory?
            </label>
            <select
              id={`sat-${q.id}`}
              className="input"
              value={r?.satisfactory == null ? '' : r.satisfactory ? 'yes' : 'no'}
              onChange={(e) =>
                dispatch({ type: 'response/set', providerId, questionId: q.id, satisfactory: e.target.value === '' ? null : e.target.value === 'yes' })
              }
            >
              <option value="">—</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>
      )}
    </li>
  );
}

function AddQuestion({ section }: { section: string }) {
  const { dispatch } = useApp();
  const [text, setText] = useState('');
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    dispatch({ type: 'question/add', question: { id: `cq-${newId()}`, section, text: text.trim() } });
    setText('');
  };
  return (
    <form onSubmit={add} className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
      <label htmlFor={`add-${section}`} className="sr-only">
        Add a question to section {section}
      </label>
      <input id={`add-${section}`} className="input flex-1" placeholder="Add your own question to this section" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="btn" disabled={!text.trim()}>
        Add question
      </button>
    </form>
  );
}
