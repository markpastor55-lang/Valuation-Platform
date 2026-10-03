import {
  isEditable,
  planSyncOperation,
  type EntityState,
  type Json,
  type SyncDecision,
  type SyncLookup,
  type SyncOperation,
} from '@vp/domain';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { HttpError } from '../http/errors.js';
import type { Router } from '../http/route.js';
import { assertAssetInJob, authorizeJob, touchJob, type JobRow } from '../repo/jobs.js';
import { audit, jobStream } from '../services/audit.js';
import { InstantSchema, JsonValue, Uuid } from './schemas.js';

const OperationSchema = z.object({
  opId: z.string().min(8).max(100),
  jobId: Uuid,
  entityType: z.enum(['asset', 'photo']),
  entityId: Uuid,
  kind: z.enum(['create', 'update', 'delete']),
  baseVersion: z.number().int().min(0).nullable(),
  changes: z.record(z.string(), JsonValue),
  clientTimestamp: InstantSchema,
  contentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  parentId: Uuid.optional(),
});

const ASSET_FIELDS = new Set(['label', 'address', 'latitude', 'longitude']);
/**
 * Photo metadata a device may sync. Privacy status, flags, redaction and content identity are
 * changed only through the privacy endpoint and never by sync.
 */
const PHOTO_FIELDS = new Set([
  'caption',
  'roomOrArea',
  'sequence',
  'capturedAt',
  'gps',
  'quality',
  'qualityOverrideReason',
  'includeInReport',
  'dHash',
]);

async function loadEntity(
  db: Db,
  op: z.infer<typeof OperationSchema>,
): Promise<EntityState | undefined> {
  if (op.entityType === 'asset') {
    const { rows } = await db.query<{
      id: string;
      label: string;
      address: Json;
      latitude: number | null;
      longitude: number | null;
      version: number;
      field_versions: Record<string, number>;
      deleted: boolean;
      job_id: string;
    }>(
      'SELECT id, label, address, latitude, longitude, version, field_versions, deleted, job_id FROM asset WHERE id = $1',
      [op.entityId],
    );
    const a = rows[0];
    if (!a) return undefined;
    if (a.job_id !== op.jobId)
      throw new HttpError(422, 'WRONG_JOB', 'entity belongs to another job');
    return {
      entityType: 'asset',
      entityId: a.id,
      version: a.version,
      data: { label: a.label, address: a.address, latitude: a.latitude, longitude: a.longitude },
      fieldVersions: a.field_versions,
      deleted: a.deleted,
      parentId: op.jobId,
    };
  }
  const { rows } = await db.query<{
    id: string;
    data: Record<string, Json>;
    version: number;
    field_versions: Record<string, number>;
    deleted: boolean;
    sha256: string;
    asset_id: string;
    job_id: string;
  }>(
    'SELECT id, data, version, field_versions, deleted, sha256, asset_id, job_id FROM photo WHERE id = $1',
    [op.entityId],
  );
  const p = rows[0];
  if (!p) return undefined;
  if (p.job_id !== op.jobId) throw new HttpError(422, 'WRONG_JOB', 'entity belongs to another job');
  return {
    entityType: 'photo',
    entityId: p.id,
    version: p.version,
    data: p.data,
    fieldVersions: p.field_versions,
    deleted: p.deleted,
    contentHash: p.sha256,
    parentId: p.asset_id,
  };
}

async function persist(
  tx: Db,
  ctx: AppContext,
  job: JobRow,
  userId: string,
  op: z.infer<typeof OperationSchema>,
  next: EntityState,
  isNew: boolean,
): Promise<void> {
  const now = ctx.clock.now();
  if (op.entityType === 'asset') {
    const d = next.data as {
      label?: string;
      address?: Json;
      latitude?: number | null;
      longitude?: number | null;
    };
    if (isNew) {
      if (!d.label || !d.address)
        throw new HttpError(422, 'ASSET_INCOMPLETE', 'asset creates need label and address');
      await tx.query(
        `INSERT INTO asset (id, org_id, job_id, label, address, latitude, longitude, version, field_versions, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          next.entityId,
          job.org_id,
          job.id,
          d.label,
          JSON.stringify(d.address),
          d.latitude ?? null,
          d.longitude ?? null,
          next.version,
          JSON.stringify(next.fieldVersions),
          userId,
          now,
        ],
      );
    } else {
      await tx.query(
        'UPDATE asset SET label = $2, address = $3, latitude = $4, longitude = $5, version = $6, field_versions = $7, deleted = $8, updated_at = $9 WHERE id = $1',
        [
          next.entityId,
          d.label,
          JSON.stringify(d.address),
          d.latitude ?? null,
          d.longitude ?? null,
          next.version,
          JSON.stringify(next.fieldVersions),
          next.deleted,
          now,
        ],
      );
    }
    return;
  }
  if (isNew) {
    if (!op.contentHash || !op.parentId)
      throw new HttpError(
        422,
        'PHOTO_INCOMPLETE',
        'photo creates need contentHash and parentId (asset)',
      );
    const photo = {
      ...next.data,
      id: next.entityId,
      assetId: op.parentId,
      sha256: op.contentHash,
      capturedBy: userId,
      privacyFlags: [],
      privacyStatus: 'clear',
      includeInReport: next.data['includeInReport'] ?? false,
    };
    await tx.query(
      'INSERT INTO photo (id, org_id, job_id, asset_id, sha256, data, version, field_versions, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        next.entityId,
        job.org_id,
        job.id,
        op.parentId,
        op.contentHash,
        JSON.stringify(photo),
        next.version,
        JSON.stringify(next.fieldVersions),
        now,
      ],
    );
  } else {
    await tx.query(
      'UPDATE photo SET data = $2, version = $3, field_versions = $4, deleted = $5 WHERE id = $1',
      [
        next.entityId,
        JSON.stringify(next.data),
        next.version,
        JSON.stringify(next.fieldVersions),
        next.deleted,
      ],
    );
  }
}

export function registerSyncRoutes(r: Router): void {
  r.add({
    method: 'POST',
    url: '/v1/sync',
    summary:
      'Apply offline operations idempotently (assets and photos); returns per-operation outcomes',
    tags: ['sync'],
    permission: 'asset.edit / photo.capture',
    body: z.object({
      deviceId: z.string().min(3).max(100),
      operations: z.array(OperationSchema).min(1).max(500),
    }),
    handler: async ({ ctx, principal, body }) => {
      const results: { opId: string; outcome: SyncDecision['outcome']; detail?: unknown }[] = [];
      for (const raw of body.operations) {
        const allowed = raw.entityType === 'asset' ? ASSET_FIELDS : PHOTO_FIELDS;
        for (const k of Object.keys(raw.changes)) {
          if (!allowed.has(k)) {
            throw new HttpError(
              422,
              'UNKNOWN_FIELD',
              `${raw.entityType} field ${k} cannot be synced`,
            );
          }
        }
        const decision = await ctx.db.transaction(async (tx) => {
          const { job } = await authorizeJob(
            ctx,
            tx,
            principal,
            raw.entityType === 'asset' ? 'asset.edit' : 'photo.capture',
            raw.jobId,
            { forUpdate: true },
          );
          // Photos must belong to an asset of the job in the request (no cross-job attachment).
          if (raw.entityType === 'photo' && raw.parentId)
            await assertAssetInJob(tx, job.id, raw.parentId);
          const applied = await tx.query(
            'SELECT 1 FROM sync_operation WHERE org_id = $1 AND device_id = $2 AND op_id = $3',
            [job.org_id, body.deviceId, raw.opId],
          );
          const current = await loadEntity(tx, raw);
          const dup =
            raw.contentHash && raw.parentId
              ? (
                  await tx.query<{ id: string }>(
                    'SELECT id FROM photo WHERE job_id = $1 AND asset_id = $2 AND sha256 = $3 AND NOT deleted',
                    [job.id, raw.parentId, raw.contentHash],
                  )
                ).rows[0]
              : undefined;
          const op: SyncOperation = {
            opId: raw.opId,
            deviceId: body.deviceId,
            userId: principal.userId,
            entityType: raw.entityType,
            entityId: raw.entityId,
            kind: raw.kind,
            baseVersion: raw.baseVersion,
            changes: raw.changes as Record<string, Json>,
            clientTimestamp: raw.clientTimestamp,
            ...(raw.contentHash ? { contentHash: raw.contentHash } : {}),
            ...(raw.parentId ? { parentId: raw.parentId } : {}),
          };
          const lookup: SyncLookup = {
            hasAppliedOp: () => applied.rows.length > 0,
            getEntity: () => current,
            findByContentHash: () =>
              dup
                ? {
                    entityType: 'photo',
                    entityId: dup.id,
                    version: 1,
                    data: {},
                    fieldVersions: {},
                    deleted: false,
                  }
                : undefined,
            isLocked: () => !isEditable(job.status),
          };
          const d = planSyncOperation(op, lookup);
          if ('next' in d)
            await persist(tx, ctx, job, principal.userId, raw, d.next, current === undefined);
          if (d.outcome === 'conflict') {
            await tx.query(
              'INSERT INTO sync_conflict (id, org_id, op_id, entity_type, entity_id, conflicts, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
              [
                ctx.newId(),
                job.org_id,
                raw.opId,
                raw.entityType,
                raw.entityId,
                JSON.stringify(d.conflicts),
                ctx.clock.now(),
              ],
            );
          }
          if (d.outcome !== 'duplicate_op' && d.outcome !== 'rejected') {
            await tx.query(
              'INSERT INTO sync_operation (op_id, org_id, device_id, user_id, entity_type, entity_id, outcome, received_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
              [
                raw.opId,
                job.org_id,
                body.deviceId,
                principal.userId,
                raw.entityType,
                raw.entityId,
                d.outcome,
                ctx.clock.now(),
              ],
            );
            await touchJob(tx, job.id, ctx.clock.now());
            await audit(tx, ctx, {
              orgId: job.org_id,
              streamId: jobStream(job.id),
              actor: principal,
              action:
                d.outcome === 'conflict' ? 'sync.conflict_detected' : 'sync.operation_applied',
              entityType: raw.entityType,
              entityId: raw.entityId,
              metadata: { opId: raw.opId, deviceId: body.deviceId, outcome: d.outcome },
            });
          }
          return d;
        });
        results.push({
          opId: raw.opId,
          outcome: decision.outcome,
          ...(decision.outcome === 'deduplicated'
            ? { detail: { existingId: decision.existingId } }
            : {}),
          ...(decision.outcome === 'conflict' ? { detail: { conflicts: decision.conflicts } } : {}),
          ...(decision.outcome === 'rejected' ? { detail: { reason: decision.reason } } : {}),
        });
      }
      return { results };
    },
  });
}
