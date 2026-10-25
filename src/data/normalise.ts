import type { Category, PensionStatus } from '../types';

// Helpers that turn the starter pack's human-written values into the app's typed values.

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, (m) => ` ${m.slice(1, -1)} `)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Provider name without a trailing note in brackets, e.g. "Carers Link (reserve)" → "carers link". */
export const nameKey = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/**
 * The latest calendar date mentioned in a free-text "prices as at" value, as YYYY-MM-DD.
 * "1 Jul 2026 (schedule updated 22 Sep 2026)" → "2026-09-22"; "Not captured" → null.
 */
export function latestDateIn(text: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  let latest: string | null = null;
  for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)];
    const day = Number(m[1]);
    if (!month || day < 1 || day > 31) continue;
    const iso = `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!latest || iso > latest) latest = iso;
  }
  return latest;
}

/** "Clinical (from 1 Oct 2026)" → clinical; "Everyday living" → everyday; "Independence" → independence. */
export function categoryFromLabel(label: string): Category | undefined {
  const l = label.toLowerCase();
  if (l === 'clinical' || l.startsWith('clinical')) return 'clinical';
  if (l === 'independence' || l.startsWith('independence')) return 'independence';
  if (l === 'everyday' || l.startsWith('everyday')) return 'everyday';
  return undefined;
}

/** Contribution-table status labels → status codes. */
export function statusFromLabel(label: string): PensionStatus | undefined {
  const l = label.toLowerCase();
  if (l === 'full_pensioner' || l.startsWith('full pensioner')) return 'full_pensioner';
  if (l === 'part_pensioner' || l.startsWith('part pensioner')) return 'part_pensioner';
  if (l === 'self_funded' || l.startsWith('self-funded') || l.startsWith('self funded')) return 'self_funded';
  return undefined;
}
