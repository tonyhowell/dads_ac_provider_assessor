import { ClaimLine } from '../components/Claims';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { entriesAt, newId } from '../state/reducer';
import { includedSections, interviewPack, packQuestionCount, type PackQuestion } from '../questions';
import { failedMustQuestions, responseKey } from '../scoring';
import { CommitTextarea } from '../components/CommitTextarea';
import { ConfirmButton } from '../components/ConfirmButton';
import { DependencyCard, NextStepCard, ResolutionCard, ScreenHeader } from '../components/ui/Cards';
import { Term } from '../components/ui/Help';
import { Icon } from '../components/ui/Icon';
import { Expander } from '../components/ui/Expander';
import { Meter } from '../components/ui/Visual';
import type { InterviewResponse } from '../types';

export function InterviewPackScreen() {
  const { seed, state, providers, canEdit } = useApp();
  const included = includedSections(seed.boundingGroups, seed.interviewSections, state.answers);
  const pack = interviewPack(seed.interviewSections, included, state.customQuestions);
  const shortlist = entriesAt(state, 'interview').flatMap((e) => {
    const p = providers.find((x) => x.id === e.provider_id);
    return p ? [{ provider: p, watch: e.watch }] : [];
  });
  const [providerId, setProviderId] = useState<string | null>(shortlist[0]?.provider.id ?? null);
  const current = shortlist.find((s) => s.provider.id === providerId) ?? shortlist[0] ?? null;
  const total = packQuestionCount(pack);
  const answered = (pid: string) => pack.flatMap((s) => s.questions).filter((q) => state.responses[responseKey(pid, q.id)]?.text.trim()).length;
  const failed = current ? failedMustQuestions(current.provider.id, seed.interviewSections, state.responses) : [];

  return (
    <section className="space-y-6">
      <ScreenHeader title="Your interview questions" purpose="Your questions for each provider, ready to use or print." helpTopic="interview-pack">
        <Link to="/interview-pack/print" className="btn btn-primary">
          Print or save as PDF
        </Link>
      </ScreenHeader>

      <p>
        {total} questions in {pack.length} sections, from your answers to <Link to="/bounding">what matters to you</Link>.{' '}
        <span className="chip chip-outline">■ Must ask</span> = get it in writing (<Term id="must-question">why?</Term>).
      </p>

      {shortlist.length === 0 ? (
        <DependencyCard to="/selection/interview" action="Choose providers to interview" minutes={2}>
          To record answers we need at least one provider on your interview list.
        </DependencyCard>
      ) : (
        <>
          <nav aria-label="Provider you're interviewing" className="card space-y-2">
            <p className="label">Recording answers for</p>
            <div className="flex flex-wrap gap-2">
              {shortlist.map(({ provider }) => (
                <button
                  key={provider.id}
                  type="button"
                  aria-pressed={current?.provider.id === provider.id}
                  className="btn"
                  onClick={() => setProviderId(provider.id)}
                >
                  {provider.provider}
                  <span className="font-normal">
                    · {answered(provider.id)} of {total}
                  </span>
                </button>
              ))}
            </div>
          </nav>
          {current && (
            <p>
              <Link to={`/dossier/${current.provider.id}`}>
                Make a dossier about you for {current.provider.provider}
              </Link>{' '}
              to give them before the interview.
            </p>
          )}
          {current?.watch && (
            <ResolutionCard
              status="info"
              title={`Watch for with ${current.provider.provider}`}
              moreLabel="Show"
              more={<p className="whitespace-pre-wrap">{current.watch}</p>}
            />
          )}
          {current && failed.length > 0 && answered(current.provider.id) > 0 && (
            <ResolutionCard
              status="stop"
              title={`Disqualify? ${current.provider.provider} hasn't answered ${failed.length} must-ask question${failed.length === 1 ? '' : 's'} in writing`}
              moreLabel="Which questions?"
              more={<p>Questions {failed.join(', ')}. Ask them to answer in writing, then tick "Got it in writing".</p>}
            />
          )}
        </>
      )}

      <div className="space-y-3">
        {pack.map((section, si) => {
          const done = current ? section.questions.filter((q) => state.responses[responseKey(current.provider.id, q.id)]?.text.trim()).length : 0;
          const musts = section.questions.filter((q) => q.priority === 'must').length;
          return (
            <Expander
              key={section.code}
              defaultOpen={si === 0}
              title={`${section.code}. ${section.section}`}
              visual={
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--charcoal)] font-semibold" aria-hidden>
                  {section.code}
                </span>
              }
              summary={
                <>
                  {section.included
                    ? `${section.questions.length} question${section.questions.length === 1 ? '' : 's'}`
                    : 'Must-ask only (ruled out by your answers)'}
                  {musts > 0 && ` · ${musts} must ask`}
                  {current && ` · ${done} answered`}
                </>
              }
              aside={
                current && (
                  <span className="hidden w-24 sm:block">
                    <Meter value={done} max={section.questions.length} />
                  </span>
                )
              }
            >
              <ol className="space-y-6">
                {section.questions.map((q) => (
                  <QuestionItem key={q.id} q={q} providerId={current?.provider.id ?? null} providerName={current?.provider.provider} />
                ))}
              </ol>
              {section.included && canEdit && <AddQuestion section={section.code} />}
            </Expander>
          );
        })}
      </div>

      <NextStepCard
        done="Your questions are ready."
        next="record an interview, or score the providers you've met"
        back={{ to: '/selection/interview', label: 'Choose who to meet' }}
        forward={{ to: '/interviews', label: 'Continue to interviews' }}
        primary={false}
      />
    </section>
  );
}

function QuestionItem({ q, providerId, providerName }: { q: PackQuestion; providerId: string | null; providerName?: string }) {
  const { state, dispatch, canEdit } = useApp();
  const r: InterviewResponse | undefined = providerId ? state.responses[responseKey(providerId, q.id)] : undefined;
  const set = (patch: { text?: string; rating?: InterviewResponse['rating']; in_writing?: boolean }) =>
    providerId && dispatch({ type: 'response/set', providerId, questionId: q.id, ...patch });
  const label = q.custom ? 'your added question' : q.id;

  return (
    <li className="space-y-3 border-t border-[var(--rule)] pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
          <span className="mr-2">{q.custom ? 'Your question' : q.id}</span>
          {q.priority === 'must' && <span className="chip chip-outline mr-2">■ Must ask</span>}
          {q.text}
        </p>
        {q.custom && canEdit && (
          <ConfirmButton
            className="btn btn-sm btn-danger"
            prompt="Delete this question and its answers?"
            confirmLabel="Delete question"
            onConfirm={() => dispatch({ type: 'question/delete', id: q.id })}
          >
            Delete <span className="sr-only">question</span>
          </ConfirmButton>
        )}
      </div>
      {providerId && <ClaimLine providerId={providerId} questionId={q.id} />}
      {providerId && (
        <fieldset disabled={!canEdit} className="well min-w-0 space-y-3">
          <div>
            <label htmlFor={`resp-${q.id}`} className="label">
              {providerName}'s answer to {label}
            </label>
            <CommitTextarea id={`resp-${q.id}`} className="input min-h-20" value={r?.text ?? ''} onCommit={(text) => set({ text })} />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">Answered well? ({label})</legend>
              <span aria-hidden className="font-medium">
                Answered well?
              </span>
              {(
                [
                  ['yes', 'Yes'],
                  ['partly', 'Partly'],
                  ['no', 'No'],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" aria-pressed={r?.rating === v} className="btn btn-sm" onClick={() => set({ rating: r?.rating === v ? null : v })}>
                  {l}
                </button>
              ))}
            </fieldset>
            <label className="flex min-h-[var(--target-min)] items-center gap-2">
              <input type="checkbox" checked={!!r?.in_writing} onChange={(e) => set({ in_writing: e.target.checked })} />
              Got it in writing <span className="sr-only">({label})</span>
            </label>
          </div>
        </fieldset>
      )}
    </li>
  );
}

function AddQuestion({ section }: { section: string }) {
  const { dispatch } = useApp();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    dispatch({
      type: 'question/add',
      question: { id: `cq-${newId()}`, section, text: text.trim() },
    });
    setText('');
    setOpen(false);
  };
  if (!open) {
    return (
      <button type="button" className="btn-quiet" onClick={() => setOpen(true)}>
        <Icon name="plus" size={20} /> Add your own question to section {section}
      </button>
    );
  }
  return (
    <form onSubmit={add} className="space-y-2 border-t border-[var(--rule)] pt-3">
      <label htmlFor={`add-${section}`} className="label">
        Your question for section {section}
      </label>
      <input id={`add-${section}`} className="input" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div className="flex gap-2">
        <button type="submit" className="btn">
          Add question
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
