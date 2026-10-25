import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { PriceProvenance, isStale } from '../components/Price';
import { StageControls } from '../components/StageControls';
import { mentionsDisallowedFees } from '../flags';
import { STAGE_LABELS } from '../state/reducer';
import { SELECTION_STAGES } from '../schemas';
import type { Provider, SelectionStage } from '../types';
import { NextStepCard, ScreenHeader } from '../components/ui/Cards';
import { StatusText } from '../components/ui/Status';
import { Icon } from '../components/ui/Icon';
import { useAuth } from '../auth/AuthContext';
import { servesArea, type AreaMatch } from '../area';

type SortKey = 'name' | 'notes';
type StageFilter = 'all' | 'none' | SelectionStage;
type Chip = 'veteran' | 'current' | 'noflags';

const hasVeteranExperience = (p: Provider) => /^strong|veteran/i.test(p.veteran_fit ?? '');
const hasFlags = (p: Provider) => p.flags.length > 0;

export function ProvidersScreen() {
  const { providers, state, canEdit, areaPostcode } = useApp();
  const { user } = useAuth();
  const [showOutside, setShowOutside] = useState(false);
  const outsideCount = providers.filter((p) => servesArea(p, areaPostcode) === 'outside').length;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [chips, setChips] = useState<Set<Chip>>(new Set());
  const stageOf = useMemo(() => new Map(state.selection.map((e) => [e.provider_id, e.stage])), [state.selection]);
  const toggleChip = (c: Chip) => setChips((s) => (s.has(c) ? new Set([...s].filter((x) => x !== c)) : new Set([...s, c])));

  const noteCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of state.notes) m.set(n.provider_id, (m.get(n.provider_id) ?? 0) + 1);
    return m;
  }, [state.notes]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = providers.filter(
      (p) =>
        (!q || [p.provider, p.outlet, p.type, ...p.flags].some((v) => v?.toLowerCase().includes(q))) &&
        (stageFilter === 'all' || (stageOf.get(p.id) ?? 'none') === stageFilter) &&
        (!chips.has('veteran') || hasVeteranExperience(p)) &&
        (!chips.has('current') || !isStale(p.prices_as_at_date)) &&
        (!chips.has('noflags') || !hasFlags(p)) &&
        (showOutside || servesArea(p, areaPostcode) !== 'outside'),
    );
    return filtered.sort((a, b) =>
      sort === 'notes' ? (noteCounts.get(b.id) ?? 0) - (noteCounts.get(a.id) ?? 0) || a.provider.localeCompare(b.provider) : a.provider.localeCompare(b.provider),
    );
  }, [providers, query, sort, noteCounts, stageFilter, stageOf, chips, showOutside, areaPostcode]);

  return (
    <section className="space-y-6">
      <ScreenHeader title="Look up providers near you" purpose="Check each provider's prices and notes, and add the ones worth a closer look to your list." helpTopic="providers">
        {user?.role === 'admin' ? (
          <Link to="/admin/providers" className="btn">
            <Icon name="edit" size={20} /> Manage the provider catalogue
          </Link>
        ) : (
          canEdit && (
            <Link to="/providers/new" className="btn">
              <Icon name="plus" size={20} /> Suggest a provider
            </Link>
          )
        )}
      </ScreenHeader>

      <div className="card space-y-4">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <label htmlFor="provider-search" className="label">
              Search by name
            </label>
            <input id="provider-search" type="search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div>
            <label htmlFor="provider-stage" className="label">
              Step
            </label>
            <select id="provider-stage" className="input" value={stageFilter} onChange={(e) => setStageFilter(e.target.value as StageFilter)}>
              <option value="all">All</option>
              <option value="none">Not on my list</option>
              {SELECTION_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="provider-sort" className="label">
              Sort by
            </label>
            <select id="provider-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="name">Name</option>
              <option value="notes">Most notes</option>
            </select>
          </div>
        </div>
        <fieldset>
          <legend className="label">Only show providers that</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {(
              [
                ['veteran', 'Have veteran experience'],
                ['current', 'Have up-to-date prices'],
                ['noflags', 'Have no flags'],
              ] as [Chip, string][]
            ).map(([c, label]) => (
              <button key={c} type="button" aria-pressed={chips.has(c)} className="btn" onClick={() => toggleChip(c)}>
                {chips.has(c) && <Icon name="check" size={18} />} {label}
              </button>
            ))}
          </div>
        </fieldset>
        <p aria-live="polite">
          Showing {rows.length} of {providers.length} providers · {state.selection.length} on your list
        </p>
        {outsideCount > 0 && (
          <button type="button" className="btn-quiet" aria-pressed={showOutside} onClick={() => setShowOutside(!showOutside)}>
            <Icon name="pin" size={20} /> {showOutside ? `Hide the ${outsideCount} outside ${areaPostcode}` : `Show ${outsideCount} provider${outsideCount === 1 ? '' : 's'} outside ${areaPostcode}`}
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <p className="card">
          No providers match. <button type="button" className="btn-quiet" onClick={() => (setQuery(''), setChips(new Set()), setStageFilter('all'), setShowOutside(true))}>Clear the search and filters</button>
        </p>
      )}

      <ul className="space-y-3">
        {rows.map((p) => {
          const notes = noteCounts.get(p.id) ?? 0;
          return (
            <li key={p.id} className="card flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-[1.2rem]">
                  <Link to={`/providers/${p.id}`}>{p.provider}</Link>
                </h2>
                {(p.outlet || p.type) && <p>{[p.type, p.outlet].filter(Boolean).join(' · ')}</p>}
                <PriceProvenance provider={p} />
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {mentionsDisallowedFees(...p.flags) && <StatusText status="caution">Possible extra fee</StatusText>}
                  {hasFlags(p) && <span>{p.flags.length} flag{p.flags.length === 1 ? '' : 's'}</span>}
                  <span>
                    {notes} note{notes === 1 ? '' : 's'}
                  </span>
                  {hasVeteranExperience(p) && <StatusText status="good">Veteran experience</StatusText>}
                  <AreaBadge match={servesArea(p, areaPostcode)} postcode={areaPostcode} />
                </div>
              </div>
              <StageControls provider={p} compact />
            </li>
          );
        })}
      </ul>

      <NextStepCard
        done={`${state.selection.length} provider${state.selection.length === 1 ? ' is' : 's are'} on your list.`}
        next="narrow your list down to the ones you'll interview"
        back={{ to: '/costs', label: 'Compare costs' }}
        forward={{ to: '/selection', label: 'Continue to choose who to meet' }}
      />
    </section>
  );
}

function AreaBadge({ match, postcode }: { match: AreaMatch; postcode: string | null }) {
  if (!postcode) return null;
  if (match === 'serves') return <StatusText status="good">Serves {postcode}</StatusText>;
  if (match === 'outside') return <StatusText status="caution">Outside {postcode}</StatusText>;
  return <span>Area not confirmed</span>;
}
