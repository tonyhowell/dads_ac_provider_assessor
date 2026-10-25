import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { loadSeedData, type SeedData } from '../data/load';
import { AppProvider } from '../state/AppContext';
import { MemoryStorage, type Storage } from '../storage/storage';
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

export function renderApp(
  route: string,
  { seed = loadSeedData(), storage = new MemoryStorage(), audio = memoryAudioStore() }: { seed?: SeedData; storage?: Storage; audio?: AudioStore } = {},
) {
  return {
    storage,
    audio,
    ...render(
      <MemoryRouter initialEntries={[route]}>
        <AppProvider seed={seed} storage={storage} audio={audio}>
          <App />
        </AppProvider>
      </MemoryRouter>,
    ),
  };
}
