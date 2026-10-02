import {
  authorize,
  type JobSelection,
  type JobStatus,
  type Permission,
  type Principal,
  type ResourceScope,
} from '@vp/domain';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { AuthorizationDenied, HttpError, notFound } from '../http/errors.js';
import { audit, orgStream } from '../services/audit.js';

export interface JobRow {
  readonly id: string;
  readonly org_id: string;
  readonly reference: string;
  readonly client_id: string;
  readonly portfolio_id: string | null;
  readonly status: JobStatus;
  readonly jurisdiction: JobSelection['jurisdiction'];
  readonly purpose: JobSelection['purpose'];
  readonly property_type: JobSelection['propertyType'];
  readonly scope: JobSelection['scope'];
  readonly mode: JobSelection['mode'];
  readonly rule_set_version_id: string;
  readonly template_version_id: string | null;
  readonly responsible_valuer_id: string | null;
  readonly reviewer_id: string | null;
  readonly fee_cents: number | null;
  readonly submitted_snapshot_hash: string | null;
  readonly approved_snapshot_hash: string | null;
  readonly version: number;
}

export const selectionOf = (j: JobRow): JobSelection => ({
  jurisdiction: j.jurisdiction,
  purpose: j.purpose,
  propertyType: j.property_type,
  scope: j.scope,
  mode: j.mode,
});

export async function getJob(db: Db, jobId: string, forUpdate = false): Promise<JobRow> {
  const { rows } = await db.query<JobRow>(
    `SELECT * FROM job WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [jobId],
  );
  const job = rows[0];
  if (!job) throw notFound('job');
  return job;
}

export async function jobResource(db: Db, job: JobRow): Promise<ResourceScope> {
  const [portfolio, inspectors, issued, exception] = await Promise.all([
    job.portfolio_id
      ? db.query<{ restricted: boolean }>('SELECT restricted FROM portfolio WHERE id = $1', [
          job.portfolio_id,
        ])
      : Promise.resolve({ rows: [] as { restricted: boolean }[] }),
    db.query<{ user_id: string }>(
      "SELECT user_id FROM job_assignment WHERE job_id = $1 AND role = 'inspector'",
      [job.id],
    ),
    db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM report WHERE job_id = $1 AND status = 'issued'",
      [job.id],
    ),
    db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM self_approval_exception WHERE job_id = $1',
      [job.id],
    ),
  ]);
  return {
    orgId: job.org_id,
    jobId: job.id,
    portfolioId: job.portfolio_id,
    portfolioRestricted: portfolio.rows[0]?.restricted ?? false,
    clientId: job.client_id,
    responsibleValuerId: job.responsible_valuer_id,
    reviewerId: job.reviewer_id,
    inspectorIds: inspectors.rows.map((r) => r.user_id),
    reportIssued: (issued.rows[0]?.n ?? 0) > 0,
    selfApprovalExceptionAuthorised: (exception.rows[0]?.n ?? 0) > 0,
  };
}

/**
 * Records an authorisation denial in the organisation's security stream. Called by the error
 * handler after the failed request's transaction has rolled back, so the record survives.
 */
export async function recordDenial(ctx: AppContext, err: AuthorizationDenied): Promise<void> {
  const d = err.denial;
  await ctx.db.transaction((tx) =>
    audit(tx, ctx, {
      orgId: d.orgId,
      streamId: orgStream(d.orgId),
      actor: { userId: d.userId, kind: d.kind, roles: d.roles as Principal['roles'] },
      action: 'auth.denied',
      entityType: d.entityType,
      entityId: d.entityId,
      metadata: { permission: d.permission, code: err.code },
    }),
  );
}

export function authorizeOrThrow(
  _ctx: AppContext,
  principal: Principal,
  permission: Permission,
  resource: ResourceScope | undefined,
  entity: { type: string; id: string },
): Promise<void> {
  const decision = authorize(principal, permission, resource);
  if (decision.allowed) return Promise.resolve();
  // Hide the existence of jobs in other organisations or behind information barriers.
  if (decision.code === 'WRONG_ORGANISATION' || decision.code === 'RESTRICTED_PORTFOLIO')
    return Promise.reject(notFound(entity.type));
  return Promise.reject(
    new AuthorizationDenied(
      {
        userId: principal.userId,
        orgId: principal.orgId,
        kind: principal.kind,
        roles: principal.roles,
        permission,
        entityType: entity.type,
        entityId: entity.id,
      },
      decision.code,
      decision.reason,
    ),
  );
}

/** Loads a job (optionally locked for update) and checks the permission against it. */
export async function authorizeJob(
  ctx: AppContext,
  db: Db,
  principal: Principal,
  permission: Permission,
  jobId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<{ job: JobRow; resource: ResourceScope }> {
  const job = await getJob(db, jobId, opts.forUpdate ?? false);
  if (job.org_id !== principal.orgId) throw notFound('job');
  const resource = await jobResource(db, job);
  await authorizeOrThrow(ctx, principal, permission, resource, { type: 'job', id: jobId });
  return { job, resource };
}

/** Bumps the job's optimistic version after any content change. */
export async function touchJob(db: Db, jobId: string, at: string): Promise<void> {
  await db.query('UPDATE job SET version = version + 1, updated_at = $2 WHERE id = $1', [
    jobId,
    at,
  ]);
}

/** Rejects references to assets that do not belong to the job in the URL (prevents cross-job writes). */
export async function assertAssetInJob(db: Db, jobId: string, assetId: string): Promise<void> {
  const { rows } = await db.query(
    'SELECT 1 FROM asset WHERE id = $1 AND job_id = $2 AND NOT deleted',
    [assetId, jobId],
  );
  if (!rows.length) throw new HttpError(422, 'UNKNOWN_ASSET', 'asset does not belong to this job');
}

export async function assertPhotoInJob(db: Db, jobId: string, photoId: string): Promise<void> {
  const { rows } = await db.query(
    'SELECT 1 FROM photo WHERE id = $1 AND job_id = $2 AND NOT deleted',
    [photoId, jobId],
  );
  if (!rows.length) throw new HttpError(422, 'UNKNOWN_PHOTO', 'photo does not belong to this job');
}
