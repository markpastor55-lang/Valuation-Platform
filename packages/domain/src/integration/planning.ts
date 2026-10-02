import type { Instant, LocalDate } from '../core/dates.js';
import type { DataSource } from '../core/data-source.js';
import { DomainError } from '../core/errors.js';
import type { Provenance } from '../core/provenance.js';
import { checkProvenance } from '../core/provenance.js';
import type { Jurisdiction } from '../config/codes.js';
import type { ConnectorResult, ConnectorRuntime } from './connector.js';
import { callWithPolicy } from './connector.js';

export interface PlanningLookupRequest {
  readonly jurisdiction: Jurisdiction;
  readonly address?: string;
  readonly parcel?: {
    readonly lot?: string;
    readonly plan?: string;
    readonly volumeFolio?: string;
  };
  readonly coordinates?: { readonly lat: number; readonly lng: number };
}

export interface PlanningControlResult {
  readonly zone?: { readonly code: string; readonly name: string };
  readonly overlays: readonly {
    readonly code: string;
    readonly name: string;
    readonly schedule?: string;
  }[];
  readonly instrument?: string;
  readonly permissibleUses?: readonly string[];
  readonly prohibitedUses?: readonly string[];
  readonly propertyReport?: { readonly documentRef: string; readonly generatedAt: Instant };
  readonly provenance: Provenance;
}

export interface ConnectorContext {
  readonly userId: string;
  readonly now: Instant;
  readonly signal?: AbortSignal;
}

export type PlanningCapability = 'zone' | 'overlays' | 'instrument' | 'uses' | 'property_report';

export interface PlanningAdapter {
  readonly id: string;
  readonly jurisdiction: Jurisdiction;
  readonly dataSourceId: string;
  readonly capabilities: readonly PlanningCapability[];
  lookup(req: PlanningLookupRequest, ctx: ConnectorContext): Promise<PlanningControlResult>;
}

/**
 * Per-jurisdiction adapter plan. Every automated source is unconfirmed until the data-licensing
 * reviewer confirms availability, API access, terms and attribution (docs/spec/04).
 */
export const PLANNING_ADAPTER_PLAN: Readonly<
  Record<
    Jurisdiction,
    {
      readonly candidate: string;
      readonly phase: 'MVP' | 'Pilot' | 'Production';
      readonly status: 'manual_only' | 'planned';
    }
  >
> = {
  VIC: { candidate: 'VicPlan / Vicmap Planning', phase: 'MVP', status: 'planned' },
  NSW: { candidate: 'NSW Planning Portal spatial services', phase: 'Pilot', status: 'planned' },
  QLD: {
    candidate: 'State planning mapping + council planning schemes',
    phase: 'Production',
    status: 'manual_only',
  },
  WA: { candidate: 'PlanWA / Landgate SLIP', phase: 'Production', status: 'manual_only' },
  SA: { candidate: 'SA Property and Planning Atlas', phase: 'Production', status: 'manual_only' },
  TAS: {
    candidate: 'LISTmap / Tasmanian Planning Scheme',
    phase: 'Production',
    status: 'manual_only',
  },
  ACT: { candidate: 'ACTmapi / Territory Plan', phase: 'Production', status: 'manual_only' },
  NT: { candidate: 'NT Atlas / NT Planning Scheme', phase: 'Production', status: 'manual_only' },
};

export interface ManualPlanningEntry {
  readonly zone?: { readonly code: string; readonly name: string };
  readonly overlays?: readonly { readonly code: string; readonly name: string }[];
  readonly instrument?: string;
  /** Uploaded planning certificate / property report — the authority for manual entry. */
  readonly documentRef: string;
  readonly documentDate: LocalDate;
  readonly source: DataSource;
}

/** The always-available fallback: values keyed from an uploaded planning document. */
export function manualPlanningResult(
  entry: ManualPlanningEntry,
  ctx: ConnectorContext,
): PlanningControlResult {
  if (!entry.documentRef)
    throw new DomainError('INVALID_ARGUMENT', 'manual planning entry requires the source document');
  return {
    ...(entry.zone ? { zone: entry.zone } : {}),
    overlays: entry.overlays ?? [],
    ...(entry.instrument ? { instrument: entry.instrument } : {}),
    propertyReport: {
      documentRef: entry.documentRef,
      generatedAt: `${entry.documentDate}T00:00:00Z`,
    },
    provenance: {
      origin: 'client_supplied',
      sourceId: entry.source.id,
      sourceRef: entry.documentRef,
      retrievedAt: ctx.now,
      effectiveDate: entry.documentDate,
      licenceBasis: entry.source.licence.basis,
      verification: 'unverified',
      capturedBy: ctx.userId,
      capturedAt: ctx.now,
    },
  };
}

export type PlanningLookupOutcome =
  | { readonly status: 'found'; readonly result: PlanningControlResult; readonly attempts: number }
  | { readonly status: 'manual_fallback'; readonly reason: string; readonly attempts: number };

/**
 * Runs an adapter under the connector policy and checks provenance completeness. Any failure —
 * outage, timeout, circuit open or incomplete provenance — yields a manual-fallback task.
 */
export async function lookupPlanning(
  adapter: PlanningAdapter,
  req: PlanningLookupRequest,
  ctx: ConnectorContext,
  rt: ConnectorRuntime,
): Promise<PlanningLookupOutcome> {
  if (adapter.jurisdiction !== req.jurisdiction) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `adapter ${adapter.id} serves ${adapter.jurisdiction}, not ${req.jurisdiction}`,
    );
  }
  const res: ConnectorResult<PlanningControlResult> = await callWithPolicy(
    (signal) => adapter.lookup(req, { ...ctx, signal }),
    rt,
  );
  if (!res.ok)
    return {
      status: 'manual_fallback',
      reason: `${res.error}: ${res.message}`,
      attempts: res.attempts,
    };
  const issues = checkProvenance(res.value.provenance);
  if (issues.length) {
    return {
      status: 'manual_fallback',
      reason: `incomplete provenance: ${issues.map((i) => i.field).join(', ')}`,
      attempts: res.attempts,
    };
  }
  return { status: 'found', result: res.value, attempts: res.attempts };
}
