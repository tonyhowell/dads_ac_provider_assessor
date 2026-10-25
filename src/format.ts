const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const audCents = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 });
const pct = new Intl.NumberFormat('en-AU', { style: 'percent', maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
const dateTime = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Australia/Sydney',
});

/** Whole-dollar AUD, e.g. `$12,345`. */
export const formatAud = (n: number) => aud.format(n);
/** Hourly rates keep cents, e.g. `$98.50`. */
export const formatRate = (n: number | null) => (n === null ? '—' : audCents.format(n));
/** `0.05` → `5%`, `0.175` → `17.5%`. */
export const formatPercent = (n: number) => pct.format(n);
/** ISO date or timestamp → `25 Oct 2026`. YYYY-MM-DD is read as a calendar date, not UTC midnight. */
export const formatDate = (iso: string) =>
  date.format(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00+10:00`) : new Date(iso));
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

export function formatDuration(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
