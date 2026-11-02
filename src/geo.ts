import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { Provider } from './types';

// Where things are, at suburb level, for the Find map and distances (improvement plan 2.1). Coordinates come
// from the server's postcode table; only postcodes are sent, never an address.

export interface PostcodeGeo {
  centre: [number, number];
  localities: Record<string, [number, number]>;
  state: string;
}
export type GeoTable = Record<string, PostcodeGeo>;

export interface Place {
  label: string;
  lat: number;
  lng: number;
  /** An outlet's suburb, or only a postcode the provider says it serves. */
  kind: 'outlet' | 'serves';
}

const SINGLE = /^\d{4}$/;

/** "Manly 4179" → { locality: "MANLY", postcode: "4179" }. */
export function parseLocation(text: string): { locality: string; postcode: string } | null {
  const m = text.trim().match(/^(.*?)[,\s]+(\d{4})$/);
  return m ? { locality: m[1].trim().toUpperCase(), postcode: m[2] } : null;
}

/** Every postcode the map needs: the home's and each provider's outlets or single served postcodes. */
export function postcodesFor(home: string | null, providers: Provider[]): string[] {
  const set = new Set<string>();
  if (home && SINGLE.test(home)) set.add(home);
  for (const p of providers) {
    for (const l of p.locations ?? []) {
      const parsed = parseLocation(l);
      if (parsed) set.add(parsed.postcode);
    }
    for (const pc of p.postcodes_served ?? []) if (SINGLE.test(pc)) set.add(pc);
  }
  return [...set].sort();
}

export function pointFor(geo: GeoTable, postcode: string, locality?: string): [number, number] | null {
  const entry = geo[postcode];
  if (!entry) return null;
  return (locality && entry.localities[locality.toUpperCase()]) || entry.centre;
}

/** A provider's places: its outlets' suburbs, or (if none are known) the single postcodes it says it serves. */
export function providerPlaces(p: Provider, geo: GeoTable): Place[] {
  const outlets = (p.locations ?? []).flatMap((l): Place[] => {
    const parsed = parseLocation(l);
    const pt = parsed && pointFor(geo, parsed.postcode, parsed.locality);
    return pt ? [{ label: l, lat: pt[0], lng: pt[1], kind: 'outlet' }] : [];
  });
  if (outlets.length) return outlets;
  return (p.postcodes_served ?? [])
    .filter((pc) => SINGLE.test(pc))
    .slice(0, 8)
    .flatMap((pc): Place[] => {
      const pt = pointFor(geo, pc);
      return pt ? [{ label: `Serves ${pc}`, lat: pt[0], lng: pt[1], kind: 'serves' }] : [];
    });
}

/** Kilometres between two points (haversine). */
export function km(a: [number, number], b: [number, number]): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export interface Nearest {
  km: number;
  place: Place;
}

export function nearest(home: [number, number] | null, places: Place[]): Nearest | null {
  if (!home || !places.length) return null;
  return places.map((place) => ({ km: km(home, [place.lat, place.lng]), place })).sort((a, b) => a.km - b.km)[0];
}

/** "4 km away · outlet in Manly" or "serves 4178". */
export function distanceText(n: Nearest | null): string | null {
  if (!n) return null;
  const d = n.km < 1 ? 'under 1 km' : `${Math.round(n.km)} km`;
  if (n.place.kind === 'serves') return n.km < 1 ? 'Serves your postcode' : `Serves an area ${d} away`;
  const suburb = n.place.label.replace(/\s*\d{4}$/, '');
  return `${d} away · outlet in ${suburb.replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())}`;
}

/** The coordinates for the given postcodes, fetched once per set (in batches: the server takes 300 at a time). */
export function useGeo(postcodes: string[]): GeoTable {
  const key = postcodes.join(',');
  const [geo, setGeo] = useState<GeoTable>({});
  useEffect(() => {
    if (!key) return;
    let live = true;
    const all = key.split(',');
    const batches = Array.from({ length: Math.ceil(all.length / 300) }, (_, i) => all.slice(i * 300, i * 300 + 300));
    Promise.all(batches.map((b) => api<{ postcodes: GeoTable }>(`/api/geo?postcodes=${encodeURIComponent(b.join(','))}`)))
      .then((rs) => live && setGeo(Object.assign({}, ...rs.map((r) => r.postcodes))))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key]);
  return geo;
}

/** Home and each provider's nearest place, for a list of providers. */
export function useDistances(homeSuburb: string | null, homePostcode: string | null, providers: Provider[]) {
  const postcodes = useMemo(() => postcodesFor(homePostcode, providers), [homePostcode, providers]);
  const geo = useGeo(postcodes);
  return useMemo(() => {
    const home = homePostcode ? pointFor(geo, homePostcode, homeSuburb ?? undefined) : null;
    const places = new Map(providers.map((p) => [p.id, providerPlaces(p, geo)]));
    const near = new Map(providers.map((p) => [p.id, nearest(home, places.get(p.id)!)]));
    return { geo, home, places, near };
  }, [geo, homePostcode, homeSuburb, providers]);
}
