import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Meter } from '../components/ui/Visual';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { formatDateTime } from '../format';
import { ConfirmButton } from '../components/ConfirmButton';
import { ResolutionCard } from '../components/ui/Cards';
import { Field } from '../components/ui/Form';
import { Icon } from '../components/ui/Icon';

// Site administration → Data checks: run the enrichment service, see what each run did and cost, and manage
// the extra sources it reads. Price changes it finds arrive as suggested corrections for approval.

type Part = 'discover' | 'prices' | 'sources' | 'claims';

type ItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

interface RunItem {
  id: string;
  part: Part;
  label: string;
  url: string | null;
  status: ItemStatus;
  stage: string | null;
  detail: string | null;
  outcome: string | null;
  error: { stage: string; message: string } | null;
  started_at: string | null;
  ms: number | null;
}

interface Run {
  id: string;
  trigger: 'schedule' | 'admin' | 'cli';
  status: 'running' | 'done' | 'failed' | 'cancelled';
  stats: {
    discover?: { found: number; added: number; updated: number; failed: number };
    prices?: { checked: number; unchanged: number; changed: number; errors: number; suggestions: number; matched: number; applied?: number };
    sources?: { checked: number; unchanged: number; changed: number; errors: number; summarised: number };
    claims?: { due: number; revalidated: number; reread: number; researched: number; deferred: number; failed: number };
  };
  usage: { estimated_cost_usd?: number; models?: Record<string, { requests: number; input_tokens: number; output_tokens: number; web_searches: number }> };
  log: string[];
  progress: { items?: RunItem[]; eta_seconds?: number | null; skipped?: { claims_current: number; no_price_list: number; not_shortlisted?: number }; updated_at?: string };
  cancel_requested: boolean;
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
  discover: {
    label: 'Find providers near each application',
    hint: "Claude searches the web and My Aged Care for providers serving each application's postcode, adds new ones and fills in missing websites and price lists. One search per area, from the search limit below.",
  },
  prices: { label: 'Price lists', hint: "Shortlisted and hand-added providers. Missing price lists are searched for; changed prices become suggested corrections." },
  sources: { label: 'Extra sources', hint: 'The pages listed below. Changes are summarised here.' },
  claims: { label: 'Public claims older than 60 days', hint: 'Re-checks the pages claims came from; searches the web only when needed.' },
};
const TRIGGER: Record<Run['trigger'], string> = { schedule: 'Scheduled', admin: 'Started here', cli: 'Command line' };
const STATUS_CHIP: Record<Run['status'], [string, string]> = { running: ['chip-info', 'Running'], done: ['chip-good', 'Done'], failed: ['chip-stop', 'Stopped by an error'], cancelled: ['chip-neutral', 'Stopped'] };

/** "45 sec", "3 min", "1 hr 5 min". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** Ticks once a second while `on`, so elapsed and remaining times count down smoothly between polls. */
function useNow(on: boolean) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const i = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(i);
  }, [on]);
  return t;
}
const usd = (n: number | undefined) => (n === undefined ? '—' : n < 0.01 ? 'under US$0.01' : `about US$${n.toFixed(2)}`);

function runSummary(r: Run): string {
  const parts: string[] = [];
  const d = r.stats.discover;
  if (d && (d.found || d.failed)) parts.push(`finding providers: ${d.found} found, ${d.added} new, ${d.updated} filled in`);
  const p = r.stats.prices;
  if (p) parts.push(`price lists: ${p.checked} checked, ${p.changed} changed${p.applied ? `, ${p.applied} read into the catalogue` : ''}, ${p.suggestions} suggestion${p.suggestions === 1 ? '' : 's'}`);
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
    const t = setInterval(load, 3000);
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

      {view.runs.filter((r) => r.status === 'running').map((r) => (
        <LiveRun key={r.id} run={r} reload={load} onError={setError} />
      ))}

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
        <Field label="Most web searches this run" hint="Finding providers, finding a missing price list and a full public-claims search each use one. Each costs more than everything else in a run together; anything over the limit waits for the next run.">
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
        {view.runs.filter((r) => r.status !== 'running').length === 0 ? (
          <p className="card">No finished checks yet.</p>
        ) : (
          <ul className="space-y-2">
            {view.runs
              .filter((r) => r.status !== 'running')
              .map((r) => (
                <PastRun key={r.id} run={r} />
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

const PART_SHORT: Record<Part, string> = { discover: 'Finding providers', prices: 'Price lists', sources: 'Extra sources', claims: 'Public claims' };

function counts(items: RunItem[]) {
  const c = { total: items.length, done: 0, failed: 0, running: 0, queued: 0, cancelled: 0 };
  for (const i of items) c[i.status === 'done' ? 'done' : i.status === 'failed' ? 'failed' : i.status === 'running' ? 'running' : i.status === 'queued' ? 'queued' : 'cancelled'] += 1;
  return c;
}

/** The check that's running now: progress, time left, what it's doing and any problems so far. */
function LiveRun({ run, reload, onError }: { run: Run; reload: () => Promise<void>; onError: (e: string | null) => void }) {
  const now = useNow(true);
  const items = run.progress.items ?? [];
  const c = counts(items);
  const finished = c.done + c.failed;
  const elapsed = (now - new Date(run.started_at).getTime()) / 1000;
  const sinceSave = run.progress.updated_at ? (now - new Date(run.progress.updated_at).getTime()) / 1000 : 0;
  const eta = run.progress.eta_seconds == null ? null : Math.max(0, run.progress.eta_seconds - sinceSave);
  const problems = items.filter((i) => i.status === 'failed');
  const running = items.filter((i) => i.status === 'running');
  const stop = async () => {
    onError(null);
    try {
      await api('/api/admin/enrichment/stop', { body: {} });
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not stop the check.');
    }
  };

  return (
    <section className="card space-y-4 border-2 border-[var(--charcoal)]" aria-labelledby="live-run">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="live-run" className="text-[1.25rem]">
            Checking now
          </h3>
          <p className="small">
            {TRIGGER[run.trigger]} · started {duration(elapsed)} ago
          </p>
        </div>
        {run.cancel_requested ? (
          <span className="chip chip-caution">Stopping after the items in hand…</span>
        ) : (
          <ConfirmButton className="btn" confirmLabel="Stop the check" prompt="Stop after the items it's working on? Anything not started waits for the next check." onConfirm={stop}>
            Stop
          </ConfirmButton>
        )}
      </div>

      <div aria-live="polite" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[1.1rem] font-semibold">
            {finished} of {c.total} checked
          </p>
          <p className="text-[1.1rem]">
            {c.total === 0 ? 'Planning…' : eta === null ? 'Estimating time…' : eta < 5 ? 'Finishing…' : <>About <b>{duration(eta)}</b> left</>}
          </p>
        </div>
        <Meter value={finished} max={Math.max(1, c.total)} tone={problems.length ? 'caution' : 'good'} label={`${finished} of ${c.total} checked`} />
        <p className="small">
          {c.done} done · {c.failed} with problems · {c.running} in progress · {c.queued} waiting. The time left is an estimate from this check and recent ones.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {(['discover', 'prices', 'sources', 'claims'] as Part[]).map((part) => {
          const mine = counts(items.filter((i) => i.part === part));
          if (!mine.total) return null;
          return (
            <div key={part} className="well">
              <p className="font-semibold">{PART_SHORT[part]}</p>
              <p className="small">
                {mine.done + mine.failed} of {mine.total}
                {mine.failed ? ` · ${mine.failed} problem${mine.failed === 1 ? '' : 's'}` : ''}
              </p>
            </div>
          );
        })}
      </div>

      {running.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-semibold">Working on</h4>
          <ul className="space-y-2">
            {running.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--rule)] p-3">
                <span className="min-w-0">
                  <span className="block font-medium">{i.label}</span>
                  <span className="block text-[0.95rem]">
                    {i.stage}
                    {i.detail && ` · ${i.detail}`}
                  </span>
                </span>
                <span className="small whitespace-nowrap">{i.started_at && duration((now - new Date(i.started_at).getTime()) / 1000)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {problems.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-semibold text-[var(--caution)]">Problems so far ({problems.length})</h4>
          <ItemTable items={problems} />
        </div>
      )}
      {(run.progress.skipped?.claims_current || run.progress.skipped?.no_price_list || run.progress.skipped?.not_shortlisted) ? (
        <p className="small">
          Not needed this time:{' '}
          {[
            run.progress.skipped?.not_shortlisted && `${run.progress.skipped.not_shortlisted} loaded provider${run.progress.skipped.not_shortlisted === 1 ? " isn't" : "s aren't"} shortlisted yet`,
            run.progress.skipped?.claims_current && `${run.progress.skipped.claims_current} provider${run.progress.skipped.claims_current === 1 ? "'s" : "s'"} public claims ${run.progress.skipped.claims_current === 1 ? 'are' : 'are'} still current`,
            run.progress.skipped?.no_price_list && `${run.progress.skipped.no_price_list} provider${run.progress.skipped.no_price_list === 1 ? ' has' : 's have'} no price list link`,
          ]
            .filter(Boolean)
            .join('; ')}
          .
        </p>
      ) : null}
    </section>
  );
}

function ItemTable({ items }: { items: RunItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Result</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td className="min-w-[12rem]">
                {i.label}
                {i.url && (
                  <a href={i.url} target="_blank" rel="noreferrer noopener" className="block max-w-[22rem] truncate text-[0.875rem]">
                    {i.url}
                  </a>
                )}
              </td>
              <td>
                {i.status === 'failed' && i.error ? (
                  <span className="text-[var(--stop)]">
                    <b>{i.error.stage}:</b> {i.error.message}
                  </span>
                ) : i.status === 'cancelled' ? (
                  'Not started — the check was stopped'
                ) : i.status === 'queued' ? (
                  'Waiting'
                ) : i.status === 'running' ? (
                  `${i.stage ?? 'Working'}${i.detail ? ` · ${i.detail}` : ''}`
                ) : (
                  i.outcome
                )}
              </td>
              <td className="whitespace-nowrap">{i.ms !== null ? duration(i.ms / 1000) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PastRun({ run }: { run: Run }) {
  const items = run.progress.items ?? [];
  const problems = items.filter((i) => i.status === 'failed');
  const [onlyProblems, setOnlyProblems] = useState(problems.length > 0);
  const took = run.finished_at ? (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000 : null;
  const [chip, word] = STATUS_CHIP[run.status];
  const shown = onlyProblems ? problems : items;
  return (
    <li className="card space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {formatDateTime(run.started_at)} · {TRIGGER[run.trigger]}
          {took !== null && <span className="font-normal"> · took {duration(took)}</span>}
        </span>
        <span className={`chip ${chip}`}>{word}</span>
      </div>
      <p>{runSummary(run)}</p>
      <p className="small">
        {problems.length ? <span className="text-[var(--caution)]">{problems.length} with problems · </span> : null}Claude cost: {usd(run.usage.estimated_cost_usd)} (estimate)
      </p>
      {run.error && <p className="text-[var(--stop)]">{run.error}</p>}
      {items.length > 0 ? (
        <details>
          <summary className="cursor-pointer">Each item ({items.length})</summary>
          <div className="mt-2 space-y-2">
            {problems.length > 0 && (
              <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-sm" aria-pressed={onlyProblems} onClick={() => setOnlyProblems(true)}>
                  Problems ({problems.length})
                </button>
                <button type="button" className="btn btn-sm" aria-pressed={!onlyProblems} onClick={() => setOnlyProblems(false)}>
                  All ({items.length})
                </button>
              </div>
            )}
            <ItemTable items={shown} />
          </div>
        </details>
      ) : (
        run.log.length > 0 && (
          <details>
            <summary className="cursor-pointer">What it did ({run.log.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-[0.95rem]">
              {run.log.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </details>
        )
      )}
    </li>
  );
}
