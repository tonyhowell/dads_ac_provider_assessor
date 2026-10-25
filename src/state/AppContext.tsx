import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SeedData } from '../data/load';
import type { AudioStore } from '../storage/audioStore';
import { reducer, type Action, type AppState } from './reducer';
import type { StateSync } from './sync';

const POLL_MS = 20_000;

interface AppContextValue {
  seed: SeedData;
  state: AppState;
  dispatch: (action: Action) => void;
  audio: AudioStore;
  /** Last save error, shown in a banner until the next successful save. */
  syncError: string | null;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * Shared state lives on the server. Changes apply here immediately (optimistically), are sent in
 * order, and the server's result replaces local state once nothing else is waiting to be sent.
 * Other family members' changes arrive by polling and when the window regains focus.
 */
export function AppProvider({ seed, sync, audio, children }: { seed: SeedData; sync: StateSync; audio: AudioStore; children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const version = useRef(-1);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(async () => {
    if (pending.current > 0) return;
    try {
      const remote = await sync.load();
      if (pending.current === 0 && remote.version !== version.current) {
        version.current = remote.version;
        setState(remote.state);
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load shared data.');
    }
  }, [sync]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const onFocus = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const dispatch = useCallback(
    (action: Action) => {
      setState((s) => (s ? reducer(s, action) : s));
      pending.current += 1;
      queue.current = queue.current.then(async () => {
        try {
          const result = await sync.send(action);
          pending.current -= 1;
          setSyncError(null);
          if (pending.current === 0) {
            version.current = result.version;
            setState(result.state);
          }
        } catch (err) {
          pending.current -= 1;
          setSyncError(`Your last change wasn't saved: ${err instanceof Error ? err.message : 'unknown error'}`);
          version.current = -1;
          await refresh();
        }
      });
    },
    [sync, refresh],
  );

  const value = useMemo(() => (state ? { seed, state, dispatch, audio, syncError } : null), [seed, state, dispatch, audio, syncError]);

  if (!value) {
    return (
      <div className="p-6 text-center" role={loadError ? 'alert' : 'status'}>
        {loadError ?? 'Loading shared data…'}
      </div>
    );
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

export function useProvider(id: string | undefined) {
  const { seed } = useApp();
  return seed.providers.find((p) => p.id === id);
}
