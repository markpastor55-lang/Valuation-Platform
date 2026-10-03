import type { Instant, LocalDate } from '../core/dates.js';
import type { DataSource } from '../core/data-source.js';
import type { Provenance } from '../core/provenance.js';
import type { PropertyType } from '../config/codes.js';
import type { SaleComparable } from '../evidence/comparables.js';

/**
 * Provider-neutral contract for licensed property data (CoreLogic / Cotality first). Everything a
 * provider returns is a suggestion with provenance: the valuer checks and accepts each value, and
 * nothing is written to the job automatically. Licence terms decide what may be stored and what
 * may appear in a report. [REVIEW: DATA_LICENSING]
 */

export interface PropertyMatch {
  readonly propertyId: string;
  readonly address: string;
  readonly latitude?: number;
  readonly longitude?: number;
  /** 0..1 match confidence, where the provider gives one. */
  readonly confidence?: number;
}

export interface PropertyAttributes {
  readonly propertyId: string;
  readonly address: string;
  readonly propertyType?: string;
  readonly landAreaM2?: number;
  readonly floorAreaM2?: number;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly carSpaces?: number;
  readonly yearBuilt?: number;
  readonly titleReference?: string;
  readonly lga?: string;
  readonly zoning?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  /** Date the provider's record is current at. */
  readonly asAt: LocalDate;
}

export interface ProviderSale {
  readonly providerSaleId: string;
  readonly propertyId?: string;
  readonly address: string;
  readonly contractDate: LocalDate;
  readonly price: number;
  readonly landAreaM2?: number;
  readonly floorAreaM2?: number;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly latitude?: number;
  readonly longitude?: number;
  /** Distance from the subject property, where searched by location. */
  readonly distanceKm?: number;
}

/** An automated valuation model estimate. A cross-check for the valuer, never the valuation. */
export interface AutomatedEstimate {
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly asAt: LocalDate;
  readonly model: string;
}

export const AVM_NOTICE =
  'Automated estimate from the data provider. It is a cross-check only, never the valuation, and is not reproduced in reports.';

export interface ComparableSearch {
  readonly propertyId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusKm: number;
  /** Look back this many months from `toDate`. */
  readonly months: number;
  readonly toDate: LocalDate;
  readonly propertyType: PropertyType;
  readonly bedrooms?: number;
  readonly limit: number;
}

export interface PropertyDataProvider {
  readonly id: string;
  /** Registered data source the provider's facts are attributed to. */
  readonly source: DataSource;
  /** Registered data source for automated estimates (never reproducible in reports). */
  readonly avmSource: DataSource;
  matchAddress(query: string, signal?: AbortSignal): Promise<PropertyMatch[]>;
  attributes(propertyId: string, signal?: AbortSignal): Promise<PropertyAttributes>;
  salesHistory(propertyId: string, signal?: AbortSignal): Promise<ProviderSale[]>;
  comparableSales(search: ComparableSearch, signal?: AbortSignal): Promise<ProviderSale[]>;
  automatedEstimate(propertyId: string, signal?: AbortSignal): Promise<AutomatedEstimate | null>;
}

export type PropertyDataStatus =
  | { readonly state: 'connected'; readonly provider: string }
  | { readonly state: 'sample'; readonly provider: string; readonly reason: string }
  | { readonly state: 'not_configured'; readonly provider: string; readonly reason: string };

/** CoreLogic / Cotality registration. Licence terms are confirmed by the data-licensing reviewer. */
export const CORELOGIC_SOURCE: DataSource = {
  id: 'ds-corelogic',
  name: 'CoreLogic (Cotality) property data',
  provider: 'CoreLogic Australia (Cotality)',
  kind: 'sales',
  licence: {
    basis: 'licensed',
    reference: 'Commercial data licence (to be supplied) [REVIEW: DATA_LICENSING]',
    attribution: '© CoreLogic (Cotality)',
    permitsStorage: true,
    permitsReportReproduction: true,
    permitsBulkUse: false,
  },
  freshnessDays: 365,
  status: 'active',
};

export const CORELOGIC_AVM_SOURCE: DataSource = {
  id: 'ds-corelogic-avm',
  name: 'CoreLogic (Cotality) automated estimate',
  provider: 'CoreLogic Australia (Cotality)',
  kind: 'other',
  licence: {
    basis: 'licensed',
    reference: 'Commercial data licence (to be supplied) [REVIEW: DATA_LICENSING]',
    permitsStorage: true,
    permitsReportReproduction: false,
    permitsBulkUse: false,
  },
  freshnessDays: 30,
  status: 'active',
};

export interface FieldSuggestion {
  readonly fieldId: string;
  readonly assetId: string;
  readonly value: unknown;
  /** How the value appears to the valuer, e.g. "650 m²". */
  readonly display: string;
  readonly provenance: Provenance;
}

interface SuggestionContext {
  readonly assetId: string;
  readonly source: DataSource;
  readonly retrievedAt: Instant;
  readonly capturedBy: string;
}

const provenanceFor = (
  ctx: SuggestionContext,
  sourceRef: string,
  effectiveDate: LocalDate,
): Provenance => ({
  origin: 'external_source',
  sourceId: ctx.source.id,
  sourceRef,
  retrievedAt: ctx.retrievedAt,
  effectiveDate,
  licenceBasis: ctx.source.licence.basis,
  verification: 'unverified',
  capturedBy: ctx.capturedBy,
  capturedAt: ctx.retrievedAt,
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Turns provider attributes into field suggestions for the valuer to accept or ignore. Values
 * that need judgement (condition, quality) are never suggested.
 */
export function suggestFieldsFromAttributes(
  a: PropertyAttributes,
  ctx: SuggestionContext,
): FieldSuggestion[] {
  const out: FieldSuggestion[] = [];
  const add = (fieldId: string, value: unknown, display: string) =>
    out.push({
      fieldId,
      assetId: ctx.assetId,
      value,
      display,
      provenance: provenanceFor(ctx, `${a.propertyId}#${fieldId}`, a.asAt),
    });
  if (a.landAreaM2 !== undefined) {
    add('land.area', a.landAreaM2, `${a.landAreaM2.toLocaleString('en-AU')} m²`);
    add('land.areaSource', `${ctx.source.name} (as at ${a.asAt})`, ctx.source.name);
  }
  if (a.titleReference) add('location.titleReference', a.titleReference, a.titleReference);
  if (a.lga) add('location.lga', a.lga, a.lga);
  if (a.zoning) add('planning.zone', a.zoning, a.zoning);
  if (a.yearBuilt !== undefined) add('improvements.yearBuilt', a.yearBuilt, String(a.yearBuilt));
  if (a.propertyType && /house/i.test(a.propertyType))
    add('improvements.dwellingType', 'Detached house', 'Detached house');
  const rooms = [
    a.bedrooms !== undefined ? plural(a.bedrooms, 'bedroom') : '',
    a.bathrooms !== undefined ? plural(a.bathrooms, 'bathroom') : '',
    a.carSpaces !== undefined ? plural(a.carSpaces, 'car space') : '',
  ].filter(Boolean);
  if (rooms.length) add('improvements.accommodation', rooms.join(', '), rooms.join(', '));
  if (a.floorAreaM2 !== undefined)
    add(
      'improvements.buildingArea',
      a.floorAreaM2,
      `${a.floorAreaM2.toLocaleString('en-AU')} m² (provider floor area; check the basis)`,
    );
  return out;
}

/** A provider sale as sales evidence (unverified until the valuer checks it). */
export function saleFromProvider(
  s: ProviderSale,
  ctx: SuggestionContext & { readonly propertyType: PropertyType },
): SaleComparable {
  return {
    id: `cl-${s.providerSaleId}`,
    assetId: ctx.assetId,
    address: s.address,
    contractDate: s.contractDate,
    price: s.price,
    interest: 'fee_simple_vacant_possession',
    propertyType: ctx.propertyType,
    ...(s.landAreaM2 !== undefined ? { landAreaM2: s.landAreaM2 } : {}),
    ...(s.floorAreaM2 !== undefined ? { buildingAreaM2: s.floorAreaM2 } : {}),
    provenance: provenanceFor(ctx, s.providerSaleId, s.contractDate),
    comparability: 'comparable',
    adjustments: [],
    analysisBasis: 'land_rate',
  };
}

/** How far the adopted value sits from the automated estimate (for the valuer's own check). */
export function avmComparison(
  adopted: number,
  avm: AutomatedEstimate,
): { readonly differenceRatio: number; readonly withinRange: boolean } {
  return {
    differenceRatio: (adopted - avm.estimate) / avm.estimate,
    withinRange: adopted >= avm.low && adopted <= avm.high,
  };
}
