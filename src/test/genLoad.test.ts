import { describe, expect, it } from 'vitest';
import { candidateToProvider, findHeader, groupProviders, isHomeCare, matchCatalogue, normaliseName, toServices, type Cell } from '../genLoad';
import { loadSeedData } from '../data/load';

const seed = loadSeedData();

/** Shaped like the GEN aged care service list: title rows, then headings, then one row per service. */
const sheet: Cell[][] = [
  ['OFFICIAL'],
  ['Aged care service list - Queensland - as at 30 June 2025'],
  [],
  ['Service Name', 'Physical Address', 'Physical Address Suburb', 'Physical Address State', 'Physical Address Post Code', 'Care Type', 'Residential Places', 'Home Care Places', 'Provider Name', 'Organisation Type', '2018 Aged Care Planning Region (ACPR)'],
  ['Bolton Clarke Brisbane South', '1 Main St', 'Wynnum', 'QLD', 4178, 'Home Care', 0, 250, 'RSL Care RDNS Limited', 'Not-for-profit', 'Brisbane South'],
  ['Bayside Home Support', '2 Bay Rd', 'Manly', 'qld', 4179, 'Home Care', 0, 40, 'Bayside Community Care Pty Ltd', 'For-profit', 'Brisbane South'],
  ['Bayside Home Support - Cleveland', '3 Shore St', 'Cleveland', 'QLD', 4163, 'Home Care', 0, 20, 'Bayside Community Care Pty Ltd', 'For-profit', 'Brisbane South'],
  ['Seaside Residential', '4 Esplanade', 'Wynnum', 'QLD', 4178, 'Residential', 120, 0, 'Seaside Aged Care Ltd', 'For-profit', 'Brisbane South'],
  ['Northside Care', '5 North St', 'Chermside', 'QLD', 4032, 'Home Care', 0, 60, 'Northside Care Ltd', 'For-profit', 'Brisbane North'],
];

describe('loading from the government service list', () => {
  it('finds the heading row and the columns, past title rows', () => {
    const h = findHeader(sheet)!;
    expect(h.index).toBe(3);
    expect(h.mapping).toMatchObject({ service: 0, address: 1, suburb: 2, state: 3, postcode: 4, care_type: 5, home_care_places: 7, provider: 8, org_type: 9, region: 10 });
  });

  it('reads services and keeps home care', () => {
    const h = findHeader(sheet)!;
    const services = toServices(sheet, h.index, h.mapping);
    expect(services).toHaveLength(5);
    expect(services[1]).toMatchObject({ provider: 'Bayside Community Care Pty Ltd', postcode: '4179', state: 'QLD', homeCarePlaces: 40 });
    expect(services.filter(isHomeCare).map((s) => s.service)).not.toContain('Seaside Residential');
  });

  it('groups services by provider and recognises providers already in the catalogue', () => {
    const h = findHeader(sheet)!;
    const groups = groupProviders(toServices(sheet, h.index, h.mapping).filter(isHomeCare), seed.providers);
    expect(groups.map((g) => [g.name, g.services.length, g.existing?.id ?? null])).toEqual([
      ['Bayside Community Care Pty Ltd', 2, null],
      ['Northside Care Ltd', 1, null],
      ['RSL Care RDNS Limited', 1, 'bolton-clarke'],
    ]);
  });

  it('matches names despite company suffixes, without false matches on common words', () => {
    expect(normaliseName('Anglicare Southern Queensland Ltd')).toBe('anglicare southern queensland');
    expect(matchCatalogue(['Anglicare Southern Queensland Limited'], seed.providers)?.id).toBe('anglicare-southern-queensland');
    expect(matchCatalogue(['Community Care Services Pty Ltd'], seed.providers)).toBeNull();
  });

  it('makes a catalogue record with no prices, marked as loaded, and a unique id', () => {
    const h = findHeader(sheet)!;
    const [bayside] = groupProviders(toServices(sheet, h.index, h.mapping), seed.providers);
    const taken = new Set(['bayside-community-care-pty-ltd']);
    const p = candidateToProvider(bayside, taken, '2026-10-27', 'qld.xlsx, Brisbane South');
    expect(p).toMatchObject({
      id: 'bayside-community-care-pty-ltd-2',
      provider: 'Bayside Community Care Pty Ltd',
      type: 'For-profit',
      outlet: 'Bayside Home Support; Bayside Home Support - Cleveland',
      pc: null,
      source_url: null,
      locations: ['Manly 4179', 'Cleveland 4163'],
      origin: { kind: 'gen', note: 'qld.xlsx, Brisbane South', at: '2026-10-27' },
    });
  });
});
