import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal Web Speech API typings (not in TypeScript's DOM lib).
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function recorderSupport() {
  return {
    recording: typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    transcription: typeof window !== 'undefined' && !!speechRecognitionCtor(),
  };
}

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export interface RecordingResult {
  blob: Blob;
  mime: string;
  durationSeconds: number;
  transcript: string;
}

/**
 * Records microphone audio with MediaRecorder and, where the browser supports it,
 * transcribes live with the Web Speech API (en-AU).
 */
export function useRecorder({ transcribe }: { transcribe: boolean }) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const finalRef = useRef('');
  // Elapsed time excludes pauses: accumulated ms + start of the current running segment.
  const accumulatedRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== 'recording') return;
    const t = setInterval(() => {
      const running = segmentStartRef.current ? Date.now() - segmentStartRef.current : 0;
      setElapsed((accumulatedRef.current + running) / 1000);
    }, 250);
    return () => clearInterval(t);
  }, [status]);

  const startRecognition = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!transcribe || !Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-AU';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += `${r[0].transcript.trim()}\n`;
        else interim += r[0].transcript;
      }
      setFinalText(finalRef.current);
      setInterimText(interim);
    };
    // Browsers end recognition after silence; restart while we are still listening.
    rec.onend = () => {
      if (listeningRef.current) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        listeningRef.current = false;
        setError('Live transcription was blocked. The audio is still being recorded; you can type or paste a transcript afterwards.');
      }
    };
    recognitionRef.current = rec;
    listeningRef.current = true;
    rec.start();
  }, [transcribe]);

  const stopRecognition = useCallback(() => {
    listeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setInterimText('');
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      finalRef.current = '';
      setFinalText('');
      accumulatedRef.current = 0;
      segmentStartRef.current = Date.now();
      setElapsed(0);
      setStatus('recording');
      startRecognition();
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in your browser settings and try again.'
          : 'Could not start recording. Check that a microphone is connected.',
      );
    }
  }, [startRecognition]);

  const pause = useCallback(() => {
    recorderRef.current?.pause();
    if (segmentStartRef.current) accumulatedRef.current += Date.now() - segmentStartRef.current;
    segmentStartRef.current = null;
    stopRecognition();
    setStatus('paused');
  }, [stopRecognition]);

  const resume = useCallback(() => {
    recorderRef.current?.resume();
    segmentStartRef.current = Date.now();
    setStatus('recording');
    startRecognition();
  }, [startRecognition]);

  const stop = useCallback((): Promise<RecordingResult> => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.reject(new Error('Not recording'));
    if (segmentStartRef.current) accumulatedRef.current += Date.now() - segmentStartRef.current;
    segmentStartRef.current = null;
    stopRecognition();
    return new Promise((resolve) => {
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const mime = recorder.mimeType || 'audio/webm';
        const durationSeconds = accumulatedRef.current / 1000;
        setElapsed(durationSeconds);
        setStatus('stopped');
        resolve({ blob: new Blob(chunksRef.current, { type: mime }), mime, durationSeconds, transcript: finalRef.current.trim() });
      };
      recorder.stop();
    });
  }, [stopRecognition]);

  // Release the microphone if the user navigates away mid-recording.
  useEffect(
    () => () => {
      listeningRef.current = false;
      recognitionRef.current?.stop();
      if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { status, elapsed, transcript: finalText, interimText, error, start, pause, resume, stop };
}
