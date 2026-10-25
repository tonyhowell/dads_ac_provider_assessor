import { ruleAt, toIsoDate } from '../rules';
import { formatRate } from '../format';
import { variance, varianceBand } from '../calc';
import type { Provider } from '../types';
import { Chip } from './ui/Status';
import { Icon } from './ui/Icon';

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/** Prices with no known date count as stale: they can't be shown to be current. */
export function isStale(pricesAsAtDate: string | null, today: string = toIsoDate(new Date())): boolean {
  return pricesAsAtDate === null || daysBetween(pricesAsAtDate, today) > ruleAt('priceStalenessDays', today);
}

/** "Source ↗" link that says it opens in a new tab (UI-SPEC §5.5). */
export function SourceLink({ url, name }: { url: string; name?: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5">
      Source <Icon name="external" size={16} />
      <span className="sr-only">
        {name ? ` for ${name} prices` : ''} (opens in new tab)
      </span>
    </a>
  );
}

/** "as at" date + source link + staleness chip, shown wherever a provider's prices appear. */
export function PriceProvenance({ provider, today }: { provider: Provider; today?: string }) {
  const now = today ?? toIsoDate(new Date());
  const stale = isStale(provider.prices_as_at_date, now);
  return (
    <span className="muted inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>Prices as at {provider.prices_as_at}</span>
      {provider.source_url ? <SourceLink url={provider.source_url} name={provider.provider} /> : <span>No source recorded</span>}
      {stale && (
        <Chip status="caution">{provider.prices_as_at_date ? `${daysBetween(provider.prices_as_at_date, now)} days old` : 'Date not confirmed'}</Chip>
      )}
    </span>
  );
}

/** ▲ 8% above guide price (stop) · ▼ 6% below (good) · Within 5% (neutral) — arrow + words + colour (UI-SPEC §6.6). */
export function VarianceChip({ rate, guide }: { rate: number | null; guide: number | null }) {
  const v = variance(rate, guide);
  const band = varianceBand(v);
  if (v === null || band === null) return null;
  const pct = `${Math.round(Math.abs(v) * 100)}%`;
  if (band === 'above') return <span className="chip chip-stop">▲ {pct} above guide price</span>;
  if (band === 'below') return <span className="chip chip-good">▼ {pct} below guide price</span>;
  return <span className="chip chip-neutral">Within 5% of guide price</span>;
}

/** A provider's hourly rate with its state: published, filled from the guide price, or not published (UI-SPEC §6.5). */
export function PriceCell({ rate, guide, special = false }: { rate: number | null; guide: number | null; special?: boolean }) {
  if (rate !== null) {
    return (
      <span className="flex flex-col items-end gap-1">
        <span className="font-medium tabular-nums">{formatRate(rate)} /hr</span>
        {special && <span className="chip chip-good">★ Special rate for you</span>}
        <VarianceChip rate={rate} guide={guide} />
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span>Not published</span>
      <span className="small">{guide !== null ? `Guide price ${formatRate(guide)} used · ask at interview` : 'Ask at interview'}</span>
    </span>
  );
}
