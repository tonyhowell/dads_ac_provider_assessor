import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatDateTime } from '../format';
import { ConfirmButton } from '../components/ConfirmButton';
import { ResolutionCard } from '../components/ui/Cards';
import { Field } from '../components/ui/Form';
import { Icon } from '../components/ui/Icon';

// Site administration → Data checks: run the enrichment service, see what each run did and cost, and manage
// the extra sources it reads. Price changes it finds arrive as suggested corrections for approval.

type Part = 'prices' | 'sources' | 'claims';

interface Run {
  id: string;
  trigger: 'schedule' | 'admin' | 'cli';
  status: 'running' | 'done' | 'failed';
  stats: {
    prices?: { checked: number; unchanged: number; changed: number; errors: number; suggestions: number; matched: number };
    sources?: { checked: number; unchanged: number; changed: number; errors: number; summarised: number };
    claims?: { due: number; revalidated: number; reread: number; researched: number; deferred: number; failed: number };
  };
  usage: { estimated_cost_usd?: number; models?: Record<string, { requests: number; input_tokens: number; output_tokens: number; web_searches: number }> };
  log: string[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface Source {
  id: string;
  name: string;
  url: string;
  note: string;
  active: boolean;
  summary: { summary: string; change: 'new' | 'changed'; mentions: { provider_id: string | null; provider_name: string; fact: string; quote: string }[] } | null;
  summary_at: string | null;
}

interface Page {
  url: string;
  http_status: number | null;
  error: string | null;
  checked_at: string | null;
  changed_at: string | null;
}

interface View {
  runs: Run[];
  sources: Source[];
  pages: Page[];
  configured: boolean;
  schedule_hours: number | null;
}

const PART_LABELS: Record<Part, { label: string; hint: string }> = {
  prices: { label: 'Price lists', hint: "Each provider's published price page. Changed prices become suggested corrections." },
  sources: { label: 'Extra sources', hint: 'The pages listed below. Changes are summarised here.' },
  claims: { label: 'Public claims older than 60 days', hint: 'Re-checks the pages claims came from; searches the web only when needed.' },
};
const TRIGGER: Record<Run['trigger'], string> = { schedule: 'Scheduled', admin: 'Started here', cli: 'Command line' };
const usd = (n: number | undefined) => (n === undefined ? '—' : n < 0.01 ? 'under US$0.01' : `about US$${n.toFixed(2)}`);

function runSummary(r: Run): string {
  const parts: string[] = [];
  const p = r.stats.prices;
  if (p) parts.push(`price lists: ${p.checked} checked, ${p.changed} changed, ${p.suggestions} suggestion${p.suggestions === 1 ? '' : 's'}`);
  const s = r.stats.sources;
  if (s && s.checked) parts.push(`sources: ${s.checked} checked, ${s.changed} changed`);
  const c = r.stats.claims;
  if (c) parts.push(`claims: ${c.due} due, ${c.revalidated} confirmed unchanged, ${c.reread} re-read, ${c.researched} searched${c.deferred ? `, ${c.deferred} left for next time` : ''}`);
  return parts.join(' · ') || 'Nothing to do';
}

export function AdminEnrichmentScreen() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[]>(['prices', 'sources', 'claims']);
  const [maxResearch, setMaxResearch] = useState(3);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api<View>('/api/admin/enrichment'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the data checks.');
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const running = view?.runs.some((r) => r.status === 'running') ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [running, load]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      await api('/api/admin/enrichment/run', { body: { parts, max_research: maxResearch } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the check.');
    } finally {
      setStarting(false);
    }
  };

  if (!view) return error ? <ResolutionCard status="stop" title="That didn't work" role="alert"><p>{error}</p></ResolutionCard> : <p role="status">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-[1.4rem]">Data checks</h2>
        <p>
          Keeps provider prices and public claims current. Pages are fetched and compared with last time first, which costs nothing; only changed pages are read by Claude (Haiku, the
          lowest-cost model). A full web search (Sonnet) runs only for claims that can't be confirmed from their pages. Nothing changes the catalogue by itself: price changes arrive as{' '}
          <Link to="/admin/suggestions">suggested corrections</Link>.
        </p>
        <p className="small">{view.schedule_hours ? `Runs automatically every ${view.schedule_hours} hours.` : 'Not scheduled: set ENRICH_EVERY_HOURS on the server to run it automatically, or run it here.'}</p>
      </div>

      {error && (
        <ResolutionCard status="stop" title="That didn't work" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}
      {!view.configured && (
        <ResolutionCard status="caution" title="Claude isn't configured">
          <p>Set ANTHROPIC_API_KEY on the server to run data checks.</p>
        </ResolutionCard>
      )}

      <section className="card space-y-3" aria-labelledby="run-now">
        <h3 id="run-now" className="text-[1.15rem]">
          Run a check now
        </h3>
        <fieldset className="space-y-1">
          <legend className="label">What to check</legend>
          {(Object.keys(PART_LABELS) as Part[]).map((p) => (
            <label key={p} className="flex min-h-[var(--target-min)] items-start gap-3">
              <input type="checkbox" className="mt-1" checked={parts.includes(p)} onChange={(e) => setParts(e.target.checked ? [...parts, p] : parts.filter((x) => x !== p))} />
              <span>
                <span className="block font-medium">{PART_LABELS[p].label}</span>
                <span className="block text-[0.95rem]">{PART_LABELS[p].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label="Most full web searches this run" hint="Each costs more than everything else in a run together. Providers over the limit wait for the next run.">
          {({ id, describedBy }) => (
            <input id={id} aria-describedby={describedBy} type="number" min={0} max={20} className="input max-w-[8rem]" value={maxResearch} onChange={(e) => setMaxResearch(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} />
          )}
        </Field>
        <button type="button" className="btn btn-primary" disabled={!view.configured || running || starting || parts.length === 0} onClick={start}>
          <Icon name="search" size={20} /> {running ? 'Checking…' : 'Run the check'}
        </button>
      </section>

      <section className="space-y-3" aria-labelledby="runs">
        <h3 id="runs" className="text-[1.15rem]">
          Recent checks
        </h3>
        {view.runs.length === 0 ? (
          <p className="card">No checks yet.</p>
        ) : (
          <ul className="space-y-2">
            {view.runs.map((r) => (
              <li key={r.id} className="card space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {formatDateTime(r.started_at)} · {TRIGGER[r.trigger]}
                  </span>
                  <span className={`chip ${r.status === 'done' ? 'chip-good' : r.status === 'failed' ? 'chip-stop' : 'chip-info'}`}>{r.status === 'running' ? 'Running' : r.status === 'done' ? 'Done' : 'Stopped'}</span>
                </div>
                <p>{runSummary(r)}</p>
                <p className="small">Claude cost: {usd(r.usage.estimated_cost_usd)} (estimate)</p>
                {r.error && <p className="text-[var(--stop)]">{r.error}</p>}
                {r.log.length > 0 && (
                  <details>
                    <summary className="cursor-pointer">What it did ({r.log.length})</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-6 text-[0.95rem]">
                      {r.log.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sources sources={view.sources} reload={load} onError={setError} />

      {view.pages.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Pages being watched ({view.pages.length})</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Last checked</th>
                  <th scope="col">Last changed</th>
                </tr>
              </thead>
              <tbody>
                {view.pages.map((p) => (
                  <tr key={p.url}>
                    <td className="max-w-[28rem] break-all">
                      <a href={p.url} target="_blank" rel="noreferrer noopener">
                        {p.url}
                      </a>
                      {p.error && <span className="block text-[var(--stop)]">{p.error}</span>}
                    </td>
                    <td>{p.checked_at ? formatDateTime(p.checked_at) : '—'}</td>
                    <td>{p.changed_at ? formatDateTime(p.changed_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Sources({ sources, reload, onError }: { sources: Source[]; reload: () => Promise<void>; onError: (e: string | null) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');

  const act = async (fn: () => Promise<unknown>) => {
    onError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'That didn’t work.');
    }
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    act(async () => {
      await api('/api/admin/enrichment/sources', { body: { name, url, note } });
      setName('');
      setUrl('');
      setNote('');
    });
  };

  return (
    <section className="space-y-3" aria-labelledby="sources">
      <h3 id="sources" className="text-[1.15rem]">
        Extra sources
      </h3>
      <p>Public pages to watch besides each provider's price list: registers, government lists, notices. When one changes, Claude summarises what it says about the providers.</p>
      {sources.length > 0 && (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="card space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-semibold">{s.name}</span>
                  {!s.active && <span className="chip chip-neutral ml-2">Paused</span>}
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="block break-all text-[0.95rem]">
                    {s.url}
                  </a>
                </span>
                <span className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-sm" onClick={() => act(() => api(`/api/admin/enrichment/sources/${s.id}`, { method: 'PATCH', body: { active: !s.active } }))}>
                    {s.active ? 'Pause' : 'Resume'} <span className="sr-only">: {s.name}</span>
                  </button>
                  <ConfirmButton className="btn btn-sm btn-danger" confirmLabel="Remove" prompt={`Stop watching ${s.name}?`} onConfirm={() => act(() => api(`/api/admin/enrichment/sources/${s.id}`, { method: 'DELETE' }))}>
                    Remove <span className="sr-only">: {s.name}</span>
                  </ConfirmButton>
                </span>
              </div>
              {s.note && <p className="small">{s.note}</p>}
              {s.summary ? (
                <div className="well space-y-2">
                  <p className="small">
                    {s.summary.change === 'new' ? 'First read' : 'Changed'} · {s.summary_at && formatDateTime(s.summary_at)}
                  </p>
                  <p>{s.summary.summary}</p>
                  {s.summary.mentions.length > 0 && (
                    <ul className="list-disc space-y-1 pl-6 text-[0.95rem]">
                      {s.summary.mentions.map((m, i) => (
                        <li key={i}>
                          <b>{m.provider_name}</b>
                          {!m.provider_id && ' (not in the catalogue)'}: {m.fact} <span className="italic">“{m.quote}”</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="small">Not read yet.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="card grid gap-3 md:grid-cols-2" onSubmit={add}>
        <Field label="Name">{({ id }) => <input id={id} className="input" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Web address">{({ id }) => <input id={id} className="input" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />}</Field>
        <Field label="What it's for (optional)" className="md:col-span-2">
          {({ id }) => <input id={id} className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <div className="md:col-span-2">
          <button type="submit" className="btn">
            <Icon name="plus" size={20} /> Add source
          </button>
        </div>
      </form>
    </section>
  );
}
