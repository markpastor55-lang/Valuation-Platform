import type { Instant, LocalDate } from './dates.js';
import { isInstant, isLocalDate } from './dates.js';

export type VerificationStatus = 'unverified' | 'verified' | 'disputed' | 'superseded';

export type DataOrigin =
  | 'manual_entry'
  | 'external_source'
  | 'client_supplied'
  | 'calculated'
  | 'measured'
  | 'ai_suggestion_accepted'
  | 'ai_suggestion_edited';

/**
 * Provenance attached to every material datum. External data must name its source, retrieval
 * time, effective date and licence basis (brief §1).
 */
export interface Provenance {
  readonly origin: DataOrigin;
  readonly sourceId?: string;
  /** Identifier of the record at the provider, a document page, or a photo id. */
  readonly sourceRef?: string;
  readonly retrievedAt?: Instant;
  readonly effectiveDate?: LocalDate;
  readonly licenceBasis?: string;
  readonly verification: VerificationStatus;
  readonly verifiedBy?: string;
  readonly verifiedAt?: Instant;
  /** 0..1, only for machine-generated values. */
  readonly confidence?: number;
  readonly capturedBy: string;
  readonly capturedAt: Instant;
}

export interface ProvenanceIssue {
  readonly field: keyof Provenance;
  readonly message: string;
}

const EXTERNAL_ORIGINS: ReadonlySet<DataOrigin> = new Set(['external_source', 'client_supplied']);

/** Returns the provenance problems that make a datum unsuitable for reporting. */
export function checkProvenance(p: Provenance): ProvenanceIssue[] {
  const issues: ProvenanceIssue[] = [];
  if (!p.capturedBy) issues.push({ field: 'capturedBy', message: 'capturing user is required' });
  if (!isInstant(p.capturedAt)) {
    issues.push({ field: 'capturedAt', message: 'capture time must be an ISO-8601 UTC instant' });
  }
  if (EXTERNAL_ORIGINS.has(p.origin)) {
    if (!p.sourceId)
      issues.push({ field: 'sourceId', message: 'external data must name its source' });
    if (!p.retrievedAt || !isInstant(p.retrievedAt)) {
      issues.push({ field: 'retrievedAt', message: 'external data must record retrieval time' });
    }
    if (!p.effectiveDate || !isLocalDate(p.effectiveDate)) {
      issues.push({
        field: 'effectiveDate',
        message: 'external data must record its effective date',
      });
    }
    if (!p.licenceBasis) {
      issues.push({
        field: 'licenceBasis',
        message: 'external data must record its licence/usage basis',
      });
    }
  }
  if (p.confidence !== undefined && (p.confidence < 0 || p.confidence > 1)) {
    issues.push({ field: 'confidence', message: 'confidence must be between 0 and 1' });
  }
  if (p.verification === 'verified' && (!p.verifiedBy || !p.verifiedAt)) {
    issues.push({
      field: 'verifiedBy',
      message: 'verified data must record who verified it and when',
    });
  }
  return issues;
}

/** Metadata carried by every material record (brief §9). */
export interface RecordMeta {
  readonly id: string;
  readonly orgId: string;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: Instant;
  readonly updatedBy: string;
  readonly updatedAt: Instant;
}
