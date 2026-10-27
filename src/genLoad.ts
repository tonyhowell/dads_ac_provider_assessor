import { slugify } from './data/normalise';
import type { Provider } from './types';

// Initial load from the government's aged care service list (GEN, published per state each year as Excel).
// Each row is one service (outlet); a provider can have several. The admin uploads the file, checks the
// columns we found, picks the area, and the providers that aren't in the catalogue yet are added.

export const GEN_FIELDS = ['service', 'provider', 'address', 'suburb', 'state', 'postcode', 'care_type', 'org_type', 'region', 'home_care_places'] as const;
export type GenField = (typeof GEN_FIELDS)[number];

export const GEN_FIELD_LABELS: Record<GenField, string> = {
  service: 'Service name',
  provider: 'Provider name',
  address: 'Address',
  suburb: 'Suburb',
  state: 'State',
  postcode: 'Postcode',
  care_type: 'Care type',
  org_type: 'Organisation type',
  region: 'Planning region',
  home_care_places: 'Home care places',
};

/** Header words for each field, most specific first. */
const PATTERNS: Record<GenField, RegExp> = {
  service: /^(service|outlet)\s*name$|^service$/i,
  provider: /provider\s*name|approved\s*provider|^provider$/i,
  address: /address(?!.*(suburb|post|state|town|locality))/i,
  suburb: /suburb|locality|town/i,
  state: /(^|\s)state(\s|$)|state\s*\/\s*territory/i,
  postcode: /post\s*code/i,
  care_type: /care\s*type|program(me)?\s*type|^program/i,
  org_type: /organi[sz]ation\s*type|org(\.|anisation)?\s*type|ownership/i,
  region: /planning\s*region|acpr/i,
  home_care_places: /home\s*care\s*places/i,
};

export type Mapping = Record<GenField, number | null>;
export type Cell = string | number | boolean | Date | null | undefined;

const text = (c: Cell) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim());

/** Finds the header row (title rows often come first) and which column holds each field. */
export function findHeader(rows: Cell[][]): { index: number; headers: string[]; mapping: Mapping } | null {
  for (let index = 0; index < Math.min(rows.length, 30); index++) {
    const headers = rows[index].map(text);
    const mapping = guessMapping(headers);
    const found = GEN_FIELDS.filter((f) => mapping[f] !== null);
    if (mapping.provider !== null && found.length >= 3) return { index, headers, mapping };
  }
  return null;
}

export function guessMapping(headers: string[]): Mapping {
  const used = new Set<number>();
  const mapping = Object.fromEntries(GEN_FIELDS.map((f) => [f, null])) as Mapping;
  // Postcode and suburb before address, so "Physical Address Suburb" isn't taken as the address.
  for (const f of ['home_care_places', 'postcode', 'suburb', 'state', 'provider', 'service', 'care_type', 'org_type', 'region', 'address'] as GenField[]) {
    const i = headers.findIndex((h, n) => !used.has(n) && h && PATTERNS[f].test(h));
    if (i >= 0) {
      mapping[f] = i;
      used.add(i);
    }
  }
  return mapping;
}

export interface GenService {
  service: string;
  provider: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  careType: string;
  orgType: string;
  region: string;
  homeCarePlaces: number | null;
}

export function toServices(rows: Cell[][], headerIndex: number, mapping: Mapping): GenService[] {
  const get = (r: Cell[], f: GenField) => (mapping[f] === null ? '' : text(r[mapping[f]!]));
  return rows
    .slice(headerIndex + 1)
    .map((r) => {
      const places = get(r, 'home_care_places');
      return {
        service: get(r, 'service'),
        provider: get(r, 'provider'),
        address: get(r, 'address'),
        suburb: get(r, 'suburb'),
        state: get(r, 'state').toUpperCase(),
        postcode: get(r, 'postcode').replace(/\.0$/, '').padStart(4, '0').replace(/^0000$/, ''),
        careType: get(r, 'care_type'),
        orgType: get(r, 'org_type'),
        region: get(r, 'region'),
        homeCarePlaces: places && !Number.isNaN(Number(places)) ? Number(places) : null,
      };
    })
    .filter((s) => s.provider);
}

/** Home care (Support at Home) services: by care type, or by having home care places. */
export const isHomeCare = (s: GenService) => /home\s*(care|support)|support\s*at\s*home|in-?home/i.test(s.careType) || (s.homeCarePlaces ?? 0) > 0;

/** Words that don't help tell providers apart. */
const NOISE = /\b(pty|ltd|limited|inc|incorporated|the|co|company|trust|trustee|for|as|t\/a|trading|ltd\.|australia|services?|care|aged|home|homes|community|group|association|assn)\b/g;
export const normaliseName = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The catalogue provider this name most likely is, if any. */
export function matchCatalogue(names: string[], catalogue: Provider[]): Provider | null {
  const wanted = names.map(normaliseName).filter((n) => n.length >= 3);
  for (const p of catalogue) {
    const mine = normaliseName(p.provider);
    if (mine.length < 3) continue;
    if (wanted.some((w) => w === mine || w.startsWith(`${mine} `) || mine.startsWith(`${w} `) || w.includes(` ${mine} `) || ` ${w} `.includes(` ${mine} `))) return p;
  }
  return null;
}

export interface LoadCandidate {
  key: string;
  name: string;
  orgType: string;
  services: GenService[];
  existing: Provider | null;
}

/** Groups services by provider and marks the ones already in the catalogue. */
export function groupProviders(services: GenService[], catalogue: Provider[]): LoadCandidate[] {
  const groups = new Map<string, GenService[]>();
  for (const s of services) {
    const key = normaliseName(s.provider) || s.provider.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      name: list[0].provider,
      orgType: list.find((s) => s.orgType)?.orgType ?? '',
      services: list,
      existing: matchCatalogue([list[0].provider, ...list.map((s) => s.service)], catalogue),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A catalogue record for a loaded provider: no prices yet, marked as from the government list. */
export function candidateToProvider(c: LoadCandidate, takenIds: Set<string>, asAt: string, note: string): Provider {
  let id = slugify(c.name) || 'provider';
  for (let n = 2; takenIds.has(id); n++) id = `${slugify(c.name)}-${n}`;
  takenIds.add(id);
  const outlets = [...new Set(c.services.map((s) => s.service).filter(Boolean))];
  const locations = [...new Set(c.services.map((s) => [s.suburb, s.postcode].filter(Boolean).join(' ')).filter(Boolean))].slice(0, 50);
  return {
    id,
    provider: c.name,
    type: c.orgType || null,
    outlet: outlets.length ? (outlets.length > 3 ? `${outlets.slice(0, 3).join('; ')} and ${outlets.length - 3} more` : outlets.join('; ')) : null,
    rn: null,
    en: null,
    pc: null,
    domestic: null,
    social: null,
    respite: null,
    gardening: null,
    care_mgmt: null,
    prices_as_at: 'Not read yet',
    prices_as_at_date: null,
    veteran_fit: null,
    flags: [],
    source_url: null,
    locations,
    origin: { kind: 'gen', note: note.slice(0, 300), at: asAt },
  };
}
