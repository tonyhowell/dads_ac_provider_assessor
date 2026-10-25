import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp, useProvider } from '../state/AppContext';
import { newId } from '../state/reducer';
import { recorderSupport, useRecorder, type RecordingResult } from '../components/useRecorder';
import { formatDuration } from '../format';
import type { Interview } from '../types';
import { ResolutionCard, ScreenHeader } from '../components/ui/Cards';
import { Icon } from '../components/ui/Icon';
import { MoreText } from '../components/ui/Expander';

export function InterviewCaptureScreen() {
  const { providerId } = useParams();
  const provider = useProvider(providerId);
  const { dispatch, audio, canEdit } = useApp();
  const navigate = useNavigate();
  const support = recorderSupport();

  const [consent, setConsent] = useState(false);
  const [needConsent, setNeedConsent] = useState(false);
  const [interviewer, setInterviewer] = useState('');
  const [liveTranscription, setLiveTranscription] = useState(support.transcription);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const rec = useRecorder({ transcribe: liveTranscription });

  if (!provider) {
    return (
      <ResolutionCard status="caution" title="We couldn't find that provider" actions={<Link to="/interviews" className="btn btn-primary">Back to interviews</Link>} />
    );
  }

  if (!canEdit) {
    return (
      <ResolutionCard status="info" title="Only contributors can record interviews" actions={<Link to="/interviews" className="btn">Back to interviews</Link>}>
        <p>Ask the coordinator to make you a contributor if you're doing the interview.</p>
      </ResolutionCard>
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
        setSaveError("The recording couldn't be saved on this device (storage may be full). The transcript was kept.");
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
    if (!consent) {
      setNeedConsent(true);
      return;
    }
    setStartedAt(new Date().toISOString());
    await rec.start();
  };
  const stop = async () => saveInterview(await rec.stop(), startedAt ?? new Date().toISOString());
  const active = rec.status === 'recording' || rec.status === 'paused';

  return (
    <section className="space-y-6">
      <ScreenHeader title={`Record your interview with ${provider.provider}`} purpose="Record or note an interview, then turn it into notes you can check and keep." helpTopic="interviews" />

      {rec.status === 'recording' && (
        <div role="status" className="card tone-stop sticky top-2 z-10 flex items-center gap-3 border-l-4 font-semibold">
          <span className="h-3 w-3 rounded-full bg-[var(--stop)]" aria-hidden /> Recording — stored on this device only
        </div>
      )}

      {!support.recording ? (
        <ResolutionCard
          status="info"
          title="This browser can't record audio"
          actions={
            <button type="button" className="btn btn-primary" onClick={() => saveInterview(null, new Date().toISOString())}>
              Type notes instead
            </button>
          }
        >
          <p>You can still type notes, or paste a transcript from another recorder.</p>
        </ResolutionCard>
      ) : (
        <>
          <fieldset className="card space-y-4" disabled={active}>
            <legend className="sr-only">Before you start</legend>
            <h2>Before you start</h2>
            <label className={`flex min-h-[var(--target-min)] items-start gap-3 rounded-[var(--radius-control)] border p-3 ${consent ? 'border-2 border-[var(--charcoal)] bg-[var(--amber-tint)]' : 'border-[var(--line)]'}`}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  setNeedConsent(false);
                }}
              />
              <span>
                <span className="block font-medium">Everyone on this call has agreed to be recorded</span>
                <span className="block">Ask at the start, so their agreement is on the recording.</span>
              </span>
            </label>
            {needConsent && (
              <p role="alert" className="field-error">
                <Icon name="octagon" size={20} /> Tick the box above once everyone has agreed. We can't start recording without it.
              </p>
            )}
            <div>
              <label htmlFor="interviewer" className="label">
                Who's doing the interview (optional)
              </label>
              <input id="interviewer" className="input max-w-md" value={interviewer} onChange={(e) => setInterviewer(e.target.value)} />
            </div>
            {support.transcription ? (
              <label className="flex min-h-[var(--target-min)] items-start gap-3">
                <input type="checkbox" className="mt-0.5" checked={liveTranscription} onChange={(e) => setLiveTranscription(e.target.checked)} />
                <span>
                  <span className="block font-medium">Turn speech into text as we go</span>
                  <MoreText className="block" text="On some browsers this sends audio to Google or Apple. Your browser's speech service turns speech into text; turn it off to keep audio on this device and type the notes afterwards." />
                </span>
              </label>
            ) : (
              <p>This browser can't turn speech into text. The audio is still recorded; add notes afterwards.</p>
            )}
          </fieldset>

          <section className="card space-y-4" aria-label="Recorder">
            <p className="figure" aria-label={`Recording time ${formatDuration(rec.elapsed)}`}>
              {formatDuration(rec.elapsed)}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {!active && (
                <button type="button" onClick={start} disabled={rec.status === 'stopped'} className="btn h-[72px] min-w-[72px] gap-3 rounded-full px-6 text-lg">
                  <span className="h-5 w-5 rounded-full bg-[var(--stop)]" aria-hidden /> Record
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
                <button type="button" className="btn btn-primary" onClick={stop}>
                  Stop and save
                </button>
              )}
              {rec.status === 'paused' && <span className="font-semibold">Paused</span>}
            </div>
            {!active && (
              <button type="button" className="btn-quiet" onClick={() => saveInterview(null, new Date().toISOString())}>
                Type notes instead of recording
              </button>
            )}
            {rec.error && (
              <ResolutionCard status="stop" title="We can't reach your microphone" role="alert" actions={<button type="button" className="btn" onClick={() => saveInterview(null, new Date().toISOString())}>Type notes instead</button>}>
                <p>{rec.error}</p>
                <p>To allow it: click the padlock or settings icon next to the web address, find Microphone, and choose Allow. Then reload the page.</p>
              </ResolutionCard>
            )}
            {saveError && <ResolutionCard status="caution" title="Recording not kept" role="alert"><p>{saveError}</p></ResolutionCard>}
          </section>

          {liveTranscription && support.transcription && active && (
            <section aria-labelledby="live-heading" className="card space-y-2">
              <h2 id="live-heading">What we've heard so far</h2>
              <p className="max-h-80 overflow-y-auto whitespace-pre-wrap" aria-live="off">
                {rec.transcript}
                <span className="text-[var(--grey)]">{rec.interimText}</span>
                {!rec.transcript && !rec.interimText && 'Listening…'}
              </p>
            </section>
          )}
        </>
      )}
    </section>
  );
}
