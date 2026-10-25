import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SeedData } from '../data/load';
import type { AudioStore } from '../storage/audioStore';
import { effectiveProviders, reducer, type Action, type AppState } from './reducer';
import { toIsoDate } from '../rules';
import type { PlanItem, Provider } from '../types';
import type { StateSync } from './sync';

const POLL_MS = 20_000;

interface AppContextValue {
  seed: SeedData;
  state: AppState;
  dispatch: (action: Action) => void;
  audio: AudioStore;
  /** Last save error, shown in a banner until the next successful save. */
  syncError: string | null;
  /** Save state for the "Saved" indicator. */
  saving: boolean;
  savedAt: Date | null;
  /** Seed providers with the family's edits, plus providers they added. Use this, not seed.providers. */
  providers: Provider[];
  /** The family's plan, or the sample plan until they edit it. */
  plan: PlanItem[];
  /** Date services are costed at (YYYY-MM-DD). */
  serviceDate: string;
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
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
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
      setSaving(true);
      queue.current = queue.current.then(async () => {
        try {
          const result = await sync.send(action);
          pending.current -= 1;
          if (pending.current === 0) setSaving(false);
          setSyncError(null);
          setSavedAt(new Date());
          if (pending.current === 0) setSaving(false);
          if (pending.current === 0) {
            version.current = result.version;
            setState(result.state);
          }
        } catch (err) {
          pending.current -= 1;
          if (pending.current === 0) setSaving(false);
          setSyncError(`Your last change wasn't saved: ${err instanceof Error ? err.message : 'unknown error'}`);
          version.current = -1;
          await refresh();
        }
      });
    },
    [sync, refresh],
  );

  const value = useMemo(
    () =>
      state
        ? {
            seed,
            state,
            dispatch,
            audio,
            syncError,
            saving,
            savedAt,
            providers: effectiveProviders(seed.providers, state.providerEdits),
            plan: state.plan ?? seed.samplePlan,
            serviceDate: state.serviceDate ?? toIsoDate(new Date()),
          }
        : null,
    [seed, state, dispatch, audio, syncError, saving, savedAt],
  );

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
  const { providers } = useApp();
  return providers.find((p) => p.id === id);
}
