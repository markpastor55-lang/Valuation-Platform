import type { LocalDate } from '../core/dates.js';
import { isBefore, isLocalDate } from '../core/dates.js';
import type { FieldValues } from './resolve.js';

export interface RetrospectiveStatus {
  /** True when the valuation date is earlier than the date it is compared with. */
  readonly retrospective: boolean;
  readonly valuationDate?: LocalDate;
  /** The inspection date, or the instruction date when there is no inspection (desktop). */
  readonly comparedWith?: {
    readonly fieldId: 'dates.inspection' | 'dates.instruction';
    readonly date: LocalDate;
  };
}

const jobDate = (values: FieldValues, id: string): LocalDate | undefined => {
  const v = values.job[id];
  return isLocalDate(v) ? v : undefined;
};

/**
 * Whether a valuation is retrospective. This is never selected: it follows from the dates, for any
 * purpose (a CGT valuation can be current or retrospective, and so can a family law valuation).
 * A valuation is retrospective when its valuation date is earlier than the inspection date, or the
 * instruction date when there is no inspection. [REVIEW: API_STANDARDS]
 */
export function retrospectiveStatus(values: FieldValues): RetrospectiveStatus {
  const valuationDate = jobDate(values, 'dates.valuation');
  const inspection = jobDate(values, 'dates.inspection');
  const instruction = jobDate(values, 'dates.instruction');
  const comparedWith = inspection
    ? ({ fieldId: 'dates.inspection', date: inspection } as const)
    : instruction
      ? ({ fieldId: 'dates.instruction', date: instruction } as const)
      : undefined;
  return {
    retrospective:
      valuationDate !== undefined &&
      comparedWith !== undefined &&
      isBefore(valuationDate, comparedWith.date),
    ...(valuationDate ? { valuationDate } : {}),
    ...(comparedWith ? { comparedWith } : {}),
  };
}
