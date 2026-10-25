import type { Provider } from './types';

// Service areas: each provider lists the postcodes it serves, as single postcodes ("4178") or ranges
// ("4150-4179"). A provider with no list hasn't had its area confirmed, so it is never hidden.

export type AreaMatch = 'serves' | 'outside' | 'unknown';

const RANGE = /^(\d{4})\s*[-–]\s*(\d{4})$/;
const SINGLE = /^\d{4}$/;

/** Parses a typed list ("4178, 4150-4179") into entries, keeping only valid ones. */
export function parseAreas(text: string): string[] {
  return text
    .replace(/(\d{4})\s*[-–]\s*(\d{4})/g, '$1-$2')
    .split(/[\s,;]+/)
    .filter((s) => SINGLE.test(s) || RANGE.test(s));
}

export function servesArea(provider: Pick<Provider, 'postcodes_served'>, postcode: string | null): AreaMatch {
  const list = provider.postcodes_served ?? [];
  if (!postcode || !SINGLE.test(postcode) || list.length === 0) return 'unknown';
  const n = Number(postcode);
  const hit = list.some((entry) => {
    const range = entry.match(RANGE);
    if (range) return n >= Number(range[1]) && n <= Number(range[2]);
    return entry.trim() === postcode;
  });
  return hit ? 'serves' : 'outside';
}

/** Words for a provider's area, e.g. "4150–4179, 4183". */
export const areaText = (p: Pick<Provider, 'postcodes_served'>) => (p.postcodes_served ?? []).map((e) => e.replace('-', '–')).join(', ');
