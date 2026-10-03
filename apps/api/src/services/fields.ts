import {
  FIELD_BY_ID,
  fieldValueProblem,
  type Json,
  type Principal,
  type Provenance,
} from '@vp/domain';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { HttpError } from '../http/errors.js';
import { audit, jobStream } from './audit.js';

export interface FieldWrite {
  readonly fieldId: string;
  readonly assetId: string | null;
  readonly value: unknown;
  readonly provenance?: Omit<Provenance, 'capturedBy' | 'capturedAt'>;
  readonly reason?: string;
}

/**
 * Writes one configuration-driven field value with provenance, keeps the full history and
 * appends a `field.updated` audit event with before/after values.
 */
export async function writeField(
  tx: Db,
  ctx: AppContext,
  principal: Principal,
  job: { id: string; org_id: string },
  w: FieldWrite,
): Promise<{ changed: boolean }> {
  const def = FIELD_BY_ID.get(w.fieldId);
  if (!def) throw new HttpError(422, 'UNKNOWN_FIELD', `unknown field ${w.fieldId}`);
  if (def.level === 'asset' && !w.assetId)
    throw new HttpError(422, 'ASSET_REQUIRED', `${w.fieldId} is captured per asset`);
  if (def.level === 'job' && w.assetId)
    throw new HttpError(422, 'JOB_LEVEL_FIELD', `${w.fieldId} is captured once per job`);
  const problem = fieldValueProblem(def, w.value);
  if (problem) throw new HttpError(422, 'INVALID_FIELD_VALUE', `${w.fieldId}: ${problem}`);
  if (w.assetId) {
    const { rows } = await tx.query(
      'SELECT 1 FROM asset WHERE id = $1 AND job_id = $2 AND NOT deleted',
      [w.assetId, job.id],
    );
    if (!rows.length)
      throw new HttpError(422, 'UNKNOWN_ASSET', 'asset does not belong to this job');
  }
  const now = ctx.clock.now();
  const base = w.provenance ?? {
    origin: 'manual_entry' as const,
    verification: 'unverified' as const,
  };
  const provenance: Provenance = {
    ...base,
    ...(base.verification === 'verified' ? { verifiedBy: principal.userId, verifiedAt: now } : {}),
    capturedBy: principal.userId,
    capturedAt: now,
  };
  const { rows } = await tx.query<{ id: string; value: Json; version: number }>(
    `SELECT id, value, version FROM field_value
      WHERE job_id = $1 AND coalesce(asset_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        AND field_id = $3 FOR UPDATE`,
    [job.id, w.assetId, w.fieldId],
  );
  const existing = rows[0];
  const valueJson = JSON.stringify(w.value);
  if (existing && JSON.stringify(existing.value) === valueJson) return { changed: false };
  let id: string;
  let version: number;
  if (existing) {
    id = existing.id;
    version = existing.version + 1;
    await tx.query(
      'UPDATE field_value SET value = $2, provenance = $3, version = $4, updated_by = $5, updated_at = $6 WHERE id = $1',
      [id, valueJson, JSON.stringify(provenance), version, principal.userId, now],
    );
  } else {
    id = ctx.newId();
    version = 1;
    await tx.query(
      'INSERT INTO field_value (id, org_id, job_id, asset_id, field_id, value, provenance, version, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9)',
      [
        id,
        job.org_id,
        job.id,
        w.assetId,
        w.fieldId,
        valueJson,
        JSON.stringify(provenance),
        principal.userId,
        now,
      ],
    );
  }
  await tx.query(
    'INSERT INTO field_value_history (field_value_id, version, value, provenance, changed_by, changed_at, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, version, valueJson, JSON.stringify(provenance), principal.userId, now, w.reason ?? null],
  );
  await audit(tx, ctx, {
    orgId: job.org_id,
    streamId: jobStream(job.id),
    actor: principal,
    action: 'field.updated',
    entityType: 'field_value',
    entityId: id,
    ...(w.reason ? { reason: w.reason } : {}),
    before: existing ? { value: existing.value } : null,
    after: {
      value: w.value as Json,
      fieldId: w.fieldId,
      assetId: w.assetId,
      provenance: provenance as unknown as Json,
    },
  });
  return { changed: true };
}
