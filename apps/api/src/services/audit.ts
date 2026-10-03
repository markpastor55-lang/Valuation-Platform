import { appendAuditEvent, type AuditEvent, type Json, type Principal } from '@vp/domain';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';

export interface AuditInput {
  readonly orgId: string;
  readonly streamId: string;
  readonly actor: Pick<Principal, 'userId' | 'kind' | 'roles'>;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly reason?: string;
  readonly before?: Json;
  readonly after?: Json;
  readonly metadata?: Record<string, Json>;
}

/** JSON round-trip so the hashed event matches exactly what JSONB stores and returns. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Appends an audit event inside the caller's transaction. A per-stream advisory lock serialises
 * writers so the hash chain never forks; the unique (stream_id, seq) constraint backs this up.
 */
export async function audit(tx: Db, ctx: AppContext, input: AuditInput): Promise<AuditEvent> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.streamId]);
  const { rows } = await tx.query<{ event: AuditEvent }>(
    'SELECT event FROM audit_event WHERE stream_id = $1 ORDER BY seq DESC LIMIT 1',
    [input.streamId],
  );
  const event = appendAuditEvent(
    rows[0]?.event ?? null,
    plain({
      id: ctx.newId(),
      orgId: input.orgId,
      streamId: input.streamId,
      at: ctx.clock.now(),
      actor: { userId: input.actor.userId, kind: input.actor.kind, roles: [...input.actor.roles] },
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.before !== undefined ? { before: input.before } : {}),
      ...(input.after !== undefined ? { after: input.after } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    }),
  );
  await tx.query(
    `INSERT INTO audit_event (id, org_id, stream_id, seq, at, event, action, entity_type, entity_id, actor_id, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      event.id,
      event.orgId,
      event.streamId,
      event.seq,
      event.at,
      JSON.stringify(event),
      event.action,
      event.entityType,
      event.entityId,
      event.actor.userId,
      event.prevHash,
      event.hash,
    ],
  );
  return event;
}

export async function loadStream(db: Db, streamId: string): Promise<AuditEvent[]> {
  const { rows } = await db.query<{ event: AuditEvent }>(
    'SELECT event FROM audit_event WHERE stream_id = $1 ORDER BY seq',
    [streamId],
  );
  return rows.map((r) => r.event);
}

export const jobStream = (jobId: string): string => `job:${jobId}`;
export const orgStream = (orgId: string): string => `org:${orgId}`;
