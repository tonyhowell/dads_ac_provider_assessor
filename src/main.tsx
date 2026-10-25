import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import './index.css';
import { App } from './App';
import { loadSeedData, SeedDataError, type SeedData } from './data/load';
import { AppProvider } from './state/AppContext';
import { LocalStorageAdapter, MemoryStorage, type Storage } from './storage/storage';
import { indexedDbAudioStore } from './storage/audioStore';
import { applyStoredTheme } from './components/ThemeToggle';

applyStoredTheme();
// `vite build --mode static` produces a file-only preview with no server and no URL routing.
const Router = import.meta.env.MODE === 'static' ? MemoryRouter : BrowserRouter;
const root = createRoot(document.getElementById('root')!);

function browserStorage(): Storage {
  try {
    return new LocalStorageAdapter();
  } catch {
    return new MemoryStorage(); // localStorage blocked: the session still works, it just isn't saved.
  }
}

let seed: SeedData | undefined;
try {
  seed = loadSeedData();
} catch (err) {
  const issues = err instanceof SeedDataError ? err.issues : [String(err)];
  const file = err instanceof SeedDataError ? err.file : 'seed data';
  root.render(
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Seed data could not be loaded</h1>
      <p className="mt-2">Fix <code>data/{file}</code> and reload.</p>
      <ul className="mt-4 list-disc pl-6 font-mono text-sm">
        {issues.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </main>,
  );
}

if (seed) {
  root.render(
    <StrictMode>
      <Router>
        <AppProvider seed={seed} storage={browserStorage()} audio={indexedDbAudioStore}>
          <App />
        </AppProvider>
      </Router>
    </StrictMode>,
  );
}
