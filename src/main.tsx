import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { App } from './App';
import { loadSeedData, SeedDataError, type SeedData } from './data/load';
import { AuthProvider } from './auth/AuthContext';
import { httpSync } from './state/sync';
import { indexedDbAudioStore } from './storage/audioStore';
import { applyDisplay, loadDisplay } from './display';

applyDisplay(loadDisplay());
const root = createRoot(document.getElementById('root')!);

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
      <BrowserRouter>
        <AuthProvider>
          <App seed={seed} sync={httpSync} audio={indexedDbAudioStore} />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}
