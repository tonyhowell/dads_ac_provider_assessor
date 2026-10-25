import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, useProvider } from '../state/AppContext';
import { newId } from '../state/reducer';
import { recorderSupport, useRecorder, type RecordingResult } from '../components/useRecorder';
import { formatDuration } from '../format';
import type { Interview } from '../types';

export function InterviewCaptureScreen() {
  const { providerId } = useParams();
  const provider = useProvider(providerId);
  const { dispatch, audio } = useApp();
  const navigate = useNavigate();
  const support = recorderSupport();

  const [consent, setConsent] = useState(false);
  const [interviewer, setInterviewer] = useState('');
  const [liveTranscription, setLiveTranscription] = useState(support.transcription);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const rec = useRecorder({ transcribe: liveTranscription });

  if (!provider) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Provider not found</h1>
        <Link to="/interviews">Back to interviews</Link>
      </section>
    );
  }

  const saveInterview = async (result: RecordingResult | null, started: string) => {
    const id = newId();
    let audioId: string | null = null;
    if (result && result.blob.size > 0) {
      audioId = id;
      try {
        await audio.put(audioId, result.blob);
      } catch {
        audioId = null;
        setSaveError('The recording could not be saved on this device (storage may be full). The transcript was kept.');
      }
    }
    const interview: Interview = {
      id,
      provider_id: provider.id,
      started_at: started,
      duration_seconds: result?.durationSeconds ?? 0,
      consent_confirmed: consent,
      interviewer: interviewer.trim(),
      audio_id: audioId,
      audio_mime: audioId ? result!.mime : null,
      transcript: result?.transcript ?? '',
      notes: null,
      notes_generated_at: null,
    };
    dispatch({ type: 'interview/save', interview });
    navigate(`/interviews/${id}`);
  };

  const start = async () => {
    setStartedAt(new Date().toISOString());
    await rec.start();
  };

  const stop = async () => {
    const result = await rec.stop();
    await saveInterview(result, startedAt ?? new Date().toISOString());
  };

  const active = rec.status === 'recording' || rec.status === 'paused';

  return (
    <section className="space-y-4">
      <Link to="/interviews" className="muted">
        ← All interviews
      </Link>
      <h1 className="text-2xl font-semibold">Interview: {provider.provider}</h1>

      {!support.recording ? (
        <div className="card space-y-3">
          <p>This browser can't record audio. You can still type or paste notes or a transcript from another recorder.</p>
          <button type="button" className="btn btn-primary" onClick={() => saveInterview(null, new Date().toISOString())}>
            Add interview without recording
          </button>
        </div>
      ) : (
        <>
          <fieldset className="card space-y-3" disabled={active}>
            <legend className="sr-only">Before you start</legend>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                Everyone in the interview has been told it is being recorded and has agreed.
                <span className="muted block">Ask at the start, and keep their agreement on the recording.</span>
              </span>
            </label>
            <div>
              <label htmlFor="interviewer" className="muted block">
                Interviewed by (optional)
              </label>
              <input id="interviewer" className="input max-w-sm" value={interviewer} onChange={(e) => setInterviewer(e.target.value)} />
            </div>
            {support.transcription ? (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={liveTranscription}
                  onChange={(e) => setLiveTranscription(e.target.checked)}
                />
                <span>
                  Transcribe live
                  <span className="muted block">
                    Uses your browser's speech recognition, which may send audio to the browser maker (for example Google or Apple) to
                    convert it to text. Turn this off to keep audio on this device; you can type or paste a transcript later.
                  </span>
                </span>
              </label>
            ) : (
              <p className="muted">
                Live transcription isn't available in this browser. The audio will still be recorded; add a transcript afterwards.
              </p>
            )}
          </fieldset>

          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-2xl tabular-nums" aria-label="Recording time">
                {formatDuration(rec.elapsed)}
              </p>
              {rec.status === 'recording' && (
                <span className="inline-flex items-center gap-1 text-sm font-medium text-red-700 dark:text-red-300">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden /> Recording
                </span>
              )}
              {rec.status === 'paused' && <span className="text-sm font-medium">Paused</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {!active && (
                <button type="button" className="btn btn-primary" onClick={start} disabled={!consent || rec.status === 'stopped'}>
                  Start recording
                </button>
              )}
              {rec.status === 'recording' && (
                <button type="button" className="btn" onClick={rec.pause}>
                  Pause
                </button>
              )}
              {rec.status === 'paused' && (
                <button type="button" className="btn" onClick={rec.resume}>
                  Resume
                </button>
              )}
              {active && (
                <button type="button" className="btn btn-danger" onClick={stop}>
                  Stop and save
                </button>
              )}
            </div>
            {!consent && !active && <p className="muted">Confirm consent to start recording.</p>}
            {rec.error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                {rec.error}
              </p>
            )}
            {saveError && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                {saveError}
              </p>
            )}
          </div>

          {liveTranscription && support.transcription && active && (
            <section aria-labelledby="live-heading" className="card">
              <h2 id="live-heading" className="font-semibold">
                Live transcript
              </h2>
              <p className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap" aria-live="off">
                {rec.transcript}
                <span className="text-slate-500">{rec.interimText}</span>
                {!rec.transcript && !rec.interimText && <span className="muted">Listening…</span>}
              </p>
            </section>
          )}
        </>
      )}
    </section>
  );
}
