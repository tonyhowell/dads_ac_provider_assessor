import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { nextStage, prevStage, STAGE_LABELS } from '../state/reducer';
import type { Provider, SelectionStage } from '../types';

const STAGE_NUMBER: Record<SelectionStage, number> = { scan: 1, refine: 2, interview: 3 };

export function StageBadge({ stage }: { stage: SelectionStage }) {
  return (
    <span className="rounded bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-900 dark:bg-teal-900 dark:text-teal-100">
      Stage {STAGE_NUMBER[stage]}: {STAGE_LABELS[stage]}
    </span>
  );
}

/**
 * Where a provider sits in the selection process, with buttons to add it,
 * move it forward or back a stage, or drop it.
 */
export function StageControls({ provider, compact = false }: { provider: Provider; compact?: boolean }) {
  const { state, dispatch } = useApp();
  const entry = state.selection.find((e) => e.provider_id === provider.id);
  const at = () => new Date().toISOString();

  if (!entry) {
    return (
      <button type="button" className="btn" onClick={() => dispatch({ type: 'selection/add', providerId: provider.id, at: at() })}>
        Add to initial scan <span className="sr-only">: {provider.provider}</span>
      </button>
    );
  }

  const next = nextStage(entry.stage);
  const prev = prevStage(entry.stage);

  if (compact) {
    return (
      <Link to={`/selection/${entry.stage}`} className="no-underline hover:no-underline">
        <StageBadge stage={entry.stage} />
      </Link>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StageBadge stage={entry.stage} />
      {next && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => dispatch({ type: 'selection/stage', providerId: provider.id, stage: next, at: at() })}
        >
          Advance to {STAGE_LABELS[next]} <span className="sr-only">: {provider.provider}</span>
        </button>
      )}
      {prev && (
        <button
          type="button"
          className="btn"
          onClick={() => dispatch({ type: 'selection/stage', providerId: provider.id, stage: prev, at: at() })}
        >
          Back to {STAGE_LABELS[prev]} <span className="sr-only">: {provider.provider}</span>
        </button>
      )}
      <button type="button" className="btn btn-danger" onClick={() => dispatch({ type: 'selection/remove', providerId: provider.id })}>
        Drop <span className="sr-only">{provider.provider}</span>
      </button>
    </div>
  );
}
