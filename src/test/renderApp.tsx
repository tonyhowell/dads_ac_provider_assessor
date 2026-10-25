import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { loadSeedData, type SeedData } from '../data/load';
import { AuthProvider, type SessionUser } from '../auth/AuthContext';
import { emptyState, reducer, type AppState } from '../state/reducer';
import type { StateSync } from '../state/sync';
import type { ApplicationInfo, Backend, Catalogue, MemberRole, Suggestion } from '../backend';
import type { Provider } from '../types';
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

export const testApplication: ApplicationInfo = {
  id: 'app-1',
  name: 'Dad – Wynnum',
  suburb: 'Wynnum',
  postcode: '',
  status: 'active',
  created_at: '2026-10-25T00:00:00.000Z',
  updated_at: '2026-10-25T00:00:00.000Z',
};

export interface MemoryBackend extends Backend {
  /** The common catalogue's edits, as the server would hold them. */
  edits: Provider[];
  suggestions: Suggestion[];
}

/** Stands in for the server: one application (with the given role) and the common catalogue. */
export function memoryBackend(server: MemoryServer, role: MemberRole = 'coordinator', application: ApplicationInfo = testApplication): MemoryBackend {
  const backend: MemoryBackend = {
    edits: [],
    suggestions: [],
    listApplications: async () => [{ ...application, role, last_activity: application.updated_at, members: 1 }],
    getApplication: async () => ({ application, role }),
    sync: () => server.sync,
    catalogue: async () => cat(),
    saveProvider: async (p) => {
      backend.edits = [...backend.edits.filter((x) => x.id !== p.id), p];
      return cat();
    },
    importProviders: async (ps) => {
      const ids = new Set(ps.map((p) => p.id));
      backend.edits = [...backend.edits.filter((x) => !ids.has(x.id)), ...ps];
      return cat();
    },
    revertProvider: async (id) => {
      backend.edits = backend.edits.filter((x) => x.id !== id);
      return cat();
    },
    suggest: async (applicationId, provider, note) => {
      const s: Suggestion = {
        id: `s${backend.suggestions.length + 1}`,
        provider_id: provider.id,
        is_new: false,
        current: null,
        proposed: provider,
        note,
        application_id: applicationId,
        application_name: application.name,
        suggested_by: 'Alex',
        status: 'pending',
        decided_by: null,
        decision_note: '',
        decided_at: null,
        created_at: new Date().toISOString(),
      };
      backend.suggestions.push(s);
      return s;
    },
    applicationSuggestions: async () => backend.suggestions,
  };
  const cat = (): Catalogue => ({ providers: backend.edits, updated_at: null });
  return backend;
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
    role = 'coordinator',
    application = testApplication,
    backend,
  }: {
    seed?: SeedData;
    server?: MemoryServer;
    audio?: AudioStore;
    user?: SessionUser | null;
    waitForNav?: boolean;
    firstRun?: boolean;
    role?: MemberRole;
    application?: ApplicationInfo;
    backend?: MemoryBackend;
  } = {},
) {
  // Skip the one-time welcome screen unless a test is about it.
  if (!firstRun) localStorage.setItem('sah-assessor:welcomed', '1');
  // Don't show "Welcome back" in tests.
  sessionStorage.setItem('sah-assessor:return-shown', '1');
  const memory = backend ?? memoryBackend(server, role, application);
  const result = {
    server,
    audio,
    backend: memory,
    ...render(
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider initialUser={user}>
          <App seed={seed} backend={memory} audio={audio} />
        </AuthProvider>
      </MemoryRouter>,
    ),
  };
  if (user && waitForNav) await screen.findByRole('navigation', { name: 'Steps' });
  else if (user) await screen.findAllByRole('heading', { level: 1 });
  return result;
}
