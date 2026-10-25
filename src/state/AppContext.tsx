import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SeedData } from '../data/load';
import type { AudioStore } from '../storage/audioStore';
import { reducer, withSpecialRates, type Action, type AppState } from './reducer';
import type { ApplicationInfo, MemberRole } from '../backend';
import { useSession } from './SessionContext';
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
  /** The common catalogue with this application's special rates applied. Use this, not seed.providers. */
  providers: Provider[];
  application: ApplicationInfo;
  role: MemberRole;
  /** Contributors and coordinators can change things; viewers, and everyone on an archived application, can't. */
  canEdit: boolean;
  /** The applicant's postcode, for matching providers' service areas: from About you, else the application. */
  areaPostcode: string | null;
  /** Fetch the latest shared state now, e.g. after the server changed it. */
  refresh: () => Promise<void>;
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
export function AppProvider({
  sync,
  audio,
  application,
  role,
  children,
}: {
  sync: StateSync;
  audio: AudioStore;
  application: ApplicationInfo;
  role: MemberRole;
  children: ReactNode;
}) {
  const { seed, catalogue } = useSession();
  const canEdit = (role === 'coordinator' || role === 'contributor') && application.status !== 'archived';
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
      // The server refuses changes from viewers too; this just stops the screen showing a change that won't stick.
      if (!canEdit) return;
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
    [sync, refresh, canEdit],
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
            providers: withSpecialRates(catalogue, state.specialRates),
            plan: state.plan ?? seed.samplePlan,
            serviceDate: state.serviceDate ?? toIsoDate(new Date()),
            application,
            role,
            canEdit,
            areaPostcode: (state.participant?.postcode || application.postcode || '').trim() || null,
            refresh: async () => {
              version.current = -1;
              await refresh();
            },
          }
        : null,
    [seed, catalogue, state, dispatch, audio, syncError, saving, savedAt, application, role, canEdit, refresh],
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

/** The open application's context, or null outside one (site administration, the applications list). */
export function useOptionalApp(): AppContextValue | null {
  return useContext(AppContext);
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
