import type { Instant } from '../core/dates.js';
import { DomainError } from '../core/errors.js';

export type PrivacyFlag =
  | 'person'
  | 'child'
  | 'personal_document'
  | 'number_plate'
  | 'screen_or_display'
  | 'personal_effects'
  | 'other_sensitive';

export type PrivacyStatus =
  'clear' | 'requires_action' | 'redacted' | 'consent_recorded' | 'excluded';

export interface PhotoRecord {
  readonly id: string;
  readonly assetId: string;
  readonly sha256: string;
  readonly dHash?: string;
  readonly sequence: number;
  readonly capturedAt: Instant;
  readonly capturedBy: string;
  /** Recorded only when the user granted location permission. */
  readonly gps?: { readonly lat: number; readonly lng: number; readonly accuracyM: number };
  readonly caption?: string;
  readonly roomOrArea?: string;
  readonly privacyFlags: readonly PrivacyFlag[];
  readonly privacyStatus: PrivacyStatus;
  /** The redacted derivative that replaces this photo in reports. */
  readonly redactedPhotoId?: string;
  readonly consentRef?: string;
  readonly quality?: { readonly isBlurry: boolean; readonly isLowLight: boolean };
  readonly qualityOverrideReason?: string;
  readonly includeInReport: boolean;
}

/** Flags sensitive content (by a person, or by AI pending human confirmation). */
export function flagPhotoPrivacy(photo: PhotoRecord, flags: readonly PrivacyFlag[]): PhotoRecord {
  const merged = [...new Set([...photo.privacyFlags, ...flags])];
  return {
    ...photo,
    privacyFlags: merged,
    privacyStatus: merged.length ? 'requires_action' : photo.privacyStatus,
  };
}

export function recordRedaction(photo: PhotoRecord, redactedPhotoId: string): PhotoRecord {
  if (photo.privacyStatus !== 'requires_action')
    throw new DomainError('GUARD_FAILED', 'photo does not require redaction');
  return { ...photo, privacyStatus: 'redacted', redactedPhotoId };
}

/** Consent is recorded against a reference (e.g. signed consent form) — not inferred. */
export function recordConsent(photo: PhotoRecord, consentRef: string): PhotoRecord {
  if (!consentRef.trim())
    throw new DomainError('INVALID_ARGUMENT', 'a consent reference is required');
  if (photo.privacyFlags.includes('child')) {
    throw new DomainError(
      'GUARD_FAILED',
      'photos of children must be redacted or excluded, not released on consent',
    );
  }
  return { ...photo, privacyStatus: 'consent_recorded', consentRef };
}

export const excludePhoto = (photo: PhotoRecord): PhotoRecord => ({
  ...photo,
  privacyStatus: 'excluded',
  includeInReport: false,
});

export interface PhotoEligibility {
  readonly eligible: boolean;
  /** The photo id to render (the redacted derivative when applicable). */
  readonly renderId?: string;
  readonly reasons: readonly string[];
}

/** Whether a photo may appear in a client report. */
export function photoReportEligibility(photo: PhotoRecord): PhotoEligibility {
  const reasons: string[] = [];
  if (!photo.includeInReport) reasons.push('not selected for the report');
  if (photo.privacyStatus === 'requires_action')
    reasons.push('sensitive content requires redaction or consent');
  if (photo.privacyStatus === 'excluded') reasons.push('excluded for privacy');
  if (photo.privacyStatus === 'redacted' && !photo.redactedPhotoId)
    reasons.push('redacted derivative missing');
  if (
    photo.quality &&
    (photo.quality.isBlurry || photo.quality.isLowLight) &&
    !photo.qualityOverrideReason?.trim()
  ) {
    reasons.push('quality issue (blurry or low light) without an override reason');
  }
  if (reasons.length) return { eligible: false, reasons };
  return {
    eligible: true,
    renderId: photo.privacyStatus === 'redacted' ? (photo.redactedPhotoId as string) : photo.id,
    reasons,
  };
}
