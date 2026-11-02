import type { Provider } from './types';

// Service areas: each provider lists the postcodes it serves, as single postcodes ("4178") or ranges
// ("4150-4179"). A provider with no list hasn't had its area confirmed, so it isn't hidden — unless we know where
// its outlets are (from the government list) and none is near home (`near`: postcodes within 60 km).

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

export function servesArea(provider: Pick<Provider, 'postcodes_served' | 'locations'>, postcode: string | null, near?: Set<string> | null): AreaMatch {
  const list = provider.postcodes_served ?? [];
  if (!postcode || !SINGLE.test(postcode)) return 'unknown';
  if (list.length === 0) {
    const outlets = (provider.locations ?? []).map((l) => l.match(/(\d{4})\s*$/)?.[1]).filter((pc): pc is string => !!pc);
    if (!near || !near.size || !outlets.length) return 'unknown';
    return outlets.some((pc) => near.has(pc)) ? 'unknown' : 'outside';
  }
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
