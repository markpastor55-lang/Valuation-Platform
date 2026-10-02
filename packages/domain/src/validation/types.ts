import type { Instant } from '../core/dates.js';
import type { DataSource } from '../core/data-source.js';
import type { Provenance } from '../core/provenance.js';
import type { JobSelection, SpecialistReviewer } from '../config/codes.js';
import type { RuleSetStatus } from '../config/rule-set.js';
import type { CalculationRecord } from '../calc/calculation.js';
import type { AiSuggestion } from '../ai/suggestions.js';
import type { RentalComparable, SaleAnalysis, SaleComparable } from '../evidence/comparables.js';
import type { MarketCommentary, RiskFlag } from '../evidence/market.js';
import type { AreaSchedule, MeasurementApproval } from '../geometry/area-schedule.js';
import type { PhotoRecord } from '../photo/privacy.js';
import type { FieldValues, ResolvedRequirements } from '../requirements/resolve.js';
import type { TemplateStatus } from '../report/template.js';
import type { Certification } from '../workflow/certification.js';
import type { QaReview } from '../workflow/qa.js';

export type ValidationStage = 'draft' | 'submit' | 'issue';
export type ValidationSeverity = 'blocking' | 'warning';
export type ValidationCategory =
  | 'selection'
  | 'completeness'
  | 'dates'
  | 'staleness'
  | 'provenance'
  | 'evidence'
  | 'calculation'
  | 'area'
  | 'ai'
  | 'photo'
  | 'risk'
  | 'scope'
  | 'independence'
  | 'purpose'
  | 'template'
  | 'certification'
  | 'qa';

export interface ValidationConfig {
  readonly minComparables: number;
  readonly saleStaleMonths: number;
  readonly commercialSaleStaleMonths: number;
  readonly outlierK: number;
  readonly adoptedRangeTolerance: number;
  readonly requireApprovedRuleSet: boolean;
  readonly requireApprovedTemplate: boolean;
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  minComparables: 3,
  saleStaleMonths: 12,
  commercialSaleStaleMonths: 24,
  outlierK: 1.5,
  adoptedRangeTolerance: 0.05,
  requireApprovedRuleSet: true,
  requireApprovedTemplate: true,
};

export interface ValidationAcknowledgement {
  readonly code: string;
  readonly path: string;
  readonly by: string;
  readonly at: Instant;
  readonly reason: string;
}

export interface ValidationContext {
  readonly stage: ValidationStage;
  readonly now: Instant;
  /** IANA zone of the property's jurisdiction (calendar-date comparisons). */
  readonly timeZone: string;
  readonly selection: JobSelection;
  readonly requirements: ResolvedRequirements;
  readonly values: FieldValues;
  readonly assetIds: readonly string[];
  /** Provenance for captured field values (by field and asset). */
  readonly provenance: readonly {
    readonly fieldId: string;
    readonly assetId: string | null;
    readonly provenance: Provenance;
  }[];
  readonly dataSources: readonly DataSource[];
  readonly sales: readonly SaleComparable[];
  readonly saleAnalyses: readonly SaleAnalysis[];
  readonly rentals: readonly RentalComparable[];
  readonly calculations: readonly CalculationRecord[];
  readonly commentary: readonly MarketCommentary[];
  readonly areaSchedules: readonly AreaSchedule[];
  readonly measurementApprovals: readonly MeasurementApproval[];
  readonly photos: readonly PhotoRecord[];
  readonly aiSuggestions: readonly AiSuggestion[];
  readonly riskFlags: readonly RiskFlag[];
  readonly certification?: Certification;
  readonly qaReview?: QaReview;
  readonly ruleSetStatus: RuleSetStatus;
  readonly templateStatus?: TemplateStatus;
  readonly acknowledgements: readonly ValidationAcknowledgement[];
  readonly config: ValidationConfig;
}

export interface RawFinding {
  /** Stable locator, e.g. `job/field:dates.valuation` or `asset:a1/sale:s3`. */
  readonly path: string;
  readonly message: string;
}

export interface ValidationRule {
  readonly code: string;
  readonly title: string;
  readonly category: ValidationCategory;
  readonly severity: ValidationSeverity;
  readonly stages: readonly ValidationStage[];
  /** Warnings may be acknowledged with a reason; blocking findings must be fixed. */
  readonly acknowledgeable: boolean;
  readonly description: string;
  readonly review?: SpecialistReviewer;
  evaluate(ctx: ValidationContext): RawFinding[];
}

export interface Finding extends RawFinding {
  readonly code: string;
  readonly title: string;
  readonly category: ValidationCategory;
  readonly severity: ValidationSeverity;
  readonly acknowledgeable: boolean;
  readonly acknowledgement?: ValidationAcknowledgement;
}

export interface ValidationResult {
  readonly stage: ValidationStage;
  readonly ranAt: Instant;
  readonly findings: readonly Finding[];
  readonly blockingCount: number;
  readonly unacknowledgedWarningCount: number;
  /** Rule codes evaluated (for the audit trail). */
  readonly rulesEvaluated: readonly string[];
}
