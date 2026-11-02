// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectKind, macRates, macSearchUrl, mergeProviders, parseCompare, parseProviderCards, shareLink, stateForPostcode, withFlag } from '../mac';

// Text from real My Aged Care printouts (Find a provider, November 2026), as the server extracts it.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SHORTLIST = fixture('mac-shortlist.txt');
const COMPARE = fixture('mac-compare.txt');
const DETAILS = fixture('mac-details.txt');

describe('My Aged Care printouts', () => {
  it('tells the printouts apart', () => {
    expect(detectKind(SHORTLIST)).toBe('shortlist');
    expect(detectKind(COMPARE)).toBe('compare');
    expect(detectKind(DETAILS)).toBe('details');
    expect(detectKind('Some other page')).toBe('unknown');
  });

  it('reads the shortlist: names, where based, phones, and the share link', () => {
    const list = parseProviderCards(SHORTLIST);
    expect(list.map((p) => [p.name, p.based_in, p.phone])).toEqual([
      ['ADL Local Guardians (Activities Daily Living)', 'MELBOURNE VIC 3000', '03 7067 0555'],
      ['Advanced Care Australia (Brisbane)', 'BRISBANE CITY QLD 4000', '1300 628 485'],
      ['All Aged Care - Brisbane South', 'SPRING HILL QLD 4000', '07 3238 6700'],
      ['ARMIA House', 'SUNNYBANK QLD 4109', '0424 833 284'],
      ['Australian Nursing and Training Services', 'HURSTVILLE NSW 2220', '02 9542 3340'],
      ['Bannister In Home Care Queensland', 'TWEED HEADS NSW 2485', '07 5676 7676'],
      ['Care Connect (QLD)', 'TWEED HEADS NSW 2485', '1800 692 464'],
      ['Care to Care', 'CANNON HILL QLD 4170', '1300 620 013'],
      ['Centacare Brisbane South', 'BRISBANE CITY QLD 4000', '1300 236 822'],
      ['Centacare Darra', 'BRISBANE CITY QLD 4000', '1300 236 822'],
    ]);
    expect(shareLink(SHORTLIST)).toBe('https://www.myagedcare.gov.au/p/exampletest123');
  });

  it('reads Compare: every service price for each provider, with its unit', () => {
    const [adl, armia, ants] = parseCompare(COMPARE);
    expect([adl.name, armia.name, ants.name]).toEqual(['ADL Local Guardians (Activities Daily Living)', 'ARMIA House', 'Australian Nursing and Training Services']);
    expect(adl.prices).toHaveLength(42);
    const price = (p: typeof adl, s: string) => p.prices.find((x) => x.service === s);
    expect(price(adl, 'General house cleaning')).toEqual({ service: 'General house cleaning', unit: 'hour', standard: 66 });
    expect(price(armia, 'Registered nurse clinical care')?.standard).toBe(140);
    expect(price(ants, 'Meal delivery')).toEqual({ service: 'Meal delivery', unit: 'meal', standard: 110 });
    expect(price(armia, 'Meal delivery')?.standard).toBeNull();
    expect(price(adl, 'Direct transport')).toMatchObject({ unit: 'trip', standard: 1.1 });
    // A price that can't be right is kept but flagged.
    expect(price(adl, 'Continence management (non-clinical)')?.flag).toMatch(/looks wrong/);
    expect(macRates(adl.prices)).toEqual({ rn: 181.5, en: 127, pc: 71.5, domestic: 66, respite: 110, gardening: 66, care_mgmt: 154 });
  });

  it('merges printouts of the same provider', () => {
    const merged = mergeProviders([parseProviderCards(SHORTLIST), parseCompare(COMPARE)]);
    expect(merged).toHaveLength(10);
    const adl = merged.find((p) => p.name.startsWith('ADL'))!;
    expect(adl.from).toEqual(['shortlist', 'compare']);
    expect(adl.phone).toBe('03 7067 0555');
    expect(adl.prices.length).toBe(42);
  });

  it('flags implausible prices and builds the search link', () => {
    expect(withFlag({ service: 'x', unit: 'hour', standard: 1.1 }).flag).toBeTruthy();
    expect(withFlag({ service: 'x', unit: 'hour', standard: 75 }).flag).toBeUndefined();
    expect([stateForPostcode('4178'), stateForPostcode('2600'), stateForPostcode('0810'), stateForPostcode('3000')]).toEqual(['QLD', 'ACT', 'NT', 'VIC']);
    expect(macSearchUrl({ suburb: 'Wynnum', postcode: '4178', services: ['General house cleaning', 'Gardening'] })).toBe(
      'https://www.myagedcare.gov.au/find-a-provider/search/results?careProgram=sah&distance=250&location=WYNNUM+QLD+4178&page=1&searchType=help-at-home&services=General+house+cleaning&services=Gardening&sort=titleAsc',
    );
  });
});
