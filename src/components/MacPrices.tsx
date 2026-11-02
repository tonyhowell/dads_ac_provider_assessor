import type { Provider } from '../types';
import { formatDate } from '../format';

// Every price a provider publishes on My Aged Care (from an uploaded Compare or details page), with the times
// of day it covers when we know them.

const fmt = (v: number | 'not_offered' | null | undefined) => (v === 'not_offered' ? 'Not offered' : typeof v === 'number' ? `$${v % 1 ? v.toFixed(2) : v}` : '—');

export function MacPrices({ provider }: { provider: Provider }) {
  const mac = provider.mac;
  if (!mac || !mac.prices.length) return null;
  const byTime = mac.prices.some((p) => p.saturday !== undefined || p.non_standard !== undefined);
  const prices = [...mac.prices].sort((a, b) => Number(a.standard === null) - Number(b.standard === null) || a.service.localeCompare(b.service));
  return (
    <section className="card space-y-3" aria-labelledby="mac-prices-heading">
      <h2 id="mac-prices-heading">Prices on My Aged Care</h2>
      {(provider.based_in || provider.phone) && (
        <p>
          {provider.based_in && <>Based in {provider.based_in.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => (['QLD', 'NSW', 'VIC', 'ACT', 'TAS', 'NT', 'SA', 'WA'].includes(a + b) ? a + b : a + b.toLowerCase()))}</>}
          {provider.based_in && provider.phone && ' · '}
          {provider.phone && <a href={`tel:${provider.phone.replace(/\s/g, '')}`}>{provider.phone}</a>}
        </p>
      )}
      <p className="small">
        As published by {provider.provider} on My Aged Care, saved {formatDate(mac.as_at)}. Providers must keep these up to date and review them every two months.
        {mac.share_url && (
          <>
            {' '}
            <a href={mac.share_url} target="_blank" rel="noreferrer noopener">
              Open the family's shortlist on My Aged Care<span className="sr-only"> (opens in new tab)</span>
            </a>
          </>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">Prices published on My Aged Care</caption>
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col">Standard hours</th>
              {byTime && (
                <>
                  <th scope="col">Other weekday hours</th>
                  <th scope="col">Saturday</th>
                  <th scope="col">Sunday</th>
                  <th scope="col">Public holiday</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.service}>
                <th scope="row" className="font-normal">
                  {p.service}
                  {p.flag && <span className="small block text-[var(--stop)]">{p.flag}</span>}
                </th>
                <td>
                  {p.standard === null ? "Not published" : `${fmt(p.standard)} ${/^(h|[aeiou])/i.test(p.unit) ? "an" : "a"} ${p.unit}`}
                </td>
                {byTime && (
                  <>
                    <td>{fmt(p.non_standard)}</td>
                    <td>{fmt(p.saturday)}</td>
                    <td>{fmt(p.sunday)}</td>
                    <td>{fmt(p.public_holiday)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
