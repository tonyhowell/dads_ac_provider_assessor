import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useSession } from '../state/SessionContext';
import { formatDate, formatDateTime } from '../format';
import { ResolutionCard } from './ui/Cards';

// Site administration: the automatic import of the government aged care service list. The server finds the
// newest list from a page (or a direct file link), and adds, updates and flags providers when it changes.

interface Settings {
  url: string;
  scope: 'national' | 'regions';
  auto: boolean;
}
interface Run {
  id: string;
  trigger: string;
  status: 'running' | 'done' | 'unchanged' | 'failed';
  file_url: string | null;
  as_at: string | null;
  stats: Record<string, number>;
  log: string[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
  progress?: { stage: Stage; done: number; total: number; updated_at: string } | null;
}
type Stage = 'finding' | 'downloading' | 'reading' | 'matching' | 'saving';

const STAGES: { id: Stage | 'uploading'; label: string }[] = [
  { id: 'uploading', label: 'Sending the file' },
  { id: 'reading', label: 'Reading the spreadsheet' },
  { id: 'matching', label: 'Matching providers to the catalogue' },
  { id: 'saving', label: 'Saving changes' },
];
const FETCH_STAGES: { id: Stage; label: string }[] = [
  { id: 'finding', label: 'Finding the newest list' },
  { id: 'downloading', label: 'Downloading' },
  { id: 'reading', label: 'Reading the spreadsheet' },
  { id: 'matching', label: 'Matching providers to the catalogue' },
  { id: 'saving', label: 'Saving changes' },
];

/** Sends JSON with upload progress (fetch can't report it). */
function postWithProgress(url: string, body: unknown, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `The server answered ${xhr.status}.`;
      try {
        message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
      } catch {
        /* not JSON */
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Can't reach the server. Check your internet connection."));
    xhr.send(JSON.stringify(body));
  });
}

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const STATUS: Record<Run['status'], string> = { running: 'Running', done: 'Imported', unchanged: 'No change', failed: 'Failed' };

export function GenAutoImport() {
  const { refreshCatalogue } = useSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [every, setEvery] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ settings: Settings; runs: Run[]; every_hours: number }>('/api/admin/gen-import');
      if (r.settings) {
        setSettings(r.settings);
        setDraft((d) => d ?? r.settings);
      }
      setRuns(r.runs ?? []);
      setEvery(r.every_hours ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the import settings.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const running = runs[0]?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      await load();
    }, 1500);
    return () => clearInterval(timer);
  }, [running, load]);
  // When an import finishes, show its providers straight away.
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (wasRunning && !running) void refreshCatalogue();
    setWasRunning(running);
  }, [running, wasRunning, refreshCatalogue]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    try {
      const r = await api<{ settings: Settings }>('/api/admin/gen-import', { method: 'PUT', body: draft });
      setSettings(r.settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  };
  const [file, setFile] = useState<File | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  /** When this page started an import: its progress and result are shown until dismissed. */
  const [startedAt, setStartedAt] = useState<{ before: string | null } | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const mine = startedAt && runs[0] && runs[0].id !== startedAt.before ? runs[0] : undefined;
  const waiting = !!startedAt && sent === null && !mine;
  const startImport = async () => {
    if (!file) return;
    setError(null);
    setStartedAt({ before: runs[0]?.id ?? null });
    setSent(0);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      await postWithProgress('/api/admin/gen-import/upload', { name: file.name, data: btoa(binary), force: false }, setSent);
      setSent(null);
      await load();
    } catch (err) {
      setSent(null);
      setStartedAt(null);
      setError(err instanceof Error ? err.message : 'Could not import the file.');
    }
  };
  // Follow an import this page started (it starts a moment after the upload finishes).
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, [waiting, load]);
  const busy = sent !== null || waiting || running;
  const run = async (force: boolean) => {
    setError(null);
    setStartedAt({ before: runs[0]?.id ?? null });
    try {
      await api('/api/admin/gen-import/run', { body: { force } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the import.');
    }
  };

  if (!draft || !settings) return error ? <p role="alert">{error}</p> : null;
  const last = runs[0];
  return (
    <section className="card space-y-3" aria-labelledby="auto-import-heading">
      <h3 id="auto-import-heading" className="text-[1.2rem]">
        Automatic import
      </h3>
      <p>
        The server fetches the newest service list itself{settings.auto && every > 0 ? `, checking every ${every >= 24 && every % 24 === 0 ? `${every / 24} day${every === 24 ? '' : 's'}` : `${every} hours`}` : ''}, and only acts when the
        list has changed. New home care providers are added without prices; providers from an earlier list get their outlets updated; ones no longer on the list are flagged, not
        removed. Providers you entered by hand are never overwritten.
      </p>
      <form className="space-y-3" onSubmit={save}>
        <div>
          <label htmlFor="gen-url" className="label">
            Where to find the list
          </label>
          <span className="hint">GEN's providers page, a release page, or the file itself (.xlsx or .csv).</span>
          <input
            id="gen-url"
            type="url"
            className="input"
            value={draft.url}
            onChange={(e) => {
              setDraft({ ...draft, url: e.target.value });
              setSaved(false);
            }}
          />
        </div>
        <fieldset>
          <legend className="label">Which providers</legend>
          {(
            [
              ['national', 'Every home care provider in Australia'],
              ['regions', 'Only the regions around active applications'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-[var(--target-min)] items-center gap-3">
              <input
                type="radio"
                name="gen-scope"
                checked={draft.scope === value}
                onChange={() => {
                  setDraft({ ...draft, scope: value });
                  setSaved(false);
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="flex min-h-[var(--target-min)] items-center gap-3">
          <input
            type="checkbox"
            checked={draft.auto}
            onChange={(e) => {
              setDraft({ ...draft, auto: e.target.checked });
              setSaved(false);
            }}
          />
          Check on a schedule
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn">
            Save settings
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(false)}>
            {running ? 'Importing…' : 'Check for a new list now'}
          </button>
          {last && last.status !== 'running' && (
            <button type="button" className="btn-quiet" onClick={() => run(true)}>
              Re-import even if unchanged
            </button>
          )}
          {saved && (
            <span role="status" className="small">
              Saved.
            </span>
          )}
        </div>
      </form>
      <div className="space-y-1 border-t border-[var(--rule)] pt-3">
        <label htmlFor="gen-upload" className="label">
          Or upload the list yourself
        </label>
        <span className="hint">
          If the government site blocks the server, download the Australia-wide file (.xlsx) from the{' '}
          <a href="https://www.gen-agedcaredata.gov.au/topics/providers-of-aged-care" target="_blank" rel="noreferrer noopener">
            GEN providers page<span className="sr-only"> (opens in new tab)</span>
          </a>{' '}
          and upload it here. It's imported the same way: added, updated and flagged as above.
        </span>
        <input
          key={inputKey}
          id="gen-upload"
          type="file"
          accept=".xlsx,.csv"
          className="block"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setStartedAt(null);
            setError(null);
          }}
        />
        {file && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span>
              <b>{file.name}</b> ({sizeText(file.size)})
            </span>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={startImport}>
              Import this file
            </button>
          </div>
        )}
      </div>
      {startedAt && (sent !== null || waiting || mine) && (
        <ImportProgress
          stages={mine?.trigger === 'upload' || sent !== null || (waiting && !!file) ? STAGES : FETCH_STAGES}
          sent={sent}
          run={mine}
          onDismiss={() => {
            setStartedAt(null);
            setFile(null);
            setInputKey((k) => k + 1);
          }}
        />
      )}
      {error && (
        <ResolutionCard status="stop" title="That didn't work" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}
      {runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Recent imports</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Result</th>
                <th scope="col">List as at</th>
                <th scope="col">Changes</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    {formatDateTime(r.started_at)}
                    <span className="small block">{r.trigger === 'schedule' ? 'On schedule' : r.trigger === 'upload' ? 'Uploaded by an admin' : 'By an admin'}</span>
                  </td>
                  <td>
                    {STATUS[r.status]}
                    {r.error && <span className="small block">{r.error}</span>}
                    {r.status === 'failed' && r.log.length > 0 && (
                      <details className="small">
                        <summary className="cursor-pointer">What it tried</summary>
                        <ul className="list-disc pl-5">
                          {r.log.map((line, i) => (
                            <li key={i} className="break-all">
                              {line}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td>{r.as_at ? formatDate(r.as_at) : '—'}</td>
                  <td>
                    {r.status === 'done'
                      ? `${r.stats.added ?? 0} added, ${(r.stats.updated ?? 0) + (r.stats.back ?? 0)} updated, ${r.stats.missing ?? 0} no longer listed · ${r.stats.providers ?? 0} home care providers in ${r.stats.home_care ?? 0} services`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The steps of an import this page started, with a bar for the current one, then the result. */
function ImportProgress({ stages, sent, run, onDismiss }: { stages: { id: string; label: string }[]; sent: number | null; run: Run | undefined; onDismiss: () => void }) {
  const current: string = sent !== null ? 'uploading' : (run?.progress?.stage ?? (run ? 'reading' : 'uploading'));
  const finished = run && run.status !== 'running';
  const index = stages.findIndex((s) => s.id === current);
  const p = run?.progress;
  const fraction = sent !== null ? sent : p && p.total > 0 ? p.done / p.total : null;
  if (finished) {
    const st = run.stats;
    return (
      <ResolutionCard
        status={run.status === 'failed' ? 'stop' : 'good'}
        title={run.status === 'done' ? 'Import finished' : run.status === 'unchanged' ? 'Nothing new: same list as last time' : 'The import failed'}
        role={run.status === 'failed' ? 'alert' : 'status'}
        actions={
          <button type="button" className="btn" onClick={onDismiss}>
            Done
          </button>
        }
      >
        {run.status === 'done' && (
          <p>
            {st.added ?? 0} providers added, {(st.updated ?? 0) + (st.back ?? 0)} updated, {st.missing ?? 0} no longer listed. {st.providers ?? 0} home care providers found in {st.services ?? 0}{' '}
            services. New providers show in Find for families near their outlets.
          </p>
        )}
        {run.error && <p>{run.error}</p>}
      </ResolutionCard>
    );
  }
  return (
    <section className="well space-y-2" aria-labelledby="import-progress-heading">
      <h4 id="import-progress-heading" className="font-semibold">
        Importing…
      </h4>
      <ol className="space-y-1">
        {stages.map((s, i) => (
          <li key={s.id} className={i === index ? 'font-semibold' : i < index ? '' : 'text-[var(--grey)]'}>
            {i < index ? '✓ ' : i === index ? '→ ' : '○ '}
            {s.label}
            {i === index && s.id === 'uploading' && sent !== null && ` (${Math.round(sent * 100)}%)`}
            {i === index && p && p.total > 0 && s.id !== 'uploading' && ` (${p.done.toLocaleString('en-AU')} of ${p.total.toLocaleString('en-AU')})`}
          </li>
        ))}
      </ol>
      <progress className="w-full" aria-label={stages[Math.max(0, index)]?.label ?? 'Importing'} {...(fraction !== null ? { value: Math.round(fraction * 100), max: 100 } : {})} />
      <p className="small" role="status">
        {stages[Math.max(0, index)]?.label ?? 'Starting'}… You can leave this page; the import carries on.
      </p>
    </section>
  );
}
