import type { Instant, LocalDate } from './dates.js';
import { daysBetween, isAfter, localDateOf } from './dates.js';
import type { Jurisdiction } from '../config/codes.js';

export type DataSourceKind =
  | 'geocoding'
  | 'title'
  | 'planning'
  | 'hazard'
  | 'map'
  | 'imagery'
  | 'sales'
  | 'rental'
  | 'construction_cost'
  | 'market_commentary'
  | 'client_document'
  | 'other';

export type LicenceBasis =
  'licensed' | 'open_licence' | 'client_supplied' | 'public_view_only' | 'internal';

/**
 * A registered data source and the terms under which its data may be stored and reproduced.
 * Licence rules are configuration: they are reviewed by the data-licensing owner, not hard-coded.
 */
export interface DataSource {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly kind: DataSourceKind;
  readonly jurisdictions?: readonly Jurisdiction[];
  readonly licence: {
    readonly basis: LicenceBasis;
    readonly reference?: string;
    readonly attribution?: string;
    readonly permitsStorage: boolean;
    readonly permitsReportReproduction: boolean;
    readonly permitsBulkUse: boolean;
    readonly expiresOn?: LocalDate;
  };
  /** Data older than this (by retrieval) is stale for reporting purposes. */
  readonly freshnessDays?: number;
  readonly status: 'active' | 'suspended' | 'retired';
}

export interface DataSourceUsageCheck {
  readonly storable: boolean;
  readonly reproducibleInReport: boolean;
  readonly licenceExpired: boolean;
  readonly stale: boolean;
  readonly reasons: string[];
}

/** Determines how a datum retrieved from `source` may be used on `asAt` (UTC instant). */
export function checkDataSourceUsage(
  source: DataSource,
  retrievedAt: Instant,
  asAt: Instant,
  timeZone = 'Australia/Sydney',
): DataSourceUsageCheck {
  const reasons: string[] = [];
  const today = localDateOf(asAt, timeZone);
  const licenceExpired =
    source.licence.expiresOn !== undefined && isAfter(today, source.licence.expiresOn);
  if (licenceExpired)
    reasons.push(`licence for ${source.name} expired on ${source.licence.expiresOn ?? ''}`);
  if (source.status !== 'active') reasons.push(`data source ${source.name} is ${source.status}`);
  if (!source.licence.permitsStorage)
    reasons.push(`${source.name} licence does not permit storage`);
  if (!source.licence.permitsReportReproduction) {
    reasons.push(`${source.name} licence does not permit reproduction in reports`);
  }
  const ageDays = daysBetween(localDateOf(retrievedAt, timeZone), today);
  const stale = source.freshnessDays !== undefined && ageDays > source.freshnessDays;
  if (stale)
    reasons.push(
      `data retrieved ${ageDays} days ago exceeds ${source.freshnessDays ?? 0}-day freshness`,
    );
  return {
    storable: source.licence.permitsStorage && !licenceExpired,
    reproducibleInReport:
      source.licence.permitsReportReproduction && !licenceExpired && source.status === 'active',
    licenceExpired,
    stale,
    reasons,
  };
}
