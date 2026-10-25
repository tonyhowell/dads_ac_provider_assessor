import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, useProvider } from '../state/AppContext';
import { newId } from '../state/reducer';
import { formatDate, formatDateTime, formatDuration } from '../format';
import { mustQuestions, notesSections, notesToText, requestInterviewNotes } from '../interviews';
import { ConfirmButton } from '../components/ConfirmButton';

export function InterviewReviewScreen() {
  const { id } = useParams();
  const { state, seed, dispatch, audio } = useApp();
  const navigate = useNavigate();
  const interview = state.interviews.find((i) => i.id === id);
  const provider = useProvider(interview?.provider_id);

  const [transcript, setTranscript] = useState(interview?.transcript ?? '');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioMissing, setAudioMissing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToNotes, setSavedToNotes] = useState(false);

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
    return (
      <section>
        <h1 className="text-2xl font-semibold">Interview not found</h1>
        <Link to="/interviews">Back to interviews</Link>
      </section>
    );
  }

  const transcriptDirty = transcript !== interview.transcript;
  const saveTranscript = () => dispatch({ type: 'interview/save', interview: { ...interview, transcript } });

  const generate = async () => {
    if (transcriptDirty) saveTranscript();
    setGenerating(true);
    setError(null);
    try {
      const notes = await requestInterviewNotes({
        provider_name: provider.provider,
        interview_date: formatDate(interview.started_at),
        transcript,
        questions: mustQuestions(seed.interviewSections),
      });
      dispatch({ type: 'interview/notes', id: interview.id, notes, at: new Date().toISOString() });
      setSavedToNotes(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate notes.');
    } finally {
      setGenerating(false);
    }
  };

  const saveToProviderNotes = () => {
    if (!interview.notes) return;
    dispatch({
      type: 'note/add',
      note: {
        id: newId(),
        provider_id: provider.id,
        text: notesToText(interview.notes, `Interview ${formatDateTime(interview.started_at)}`),
        created_at: new Date().toISOString(),
        source: 'interview',
        interview_id: interview.id,
      },
    });
    setSavedToNotes(true);
  };

  const remove = async () => {
    if (interview.audio_id) await audio.delete(interview.audio_id).catch(() => undefined);
    dispatch({ type: 'interview/delete', id: interview.id });
    navigate('/interviews');
  };

  return (
    <section className="space-y-4">
      <Link to="/interviews" className="muted">
        ← All interviews
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Interview: <Link to={`/providers/${provider.id}`}>{provider.provider}</Link>
          </h1>
          <p className="muted">
            {formatDateTime(interview.started_at)}
            {interview.audio_id && ` · ${formatDuration(interview.duration_seconds)}`}
            {interview.interviewer && ` · by ${interview.interviewer}`}
            {interview.consent_confirmed && ' · consent confirmed'}
          </p>
        </div>
        <ConfirmButton
          prompt="Delete this interview for everyone? Notes already saved to the provider are kept."
          confirmLabel="Delete interview"
          onConfirm={remove}
        >
          Delete interview
        </ConfirmButton>
      </div>

      {interview.audio_id && (
        <section aria-labelledby="recording-heading" className="card">
          <h2 id="recording-heading" className="font-semibold">
            Recording
          </h2>
          {audioUrl ? (
            <>
              <audio controls src={audioUrl} className="mt-2 w-full">
                Your browser can't play this recording.
              </audio>
              <p className="muted mt-2">Stored only on this device. Clearing site data deletes it.</p>
            </>
          ) : audioMissing ? (
            <p className="muted mt-2">The recording is kept only on the device that made it. The transcript below is shared.</p>
          ) : (
            <p className="muted mt-2">Loading recording…</p>
          )}
        </section>
      )}

      <section aria-labelledby="transcript-heading" className="card space-y-2">
        <h2 id="transcript-heading" className="font-semibold">
          Transcript
        </h2>
        <p className="muted">
          Correct misheard words and remove anything you don't want to keep before drafting notes.
          {!interview.transcript && ' No live transcript was captured — type or paste one here.'}
        </p>
        <label htmlFor="transcript" className="sr-only">
          Transcript
        </label>
        <textarea id="transcript" className="input min-h-64 font-mono" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
        <button type="button" className="btn" onClick={saveTranscript} disabled={!transcriptDirty}>
          {transcriptDirty ? 'Save transcript' : 'Transcript saved'}
        </button>
      </section>

      <section aria-labelledby="notes-heading" className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="notes-heading" className="font-semibold">
            Interview notes
          </h2>
          <button type="button" className="btn btn-primary" onClick={generate} disabled={generating || transcript.trim().length < 20}>
            {generating ? 'Drafting notes…' : interview.notes ? 'Redraft notes' : 'Draft notes from transcript'}
          </button>
        </div>
        <p className="muted">
          Sends the transcript (not the audio) to Anthropic's Claude API to draft notes. Notes are a draft: check them against the
          recording.
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        {interview.notes && (
          <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
            <p className="muted text-xs">Drafted {interview.notes_generated_at && formatDateTime(interview.notes_generated_at)}</p>
            <p>{interview.notes.summary}</p>
            {notesSections(interview.notes).map((s) => (
              <div key={s.key}>
                <h3 className="font-medium">{s.label}</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {s.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
            <button type="button" className="btn" onClick={saveToProviderNotes} disabled={savedToNotes}>
              {savedToNotes ? 'Saved to provider notes' : 'Save to provider notes'}
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
