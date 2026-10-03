import { describe, expect, it } from 'vitest';
import {
  convert,
  dollarsToCents,
  formatArea,
  formatAud,
  formatPercent,
  fromAcresRoodsPerches,
  roundHalfAwayFromZero,
  toSquareMetres,
} from '../src/index.js';

describe('unit conversions', () => {
  it('converts imperial and metric areas exactly', () => {
    expect(toSquareMetres(1, 'acre')).toBeCloseTo(4046.8564224, 10);
    expect(toSquareMetres(1, 'ha')).toBe(10_000);
    expect(toSquareMetres(100, 'ft2')).toBeCloseTo(9.290304, 10);
    expect(toSquareMetres(1, 'square')).toBeCloseTo(9.290304, 10);
    expect(convert(1, 'acre', 'perch')).toBeCloseTo(160, 9);
    expect(convert(1, 'acre', 'rood')).toBeCloseTo(4, 9);
  });

  it('converts lengths including chains and links', () => {
    expect(convert(1, 'chain', 'link')).toBeCloseTo(100, 9);
    expect(convert(1, 'chain', 'ft')).toBeCloseTo(66, 9);
    expect(convert(10, 'ft', 'm')).toBeCloseTo(3.048, 10);
  });

  it('converts old-title acres-roods-perches', () => {
    // 1a 2r 16p = 1.6 acres
    expect(fromAcresRoodsPerches(1, 2, 16)).toBeCloseTo(1.6 * 4046.8564224, 6);
    expect(() => fromAcresRoodsPerches(-1, 0, 0)).toThrow();
  });

  it('round-trips', () => {
    expect(convert(convert(1234.5, 'm2', 'ft2'), 'ft2', 'm2')).toBeCloseTo(1234.5, 9);
  });

  it('rejects cross-dimension conversions', () => {
    expect(() => convert(1, 'm2', 'm')).toThrow(/cannot convert/);
    expect(() => convert(1, 'AUD', 'm2')).toThrow(/cannot convert/);
  });
});

describe('rounding and formatting', () => {
  it('rounds half away from zero, including binary edge cases', () => {
    expect(roundHalfAwayFromZero(1.005, 2)).toBe(1.01);
    expect(roundHalfAwayFromZero(2.5, 0)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5, 0)).toBe(-3);
    expect(roundHalfAwayFromZero(1234.5678, 2)).toBe(1234.57);
    expect(roundHalfAwayFromZero(0.1 + 0.2, 2)).toBe(0.3);
  });

  it('converts dollars to integer cents', () => {
    expect(dollarsToCents(1234.565)).toBe(123457);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });

  it('formats Australian currency, areas and percentages', () => {
    expect(formatAud(1250000)).toBe('$1,250,000');
    expect(formatAud(12.5, true)).toBe('$12.50');
    expect(formatArea(1234.567)).toBe('1,234.57 m²');
    expect(formatPercent(0.0575)).toBe('5.75%');
  });
});
