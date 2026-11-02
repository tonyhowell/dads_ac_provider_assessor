import type { RateKey } from './types';

// My Aged Care (Find a provider) printouts → provider records. A coordinator searches My Aged Care for the
// family's area, shortlists providers there, and saves pages as PDF ("Print → Save as PDF"): the shortlist (who),
// Compare (up to three providers' prices for every service) and, optionally, a provider's details (rates by time
// of day, and prices Compare leaves out). These parsers read the PDF text; the details page is read by Claude.

export type MacKind = 'shortlist' | 'compare' | 'details' | 'unknown';

export interface MacPrice {
  /** As My Aged Care names the service, e.g. "General house cleaning". */
  service: string;
  /** "hour", "meal", "trip"… */
  unit: string;
  /** Standard hours price (AUD); null when none is published. */
  standard: number | null;
  /** Other times, from the details page: a price, or "not offered". */
  non_standard?: number | 'not_offered' | null;
  saturday?: number | 'not_offered' | null;
  sunday?: number | 'not_offered' | null;
  public_holiday?: number | 'not_offered' | null;
  /** Why this price looks wrong (and so isn't used in costs). */
  flag?: string;
}

export interface MacProvider {
  name: string;
  /** "BRISBANE CITY QLD 4000": where it's based (often a head office), not the area it serves. */
  based_in: string | null;
  phone: string | null;
  prices: MacPrice[];
  /** Services the provider lists (from the details page), priced or not. */
  services: string[];
  /** Which printouts it came from. */
  from: MacKind[];
}

const clean = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/Give Feedback$/, '').trim())
    .filter((l) => l && !/^(=====PAGE.*|--- Page \d+ ---)$/.test(l));

export function detectKind(text: string): MacKind {
  if (/Compare aged care\s*providers/i.test(text) && /Cost \(Per /i.test(text)) return 'compare';
  if (/Delivery period\s+Cost \(per /i.test(text) && /Services and costs/i.test(text)) return 'details';
  if (/My shortlist/i.test(text) && /Based in /i.test(text)) return 'shortlist';
  return 'unknown';
}

/** The shortlist's share link, if the printout shows it. */
export function shareLink(text: string): string | null {
  const m = text.match(/(?:https?:\/\/)?www\.myagedcare\.gov\.au\/p\/[a-z0-9]+/i);
  return m ? (m[0].startsWith('http') ? m[0] : `https://${m[0]}`) : null;
}

const PHONE = /^(\+?61\s?)?[\d ()]{8,16}$/;
const POSTCODE = /^\d{4}$/;
const SHORTLIST_NOISE = /^(Compare|Edit|Show details|Remove|Enquire|\d{1,2}|My shortlist.*|Support at Home|Help at home|Compare Compare|Show details Show details|Compare Edit|Find a provider|Print Share|Change selection|Matched to your needs|Commonwealth Home Support Programme|Home Care Packages?)$/i;

/** Providers on a shortlist (or Compare header): name, where based, phone. */
export function parseProviderCards(text: string): MacProvider[] {
  const lines = clean(text);
  const out: MacProvider[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^Based in /i.test(lines[i])) continue;
    const name: string[] = [];
    for (let j = i - 1; j >= 0 && name.length < 3; j--) {
      const l = lines[j];
      if (SHORTLIST_NOISE.test(l) || PHONE.test(l) || POSTCODE.test(l) || /^Based in /i.test(l) || /[.?!]$/.test(l) || l.length > 80) break;
      name.unshift(l);
    }
    if (!name.length) continue;
    const where = lines[i].replace(/^Based in\s+/i, '').replace(/,/g, '');
    const based = `${where}${POSTCODE.test(lines[i + 1] ?? '') ? ` ${lines[i + 1]}` : ''}`.replace(/\s+/g, ' ').trim();
    const phone = lines.slice(i + 1, i + 4).find((l) => PHONE.test(l) && !POSTCODE.test(l)) ?? null;
    const provider = name.join(' ').replace(/\s+/g, ' ');
    if (!out.some((p) => p.name === provider)) out.push({ name: provider, based_in: based || null, phone, prices: [], services: [], from: ['shortlist'] });
  }
  return out;
}

/** Compare: each provider's standard price for every service compared. */
export function parseCompare(text: string): MacProvider[] {
  const lines = clean(text);
  const providers = parseProviderCards(text).map((p) => ({ ...p, from: ['compare' as MacKind] }));
  const names = providers.map((p) => p.name);
  // The services compared: the ticked list under "Compare the details that are important to you".
  const start = lines.indexOf('Services');
  const services: string[] = [];
  for (let i = start + 1; start >= 0 && i < lines.length && !['Services', 'Support at Home services'].includes(lines[i]); i++) services.push(lines[i]);
  let service: string | null = null;
  let provider: string | null = null;
  let detail = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === 'Delivery information') detail = true;
    if (!detail) {
      // The service heading just before the first "Delivery information".
      if (services.includes(l)) service = l;
      continue;
    }
    if (services.includes(l)) {
      service = l;
      provider = null;
      continue;
    }
    const named = names.find((n) => n === l);
    if (named) {
      provider = named;
      continue;
    }
    const cost = l.match(/^Cost \(Per (.+)\)$/i);
    if (cost && service && provider) {
      let j = i + 1;
      while (j < lines.length && /^(Standard hours|Select hours)$/i.test(lines[j])) j++;
      const value = lines[j] ?? '';
      const p = providers.find((x) => x.name === provider)!;
      if (!p.prices.some((x) => x.service === service)) p.prices.push(withFlag({ service, unit: cost[1].toLowerCase(), standard: money(value) }));
    }
  }
  return providers;
}

export const money = (s: string): number | null => {
  const m = s.match(/^\$\s?([\d,]+(?:\.\d+)?)$/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

/** Prices that can't be right (a provider's data-entry slip) are kept but flagged, and not used in costs. */
export function withFlag(p: MacPrice): MacPrice {
  if (p.standard === null) return p;
  if (p.unit === 'hour' && (p.standard < 20 || p.standard > 600)) return { ...p, flag: `$${p.standard} an hour looks wrong: check with the provider` };
  if (p.unit === 'meal' && p.standard > 200) return { ...p, flag: `$${p.standard} a meal looks wrong: check with the provider` };
  return p;
}

/** Merge printouts of the same provider: later prices fill gaps; details (rates by time) win over Compare. */
export function mergeProviders(lists: MacProvider[][]): MacProvider[] {
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const out = new Map<string, MacProvider>();
  for (const list of lists)
    for (const p of list) {
      const k = key(p.name);
      const prev = out.get(k);
      if (!prev) {
        out.set(k, { ...p, prices: [...p.prices], services: [...p.services], from: [...p.from] });
        continue;
      }
      prev.based_in ??= p.based_in;
      prev.phone ??= p.phone;
      prev.from = [...new Set([...prev.from, ...p.from])];
      prev.services = [...new Set([...prev.services, ...p.services])];
      for (const price of p.prices) {
        const i = prev.prices.findIndex((x) => x.service === price.service);
        if (i < 0) prev.prices.push(price);
        else if (price.standard !== null || price.saturday !== undefined) prev.prices[i] = { ...prev.prices[i], ...Object.fromEntries(Object.entries(price).filter(([, v]) => v !== null && v !== undefined)) };
      }
    }
  return [...out.values()];
}

/** The app's eight costed services, from My Aged Care's service names (hourly prices only). */
export const MAC_RATE_SERVICES: Record<RateKey, string[]> = {
  rn: ['Registered nurse clinical care'],
  en: ['Enrolled nurse clinical care'],
  pc: ['Assistance with self-care and activities of daily living'],
  domestic: ['General house cleaning'],
  social: ['Individual social support', 'Accompanied activities'],
  respite: ['Flexible respite'],
  gardening: ['Gardening'],
  care_mgmt: ['Home support care management'],
};

export function macRates(prices: MacPrice[]): Partial<Record<RateKey, number>> {
  const out: Partial<Record<RateKey, number>> = {};
  for (const [key, names] of Object.entries(MAC_RATE_SERVICES) as [RateKey, string[]][]) {
    const hit = names.map((n) => prices.find((p) => p.service.toLowerCase() === n.toLowerCase() && p.unit === 'hour' && p.standard !== null && !p.flag)).find(Boolean);
    if (hit) out[key] = hit.standard!;
  }
  return out;
}

/** State from a postcode (for My Aged Care's "SUBURB STATE POSTCODE" location). */
export function stateForPostcode(postcode: string): string | null {
  const n = Number(postcode);
  if (!/^\d{4}$/.test(postcode)) return null;
  if ((n >= 200 && n <= 299) || (n >= 2600 && n <= 2618) || (n >= 2900 && n <= 2920)) return 'ACT';
  if (n >= 800 && n <= 999) return 'NT';
  if (n >= 1000 && n <= 2999) return 'NSW';
  if (n >= 3000 && n <= 3999) return 'VIC';
  if (n >= 4000 && n <= 4999) return 'QLD';
  if (n >= 5000 && n <= 5999) return 'SA';
  if (n >= 6000 && n <= 6999) return 'WA';
  if (n >= 7000 && n <= 7999) return 'TAS';
  return null;
}

/** My Aged Care's search, set to the family's area and the services in their plan. */
export function macSearchUrl(input: { suburb: string; postcode: string; services: string[] }): string | null {
  const state = stateForPostcode(input.postcode);
  if (!input.suburb.trim() || !state) return null;
  const q = new URLSearchParams({ careProgram: 'sah', distance: '250', location: `${input.suburb.trim().toUpperCase()} ${state} ${input.postcode}`, page: '1', searchType: 'help-at-home' });
  for (const s of input.services) q.append('services', s);
  q.append('sort', 'titleAsc');
  return `https://www.myagedcare.gov.au/find-a-provider/search/results?${q.toString()}`;
}

/** My Aged Care service names for the plan's costed services. */
export const planServices = (keys: RateKey[]) => [...new Set(keys.flatMap((k) => MAC_RATE_SERVICES[k].slice(0, 1)))];
