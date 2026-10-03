/**
 * Selection vocabulary (see docs/spec/00-architecture-and-conventions.md §4).
 * Codes are stable identifiers persisted in the database; labels are display text.
 */

export const JURISDICTIONS = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const JURISDICTION_LABELS: Readonly<Record<Jurisdiction, string>> = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  WA: 'Western Australia',
  SA: 'South Australia',
  TAS: 'Tasmania',
  ACT: 'Australian Capital Territory',
  NT: 'Northern Territory',
};

/** IANA zone used to derive calendar dates for work dated in each jurisdiction. */
export const JURISDICTION_TIME_ZONES: Readonly<Record<Jurisdiction, string>> = {
  NSW: 'Australia/Sydney',
  VIC: 'Australia/Melbourne',
  QLD: 'Australia/Brisbane',
  WA: 'Australia/Perth',
  SA: 'Australia/Adelaide',
  TAS: 'Australia/Hobart',
  ACT: 'Australia/Sydney',
  NT: 'Australia/Darwin',
};

export const REPORT_PURPOSES = [
  'MARKET_VALUE',
  'CGT_RETROSPECTIVE',
  'FAMILY_LAW',
  'FINANCIAL_REPORTING',
  'RENTAL_ASSESSMENT',
  'INSURANCE_REPLACEMENT',
] as const;
export type ReportPurpose = (typeof REPORT_PURPOSES)[number];

export const REPORT_PURPOSE_LABELS: Readonly<Record<ReportPurpose, string>> = {
  MARKET_VALUE: 'Market value',
  CGT_RETROSPECTIVE: 'Capital gains tax / retrospective',
  FAMILY_LAW: 'Family law',
  FINANCIAL_REPORTING: 'Financial reporting (fair value)',
  RENTAL_ASSESSMENT: 'Rental assessment',
  INSURANCE_REPLACEMENT: 'Insurance / replacement cost',
};

export const PROPERTY_TYPES = [
  'VACANT_LAND',
  'RESIDENTIAL',
  'COMMERCIAL_OFFICE',
  'COMMERCIAL_RETAIL',
  'INDUSTRIAL',
  'SPECIALISED_MIXED_USE',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABELS: Readonly<Record<PropertyType, string>> = {
  VACANT_LAND: 'Vacant land',
  RESIDENTIAL: 'Residential',
  COMMERCIAL_OFFICE: 'Commercial — office',
  COMMERCIAL_RETAIL: 'Commercial — retail',
  INDUSTRIAL: 'Industrial',
  SPECIALISED_MIXED_USE: 'Specialised or mixed use',
};

export const INSPECTION_SCOPES = ['FULL', 'KERBSIDE', 'RESTRICTED', 'DESKTOP'] as const;
export type InspectionScope = (typeof INSPECTION_SCOPES)[number];

export const INSPECTION_SCOPE_LABELS: Readonly<Record<InspectionScope, string>> = {
  FULL: 'Full internal and external inspection',
  KERBSIDE: 'Kerbside (external only)',
  RESTRICTED: 'Restricted access',
  DESKTOP: 'Desktop (no inspection)',
};

export const ASSET_MODES = ['SINGLE', 'PORTFOLIO'] as const;
export type AssetMode = (typeof ASSET_MODES)[number];

/** The first-step selection that drives requirements (brief §2). */
export interface JobSelection {
  readonly jurisdiction: Jurisdiction;
  readonly purpose: ReportPurpose;
  readonly propertyType: PropertyType;
  readonly scope: InspectionScope;
  readonly mode: AssetMode;
}

/** Specialist reviewer roles used for `[REVIEW: …]` tags and template sign-off. */
export const SPECIALIST_REVIEWERS = [
  'API_STANDARDS',
  'FAMILY_LAW',
  'TAX',
  'ACCOUNTING',
  'PRIVACY',
  'SECURITY',
  'DATA_LICENSING',
  'QUANTITY_SURVEYOR',
  'LEGAL',
] as const;
export type SpecialistReviewer = (typeof SPECIALIST_REVIEWERS)[number];

export function isJobSelection(value: unknown): value is JobSelection {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (JURISDICTIONS as readonly unknown[]).includes(v['jurisdiction']) &&
    (REPORT_PURPOSES as readonly unknown[]).includes(v['purpose']) &&
    (PROPERTY_TYPES as readonly unknown[]).includes(v['propertyType']) &&
    (INSPECTION_SCOPES as readonly unknown[]).includes(v['scope']) &&
    (ASSET_MODES as readonly unknown[]).includes(v['mode'])
  );
}
