import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/AppContext';
import { optionsFor, rulesOut } from '../lookingFor';
import { recorderSupport, useRecorder } from './useRecorder';
import { Expander } from './ui/Expander';
import { ResolutionCard } from './ui/Cards';
import { Icon } from './ui/Icon';
import { formatDuration } from '../format';

// Gather: record a family conversation, and Claude suggests answers to these questions from it, each with the
// words it came from. Each suggestion is accepted, or skipped, by the family; nothing is saved otherwise.
// Only the transcript is sent (audio stays in the browser).

interface Suggestion {
  question_id: string;
  choices: string[];
  detail: string;
  quote: string;
}

export function FamilyConversation({ groups }: { groups: string[] }) {
  const { application, seed, state, dispatch, canEdit } = useApp();
  const support = recorderSupport();
  const rec = useRecorder({ transcribe: support.transcription });
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [handled, setHandled] = useState<Set<string>>(new Set());
  if (!canEdit) return null;

  const questions = new Map(seed.boundingGroups.filter((g) => groups.includes(g.group)).flatMap((g) => g.questions).map((q) => [q.id, q]));

  const stop = async () => {
    const result = await rec.stop();
    setTranscript((t) => [t, result.transcript].filter(Boolean).join('\n'));
  };

  const suggest = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ suggestions: Suggestion[] }>(`/api/applications/${encodeURIComponent(application.id)}/gather/conversation`, { body: { transcript, groups } });
      setSuggestions(r.suggestions);
      setHandled(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not suggest answers.');
    } finally {
      setBusy(false);
    }
  };

  const accept = (s: Suggestion) => {
    const q = questions.get(s.question_id);
    if (!q) return;
    const prev = state.answers[q.id] ?? { answer: '', notes: '', not_relevant: false };
    const choice = s.choices.length ? (q.type === 'multi' ? { choices: s.choices, answer: '' } : { answer: s.choices[0] }) : {};
    const notes = s.detail.trim() ? [prev.notes?.trim(), s.detail.trim()].filter(Boolean).join('\n') : prev.notes;
    dispatch({ type: 'bounding/answer', questionId: q.id, answer: { ...prev, ...choice, notes, not_relevant: s.choices.length ? rulesOut(q, s.choices) : prev.not_relevant } });
    setHandled((h) => new Set([...h, s.question_id]));
  };
  const open = suggestions?.filter((s) => !handled.has(s.question_id)) ?? [];

  return (
    <Expander icon="users" title="Record a family conversation" summary="Talk it through together; Claude suggests answers for you to check">
      <div className="space-y-3">
        <p>
          Record a conversation about these questions, for example around the kitchen table. Claude suggests answers from what's said, each with the words it came from; you accept or skip each one. Only the
          words are sent to Claude: the recording stays on this device.
        </p>
        {support.recording && support.transcription ? (
          <div className="flex flex-wrap items-center gap-2">
            {rec.status === 'recording' || rec.status === 'paused' ? (
              <>
                <span role="status" className="chip chip-stop">
                  Recording {formatDuration(rec.elapsed)}
                </span>
                <button type="button" className="btn" onClick={stop}>
                  Stop
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => rec.start()}>
                <Icon name="clock" size={20} /> {transcript ? 'Record more' : 'Start recording'}
              </button>
            )}
          </div>
        ) : (
          <p className="small">This browser can't turn speech into words. Type or paste notes of the conversation below instead.</p>
        )}
        {rec.error && <p className="text-[var(--stop)]">{rec.error}</p>}
        {(rec.status === 'recording' || rec.interimText) && (
          <p className="well text-[0.95rem]" aria-live="polite">
            {rec.transcript} <span className="italic">{rec.interimText}</span>
          </p>
        )}
        <div>
          <label htmlFor="conversation-text" className="label">
            What was said
          </label>
          <textarea id="conversation-text" className="input min-h-32" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary" disabled={busy || transcript.trim().length < 40 || rec.status === 'recording'} onClick={suggest}>
          {busy ? 'Suggesting answers…' : 'Suggest answers'}
        </button>
        {error && (
          <ResolutionCard status="stop" title="That didn't work" role="alert">
            <p>{error}</p>
          </ResolutionCard>
        )}
        {suggestions && (
          <section aria-labelledby="suggested" className="space-y-2">
            <h3 id="suggested" className="font-semibold">
              {open.length ? `${open.length} suggested answer${open.length === 1 ? '' : 's'} to check` : suggestions.length ? 'All suggestions handled.' : 'No answers found in this conversation.'}
            </h3>
            {open.length > 1 && (
              <button type="button" className="btn btn-sm" onClick={() => open.forEach(accept)}>
                Accept all {open.length}
              </button>
            )}
            <ul className="space-y-2">
              {open.map((s) => {
                const q = questions.get(s.question_id)!;
                const labels = optionsFor(q)
                  .filter((o) => s.choices.includes(o.value))
                  .map((o) => o.label);
                return (
                  <li key={s.question_id} className="rounded-[var(--radius-control)] border border-[var(--rule)] p-3">
                    <p className="font-semibold">{q.text}</p>
                    {labels.length > 0 && <p>Answer: {labels.join(', ')}</p>}
                    {s.detail && <p>Detail: {s.detail}</p>}
                    <p className="small italic">“{s.quote}”</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="btn btn-sm" onClick={() => accept(s)}>
                        Accept <span className="sr-only">: {q.text}</span>
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setHandled((h) => new Set([...h, s.question_id]))}>
                        Skip <span className="sr-only">: {q.text}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Expander>
  );
}
