import { parseAreas } from './area';
import { ProviderSchema, RATE_KEYS } from './schemas';
import { latestDateIn, slugify } from './data/normalise';
import type { Provider } from './types';

/** Parses CSV text (RFC 4180: quoted fields, doubled quotes, newlines inside quotes) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface ImportRow {
  line: number;
  provider?: Provider;
  /** True when this row updates a provider that already exists. */
  updates?: boolean;
  errors: string[];
}

const HEADER_ALIASES: Record<string, string> = { name: 'provider', provider_name: 'provider', url: 'source_url', source: 'source_url', as_at: 'prices_as_at', postcodes: 'postcodes_served', service_area: 'postcodes_served', areas: 'postcodes_served' };

/**
 * Turns CSV rows into providers. The first row is the header; recognised columns are
 * provider (required), id, type, outlet, the rate columns (rn, en, pc, domestic, social, respite,
 * gardening, care_mgmt), prices_as_at, source_url, veteran_fit, flags (separated by semicolons) and
 * postcodes_served (postcodes or ranges such as 4150-4169).
 */
export function providersFromCsv(text: string, existing: Provider[]): { rows: ImportRow[]; unknownColumns: string[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], unknownColumns: [] };
  const cols = header.map((h) => {
    const k = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return HEADER_ALIASES[k] ?? k;
  });
  const known = new Set(['id', 'provider', 'type', 'outlet', 'prices_as_at', 'source_url', 'veteran_fit', 'flags', 'postcodes_served', ...RATE_KEYS]);
  const byId = new Map(existing.map((p) => [p.id, p]));
  const byName = new Map(existing.map((p) => [p.provider.trim().toLowerCase(), p]));

  const rows = body.map((cells, i): ImportRow => {
    const get = (k: string) => {
      const idx = cols.indexOf(k);
      return idx < 0 ? undefined : (cells[idx] ?? '').trim();
    };
    const errors: string[] = [];
    const name = get('provider');
    if (!name) return { line: i + 2, errors: ['Provider name is missing.'] };
    const match = byId.get(get('id') || '') ?? byName.get(name.toLowerCase());

    const rates = Object.fromEntries(
      RATE_KEYS.map((k) => {
        const raw = get(k);
        if (raw === undefined) return [k, match ? match[k] : null];
        if (raw === '' || /^(n\/?a|-|—|null)$/i.test(raw)) return [k, null];
        const n = Number(raw.replace(/[$,\s]/g, ''));
        if (!Number.isFinite(n) || n < 0) {
          errors.push(`${k}: "${raw}" isn't a price.`);
          return [k, null];
        }
        return [k, n];
      }),
    );
    const asAt = get('prices_as_at') ?? match?.prices_as_at ?? 'Not captured';
    const flags = get('flags');
    const candidate = {
      id: match?.id ?? (get('id') || slugify(name)),
      provider: name,
      type: get('type') ?? match?.type ?? null,
      outlet: get('outlet') ?? match?.outlet ?? null,
      ...rates,
      prices_as_at: asAt || 'Not captured',
      prices_as_at_date: latestDateIn(asAt),
      veteran_fit: get('veteran_fit') ?? match?.veteran_fit ?? null,
      flags: flags === undefined ? (match?.flags ?? []) : flags.split(';').map((f) => f.trim()).filter(Boolean),
      source_url: (get('source_url') ?? match?.source_url) || null,
      postcodes_served: (() => {
        const raw = get('postcodes_served');
        return raw === undefined ? match?.postcodes_served : parseAreas(raw);
      })(),
    };
    const parsed = ProviderSchema.safeParse(candidate);
    if (!parsed.success) errors.push(...parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`));
    return errors.length ? { line: i + 2, errors } : { line: i + 2, provider: parsed.data, updates: !!match, errors: [] };
  });
  return { rows, unknownColumns: header.filter((_, i) => !known.has(cols[i])) };
}
