import { useState, type ReactNode } from 'react';
import { useApp } from '../state/AppContext';
import { useSession } from '../state/SessionContext';
import { formatDate } from '../format';
import type { Provider } from '../types';
import { Icon } from './ui/Icon';

// What we know about a shortlisted provider, and how to get more. Shortlisting reads the provider's prices
// automatically; checking what they say publicly ("enriching") is offered here, or updating it if done before.

export function ProviderDataBox({ provider }: { provider: Provider }) {
  const { state, canEdit, application } = useApp();
  const { priceChecks, claims, startPriceCheck, startClaims } = useSession();
  const [error, setError] = useState<string | null>(null);
  if (!state.selection.some((e) => e.provider_id === provider.id)) return null;

  const price = priceChecks.get(provider.id);
  const claim = claims.get(provider.id);
  const hasPrices = provider.pc !== null || provider.domestic !== null || provider.rn !== null || provider.social !== null;
  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t start. Try again.');
    }
  };

  let priceLine: ReactNode = null;
  if (price?.status === 'running') priceLine = <span role="status">Reading their prices… {price.stage && <span className="small">({price.stage})</span>}</span>;
  else if (price?.status === 'failed')
    priceLine = (
      <>
        <span className="text-[var(--caution)]">Couldn't read their prices — {price.error}</span>
        {canEdit && (
          <button type="button" className="btn btn-sm" onClick={() => act(() => startPriceCheck(application.id, provider.id))}>
            Try again
          </button>
        )}
      </>
    );
  else if (price?.status === 'done') priceLine = <span>Prices: {price.outcome}{price.finished_at && ` · ${formatDate(price.finished_at.slice(0, 10))}`}</span>;
  else if (!hasPrices && canEdit)
    priceLine = (
      <>
        <span>No prices yet.</span>
        <button type="button" className="btn btn-sm" onClick={() => act(() => startPriceCheck(application.id, provider.id))}>
          Read their prices
        </button>
      </>
    );

  const enriched = !!claim?.claims;
  let enrichLine: ReactNode;
  if (claim?.status === 'running') enrichLine = <span role="status">Checking what they say publicly… usually 1–3 minutes.</span>;
  else if (enriched)
    enrichLine = (
      <>
        <span>
          What they say publicly: {claim!.claims!.items.length} claim{claim!.claims!.items.length === 1 ? '' : 's'} found
          {claim!.finished_at && `, checked ${formatDate(claim!.finished_at.slice(0, 10))}`}.
        </span>
        {canEdit && (
          <button type="button" className="btn btn-sm" onClick={() => act(() => startClaims(application.id, provider.id, true))}>
            Update
            <span className="sr-only"> what {provider.provider} says publicly</span>
          </button>
        )}
      </>
    );
  else
    enrichLine = canEdit ? (
      <>
        <span>
          {claim?.status === 'failed' && <span className="text-[var(--caution)]">The last check didn't finish. </span>}
          Want more? Claude can check what {provider.provider} says publicly about what matters to you.
        </span>
        <button type="button" className="btn btn-sm" onClick={() => act(() => startClaims(application.id, provider.id, false))}>
          <Icon name="search" size={16} /> Enrich this provider
        </button>
      </>
    ) : (
      <span>Not checked for public claims yet.</span>
    );

  return (
    <section className="well space-y-2" aria-label={`What we know about ${provider.provider}`}>
      {provider.origin && (
        <p className="small">
          {provider.origin.kind === 'gen' ? 'Added from the government service list' : 'Found by a provider search'} on {formatDate(provider.origin.at)}.
        </p>
      )}
      {priceLine && <div className="flex flex-wrap items-center gap-2">{priceLine}</div>}
      <div className="flex flex-wrap items-center gap-2">{enrichLine}</div>
      {error && (
        <p role="alert" className="text-[var(--stop)]">
          {error}
        </p>
      )}
    </section>
  );
}
