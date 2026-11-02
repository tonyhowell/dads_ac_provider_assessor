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
}

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
    }, 3000);
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
  const run = async (force: boolean) => {
    setError(null);
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
          <button type="button" className="btn btn-primary" disabled={running} onClick={() => run(false)}>
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
                    <span className="small block">{r.trigger === 'schedule' ? 'On schedule' : 'By an admin'}</span>
                  </td>
                  <td>
                    {STATUS[r.status]}
                    {r.error && <span className="small block">{r.error}</span>}
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
