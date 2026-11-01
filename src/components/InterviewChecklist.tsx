import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/AppContext';
import { responseKey } from '../scoring';
import { useTailored } from '../screens/PrepareScreen';
import type { TailoredQuestion } from '../tailored';
import type { Provider } from '../types';
import { Icon } from './ui/Icon';

// The interview checklist (improvement plan 3.3): the tailored questions for this provider, ticked off as
// they're answered, with a rating and a short note saved as the interview goes. While recording with live
// transcription, Claude checks the transcript about once a minute and marks what's been answered, so the
// family can see what's still to ask before they finish.

export const GAP_CHECK_EVERY_MS = 60_000;

interface Heard {
  level: 'yes' | 'partly';
  answer: string;
}

export function InterviewChecklist({ provider, transcript, recording, phone }: { provider: Provider; transcript: string; recording: boolean; phone: boolean }) {
  const { application, state, dispatch, canEdit } = useApp();
  const { focus, rest } = useTailored(provider);
  const [showAll, setShowAll] = useState(false);
  const [heard, setHeard] = useState<Record<string, Heard>>({});
  const [checkError, setCheckError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [one, setOne] = useState(0);
  const questions = showAll ? [...focus, ...rest] : focus;
  const response = (q: TailoredQuestion) => state.responses[responseKey(provider.id, q.id)];
  const done = (q: TailoredQuestion) => response(q)?.rating === 'yes';
  const open = questions.filter((q) => !done(q));
  const openMust = open.filter((q) => q.must && heard[q.id]?.level !== 'yes');

  // The latest values, read by the timer without restarting it.
  const latest = useRef({ transcript, open });
  latest.current = { transcript, open };
  const checkedLength = useRef(0);

  useEffect(() => {
    if (!recording || !canEdit) return;
    const timer = setInterval(async () => {
      const { transcript: t, open: o } = latest.current;
      // Only check when there's new speech, and something left to ask.
      if (t.trim().length < 40 || t.length <= checkedLength.current || !o.length) return;
      checkedLength.current = t.length;
      try {
        const r = await api<{ answered: { question_id: string; level: 'yes' | 'partly'; answer: string }[] }>(`/api/applications/${encodeURIComponent(application.id)}/gap-check`, {
          body: { transcript: t, questions: o.map((q) => ({ id: q.id, text: q.text })) },
        });
        setHeard((h) => {
          const next = { ...h };
          for (const a of r.answered) if (next[a.question_id]?.level !== 'yes') next[a.question_id] = { level: a.level, answer: a.answer };
          return next;
        });
        setCheckError(null);
        setLastCheck(new Date().toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' }));
      } catch (err) {
        setCheckError(err instanceof Error ? err.message : 'Could not check the interview.');
      }
    }, GAP_CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [recording, canEdit, application.id]);

  const rate = (q: TailoredQuestion, rating: 'yes' | 'partly' | 'no') =>
    dispatch({ type: 'response/set', providerId: provider.id, questionId: q.id, rating: response(q)?.rating === rating ? null : rating, ...(response(q)?.text || !heard[q.id] ? {} : { text: heard[q.id].answer }) });
  const note = (q: TailoredQuestion, text: string) => {
    if (text !== (response(q)?.text ?? '')) dispatch({ type: 'response/set', providerId: provider.id, questionId: q.id, text });
  };

  const current = open[Math.min(one, open.length - 1)];

  return (
    <section className="card space-y-3" aria-labelledby="checklist-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="checklist-heading" className="text-[1.2rem]">
          Question checklist
        </h2>
        <p className="font-medium" role="status">
          {questions.length - open.length} of {questions.length} answered
          {openMust.length > 0 && ` · ${openMust.length} must-ask still to go`}
        </p>
      </div>
      {recording && (
        <p className="small">
          <Icon name="star" size={16} /> Claude checks what's been answered about once a minute{lastCheck ? ` (last checked ${lastCheck})` : ''}. Tick each one yourself to confirm.
        </p>
      )}
      {checkError && (
        <p className="small" role="alert">
          The live check didn't work: {checkError} Carry on with the list.
        </p>
      )}

      {phone && current ? (
        <div className="well space-y-3" aria-label="One question at a time">
          <p className="small">
            Question {Math.min(one, open.length - 1) + 1} of {open.length} still to ask
          </p>
          <Line q={current} heard={heard[current.id]} response={response(current)} canEdit={canEdit} onRate={rate} onNote={note} large />
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={one <= 0} onClick={() => setOne((n) => Math.max(0, n - 1))}>
              Previous
            </button>
            <button type="button" className="btn" disabled={one >= open.length - 1} onClick={() => setOne((n) => Math.min(open.length - 1, n + 1))}>
              Next question
            </button>
          </div>
        </div>
      ) : phone ? (
        <p className="well font-semibold">Every question on the list has been answered.</p>
      ) : (
        <ol className="space-y-3">
          {questions.map((q) => (
            <li key={q.id}>
              <Line q={q} heard={heard[q.id]} response={response(q)} canEdit={canEdit} onRate={rate} onNote={note} />
            </li>
          ))}
        </ol>
      )}
      {rest.length > 0 && (
        <label className="flex min-h-[var(--target-min)] items-center gap-3">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include the rest of your questions ({rest.length} more)
        </label>
      )}
    </section>
  );
}

const RATINGS = [
  ['yes', 'Answered'],
  ['partly', 'Partly'],
  ['no', 'Not answered'],
] as const;

function Line({
  q,
  heard,
  response,
  canEdit,
  onRate,
  onNote,
  large = false,
}: {
  q: TailoredQuestion;
  heard: Heard | undefined;
  response: { text: string; rating: 'yes' | 'partly' | 'no' | null } | undefined;
  canEdit: boolean;
  onRate: (q: TailoredQuestion, r: 'yes' | 'partly' | 'no') => void;
  onNote: (q: TailoredQuestion, text: string) => void;
  large?: boolean;
}) {
  const id = `note-${q.id}`;
  return (
    <div className={`space-y-1 rounded-[var(--radius-control)] border p-3 ${response?.rating === 'yes' ? 'border-[var(--line)] opacity-80' : 'border-[var(--charcoal)]'}`}>
      <p className={large ? 'text-[1.25rem] font-semibold' : 'font-medium'}>
        {response?.rating === 'yes' && <Icon name="check" size={18} />} {q.text}
        {q.must && <span className="small"> · must-ask</span>}
      </p>
      {q.why && <p className="small">{q.why}</p>}
      {q.theySay && <p className="small">They say publicly: “{q.theySay}”</p>}
      {heard && (
        <p className="small font-medium" role="note">
          <Icon name="star" size={16} /> Heard{heard.level === 'partly' ? ' (partly)' : ''}: {heard.answer}
        </p>
      )}
      {canEdit && (
        <>
          <div role="group" aria-label={`How well was it answered: ${q.text}`} className="flex flex-wrap gap-2">
            {RATINGS.map(([value, label]) => (
              <button key={value} type="button" className="btn" aria-pressed={response?.rating === value} onClick={() => onRate(q, value)}>
                {label}
              </button>
            ))}
          </div>
          <label htmlFor={id} className="sr-only">
            Note: {q.text}
          </label>
          <input key={response?.text ?? ""} id={id} className="input" placeholder="Their answer, in a few words" defaultValue={response?.text ?? ''} onBlur={(e) => onNote(q, e.target.value)} />
        </>
      )}
    </div>
  );
}
