import { createContext, useContext, useRef, useState } from 'react';
import { speechRecognitionCtor } from './useRecorder';
import { Icon } from './ui/Icon';

// Speaking instead of typing (improvement plan 1.3): in the applicant's view, text boxes get a microphone button
// that turns speech into words with the browser's own speech recognition (en-AU). Nothing is recorded or sent.

const DictationContext = createContext(false);
export const DictationProvider = DictationContext.Provider;
export const useDictationOn = () => useContext(DictationContext) && !!speechRecognitionCtor();

export function DictateButton({ onText, label }: { onText: (text: string) => void; label: string }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop(): void } | null>(null);
  const on = useDictationOn();
  if (!on) return null;
  const start = () => {
    const Ctor = speechRecognitionCtor()!;
    const rec = new Ctor();
    rec.lang = 'en-AU';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text.trim()) onText(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  return (
    <button type="button" className="btn btn-sm mt-1" aria-pressed={listening} onClick={() => (listening ? recRef.current?.stop() : start())}>
      <Icon name="users" size={16} /> {listening ? 'Listening… tap to stop' : 'Speak instead'}
      <span className="sr-only"> for {label}</span>
    </button>
  );
}
