import { DomainError } from '../core/errors.js';

/**
 * Units of measure. Area and length factors are exact definitions (international foot =
 * 0.3048 m), including imperial units found on older Australian titles and plans
 * (acres-roods-perches, chains and links) and residential "squares" (100 ft²).
 */
export const AREA_UNITS = {
  m2: 1,
  ha: 10_000,
  km2: 1_000_000,
  ft2: 0.09290304,
  square: 9.290304,
  perch: 25.29285264,
  rood: 1011.7141056,
  acre: 4046.8564224,
} as const;

export const LENGTH_UNITS = {
  m: 1,
  mm: 0.001,
  cm: 0.01,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  link: 0.201168,
  chain: 20.1168,
} as const;

export type AreaUnit = keyof typeof AREA_UNITS;
export type LengthUnit = keyof typeof LENGTH_UNITS;
export type OtherUnit =
  'AUD' | 'AUD/m2' | 'AUD/ha' | 'AUD/yr' | 'AUD/m2/yr' | 'ratio' | 'years' | 'months' | 'count';
export type Unit = AreaUnit | LengthUnit | OtherUnit;

export const isAreaUnit = (u: string): u is AreaUnit => Object.hasOwn(AREA_UNITS, u);
export const isLengthUnit = (u: string): u is LengthUnit => Object.hasOwn(LENGTH_UNITS, u);

export function dimensionOf(unit: string): 'area' | 'length' | 'other' {
  if (isAreaUnit(unit)) return 'area';
  if (isLengthUnit(unit)) return 'length';
  return 'other';
}

/** Converts between units of the same dimension. Identity for equal units. */
export function convert(value: number, from: string, to: string): number {
  if (!Number.isFinite(value))
    throw new DomainError('INVALID_ARGUMENT', 'value must be finite', { value });
  if (from === to) return value;
  if (isAreaUnit(from) && isAreaUnit(to)) return (value * AREA_UNITS[from]) / AREA_UNITS[to];
  if (isLengthUnit(from) && isLengthUnit(to))
    return (value * LENGTH_UNITS[from]) / LENGTH_UNITS[to];
  throw new DomainError('INVALID_UNIT', `cannot convert ${from} to ${to}`, { from, to });
}

export const toSquareMetres = (value: number, unit: AreaUnit): number => convert(value, unit, 'm2');

/** Converts an old-title area expressed as acres, roods and perches to m². */
export function fromAcresRoodsPerches(acres: number, roods: number, perches: number): number {
  for (const [name, v] of [
    ['acres', acres],
    ['roods', roods],
    ['perches', perches],
  ] as const) {
    if (!Number.isFinite(v) || v < 0) {
      throw new DomainError('INVALID_ARGUMENT', `${name} must be a non-negative number`, {
        [name]: v,
      });
    }
  }
  return acres * AREA_UNITS.acre + roods * AREA_UNITS.rood + perches * AREA_UNITS.perch;
}

/** Rounds half away from zero to `dp` decimal places (deterministic across platforms). */
export function roundHalfAwayFromZero(value: number, dp: number): number {
  if (!Number.isFinite(value))
    throw new DomainError('INVALID_ARGUMENT', 'value must be finite', { value });
  const factor = 10 ** dp;
  const scaled = Math.abs(value) * factor;
  // Nudge by a relative epsilon so values like 1.005 (stored as 1.00499999…) round as written.
  const rounded = Math.round(scaled * (1 + Number.EPSILON * 4)) / factor;
  return value < 0 ? -rounded : rounded;
}

/** Whole cents from dollars, for persistence. */
export const dollarsToCents = (dollars: number): number =>
  Math.round(roundHalfAwayFromZero(dollars, 2) * 100);
export const centsToDollars = (cents: number): number => cents / 100;

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});
const AUD_CENTS = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 });

export const formatAud = (dollars: number, cents = false): string =>
  (cents ? AUD_CENTS : AUD).format(dollars);
export const formatArea = (m2: number): string => `${NUM.format(roundHalfAwayFromZero(m2, 2))} m²`;
export const formatPercent = (ratio: number, dp = 2): string =>
  `${roundHalfAwayFromZero(ratio * 100, dp).toFixed(dp)}%`;
export const formatNumber = (n: number): string => NUM.format(n);
