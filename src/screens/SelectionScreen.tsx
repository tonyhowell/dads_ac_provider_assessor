import { CheckAllClaims, ClaimsChip } from '../components/Claims';
import { useState } from 'react';
import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { entriesAt, STAGE_LABELS } from '../state/reducer';
import { SELECTION_STAGES } from '../schemas';
import { StageControls } from '../components/StageControls';
import { OptionalNote } from '../components/OptionalNote';
import { usePlanCosts } from '../components/usePlanCosts';
import { mentionsDisallowedFees } from '../flags';
import { formatAud, formatPercent } from '../format';
import type { Provider, SelectionEntry, SelectionStage } from '../types';
import { NextStepCard, ResolutionCard, ScreenHeader } from '../components/ui/Cards';
import { UndoBar } from '../components/ui/Feedback';
import { Chip } from '../components/ui/Status';
import { Icon } from '../components/ui/Icon';

const STAGE_HELP: Record<SelectionStage, string> = {
  scan: 'Anyone who services your area. Keep anyone worth a second look.',
  refine: 'Compare costs and flags. Aim for 3 to 5.',
  interview: 'Put them in order. Add why you chose them and what to watch for.',
};

const isStage = (s: string | undefined): s is SelectionStage => SELECTION_STAGES.includes(s as SelectionStage);

export function SelectionScreen() {
  const { stage } = useParams();
  const { providers, state, dispatch } = useApp();
  const [dropped, setDropped] = useState<{ entry: SelectionEntry; index: number; name: string } | null>(null);
  const { byProvider, budget, benchmark } = usePlanCosts(providers.filter((p) => state.selection.some((e) => e.provider_id === p.id)));
  if (!isStage(stage)) return <Navigate to="/selection/scan" replace />;

  const byId = new Map(providers.map((p) => [p.id, p]));
  const onDrop = (entry: SelectionEntry) => () => {
    setDropped({ entry, index: state.selection.indexOf(entry), name: byId.get(entry.provider_id)?.provider ?? 'provider' });
  };
  const interviewCount = entriesAt(state, 'interview').length;

  return (
    <section className="space-y-6">
      <ScreenHeader title="Choose who to meet" purpose="Narrow down from all providers to the few you'll interview." helpTopic="selection" />

      {dropped && (
        <UndoBar
          onUndo={() => {
            dispatch({ type: 'selection/restore', entry: dropped.entry, index: dropped.index });
            setDropped(null);
          }}
          onDismiss={() => setDropped(null)}
        >
          Dropped {dropped.name}.
        </UndoBar>
      )}

      {/* Phones and tablets: one step at a time, with counts. */}
      <nav aria-label="Steps in choosing" className="min-[1120px]:hidden">
        <ol className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
          {SELECTION_STAGES.map((s, i) => {
            const n = entriesAt(state, s).length;
            return (
              <li key={s}>
                <NavLink
                  to={`/selection/${s}`}
                  aria-label={`Step ${i + 1}: ${STAGE_LABELS[s]}, ${n} provider${n === 1 ? '' : 's'}`}
                  className={({ isActive }) =>
                    `flex h-full min-h-[var(--target-min)] flex-col rounded-[var(--radius-control)] border p-2 no-underline ${isActive ? 'border-2 border-[var(--charcoal)] bg-[var(--amber-tint)]' : 'border-[var(--line)] bg-[var(--surface)]'}`
                  }
                >
                  <span className="text-[0.875rem]">Step {i + 1}</span>
                  <span className="font-semibold leading-tight [overflow-wrap:anywhere]">{STAGE_LABELS[s]}</span>
                  <span className="text-[0.875rem]">
                    {n} provider{n === 1 ? '' : 's'}
                  </span>
                </NavLink>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 min-[1120px]:grid-cols-3">
        {SELECTION_STAGES.map((s, i) => {
          const entries = entriesAt(state, s).flatMap((entry) => {
            const provider = byId.get(entry.provider_id);
            return provider ? [{ entry, provider }] : [];
          });
          return (
            <section key={s} aria-labelledby={`col-${s}`} className={`space-y-3 ${s === stage ? '' : 'max-[1119px]:hidden'}`}>
              <div className="well">
                <h2 id={`col-${s}`} className="text-[1.2rem]">
                  Step {i + 1}: {STAGE_LABELS[s]} <span className="font-normal">({entries.length})</span>
                </h2>
                <p>{STAGE_HELP[s]}</p>
                {s === 'scan' && entries.length > 0 && (
                  <div className="mt-2">
                    <CheckAllClaims providerIds={entries.map((e) => e.provider.id)} />
                  </div>
                )}
              </div>
              {entries.length === 0 ? (
                <p className="card">
                  {s === 'scan' ? (
                    <>
                      Nothing here yet. <Link to="/providers">Add providers from the full list</Link>.
                    </>
                  ) : (
                    <>Move providers here from {STAGE_LABELS[SELECTION_STAGES[i - 1]]}.</>
                  )}
                </p>
              ) : (
                <ol className="space-y-3">
                  {entries.map(({ entry, provider }, index) => {
                    const cost = byProvider.find((r) => r.provider.id === provider.id)?.cost;
                    return (
                      <ProviderCard
                        key={provider.id}
                        entry={entry}
                        provider={provider}
                        index={index}
                        count={entries.length}
                        cost={cost?.lines.some((l) => !l.filled_from_benchmark && l.price !== null) ? cost.quarterly_cost : null}
                        forServices={budget?.for_services ?? null}
                        guide={benchmark.quarterly_cost}
                        onDrop={onDrop(entry)}
                      />
                    );
                  })}
                </ol>
              )}
            </section>
          );
        })}
      </div>

      {interviewCount < 2 && (
        <ResolutionCard status="info" title="Interviewing at least two providers helps you compare">
          <p>
            {interviewCount === 0 ? 'No one is' : 'Only one provider is'} on your interview list yet. Move providers on from Refinement when you're ready.
          </p>
        </ResolutionCard>
      )}

      <NextStepCard
        done={`${interviewCount} provider${interviewCount === 1 ? ' is' : 's are'} ready to interview.`}
        next="use your interview questions with each provider"
        back={{ to: '/providers', label: 'Providers' }}
        forward={{ to: '/interview-pack', label: 'Continue to interview questions' }}
      />
    </section>
  );
}

function ProviderCard({
  entry,
  provider,
  index,
  count,
  cost,
  forServices,
  guide,
  onDrop,
}: {
  entry: SelectionEntry;
  provider: Provider;
  index: number;
  count: number;
  cost: number | null;
  forServices: number | null;
  guide: number;
  onDrop: () => void;
}) {
  const { state, dispatch, canEdit } = useApp();
  const ranked = entry.stage === 'interview';
  const notes = state.notes.filter((n) => n.provider_id === provider.id).length;
  const flags = provider.flags.length;
  const vsGuide = cost !== null && guide > 0 ? (cost - guide) / guide : null;

  return (
    <li className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        {ranked && (
          <>
            <span className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-[var(--charcoal)] px-2 font-semibold text-[var(--surface)]" aria-hidden>
              {index + 1}
            </span>
          </>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-[1.1rem]">
            {ranked && <span className="sr-only">Number {index + 1}: </span>}
            <Link to={`/providers/${provider.id}`}>{provider.provider}</Link>
          </h3>
          {cost === null ? (
            <p className="small">No published prices for your plan</p>
          ) : (
            <p>
              <strong className="tabular-nums">{formatAud(cost)}</strong> a quarter
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {cost !== null &&
          forServices !== null &&
          (cost > forServices ? <Chip status="stop">Over budget by {formatAud(cost - forServices)}</Chip> : <Chip status="good">Under budget by {formatAud(forServices - cost)}</Chip>)}
        {vsGuide !== null && (
          <span className="chip chip-neutral">{Math.abs(vsGuide) < 0.05 ? 'Within 5% of guide' : `${vsGuide > 0 ? '▲' : '▼'} ${formatPercent(Math.abs(vsGuide))} ${vsGuide > 0 ? 'above' : 'below'} guide`}</span>
        )}
        {mentionsDisallowedFees(...provider.flags) && <Chip status="caution">Possible extra fee</Chip>}
        <ClaimsChip provider={provider} />
        {flags > 0 && (
          <span className="chip chip-neutral">
            {flags} flag{flags === 1 ? '' : 's'}
          </span>
        )}
        {notes > 0 && (
          <span className="chip chip-neutral">
            {notes} note{notes === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StageControls provider={provider} onDrop={onDrop} small />
        {ranked && canEdit && (
          <>
            <button type="button" className="btn btn-sm w-11 px-0" disabled={index === 0} onClick={() => dispatch({ type: 'selection/move', providerId: provider.id, toIndex: index - 1 })}>
              <Icon name="arrowUp" size={20} /> <span className="sr-only">Move up {provider.provider}</span>
            </button>
            <button type="button" className="btn btn-sm w-11 px-0" disabled={index === count - 1} onClick={() => dispatch({ type: 'selection/move', providerId: provider.id, toIndex: index + 1 })}>
              <Icon name="arrowDown" size={20} /> <span className="sr-only">Move down {provider.provider}</span>
            </button>
          </>
        )}
      </div>

      <OptionalNote
        id={`why-${provider.id}`}
        label={ranked ? 'Why you chose them' : 'Why keep them'}
        addLabel={ranked ? 'Add why you chose them' : 'Add why to keep them'}
        value={entry.why}
        readOnly={!canEdit}
        onCommit={(v) => dispatch({ type: 'selection/update', providerId: provider.id, why: v })}
      />
      {ranked && (
        <OptionalNote
          id={`watch-${provider.id}`}
          label="Watch for"
          addLabel="Add what to watch for"
          hint={`These show up in your interview questions for ${provider.provider}.`}
          value={entry.watch}
          readOnly={!canEdit}
          onCommit={(v) => dispatch({ type: 'selection/update', providerId: provider.id, watch: v })}
        />
      )}
    </li>
  );
}
