// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { lookupPostcodes } from './geo.ts';
import { distanceText, km, nearest, parseLocation, providerPlaces, type GeoTable } from '../src/geo.ts';
import { loadSeedData } from '../src/data/load.ts';

describe('suburb centres for the map', () => {
  it('looks up postcodes and their suburbs, ignoring anything that is not a postcode', () => {
    const geo = lookupPostcodes(['4178', '4179', 'nope', '0001']);
    expect(Object.keys(geo)).toEqual(['4178', '4179']);
    expect(geo['4178'].localities.WYNNUM[0]).toBeCloseTo(-27.44, 1);
    expect(geo['4179'].localities.MANLY).toBeDefined();
    expect(geo['4178'].state).toBe('QLD');
  });

  it('places a provider at its outlets, says how far away the nearest is', () => {
    const geo = lookupPostcodes(['4178', '4179', '4163']) as GeoTable;
    const bolton = { ...loadSeedData().providers[0], locations: ['Cleveland 4163', 'Manly 4179'] };
    const places = providerPlaces(bolton, geo);
    expect(places.map((p) => p.label)).toEqual(['Cleveland 4163', 'Manly 4179']);
    const home = geo['4178'].localities.WYNNUM;
    const n = nearest(home, places)!;
    expect(n.place.label).toBe('Manly 4179');
    expect(distanceText(n)).toMatch(/^\d km away · outlet in Manly$/);
    expect(km(home, home)).toBe(0);
    expect(parseLocation('Port of Brisbane 4178')).toEqual({ locality: 'PORT OF BRISBANE', postcode: '4178' });
  });

  it('falls back to postcodes served when no outlet is known', () => {
    const geo = lookupPostcodes(['4178']) as GeoTable;
    const p = { ...loadSeedData().providers[0], locations: [], postcodes_served: ['4178', '4100-4120'] };
    const places = providerPlaces(p, geo);
    expect(places.map((x) => [x.label, x.kind])).toEqual([['Serves 4178', 'serves']]);
    expect(distanceText(nearest(geo['4178'].centre, places))).toBe('Serves your postcode');
  });
});
