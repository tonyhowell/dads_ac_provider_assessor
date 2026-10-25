import { describe, expect, it } from 'vitest';
import { parseAreas, servesArea } from '../area';

describe('service areas', () => {
  it('matches single postcodes and ranges', () => {
    const p = { postcodes_served: ['4178', '4150-4169'] };
    expect(servesArea(p, '4178')).toBe('serves');
    expect(servesArea(p, '4155')).toBe('serves');
    expect(servesArea(p, '4170')).toBe('outside');
  });

  it("is unknown when the area isn't confirmed or there's no postcode", () => {
    expect(servesArea({}, '4178')).toBe('unknown');
    expect(servesArea({ postcodes_served: [] }, '4178')).toBe('unknown');
    expect(servesArea({ postcodes_served: ['4178'] }, null)).toBe('unknown');
  });

  it('parses a typed list, dropping anything that is not a postcode or range', () => {
    expect(parseAreas('4178, 4150 - 4169; 41x9\n4183')).toEqual(['4178', '4150-4169', '4183']);
  });
});
