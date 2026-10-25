import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { loadSeedData, type SeedData } from '../data/load';
import { AuthProvider, type SessionUser } from '../auth/AuthContext';
import { emptyState, reducer, type AppState } from '../state/reducer';
import type { StateSync } from '../state/sync';
import type { AudioStore } from '../storage/audioStore';

export function memoryAudioStore(): AudioStore & { blobs: Map<string, Blob> } {
  const blobs = new Map<string, Blob>();
  return {
    blobs,
    put: async (id, blob) => void blobs.set(id, blob),
    get: async (id) => blobs.get(id),
    delete: async (id) => void blobs.delete(id),
  };
}

/** Stands in for the server: applies actions with the same reducer and keeps a version. */
export interface MemoryServer {
  state: AppState;
  version: number;
  sync: StateSync;
}

export function memoryServer(initial: AppState = emptyState()): MemoryServer {
  const server: MemoryServer = {
    state: initial,
    version: 0,
    sync: {
      load: async () => ({ version: server.version, state: server.state }),
      send: async (action) => {
        server.state = reducer(server.state, action);
        server.version += 1;
        return { version: server.version, state: server.state };
      },
    },
  };
  return server;
}

export const testUser: SessionUser = { id: 'u1', username: 'alex', display_name: 'Alex', role: 'admin' };

/** Renders the signed-in app and waits for shared state to load. */
export async function renderApp(
  route: string,
  {
    seed = loadSeedData(),
    server = memoryServer(),
    audio = memoryAudioStore(),
    user = testUser,
    waitForNav = true,
    firstRun = false,
  }: { seed?: SeedData; server?: MemoryServer; audio?: AudioStore; user?: SessionUser | null; waitForNav?: boolean; firstRun?: boolean } = {},
) {
  // Skip the one-time welcome screen unless a test is about it.
  if (!firstRun) localStorage.setItem('sah-assessor:welcomed', '1');
  // Don't show "Welcome back" in tests.
  sessionStorage.setItem('sah-assessor:return-shown', '1');
  const result = {
    server,
    audio,
    ...render(
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider initialUser={user}>
          <App seed={seed} sync={server.sync} audio={audio} />
        </AuthProvider>
      </MemoryRouter>,
    ),
  };
  if (user && waitForNav) await screen.findByRole('navigation', { name: 'Steps' });
  else if (user) await screen.findByRole('heading', { level: 1 });
  return result;
}
