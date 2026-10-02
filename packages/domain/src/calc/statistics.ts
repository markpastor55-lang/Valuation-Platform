import { DomainError } from '../core/errors.js';

export interface RateSummary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
  readonly q1: number;
  readonly q3: number;
  readonly iqr: number;
  readonly lowerFence: number;
  readonly upperFence: number;
}

/** Quantile by linear interpolation between closest ranks (type 7). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new DomainError('INVALID_ARGUMENT', 'quantile of empty set');
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

/** Descriptive statistics for analysed rates, with Tukey fences (k × IQR). */
export function summariseRates(values: readonly number[], k = 1.5): RateSummary {
  if (values.length === 0) throw new DomainError('INVALID_ARGUMENT', 'no values to summarise');
  if (values.some((v) => !Number.isFinite(v)))
    throw new DomainError('INVALID_ARGUMENT', 'values must be finite');
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  return {
    count: sorted.length,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    median: quantile(sorted, 0.5),
    q1,
    q3,
    iqr,
    lowerFence: q1 - k * iqr,
    upperFence: q3 + k * iqr,
  };
}

export interface OutlierResult {
  readonly summary: RateSummary | null;
  readonly outlierIds: readonly string[];
  /** Fewer than `minCount` observations: outlier detection was not meaningful. */
  readonly insufficientData: boolean;
}

/** Flags analysed rates outside the Tukey fences. Needs at least `minCount` observations. */
export function detectOutliers(
  items: readonly { id: string; value: number }[],
  options: { k?: number; minCount?: number } = {},
): OutlierResult {
  const minCount = options.minCount ?? 4;
  if (items.length < minCount) return { summary: null, outlierIds: [], insufficientData: true };
  const summary = summariseRates(
    items.map((i) => i.value),
    options.k ?? 1.5,
  );
  return {
    summary,
    outlierIds: items
      .filter((i) => i.value < summary.lowerFence || i.value > summary.upperFence)
      .map((i) => i.id),
    insufficientData: false,
  };
}

/** Whether an adopted figure sits within the range of adjusted indications (with tolerance). */
export function withinRange(
  adopted: number,
  indications: readonly number[],
  tolerance = 0,
): boolean {
  if (indications.length === 0) return false;
  const min = Math.min(...indications);
  const max = Math.max(...indications);
  return adopted >= min * (1 - tolerance) && adopted <= max * (1 + tolerance);
}
