import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { entriesAt, STAGE_LABELS } from '../state/reducer';
import { SELECTION_STAGES } from '../schemas';
import { PriceProvenance } from '../components/Price';
import { StageControls } from '../components/StageControls';
import type { Provider, SelectionEntry, SelectionStage } from '../types';

const STAGE_HELP: Record<SelectionStage, string> = {
  scan: 'Every provider you want a first look at. Check coverage, published prices and anything that rules them out, then advance the promising ones.',
  refine: 'Compare the remaining providers more closely (costs, fit, notes from phone calls) and advance the ones worth interviewing.',
  interview: 'The providers you will interview, in order of preference. Record why each made the list and what to probe.',
};

const isStage = (s: string | undefined): s is SelectionStage => SELECTION_STAGES.includes(s as SelectionStage);

export function SelectionScreen() {
  const { stage } = useParams();
  const { seed, state } = useApp();
  if (!isStage(stage)) return <Navigate to="/selection/scan" replace />;

  const byId = new Map(seed.providers.map((p) => [p.id, p]));
  const entries = entriesAt(state, stage).flatMap((entry) => {
    const provider = byId.get(entry.provider_id);
    return provider ? [{ entry, provider }] : [];
  });
  const unselected = seed.providers.length - state.selection.length;

  return (
    <section>
      <h1 className="text-2xl font-semibold">Provider selection</h1>
      <p className="muted mt-1">
        {seed.providers.length} providers in the area · {unselected} not yet selected ·{' '}
        <Link to="/providers">browse all providers</Link>
      </p>

      <nav aria-label="Selection stages" className="mt-4">
        <ol className="grid grid-cols-3 gap-2">
          {SELECTION_STAGES.map((s, i) => {
            const n = entriesAt(state, s).length;
            const count = `${n} provider${n === 1 ? '' : 's'}`;
            return (
            <li key={s}>
              <NavLink
                to={`/selection/${s}`}
                aria-label={`Stage ${i + 1}: ${STAGE_LABELS[s]}, ${count}`}
                className={({ isActive }) =>
                  `block h-full rounded-md border px-3 py-2 text-sm no-underline hover:no-underline ${
                    isActive
                      ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-600'
                      : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
                  }`
                }
              >
                <span className="block text-xs opacity-80">Stage {i + 1}</span>
                <span className="block font-medium">{STAGE_LABELS[s]}</span>
                <span className="block text-xs opacity-80">{count}</span>
              </NavLink>
            </li>
            );
          })}
        </ol>
      </nav>

      <p className="muted mt-4">{STAGE_HELP[stage]}</p>

      {entries.length === 0 ? (
        <div className="card mt-4">
          <p>No providers at this stage.</p>
          <p className="mt-2">
            {stage === 'scan' ? (
              <Link to="/providers">Add providers from the full list</Link>
            ) : (
              <Link to={`/selection/${SELECTION_STAGES[SELECTION_STAGES.indexOf(stage) - 1]}`}>
                Advance providers from the previous stage
              </Link>
            )}
          </p>
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {entries.map(({ entry, provider }, index) => (
            <SelectionCard key={provider.id} entry={entry} provider={provider} index={index} count={entries.length} />
          ))}
        </ol>
      )}
    </section>
  );
}

function SelectionCard({ entry, provider, index, count }: { entry: SelectionEntry; provider: Provider; index: number; count: number }) {
  const { state, dispatch } = useApp();
  const ranked = entry.stage === 'interview';
  const noteCount = state.notes.filter((n) => n.provider_id === provider.id).length;
  const interviewCount = state.interviews.filter((i) => i.provider_id === provider.id).length;

  return (
    <li className="card space-y-3">
      <div>
        <h2 className="font-semibold">
          {ranked && (
            <>
              <span className="mr-2 inline-block min-w-6 rounded bg-teal-700 px-1.5 text-center text-white dark:bg-teal-600" aria-hidden>
                {index + 1}
              </span>
              <span className="sr-only">Rank {index + 1}: </span>
            </>
          )}
          <Link to={`/providers/${provider.id}`}>{provider.provider}</Link>
        </h2>
        <PriceProvenance provider={provider} />
        <p className="muted">
          {noteCount} note{noteCount === 1 ? '' : 's'}
          {ranked && ` · ${interviewCount} interview${interviewCount === 1 ? '' : 's'} recorded`}
        </p>
      </div>

      <StageControls provider={provider} />

      {ranked && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            disabled={index === 0}
            onClick={() => dispatch({ type: 'selection/move', providerId: provider.id, toIndex: index - 1 })}
          >
            Move up <span className="sr-only">{provider.provider}</span>
          </button>
          <button
            type="button"
            className="btn"
            disabled={index === count - 1}
            onClick={() => dispatch({ type: 'selection/move', providerId: provider.id, toIndex: index + 1 })}
          >
            Move down <span className="sr-only">{provider.provider}</span>
          </button>
          <Link to={`/interviews/new/${provider.id}`} className="btn no-underline hover:no-underline">
            Record interview <span className="sr-only">with {provider.provider}</span>
          </Link>
        </div>
      )}

      <div className={`grid gap-3 ${ranked ? 'md:grid-cols-2' : ''}`}>
        <div>
          <label htmlFor={`why-${provider.id}`} className="muted block">
            {ranked ? "Why it's on the shortlist" : 'Reason for keeping it'}
          </label>
          <textarea
            id={`why-${provider.id}`}
            className="input min-h-20"
            value={entry.why}
            onChange={(e) => dispatch({ type: 'selection/update', providerId: provider.id, why: e.target.value })}
          />
        </div>
        {ranked && (
          <div>
            <label htmlFor={`watch-${provider.id}`} className="muted block">
              Probe at interview
            </label>
            <textarea
              id={`watch-${provider.id}`}
              className="input min-h-20"
              value={entry.watch}
              onChange={(e) => dispatch({ type: 'selection/update', providerId: provider.id, watch: e.target.value })}
            />
          </div>
        )}
      </div>
    </li>
  );
}
