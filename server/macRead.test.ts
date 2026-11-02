// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { applyListing, findMatch, readDetails, readPrintouts } from './macRead.ts';
import { macRates } from '../src/mac.ts';
import { loadSeedData } from '../src/data/load.ts';

const seed = loadSeedData();
const text = (name: string) => readFileSync(new URL(`../src/test/fixtures/${name}`, import.meta.url), 'utf8');
/** Stands in for PDF text extraction: the "file" holds the fixture's name. */
const toText = async (data: Buffer) => {
  const name = data.toString();
  return name.endsWith('.txt') ? { text: text(name), pages: 10 } : null;
};

describe('reading My Aged Care printouts', () => {
  it('merges the shortlist and Compare into one preview, matched to the catalogue', async () => {
    const catalogue = [...seed.providers, { ...seed.providers[0], id: 'armia', provider: 'Armia House Care', phone: '0424 833 284' }];
    const r = await readPrintouts(
      [
        { name: 'shortlist.pdf', data: Buffer.from('mac-shortlist.txt') },
        { name: 'compare.pdf', data: Buffer.from('mac-compare.txt') },
        { name: 'photo.pdf', data: Buffer.from('scan') },
      ],
      catalogue,
      undefined,
      toText,
    );
    expect(r.files.map((f) => [f.kind, f.providers, !!f.error])).toEqual([
      ['shortlist', 10, false],
      ['compare', 3, false],
      ['unknown', 0, true],
    ]);
    expect(r.share_url).toBe('https://www.myagedcare.gov.au/p/exampletest123');
    expect(r.providers).toHaveLength(10);
    expect(r.providers.find((p) => p.name === 'ARMIA House')?.match).toEqual({ id: 'armia', provider: 'Armia House Care' }); // same phone
    expect(r.providers.find((p) => p.name.startsWith('ADL'))).toMatchObject({ match: null, from: ['shortlist', 'compare'] });
  });

  it('says a details page needs Claude when it isn’t configured', async () => {
    const r = await readPrintouts([{ name: 'details.pdf', data: Buffer.from('mac-details.txt') }], seed.providers, undefined, toText);
    expect(r.files[0]).toMatchObject({ kind: 'details', providers: 0, error: expect.stringMatching(/needs Claude/) });
  });

  it('reads a details page with Claude Haiku, as a PDF', async () => {
    const parse = vi.fn(async (_p: unknown) => ({
      usage: { input_tokens: 1, output_tokens: 1 },
      parsed_output: {
        provider_name: 'ADL Local Guardians (Activities Daily Living)',
        services_listed: ['Gardening', 'Individual social support'],
        prices: [
          { service: 'Individual social support', unit: 'per hour', standard: 71.25, non_standard: 'not_offered', saturday: 'not_offered', sunday: 'not_offered', public_holiday: 'not_offered' },
          { service: 'Art therapy', unit: 'hour', standard: 1.1, non_standard: null, saturday: null, sunday: null, public_holiday: null },
        ],
      },
    }));
    const p = await readDetails({ beta: { messages: { parse } } } as unknown as Anthropic, Buffer.from('%PDF-fake'));
    expect(p.prices[0]).toMatchObject({ service: 'Individual social support', unit: 'hour', standard: 71.25, saturday: 'not_offered' });
    expect(p.prices[1].flag).toMatch(/looks wrong/);
    const sent = parse.mock.calls[0][0] as { model: string; messages: { content: { type: string }[] }[] };
    expect(sent.model).toBe('claude-haiku-5-5');
    expect(sent.messages[0].content[0].type).toBe('document');
    expect(macRates(p.prices)).toEqual({ social: 71.25 });
  });
});

describe('applying a listing', () => {
  const listing = {
    name: 'Care to Care',
    based_in: 'CANNON HILL QLD 4170',
    phone: '1300 620 013',
    services: [],
    from: ['compare' as const],
    prices: [
      { service: 'General house cleaning', unit: 'hour', standard: 70 },
      { service: 'Gardening', unit: 'hour', standard: 1.1, flag: 'looks wrong' },
    ],
  };

  it('adds a new provider with its published prices, dated, from My Aged Care', () => {
    const p = applyListing(listing, null, new Set(), { asAt: '2026-11-02', shareUrl: null, rates: macRates(listing.prices) });
    expect(p).toMatchObject({ id: 'care-to-care', provider: 'Care to Care', domestic: 70, gardening: null, phone: '1300 620 013', based_in: 'CANNON HILL QLD 4170', prices_as_at: 'My Aged Care, 2 Nov 2026', prices_as_at_date: '2026-11-02', origin: { kind: 'mac' } });
    expect(p.mac?.prices).toHaveLength(2);
  });

  it('updates a matched provider: its published prices replace ours, everything else kept', () => {
    const bolton = seed.providers.find((p) => p.id === 'bolton-clarke')!;
    const p = applyListing({ ...listing, name: 'Bolton Clarke' }, bolton, new Set(), { asAt: '2026-11-02', shareUrl: 'https://www.myagedcare.gov.au/p/x', rates: macRates(listing.prices) });
    expect(p).toMatchObject({ id: 'bolton-clarke', domestic: 70, rn: bolton.rn, veteran_fit: bolton.veteran_fit, mac: { share_url: 'https://www.myagedcare.gov.au/p/x' } });
    expect(findMatch({ ...listing, name: 'Bolton Clarke', phone: null }, seed.providers)?.id).toBe('bolton-clarke');
  });
});
