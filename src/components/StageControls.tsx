import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { nextStage, prevStage, STAGE_LABELS } from '../state/reducer';
import type { Provider, SelectionStage } from '../types';
import { Icon } from './ui/Icon';

const STAGE_NUMBER: Record<SelectionStage, number> = { scan: 1, refine: 2, interview: 3 };

export function StageBadge({ stage }: { stage: SelectionStage }) {
  return (
    <span className="chip chip-outline">
      Step {STAGE_NUMBER[stage]}: {STAGE_LABELS[stage]}
    </span>
  );
}

/**
 * Where a provider sits in the selection, with explicit buttons to add it, move it on or back, or drop it
 * (UI-SPEC §6.10). `onDrop` lets the screen offer Undo.
 */
export function StageControls({
  provider,
  compact = false,
  primaryAdd = false,
  small = false,
  onDrop,
}: {
  provider: Provider;
  compact?: boolean;
  /** Show "Add to my list" as the screen's amber action. */
  primaryAdd?: boolean;
  /** Smaller buttons, for cards on the selection board. */
  small?: boolean;
  onDrop?: (stage: SelectionStage) => void;
}) {
  const { state, dispatch, canEdit } = useApp();
  const entry = state.selection.find((e) => e.provider_id === provider.id);
  const at = () => new Date().toISOString();

  if (!canEdit && !compact) return entry ? <StageBadge stage={entry.stage} /> : null;

  if (!entry) {
    if (!canEdit) return null;
    return (
      <button type="button" className={`btn ${primaryAdd ? 'btn-primary' : ''}`} onClick={() => dispatch({ type: 'selection/add', providerId: provider.id, at: at() })}>
        <Icon name="plus" size={20} /> Add to my list <span className="sr-only">: {provider.provider}</span>
      </button>
    );
  }

  if (compact) {
    return (
      <Link to={`/selection/${entry.stage}`}>
        <StageBadge stage={entry.stage} />
      </Link>
    );
  }

  const sm = small ? 'btn-sm' : '';
  const next = nextStage(entry.stage);
  const prev = prevStage(entry.stage);
  return (
    <div className={`flex flex-wrap items-center gap-2 ${small ? 'contents' : ''}`}>
      {next && (
        <button type="button" className={`btn ${sm}`} onClick={() => dispatch({ type: 'selection/stage', providerId: provider.id, stage: next, at: at() })}>
          Move to {STAGE_LABELS[next]} <Icon name="arrowRight" size={20} /> <span className="sr-only">: {provider.provider}</span>
        </button>
      )}
      {prev && (
        <button type="button" className={`btn ${sm}`} onClick={() => dispatch({ type: 'selection/stage', providerId: provider.id, stage: prev, at: at() })}>
          <Icon name="arrowLeft" size={20} /> Back to {STAGE_LABELS[prev]} <span className="sr-only">: {provider.provider}</span>
        </button>
      )}
      <button
        type="button"
        className={`btn btn-danger ${sm}`}
        onClick={() => {
          dispatch({ type: 'selection/remove', providerId: provider.id });
          onDrop?.(entry.stage);
        }}
      >
        <Icon name="octagon" size={20} /> Drop <span className="sr-only">{provider.provider}</span>
      </button>
    </div>
  );
}
