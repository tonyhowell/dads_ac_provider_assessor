import { formatDate } from '../format';
import { ruleAt, toIsoDate } from '../rules';
import type { Provider } from '../types';

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

export function isStale(pricesAsAt: string, today: string = toIsoDate(new Date())): boolean {
  return daysBetween(pricesAsAt, today) > ruleAt('priceStalenessDays', today);
}

/** "Prices as at" date + source link + staleness badge. Shown wherever a provider's prices appear. */
export function PriceProvenance({ provider, today }: { provider: Provider; today?: string }) {
  const stale = isStale(provider.prices_as_at, today);
  return (
    <span className="muted inline-flex flex-wrap items-center gap-2">
      <span>Prices as at {formatDate(provider.prices_as_at)}</span>
      {provider.source_url ? (
        <a href={provider.source_url} target="_blank" rel="noreferrer">
          source <span className="sr-only">for {provider.provider} prices (opens in new tab)</span>
        </a>
      ) : (
        <span>no source recorded</span>
      )}
      {stale && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          Over {ruleAt('priceStalenessDays', today ?? new Date())} days old
        </span>
      )}
    </span>
  );
}
