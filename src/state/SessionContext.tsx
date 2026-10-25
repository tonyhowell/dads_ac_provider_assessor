import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ApplicationSummary, Backend, Catalogue } from '../backend';
import type { SeedData } from '../data/load';
import type { Provider } from '../types';
import { effectiveProviders } from './reducer';

// What a signed-in person has regardless of which application is open: the server connection,
// the common provider catalogue, and the list of applications they belong to.

const POLL_MS = 60_000;
const CURRENT_KEY = 'sah-assessor:application';

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode: remembering the last application is only a convenience */
  }
};

interface SessionValue {
  backend: Backend;
  seed: SeedData;
  /** Starter pack plus the catalogue's corrections and additions. */
  catalogue: Provider[];
  /** Ids of providers the catalogue has changed from the starter pack, or added. */
  catalogueEdited: Set<string>;
  setCatalogue(c: Catalogue): void;
  refreshCatalogue(): Promise<void>;
  applications: ApplicationSummary[] | null;
  applicationsError: string | null;
  reloadApplications(): Promise<void>;
  /** The application to open: the last one used if still available, or the only one. */
  currentId: string | null;
  setCurrentId(id: string | null): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ backend, seed, children }: { backend: Backend; seed: SeedData; children: ReactNode }) {
  const [edits, setEdits] = useState<Provider[]>([]);
  const [applications, setApplications] = useState<ApplicationSummary[] | null>(null);
  const [applicationsError, setApplicationsError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => get(CURRENT_KEY));

  const setCatalogue = useCallback((c: Catalogue) => setEdits(c.providers), []);
  const refreshCatalogue = useCallback(async () => {
    try {
      setCatalogue(await backend.catalogue());
    } catch {
      /* keep the last good catalogue; the next poll retries */
    }
  }, [backend, setCatalogue]);

  const reloadApplications = useCallback(async () => {
    try {
      setApplications(await backend.listApplications());
      setApplicationsError(null);
    } catch (err) {
      setApplicationsError(err instanceof Error ? err.message : 'Could not load your applications.');
    }
  }, [backend]);

  useEffect(() => {
    refreshCatalogue();
    reloadApplications();
    const timer = setInterval(refreshCatalogue, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCatalogue, reloadApplications]);

  const setCurrentId = useCallback((id: string | null) => {
    put(CURRENT_KEY, id);
    setChosen(id);
  }, []);

  const value = useMemo<SessionValue>(() => {
    const open = applications?.filter((a) => a.status !== 'archived') ?? [];
    const currentId = applications?.some((a) => a.id === chosen) ? chosen : open.length === 1 ? open[0].id : null;
    return {
      backend,
      seed,
      catalogue: effectiveProviders(seed.providers, edits),
      catalogueEdited: new Set(edits.map((p) => p.id)),
      setCatalogue,
      refreshCatalogue,
      applications,
      applicationsError,
      reloadApplications,
      currentId,
      setCurrentId,
    };
  }, [backend, seed, edits, setCatalogue, refreshCatalogue, applications, applicationsError, reloadApplications, chosen, setCurrentId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
