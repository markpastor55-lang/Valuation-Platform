import type { Instant, LocalDate } from '../core/dates.js';
import { isAfter, isLocalDate, monthsBetween } from '../core/dates.js';
import type { Provenance } from '../core/provenance.js';
import type { PropertyType } from '../config/codes.js';
import type { CalculationInput, CalculationRecord } from '../calc/calculation.js';
import { runCalculation } from '../calc/calculation.js';

export type AdjustmentFactor =
  | 'time'
  | 'location'
  | 'land_size'
  | 'building_size'
  | 'condition'
  | 'quality'
  | 'accommodation'
  | 'improvements'
  | 'zoning'
  | 'tenure'
  | 'lease_terms'
  | 'other';

export interface Adjustment {
  readonly factor: AdjustmentFactor;
  readonly kind: 'percent' | 'absolute';
  /** Ratio for percent (0.05 = +5%), currency (or rate) units for absolute. */
  readonly value: number;
  readonly rationale: string;
}

export type Comparability = 'superior' | 'comparable' | 'inferior';

export interface SaleComparable {
  readonly id: string;
  readonly assetId: string;
  readonly address: string;
  readonly contractDate: LocalDate;
  readonly settlementDate?: LocalDate;
  readonly price: number;
  readonly interest: string;
  readonly propertyType: PropertyType;
  readonly landAreaM2?: number;
  readonly buildingAreaM2?: number;
  readonly zoning?: string;
  readonly provenance: Provenance;
  readonly comparability: Comparability;
  readonly adjustments: readonly Adjustment[];
  /** Which analysed rate the adjustments apply to. */
  readonly analysisBasis: 'land_rate' | 'building_rate' | 'price';
  /**
   * For retrospective work: a sale contracted after the valuation date may only be used as a
   * check, with a recorded reason. [REVIEW: TAX]
   */
  readonly postValuationDateUse?: { readonly reason: string };
}

export interface RentalComparable {
  readonly id: string;
  readonly assetId: string;
  readonly address: string;
  readonly leaseStartDate: LocalDate;
  readonly faceRentPa: number;
  readonly rentBasis: 'gross' | 'semi_gross' | 'net';
  readonly leaseAreaM2: number;
  readonly incentiveRatio?: number;
  readonly termYears?: number;
  readonly provenance: Provenance;
  readonly comparability: Comparability;
  readonly adjustments: readonly Adjustment[];
  readonly postValuationDateUse?: { readonly reason: string };
}

export interface SaleAnalysis {
  readonly saleId: string;
  readonly landRate?: CalculationRecord;
  readonly buildingRate?: CalculationRecord;
  readonly adjusted?: CalculationRecord;
}

/** Analyses a sale into traced rates and, if adjustments exist, an adjusted indication. */
export function analyseSale(
  sale: SaleComparable,
  ctx: { computedBy: string; computedAt: Instant },
): SaleAnalysis {
  const ref = (field: string) => `sale:${sale.id}.${field}`;
  const price: CalculationInput = {
    name: 'price',
    value: sale.price,
    unit: 'AUD',
    sourceRef: ref('price'),
  };
  const landRate =
    sale.landAreaM2 !== undefined
      ? runCalculation({
          id: `${sale.id}:land_rate`,
          formulaId: 'land.rate_per_m2',
          inputs: [
            price,
            { name: 'landArea', value: sale.landAreaM2, unit: 'm2', sourceRef: ref('landAreaM2') },
          ],
          ...ctx,
        })
      : undefined;
  const buildingRate =
    sale.buildingAreaM2 !== undefined
      ? runCalculation({
          id: `${sale.id}:building_rate`,
          formulaId: 'improvements.rate_per_m2',
          inputs: [
            price,
            {
              name: 'buildingArea',
              value: sale.buildingAreaM2,
              unit: 'm2',
              sourceRef: ref('buildingAreaM2'),
            },
          ],
          ...ctx,
        })
      : undefined;

  const pct = sale.adjustments.filter((a) => a.kind === 'percent');
  const abs = sale.adjustments.filter((a) => a.kind === 'absolute');
  const adjustmentInputs = (absUnit: 'AUD' | 'AUD/m2'): CalculationInput[] => [
    ...pct.map((a, i) => ({
      name: `percentAdjustment[${i}]`,
      value: a.value,
      unit: 'ratio' as const,
      sourceRef: `${ref('adjustments')}:${a.factor}`,
    })),
    ...abs.map((a, i) => ({
      name: `absoluteAdjustment[${i}]`,
      value: a.value,
      unit: absUnit,
      sourceRef: `${ref('adjustments')}:${a.factor}`,
    })),
  ];

  let adjusted: CalculationRecord | undefined;
  if (sale.adjustments.length > 0) {
    const baseRate =
      sale.analysisBasis === 'land_rate'
        ? landRate
        : sale.analysisBasis === 'building_rate'
          ? buildingRate
          : undefined;
    adjusted =
      sale.analysisBasis === 'price'
        ? runCalculation({
            id: `${sale.id}:adjusted`,
            formulaId: 'comparison.adjusted_price',
            inputs: [price, ...adjustmentInputs('AUD')],
            ...ctx,
          })
        : baseRate
          ? runCalculation({
              id: `${sale.id}:adjusted`,
              formulaId: 'comparison.adjusted_rate',
              inputs: [
                {
                  name: 'rate',
                  value: baseRate.output.value,
                  unit: 'AUD/m2',
                  sourceRef: `calc:${baseRate.id}`,
                },
                ...adjustmentInputs('AUD/m2'),
              ],
              ...ctx,
            })
          : undefined;
  }
  return {
    saleId: sale.id,
    ...(landRate ? { landRate } : {}),
    ...(buildingRate ? { buildingRate } : {}),
    ...(adjusted ? { adjusted } : {}),
  };
}

/** Months between contract date and valuation date (positive = sale precedes valuation). */
export const saleAgeMonths = (
  sale: Pick<SaleComparable, 'contractDate'>,
  valuationDate: LocalDate,
): number => monthsBetween(sale.contractDate, valuationDate);

/** True when the evidence post-dates the cut-off (hindsight evidence for retrospective work). */
export const isPostCutOff = (date: LocalDate, cutOff: LocalDate): boolean => isAfter(date, cutOff);

/** A sale the valuer types in from their own enquiries (agent, title search, own records). */
export interface SaleEntry {
  readonly address: string;
  readonly contractDate: LocalDate;
  readonly price: number;
  readonly landAreaM2?: number;
  /** Building area, or internal living area for a unit. */
  readonly buildingAreaM2?: number;
  /** Where the valuer got the sale, e.g. "Selling agent", "Title search". */
  readonly source: string;
  readonly comparability: Comparability;
}

/** Problems that stop a typed-in sale being added (`today` is the calendar date in the jurisdiction). */
export function saleEntryProblems(e: SaleEntry, today: LocalDate): string[] {
  const problems: string[] = [];
  if (e.address.trim().length < 5) problems.push('Enter the sale address');
  if (!isLocalDate(e.contractDate)) problems.push('Enter the contract date');
  else if (isAfter(e.contractDate, today)) problems.push('The contract date is in the future');
  if (!(e.price > 0)) problems.push('Enter the sale price');
  if (e.landAreaM2 !== undefined && !(e.landAreaM2 > 0)) problems.push('Land area must be above 0');
  if (e.buildingAreaM2 !== undefined && !(e.buildingAreaM2 > 0))
    problems.push('Building area must be above 0');
  if (e.source.trim().length < 3) problems.push('Say where the sale came from');
  return problems;
}

/**
 * A typed-in sale as evidence. It is recorded as the valuer's own entry, naming its source, and
 * stays unchecked until the valuer confirms it. Units are analysed on internal area; other
 * property types on land area when it is known.
 */
export function enteredSale(
  e: SaleEntry,
  ctx: {
    readonly id: string;
    readonly assetId: string;
    readonly propertyType: PropertyType;
    readonly by: string;
    readonly at: Instant;
  },
): SaleComparable {
  const unit = ctx.propertyType === 'RESIDENTIAL_UNIT';
  const analysisBasis =
    unit && e.buildingAreaM2 !== undefined
      ? 'building_rate'
      : e.landAreaM2 !== undefined
        ? 'land_rate'
        : e.buildingAreaM2 !== undefined
          ? 'building_rate'
          : 'price';
  return {
    id: ctx.id,
    assetId: ctx.assetId,
    address: e.address.trim(),
    contractDate: e.contractDate,
    price: e.price,
    interest: 'fee_simple_vacant_possession',
    propertyType: ctx.propertyType,
    ...(e.landAreaM2 !== undefined ? { landAreaM2: e.landAreaM2 } : {}),
    ...(e.buildingAreaM2 !== undefined ? { buildingAreaM2: e.buildingAreaM2 } : {}),
    provenance: {
      origin: 'manual_entry',
      sourceRef: e.source.trim(),
      effectiveDate: e.contractDate,
      verification: 'unverified',
      capturedBy: ctx.by,
      capturedAt: ctx.at,
    },
    comparability: e.comparability,
    adjustments: [],
    analysisBasis,
  };
}
