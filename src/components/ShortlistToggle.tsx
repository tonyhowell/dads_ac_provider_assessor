import { useApp } from '../state/AppContext';
import type { Provider } from '../types';

export function ShortlistToggle({ provider }: { provider: Provider }) {
  const { state, dispatch } = useApp();
  const selected = state.shortlist.some((e) => e.provider_id === provider.id);
  return (
    <button
      type="button"
      className={selected ? 'btn btn-primary' : 'btn'}
      aria-pressed={selected}
      onClick={() =>
        dispatch(
          selected
            ? { type: 'shortlist/remove', providerId: provider.id }
            : { type: 'shortlist/add', providerId: provider.id, at: new Date().toISOString() },
        )
      }
    >
      {selected ? 'Shortlisted' : 'Add to shortlist'}
      {' '}
      <span className="sr-only">— {provider.provider}</span>
    </button>
  );
}
