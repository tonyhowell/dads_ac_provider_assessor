import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { includedSections } from '../questions';
import { formatDate } from '../format';
import type { ClaimItem, Provider } from '../types';
import { Expander } from './ui/Expander';
import { ResolutionCard } from './ui/Cards';
import { Chip } from './ui/Status';
import { Icon } from './ui/Icon';
import { WorkingGrid } from './ui/Feedback';
import { Meter } from './ui/Visual';

// What providers say publicly about the interview topics. Researched by Claude, cached for every
// application and searched again after 60 days. Shown against this applicant's topics: the
// interview sections their "What I'm looking for" answers keep in.

/** The interview topics that matter to this applicant, with their section. */
export function useApplicantTopics() {
  const { seed, state } = useApp();
  return useMemo(() => {
    const included = includedSections(seed.boundingGroups, seed.interviewSections, state.answers);
    const topics = new Map<string, { text: string; section: string; relevant: boolean }>();
    for (const s of seed.interviewSections) for (const q of s.questions) topics.set(q.id, { text: q.text, section: `${s.code}. ${s.section}`, relevant: included.has(s.code) });
    return topics;
  }, [seed, state.answers]);
}

const ageDays = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);

function SourceLink({ item }: { item: ClaimItem }) {
  return (
    <a href={item.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1">
      {item.source_title || 'Source'} <Icon name="external" size={16} />
      <span className="sr-only">(opens in new tab)</span>
    </a>
  );
}

/** The provider page's "What they say publicly" section. */
export function ClaimsPanel({ provider }: { provider: Provider }) {
  const { canEdit, application } = useApp();
  const { claims, startClaims, claimsMaxAgeDays } = useSession();
  const topics = useApplicantTopics();
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const row = claims.get(provider.id);
  const items = row?.claims?.items ?? [];
  const relevantIds = [...topics].filter(([, t]) => t.relevant).map(([id]) => id);
  const relevantItems = items.filter((i) => topics.get(i.question_id)?.relevant);
  const shown = showAll ? items : relevantItems;
  const age = ageDays(row?.finished_at ?? null);

  const start = async (refresh: boolean) => {
    setError(null);
    try {
      await startClaims(application.id, provider.id, refresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the search.');
    }
  };

  const summary =
    row?.status === 'running'
      ? 'Searching now…'
      : row?.claims
        ? `${relevantItems.length} of your ${relevantIds.length} topics have a public claim · checked ${formatDate(row.finished_at!.slice(0, 10))}`
        : 'Not checked yet';

  return (
    <Expander
      icon="search"
      title="What they say publicly"
      summary={summary}
      visual={row?.claims ? <span className="w-20 shrink-0"><Meter value={relevantItems.length} max={Math.max(1, relevantIds.length)} /></span> : undefined}
    >
      <p>
        Claude searches {provider.provider}'s website and public listings for what they say about your interview topics. These are their claims, not facts: ask them to confirm in
        writing. Results are shared by every family using this app and checked again after {claimsMaxAgeDays} days.
      </p>
      {error && (
        <ResolutionCard status="stop" title="We couldn't start the search" role="alert">
          <p>{error}</p>
        </ResolutionCard>
      )}
      {row?.status === 'running' && <WorkingGrid>Searching their website and public listings. This usually takes 2 to 4 minutes; you can leave this page.</WorkingGrid>}
      {row?.status === 'failed' && (
        <ResolutionCard status="caution" title="The last search didn't finish" role="status">
          <p>{row.error}</p>
          {row.claims && <p>The results below are from an earlier search.</p>}
        </ResolutionCard>
      )}
      {row?.claims && (
        <>
          {row.claims.overview && <p className="well">{row.claims.overview}</p>}
          {row.claims.website && (
            <p>
              Website:{' '}
              <a href={row.claims.website} target="_blank" rel="noreferrer noopener">
                {row.claims.website} <span className="sr-only">(opens in new tab)</span>
              </a>
            </p>
          )}
          {shown.length === 0 ? (
            <p>No public claims found for {showAll ? 'any interview topic' : 'your topics'}. Ask about them at interview.</p>
          ) : (
            <ul className="space-y-3">
              {shown.map((item) => (
                <li key={`${item.question_id}-${item.source_url}`} className="border-t border-[var(--rule)] pt-3">
                  <p className="small">
                    {item.question_id} · {topics.get(item.question_id)?.text}
                  </p>
                  <p className="flex flex-wrap items-baseline gap-2">
                    <Chip status={item.status === 'stated' ? 'good' : 'caution'}>{item.status === 'stated' ? 'Stated' : 'Partly'}</Chip>
                    <span className="font-medium">{item.claim}</span>
                  </p>
                  {item.quote && <p className="mt-1 border-l-2 border-[var(--line)] pl-3 italic">“{item.quote}”</p>}
                  <p className="mt-1">
                    <SourceLink item={item} />
                  </p>
                </li>
              ))}
            </ul>
          )}
          {items.length !== relevantItems.length && (
            <button type="button" className="btn-quiet" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show only your topics' : `Show all ${items.length} claims, including topics you ruled out`}
            </button>
          )}
          <p className="small">
            Checked {formatDate(row.finished_at!.slice(0, 10))}
            {age !== null && age >= claimsMaxAgeDays && ' — due for a fresh search'}.
          </p>
        </>
      )}
      {canEdit && row?.status !== 'running' && (
        <button type="button" className={`btn ${row?.claims ? '' : 'btn-primary'}`} onClick={() => start(!!row?.claims)}>
          <Icon name="search" size={20} /> {row?.claims ? 'Search again' : 'Check what they say publicly'}
        </button>
      )}
    </Expander>
  );
}

/** A provider card's claims status, with a button to start a search. */
export function ClaimsChip({ provider }: { provider: Provider }) {
  const { canEdit, application } = useApp();
  const { claims, startClaims } = useSession();
  const topics = useApplicantTopics();
  const row = claims.get(provider.id);
  if (row?.status === 'running') return <span className="chip chip-neutral">Checking public claims…</span>;
  if (row?.claims) {
    const n = row.claims.items.filter((i) => topics.get(i.question_id)?.relevant).length;
    return (
      <span className="chip chip-neutral">
        <Icon name="search" size={14} /> {n} public claim{n === 1 ? '' : 's'}
      </span>
    );
  }
  if (!canEdit) return null;
  return (
    <button type="button" className="btn btn-sm" onClick={() => startClaims(application.id, provider.id).catch(() => undefined)}>
      <Icon name="search" size={18} /> Check public claims <span className="sr-only">for {provider.provider}</span>
    </button>
  );
}

/** "They say: …" under an interview question, so the family knows to get it in writing. */
export function ClaimLine({ providerId, questionId }: { providerId: string; questionId: string }) {
  const { claims } = useSession();
  const items = claims.get(providerId)?.claims?.items.filter((i) => i.question_id === questionId) ?? [];
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <p key={item.source_url} className="small">
          <Icon name="search" size={16} /> <strong>They say:</strong> {item.claim} · <SourceLink item={item} /> · ask them to confirm in writing
        </p>
      ))}
    </div>
  );
}

/** Starts searches for every provider at a stage that hasn't been checked in the last 60 days. */
export function CheckAllClaims({ providerIds }: { providerIds: string[] }) {
  const { canEdit, application } = useApp();
  const { claims, startClaims } = useSession();
  const [busy, setBusy] = useState(false);
  const todo = providerIds.filter((id) => {
    const row = claims.get(id);
    return !row || (row.status !== 'running' && !row.claims);
  });
  if (!canEdit || todo.length === 0) return null;
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        for (const id of todo) await startClaims(application.id, id).catch(() => undefined);
        setBusy(false);
      }}
    >
      <Icon name="search" size={18} /> Check public claims for {todo.length === 1 ? 'this provider' : `all ${todo.length}`}
    </button>
  );
}
