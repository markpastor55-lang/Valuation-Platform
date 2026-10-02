import type { Instant } from '../core/dates.js';
import { DomainError } from '../core/errors.js';
import { hashCanonical } from '../core/hash.js';
import type { Unit } from '../units/units.js';
import { convert, dimensionOf, roundHalfAwayFromZero } from '../units/units.js';
import type { FormulaDef, FormulaInputs } from './formulas.js';
import { findFormula } from './formulas.js';

export interface CalculationInput {
  /** Input name; series items use `name[index]`. */
  readonly name: string;
  readonly value: number;
  readonly unit: Unit;
  /** Where the value came from, e.g. `sale:<id>.price` or `field:land.area@asset:<id>`. */
  readonly sourceRef?: string;
}

export interface TracedInput extends CalculationInput {
  /** Value after unit conversion to the formula's unit. */
  readonly normalisedValue: number;
  readonly normalisedUnit: Unit;
  readonly defaulted?: boolean;
}

export interface CalculationOverride {
  readonly value: number;
  readonly reason: string;
  readonly by: string;
  readonly at: Instant;
}

/** An immutable, fully traceable calculation (brief §10: inputs, units, formula, version). */
export interface CalculationRecord {
  readonly id: string;
  readonly formulaId: string;
  readonly formulaVersion: number;
  readonly expression: string;
  readonly inputs: readonly TracedInput[];
  readonly output: { readonly value: number; readonly unit: Unit; readonly unrounded: number };
  readonly breakdown?: Readonly<Record<string, number>>;
  readonly computedBy: string;
  readonly computedAt: Instant;
  readonly override?: CalculationOverride;
  /** SHA-256 over formula, version, inputs and output (excludes override). */
  readonly traceHash: string;
}

export interface RunCalculationParams {
  readonly id: string;
  readonly formulaId: string;
  readonly formulaVersion?: number;
  readonly inputs: readonly CalculationInput[];
  readonly computedBy: string;
  readonly computedAt: Instant;
}

const SERIES_RE = /^([A-Za-z]\w*)\[(\d+)\]$/;

function normalise(input: CalculationInput, targetUnit: Unit): number {
  if (input.unit === targetUnit) return input.value;
  const from = dimensionOf(input.unit);
  if (from !== 'other' && from === dimensionOf(targetUnit))
    return convert(input.value, input.unit, targetUnit);
  throw new DomainError(
    'INVALID_UNIT',
    `input ${input.name} in ${input.unit} cannot be used as ${targetUnit}`,
    {
      input: input.name,
      unit: input.unit,
      expected: targetUnit,
    },
  );
}

function checkBounds(formula: FormulaDef, name: string, value: number): void {
  const def = formula.inputs.find((d) => d.name === name);
  if (!def) return;
  const fail = (rule: string) => {
    throw new DomainError('INVALID_ARGUMENT', `${formula.id}: ${name} ${rule}`, { name, value });
  };
  if (!Number.isFinite(value)) fail('must be a finite number');
  if (def.min !== undefined && value < def.min) fail(`must be ≥ ${def.min}`);
  if (def.max !== undefined && value > def.max) fail(`must be ≤ ${def.max}`);
  if (def.exclusiveMin !== undefined && value <= def.exclusiveMin)
    fail(`must be > ${def.exclusiveMin}`);
}

/** Runs a registered formula, converting units and recording a complete trace. */
export function runCalculation(params: RunCalculationParams): CalculationRecord {
  const formula = findFormula(params.formulaId, params.formulaVersion);
  if (!formula) {
    throw new DomainError(
      'UNKNOWN_FORMULA',
      `unknown formula ${params.formulaId}@${params.formulaVersion ?? 'latest'}`,
    );
  }

  const scalars = new Map<string, number>();
  const series = new Map<string, Map<number, number>>();
  const traced: TracedInput[] = [];

  for (const input of params.inputs) {
    const m = SERIES_RE.exec(input.name);
    const baseName = m ? (m[1] as string) : input.name;
    const def = formula.inputs.find((d) => d.name === baseName);
    if (!def) throw new DomainError('INVALID_ARGUMENT', `${formula.id} has no input ${baseName}`);
    if (Boolean(def.repeated) !== Boolean(m)) {
      throw new DomainError(
        'INVALID_ARGUMENT',
        `${formula.id}: ${baseName} must ${def.repeated ? '' : 'not '}be indexed`,
      );
    }
    const value = normalise(input, def.unit);
    checkBounds(formula, baseName, value);
    if (m) {
      const items = series.get(baseName) ?? new Map<number, number>();
      const index = Number(m[2]);
      if (items.has(index))
        throw new DomainError('INVALID_ARGUMENT', `duplicate input ${input.name}`);
      items.set(index, value);
      series.set(baseName, items);
    } else {
      if (scalars.has(baseName))
        throw new DomainError('INVALID_ARGUMENT', `duplicate input ${input.name}`);
      scalars.set(baseName, value);
    }
    traced.push({ ...input, normalisedValue: value, normalisedUnit: def.unit });
  }

  for (const def of formula.inputs) {
    if (def.repeated) {
      if (!def.optional && !series.has(def.name)) {
        throw new DomainError('INVALID_ARGUMENT', `${formula.id}: missing series ${def.name}`);
      }
      continue;
    }
    if (scalars.has(def.name)) continue;
    if (def.default !== undefined) {
      scalars.set(def.name, def.default);
      traced.push({
        name: def.name,
        value: def.default,
        unit: def.unit,
        normalisedValue: def.default,
        normalisedUnit: def.unit,
        defaulted: true,
      });
    } else if (!def.optional) {
      throw new DomainError('INVALID_ARGUMENT', `${formula.id}: missing input ${def.name}`);
    }
  }

  const accessor: FormulaInputs = {
    get: (name) => {
      const v = scalars.get(name);
      if (v === undefined)
        throw new DomainError('INVALID_ARGUMENT', `${formula.id}: missing input ${name}`);
      return v;
    },
    series: (name) =>
      [...(series.get(name) ?? new Map<number, number>()).entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v),
  };

  let result;
  try {
    result = formula.compute(accessor);
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw new DomainError('INVALID_ARGUMENT', `${formula.id}: ${(err as Error).message}`);
  }
  const unrounded = typeof result === 'number' ? result : result.value;
  if (!Number.isFinite(unrounded)) {
    throw new DomainError('INVALID_ARGUMENT', `${formula.id} produced a non-finite result`);
  }
  const breakdown =
    typeof result === 'number'
      ? undefined
      : Object.fromEntries(
          Object.entries(result.breakdown).map(([k, v]) => [
            k,
            roundHalfAwayFromZero(v, Math.max(formula.output.dp, 2)),
          ]),
        );
  const output = {
    value: roundHalfAwayFromZero(unrounded, formula.output.dp),
    unit: formula.output.unit,
    unrounded,
  };
  const sortedInputs = [...traced].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { numeric: true }),
  );

  return {
    id: params.id,
    formulaId: formula.id,
    formulaVersion: formula.version,
    expression: formula.expression,
    inputs: sortedInputs,
    output,
    ...(breakdown ? { breakdown } : {}),
    computedBy: params.computedBy,
    computedAt: params.computedAt,
    traceHash: hashCanonical({
      formulaId: formula.id,
      formulaVersion: formula.version,
      inputs: sortedInputs,
      output,
    }),
  };
}

export const MIN_OVERRIDE_REASON_LENGTH = 15;

/**
 * Records a valuer override. The original computed output and trace are retained; the
 * override is only valid with a substantive reason (brief §10).
 */
export function overrideCalculation(
  record: CalculationRecord,
  override: CalculationOverride,
  minReasonLength = MIN_OVERRIDE_REASON_LENGTH,
): CalculationRecord {
  if (override.reason.trim().length < minReasonLength) {
    throw new DomainError(
      'OVERRIDE_REASON_REQUIRED',
      `an override requires a reason of at least ${minReasonLength} characters`,
    );
  }
  if (!Number.isFinite(override.value))
    throw new DomainError('INVALID_ARGUMENT', 'override value must be finite');
  return { ...record, override: { ...override, reason: override.reason.trim() } };
}

/** The value used downstream: the override if present, otherwise the computed output. */
export const effectiveValue = (record: CalculationRecord): number =>
  record.override?.value ?? record.output.value;

/** Recomputes a record from its trace and confirms the stored output and hash still match. */
export function verifyCalculation(record: CalculationRecord): boolean {
  const recomputed = runCalculation({
    id: record.id,
    formulaId: record.formulaId,
    formulaVersion: record.formulaVersion,
    inputs: record.inputs
      .filter((i) => i.defaulted !== true)
      .map(({ name, value, unit, sourceRef }) => ({
        name,
        value,
        unit,
        ...(sourceRef ? { sourceRef } : {}),
      })),
    computedBy: record.computedBy,
    computedAt: record.computedAt,
  });
  return (
    recomputed.traceHash === record.traceHash && recomputed.output.value === record.output.value
  );
}
