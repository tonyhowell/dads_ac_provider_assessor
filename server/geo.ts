import { readFileSync } from 'node:fs';

// Suburb centres for the Find map, from data/postcodes.csv (Matthew Proctor's Australian Postcodes). Only
// postcodes and suburb names are looked up, here on the server; no address is ever sent anywhere.

export interface PostcodeGeo {
  /** The middle of the postcode's suburbs. */
  centre: [number, number];
  /** Suburb name (upper case) → centre. */
  localities: Record<string, [number, number]>;
  state: string;
}

let table: Map<string, PostcodeGeo> | undefined;

function load(): Map<string, PostcodeGeo> {
  if (table) return table;
  table = new Map();
  const text = readFileSync(new URL('../data/postcodes.csv', import.meta.url), 'utf8');
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || line.startsWith('postcode,')) continue;
    const [postcode, locality, state, lat, lng] = line.split(',');
    const point: [number, number] = [Number(lat), Number(lng)];
    if (!postcode || Number.isNaN(point[0])) continue;
    const entry = table.get(postcode) ?? { centre: [0, 0], localities: {}, state };
    entry.localities[locality] = point;
    table.set(postcode, entry);
  }
  for (const entry of table.values()) {
    const pts = Object.values(entry.localities);
    entry.centre = [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
  }
  return table;
}

export function lookupPostcodes(postcodes: string[]): Record<string, PostcodeGeo> {
  const t = load();
  return Object.fromEntries(postcodes.filter((p) => /^\d{4}$/.test(p) && t.has(p)).map((p) => [p, t.get(p)!]));
}
