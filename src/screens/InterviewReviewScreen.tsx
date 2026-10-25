import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, useProvider } from '../state/AppContext';
import { newId } from '../state/reducer';
import { formatDate, formatDateTime, formatDuration } from '../format';
import { mustQuestions, notesToText, requestInterviewNotes } from '../interviews';
import { ConfirmButton } from '../components/ConfirmButton';
import { ResolutionCard } from '../components/ui/Cards';
import { WorkingGrid } from '../components/ui/Feedback';
import { Icon } from '../components/ui/Icon';
import type { InterviewNotes } from '../types';

type ListKey = Exclude<keyof InterviewNotes, 'summary'>;

export function InterviewReviewScreen() {
  const { id } = useParams();
  const { state, seed, dispatch, audio } = useApp();
  const navigate = useNavigate();
  const interview = state.interviews.find((i) => i.id === id);
  const provider = useProvider(interview?.provider_id);

  const [transcript, setTranscript] = useState(interview?.transcript ?? '');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioMissing, setAudioMissing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToNotes, setSavedToNotes] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!interview?.audio_id) return;
    let url: string | null = null;
    let cancelled = false;
    audio
      .get(interview.audio_id)
      .catch(() => undefined)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) return setAudioMissing(true);
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [interview?.audio_id, audio]);

  if (!interview || !provider) {
    return <ResolutionCard status="caution" title="We couldn't find that interview" actions={<Link to="/interviews" className="btn btn-primary">Back to interviews</Link>} />;
  }

  const transcriptDirty = transcript !== interview.transcript;
  const saveTranscript = () => dispatch({ type: 'interview/save', interview: { ...interview, transcript } });
  const setNotes = (notes: InterviewNotes) => {
    dispatch({ type: 'interview/notes', id: interview.id, notes, at: new Date().toISOString() });
    setSavedToNotes(false);
  };

  const draft = async () => {
    if (transcriptDirty) saveTranscript();
    setDrafting(true);
    setError(null);
    abort.current = new AbortController();
    try {
      const notes = await requestInterviewNotes(
        { provider_name: provider.provider, interview_date: formatDate(interview.started_at), transcript, questions: mustQuestions(seed.interviewSections) },
        fetch,
        abort.current.signal,
      );
      setNotes(notes);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setDrafting(false);
    }
  };

  const writeMyself = () => setNotes({ summary: '', strengths: [], concerns: [], commitments: [], pricing_mentions: [], follow_up_questions: [] });

  const saveToProviderNotes = () => {
    if (!interview.notes) return;
    dispatch({
      type: 'note/add',
      note: { id: newId(), provider_id: provider.id, text: notesToText(interview.notes, `Interview ${formatDateTime(interview.started_at)}`), created_at: new Date().toISOString(), source: 'interview', interview_id: interview.id },
    });
    setSavedToNotes(true);
  };

  const remove = async () => {
    if (interview.audio_id) await audio.delete(interview.audio_id).catch(() => undefined);
    dispatch({ type: 'interview/delete', id: interview.id });
    navigate('/interviews');
  };

  return (
    <section className="space-y-6">
      <Link to="/interviews" className="btn-quiet">
        <Icon name="arrowLeft" size={20} /> All interviews
      </Link>
      <div className="space-y-2">
        <h1>Check your interview with {provider.provider}</h1>
        <p>
          {formatDateTime(interview.started_at)}
          {interview.audio_id && ` · ${formatDuration(interview.duration_seconds)}`}
          {interview.interviewer && ` · by ${interview.interviewer}`}
          {interview.consent_confirmed && ' · everyone agreed to the recording'}
        </p>
      </div>

      {interview.audio_id && (
        <section aria-labelledby="recording-heading" className="card space-y-2">
          <h2 id="recording-heading">Recording</h2>
          {audioUrl ? (
            <>
              <audio controls src={audioUrl} className="w-full">
                Your browser can't play this recording.
              </audio>
              <p className="muted">Stored only on this device. Clearing the browser's site data deletes it.</p>
            </>
          ) : audioMissing ? (
            <p>The recording is kept only on the device that made it. The transcript below is shared with your family.</p>
          ) : (
            <p>Loading the recording…</p>
          )}
        </section>
      )}

      <section aria-labelledby="transcript-heading" className="card space-y-3">
        <h2 id="transcript-heading">Transcript</h2>
        <label htmlFor="transcript" className="label">
          What was said
        </label>
        <span className="hint">
          Fix any misheard words and remove anything you don't want kept before drafting notes.
          {!interview.transcript && ' Nothing was captured automatically — type or paste what was said.'}
        </span>
        <textarea id="transcript" className="input min-h-64" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
        <button type="button" className="btn" onClick={saveTranscript} disabled={!transcriptDirty}>
          {transcriptDirty ? 'Save transcript' : (
            <>
              <Icon name="check" size={20} /> Transcript saved
            </>
          )}
        </button>
      </section>

      <section aria-labelledby="notes-heading" className="card space-y-4">
        <h2 id="notes-heading">Notes</h2>
        <p>Notes drafted by Claude from your transcript (not the audio). Check them, keep what's right, then save them to {provider.provider}'s notes.</p>
        {!drafting && (
          <button type="button" className={`btn ${interview.notes ? '' : 'btn-primary'}`} onClick={draft} disabled={transcript.trim().length < 20}>
            {interview.notes ? 'Draft the notes again' : 'Draft notes from transcript'}
          </button>
        )}
        {transcript.trim().length < 20 && !interview.notes && <p>Add at least a few sentences of transcript first.</p>}
        {drafting && (
          <WorkingGrid onCancel={() => abort.current?.abort()}>Drafting notes from your transcript. This usually takes about 20 seconds.</WorkingGrid>
        )}
        {error && (
          <ResolutionCard
            status="stop"
            title="We couldn't draft the notes just now"
            role="alert"
            actions={
              <>
                <button type="button" className="btn" onClick={draft}>
                  Try again
                </button>
                <button type="button" className="btn" onClick={writeMyself}>
                  Write notes myself
                </button>
              </>
            }
          >
            <p>{error} Your transcript is safe.</p>
          </ResolutionCard>
        )}
        {interview.notes && <NotesEditor notes={interview.notes} onChange={setNotes} />}
        {interview.notes && (
          <button type="button" className="btn btn-primary" onClick={saveToProviderNotes} disabled={savedToNotes}>
            {savedToNotes ? (
              <>
                <Icon name="check" size={20} /> Saved to {provider.provider}'s notes
              </>
            ) : (
              `Save to ${provider.provider}'s notes`
            )}
          </button>
        )}
      </section>

      <ConfirmButton prompt="Delete this interview for everyone? Notes already saved to the provider are kept." confirmLabel="Delete interview" onConfirm={remove}>
        <Icon name="octagon" size={20} /> Delete interview
      </ConfirmButton>
    </section>
  );
}

/** Every drafted item can be kept, edited or removed before saving (UI-SPEC §7.8). */
function NotesEditor({ notes, onChange }: { notes: InterviewNotes; onChange: (n: InterviewNotes) => void }) {
  const allKeys: { key: ListKey; label: string }[] = [
    { key: 'strengths', label: 'Strengths' },
    { key: 'concerns', label: 'Concerns' },
    { key: 'commitments', label: 'Commitments made' },
    { key: 'pricing_mentions', label: 'Prices and fees mentioned' },
    { key: 'follow_up_questions', label: 'Follow up (including unanswered must-ask questions)' },
  ];
  const update = (key: ListKey, items: string[]) => onChange({ ...notes, [key]: items });
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="notes-summary" className="label">
          Summary
        </label>
        <textarea id="notes-summary" className="input min-h-24" defaultValue={notes.summary} onBlur={(e) => e.target.value !== notes.summary && onChange({ ...notes, summary: e.target.value })} />
      </div>
      {allKeys.map(({ key, label }) => (
        <section key={key} className="space-y-2" aria-label={label}>
          <h3>{label}</h3>
          {notes[key].length === 0 && <p className="muted">None.</p>}
          <ul className="space-y-2">
            {notes[key].map((item, i) => (
              <NoteItemRow key={`${key}-${i}-${item}`} item={item} onSave={(v) => update(key, notes[key].map((x, j) => (j === i ? v : x)))} onRemove={() => update(key, notes[key].filter((_, j) => j !== i))} />
            ))}
          </ul>
          <button type="button" className="btn-quiet" onClick={() => update(key, [...notes[key], ''])}>
            <Icon name="plus" size={20} /> Add to {label.toLowerCase().split(' (')[0]}
          </button>
        </section>
      ))}
    </div>
  );
}

function NoteItemRow({ item, onSave, onRemove }: { item: string; onSave: (v: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(item === '');
  const [text, setText] = useState(item);
  if (editing) {
    return (
      <li className="well space-y-2">
        <label className="sr-only" htmlFor={`edit-${item}`}>
          Edit item
        </label>
        <textarea id={`edit-${item}`} className="input min-h-16" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" onClick={() => (text.trim() ? (onSave(text.trim()), setEditing(false)) : onRemove())}>
            Keep
          </button>
          <button type="button" className="btn btn-sm" onClick={() => (item ? (setText(item), setEditing(false)) : onRemove())}>
            Cancel
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="well flex flex-wrap items-start justify-between gap-2">
      <span className="min-w-0 flex-1">{item}</span>
      <span className="flex gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
          Remove
        </button>
      </span>
    </li>
  );
}
