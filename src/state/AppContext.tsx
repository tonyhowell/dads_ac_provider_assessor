import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { SeedData } from '../data/load';
import type { Storage } from '../storage/storage';
import type { AudioStore } from '../storage/audioStore';
import { initialState, migrate, reducer, type Action, type AppState } from './reducer';

const STATE_KEY = 'state';

interface AppContextValue {
  seed: SeedData;
  state: AppState;
  dispatch: (action: Action) => void;
  audio: AudioStore;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  seed,
  storage,
  audio,
  children,
}: {
  seed: SeedData;
  storage: Storage;
  audio: AudioStore;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    return migrate(storage.load(STATE_KEY)) ?? initialState(seed.shortlist, seed.providers, new Date().toISOString());
  });

  useEffect(() => {
    storage.save(STATE_KEY, state);
  }, [state, storage]);

  const value = useMemo(() => ({ seed, state, dispatch, audio }), [seed, state, audio]);
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
