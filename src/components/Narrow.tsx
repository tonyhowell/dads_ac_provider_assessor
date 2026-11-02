import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import type { useFinderState } from '../screens/FindProvidersScreen';
import { countChoice, countWith, needsResearch, ORG_KINDS, RADII, RESEARCH_COST_EACH_USD, RESEARCH_MAX, SIZE_BANDS, type NarrowFilters, type Row } from '../narrow';
import { Icon } from './ui/Icon';

// Find, basic (improvement plan: narrowing): three steps from everyone nearby to a short, researched list —
// how far, the essentials, then check what's left in one go. Every choice shows how many it would leave.

export type FinderState = ReturnType<typeof useFinderState>;

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
const providers = (n: number) => `${n.toLocaleString('en-AU')} provider${n === 1 ? '' : 's'}`;

export function NarrowSteps({ f }: { f: FinderState }) {
  const n = f.narrow;
  const set = (patch: Partial<NarrowFilters>) => f.setNarrow({ ...n, ...patch });
  const left = f.shownRows.length;
  const checked = f.base.filter((r) => r.facts.compliance !== 'unchecked' && r.facts.compliance !== 'checking').length;
  const anyOn = n.radiusKm !== null || n.org.length > 0 || n.sizes.length > 0 || n.cleanRecord;
  return (
    <section className="card space-y-4" aria-labelledby="narrow-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="narrow-heading" className="text-[1.2rem]">
          Narrow down
        </h2>
        <p className="font-semibold" role="status">
          {providers(left)} left of {f.base.length.toLocaleString('en-AU')} in your area
        </p>
      </div>

      <fieldset className="space-y-1">
        <legend className="label">1. How far away</legend>
        <div className="flex flex-wrap gap-2">
          {[null, ...RADII].map((km) => (
            <button key={km ?? 'any'} type="button" className="btn btn-sm" aria-pressed={n.radiusKm === km} onClick={() => set({ radiusKm: km })}>
              {km === null ? 'Any distance' : `Within ${km} km`} <span className="font-normal">({countWith(f.base, n, 'radiusKm', km)})</span>
            </button>
          ))}
        </div>
        <p className="small">Measured to their nearest outlet, by suburb.</p>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-3">
        <fieldset>
          <legend className="label">2. Type of organisation</legend>
          {ORG_KINDS.map((o) => (
            <Choice key={o.id} label={o.label} count={countChoice(f.base, n, 'org', o.id)} checked={n.org.includes(o.id)} onChange={() => set({ org: toggle(n.org, o.id) })} />
          ))}
        </fieldset>
        <fieldset>
          <legend className="label">Size (government funding a year)</legend>
          {SIZE_BANDS.map((b) => (
            <Choice key={b.id} label={b.label} hint={b.hint} count={countChoice(f.base, n, 'sizes', b.id)} checked={n.sizes.includes(b.id)} onChange={() => set({ sizes: toggle(n.sizes, b.id) })} />
          ))}
        </fieldset>
        <fieldset>
          <legend className="label">Record</legend>
          <Choice
            label="No sanctions or non-compliance"
            hint={`checked for ${checked} of ${f.base.length}`}
            count={countWith(f.base, n, 'cleanRecord', true)}
            checked={n.cleanRecord}
            onChange={() => set({ cleanRecord: !n.cleanRecord })}
          />
        </fieldset>
      </div>

      <div className="space-y-2 border-t border-[var(--rule)] pt-3">
        <p className="label">3. Check what's left</p>
        <ResearchControl rows={f.shownRows} />
      </div>
      {anyOn && (
        <button type="button" className="btn-quiet" onClick={() => f.setNarrow({ ...n, radiusKm: null, org: [], sizes: [], cleanRecord: false })}>
          Clear these choices
        </button>
      )}
    </section>
  );
}

function Choice({ label, hint, count, checked, onChange }: { label: string; hint?: string; count: number; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex min-h-[var(--target-min)] items-center gap-3">
      <input type="checkbox" checked={checked} onChange={onChange} disabled={!checked && count === 0} />
      <span>
        {label} <span className="small">({count})</span>
        {hint && <span className="small block">{hint}</span>}
      </span>
    </label>
  );
}

/** Prices, compliance and public claims for a list of providers in one go, with a cost estimate and progress. */
export function ResearchControl({ rows, label }: { rows: Row[]; label?: string }) {
  const { application, canEdit } = useApp();
  const { startResearch, priceChecks, claims, compliance } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const todo = rows.filter((r) => needsResearch(r.facts));
  const running = (id: string) => priceChecks.get(id)?.status === 'running' || claims.get(id)?.status === 'running' || compliance.get(id)?.status === 'running';
  const busy = sent.filter(running).length;
  if (!canEdit) return null;
  const go = async () => {
    setError(null);
    const ids = todo.map((r) => r.m.provider.id);
    try {
      await startResearch(application.id, ids);
      setSent(ids);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checking.');
    }
  };
  const cost = Math.max(0.5, todo.length * RESEARCH_COST_EACH_USD);
  return (
    <div className="space-y-1">
      {busy > 0 ? (
        <div role="status" className="space-y-1">
          <p className="font-medium">
            Checking: {sent.length - busy} of {sent.length} done. Results fill in as each one finishes; you can carry on.
          </p>
          <progress className="w-full" value={sent.length - busy} max={sent.length} aria-label="Checking providers" />
        </div>
      ) : todo.length === 0 ? (
        <p>{rows.length ? `All ${providers(rows.length)} have been checked.` : 'No providers to check.'}</p>
      ) : todo.length > RESEARCH_MAX ? (
        <p>
          {providers(todo.length)} still need checking. Narrow to {RESEARCH_MAX} or fewer to check them all at once.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={go}>
            <Icon name="search" size={18} /> {label ?? 'Check these'} {providers(todo.length)}
          </button>
          <span className="small">
            Reads their prices, checks their quality record and what they say publicly. About US${cost.toFixed(2)} in Claude use; takes a few minutes.
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
