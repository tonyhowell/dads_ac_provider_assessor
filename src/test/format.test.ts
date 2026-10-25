import { describe, expect, it } from 'vitest';
import { formatAud, formatDate, formatDuration, formatPercent, formatRate } from '../format';

describe('format', () => {
  it('formats AUD to whole dollars', () => {
    expect(formatAud(12345.67)).toBe('$12,346');
  });
  it('keeps cents on hourly rates', () => {
    expect(formatRate(98.5)).toBe('$98.50');
    expect(formatRate(null)).toBe('—');
  });
  it('formats contribution rates', () => {
    expect(formatPercent(0.05)).toBe('5%');
    expect(formatPercent(0.175)).toBe('17.5%');
  });
  it('formats calendar dates without shifting the day', () => {
    expect(formatDate('2026-10-25')).toBe('25 Oct 2026');
  });
  it('formats durations', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(754)).toBe('12:34');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
