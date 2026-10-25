import { describe, expect, it } from 'vitest';
import { parseCsv, providersFromCsv } from '../csv';
import { loadSeedData } from '../data/load';

const seed = loadSeedData();

describe('parseCsv', () => {
  it('handles quotes, embedded commas, doubled quotes and newlines', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', '2'],
    ]);
  });
});

describe('providersFromCsv', () => {
  it('adds new providers and updates existing ones by name', () => {
    const csv = [
      'Provider,Type,PC,Domestic,RN,Prices as at,Source URL,Flags,Colour',
      'Example Home Care,Private company,$98.50,95,,1 Oct 2026,https://example.org/prices,Min 1 hour; travel fee $10,blue',
      'Bolton Clarke,,121,,,24 Oct 2026,,,',
    ].join('\n');
    const { rows, unknownColumns } = providersFromCsv(csv, seed.providers);
    expect(unknownColumns).toEqual(['Colour']);
    const [added, updated] = rows;
    expect(added.provider).toMatchObject({
      id: 'example-home-care',
      pc: 98.5,
      domestic: 95,
      rn: null,
      prices_as_at_date: '2026-10-01',
      flags: ['Min 1 hour', 'travel fee $10'],
    });
    expect(added.updates).toBe(false);
    // Updating keeps columns the CSV leaves blank for text, and replaces rates the CSV gives.
    expect(updated.updates).toBe(true);
    expect(updated.provider).toMatchObject({ id: 'bolton-clarke', pc: 121, rn: null, prices_as_at: '24 Oct 2026' });
  });

  it('reports rows it cannot import with their line number', () => {
    const { rows } = providersFromCsv('provider,pc,source_url\n,90,\nBad Co,ninety,\nWorse Co,90,not a url', seed.providers);
    expect(rows.map((r) => [r.line, r.errors.length > 0])).toEqual([
      [2, true],
      [3, true],
      [4, true],
    ]);
    expect(rows[1].errors[0]).toMatch(/pc: "ninety"/);
  });
});
