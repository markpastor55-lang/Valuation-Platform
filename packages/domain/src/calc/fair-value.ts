import type { Instant } from '../core/dates.js';
import { DomainError } from '../core/errors.js';
import type { CalculationRecord } from './calculation.js';
import { runCalculation } from './calculation.js';

export type FairValueLevel = 1 | 2 | 3;

export interface FairValueInput {
  readonly name: string;
  /** Significant to the measurement in its entirety (a judgement recorded by the valuer). */
  readonly significant: boolean;
  /** 1 = quoted price for identical asset in active market; 2 = other observable; 3 = unobservable. */
  readonly level: FairValueLevel;
  readonly rationale?: string;
}

export interface FairValueLevelResult {
  readonly level: FairValueLevel;
  readonly drivingInputs: readonly string[];
  /** Configurable standard reference; defaults to AASB 13. [REVIEW: ACCOUNTING] */
  readonly standard: string;
}

/**
 * Categorises a measurement within the fair-value hierarchy at the level of the lowest-level
 * input that is significant to the entire measurement (the AASB 13 approach). The categorisation
 * is a suggestion presented to the valuer; the significance judgement stays with the valuer and
 * the entity. [REVIEW: ACCOUNTING]
 */
export function deriveFairValueLevel(
  inputs: readonly FairValueInput[],
  standard = 'AASB 13 Fair Value Measurement',
): FairValueLevelResult {
  const significant = inputs.filter((i) => i.significant);
  if (significant.length === 0) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'at least one significant input is required to categorise fair value',
    );
  }
  const level = Math.max(...significant.map((i) => i.level)) as FairValueLevel;
  return {
    level,
    drivingInputs: significant.filter((i) => i.level === level).map((i) => i.name),
    standard,
  };
}

export interface SensitivityRow {
  readonly capRate: number;
  readonly delta: number;
  readonly calculation: CalculationRecord;
  readonly changeFromBase: number;
}

/**
 * Capitalisation-rate sensitivity table supporting fair-value disclosures: recomputes the
 * capitalised value for each cap-rate shift (e.g. ±0.25%, ±0.50%).
 */
export function capitalisationSensitivity(params: {
  readonly idPrefix: string;
  readonly netIncome: number;
  readonly baseCapRate: number;
  readonly deltas: readonly number[];
  readonly computedBy: string;
  readonly computedAt: Instant;
}): SensitivityRow[] {
  const run = (capRate: number, suffix: string) =>
    runCalculation({
      id: `${params.idPrefix}:${suffix}`,
      formulaId: 'income.capitalised_value',
      inputs: [
        { name: 'netIncome', value: params.netIncome, unit: 'AUD/yr' },
        { name: 'capRate', value: capRate, unit: 'ratio' },
      ],
      computedBy: params.computedBy,
      computedAt: params.computedAt,
    });
  const base = run(params.baseCapRate, 'base');
  const deltas = [...new Set([0, ...params.deltas])].sort((a, b) => a - b);
  return deltas.map((delta) => {
    const capRate = Math.round((params.baseCapRate + delta) * 1e10) / 1e10;
    const calculation = delta === 0 ? base : run(capRate, `${delta}`);
    return {
      capRate,
      delta,
      calculation,
      changeFromBase: calculation.output.value - base.output.value,
    };
  });
}
