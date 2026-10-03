import type { Json } from '../core/canonical-json.js';
import { canonicalJson } from '../core/canonical-json.js';
import type { Instant } from '../core/dates.js';

/**
 * Offline-first synchronisation. Devices create records with client-generated UUIDs and send
 * operations; the server plans each operation against current state. Replays are idempotent,
 * photos are de-duplicated by content hash, and concurrent edits are merged field-by-field,
 * surfacing true conflicts for a person to resolve rather than silently overwriting evidence.
 */
export interface SyncOperation {
  readonly opId: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly kind: 'create' | 'update' | 'delete';
  /** Version the client last saw; `null` for creates. */
  readonly baseVersion: number | null;
  readonly changes: Readonly<Record<string, Json>>;
  readonly clientTimestamp: Instant;
  /** SHA-256 of binary content (photos, documents) for de-duplication. */
  readonly contentHash?: string;
  /** Owning record, e.g. the asset a photo belongs to. */
  readonly parentId?: string;
}

export interface EntityState {
  readonly entityType: string;
  readonly entityId: string;
  readonly version: number;
  readonly data: Readonly<Record<string, Json>>;
  /** Version at which each field last changed. */
  readonly fieldVersions: Readonly<Record<string, number>>;
  readonly deleted: boolean;
  readonly contentHash?: string;
  readonly parentId?: string;
}

export interface SyncLookup {
  hasAppliedOp(opId: string): boolean;
  getEntity(entityType: string, entityId: string): EntityState | undefined;
  findByContentHash(
    entityType: string,
    parentId: string | undefined,
    contentHash: string,
  ): EntityState | undefined;
  /** True when the owning job is locked (submitted, in review, approved or issued). */
  isLocked?(entityType: string, entityId: string, parentId: string | undefined): boolean;
}

export type FieldConflictPolicy = 'manual' | 'client_wins' | 'server_wins';

export interface SyncPolicy {
  fieldPolicy?(entityType: string, field: string): FieldConflictPolicy;
  /** Entity types de-duplicated by content hash. */
  readonly contentAddressedTypes?: readonly string[];
}

export const DEFAULT_SYNC_POLICY: SyncPolicy = {
  fieldPolicy: () => 'manual',
  contentAddressedTypes: ['photo', 'document', 'source_plan'],
};

export interface FieldConflict {
  readonly field: string;
  readonly serverValue: Json | undefined;
  readonly clientValue: Json;
  readonly serverFieldVersion: number;
}

export type SyncDecision =
  | { readonly outcome: 'duplicate_op' }
  | {
      readonly outcome: 'applied';
      readonly next: EntityState;
      readonly changedFields: readonly string[];
    }
  | {
      readonly outcome: 'merged';
      readonly next: EntityState;
      readonly changedFields: readonly string[];
    }
  | { readonly outcome: 'deduplicated'; readonly existingId: string }
  | {
      readonly outcome: 'conflict';
      readonly conflicts: readonly FieldConflict[];
      /** Non-conflicting changes applied (if any); conflicting fields keep server values. */
      readonly next?: EntityState;
      readonly changedFields: readonly string[];
    }
  | { readonly outcome: 'rejected'; readonly reason: string };

const same = (a: Json | undefined, b: Json | undefined): boolean =>
  a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b);

function applyChanges(
  current: EntityState,
  changes: Readonly<Record<string, Json>>,
): { next: EntityState; changed: string[] } {
  const version = current.version + 1;
  const data: Record<string, Json> = { ...current.data };
  const fieldVersions: Record<string, number> = { ...current.fieldVersions };
  const changed: string[] = [];
  for (const [field, value] of Object.entries(changes)) {
    if (same(data[field], value)) continue;
    data[field] = value;
    fieldVersions[field] = version;
    changed.push(field);
  }
  return {
    next: { ...current, version: changed.length ? version : current.version, data, fieldVersions },
    changed,
  };
}

/** Plans (but does not persist) the effect of one operation. Pure and deterministic. */
export function planSyncOperation(
  op: SyncOperation,
  lookup: SyncLookup,
  policy: SyncPolicy = DEFAULT_SYNC_POLICY,
): SyncDecision {
  if (lookup.hasAppliedOp(op.opId)) return { outcome: 'duplicate_op' };
  if (lookup.isLocked?.(op.entityType, op.entityId, op.parentId)) {
    return {
      outcome: 'rejected',
      reason: 'record is locked for QA or issued; changes must be made in an amendment',
    };
  }
  const current = lookup.getEntity(op.entityType, op.entityId);

  if (op.kind === 'create') {
    if (!current) {
      if (op.contentHash && (policy.contentAddressedTypes ?? []).includes(op.entityType)) {
        const existing = lookup.findByContentHash(op.entityType, op.parentId, op.contentHash);
        if (existing && !existing.deleted)
          return { outcome: 'deduplicated', existingId: existing.entityId };
      }
      const fieldVersions = Object.fromEntries(Object.keys(op.changes).map((k) => [k, 1]));
      return {
        outcome: 'applied',
        next: {
          entityType: op.entityType,
          entityId: op.entityId,
          version: 1,
          data: { ...op.changes },
          fieldVersions,
          deleted: false,
          ...(op.contentHash ? { contentHash: op.contentHash } : {}),
          ...(op.parentId ? { parentId: op.parentId } : {}),
        },
        changedFields: Object.keys(op.changes),
      };
    }
    // Same id already exists: a retried create with a new op id. Identical content is a no-op.
    const differing = Object.entries(op.changes).filter(([k, v]) => !same(current.data[k], v));
    if (differing.length === 0) return { outcome: 'duplicate_op' };
    return planUpdate({ ...op, kind: 'update', baseVersion: 0 }, current, policy);
  }

  if (!current) return { outcome: 'rejected', reason: `unknown ${op.entityType} ${op.entityId}` };
  if (op.baseVersion === null || op.baseVersion > current.version) {
    return { outcome: 'rejected', reason: 'base version is newer than the server version' };
  }

  if (op.kind === 'delete') {
    if (current.deleted) return { outcome: 'duplicate_op' };
    const changedSince = Object.entries(current.fieldVersions).filter(
      ([, v]) => v > (op.baseVersion as number),
    );
    if (changedSince.length > 0) {
      return {
        outcome: 'conflict',
        conflicts: changedSince.map(([field, v]) => ({
          field,
          serverValue: current.data[field],
          clientValue: null,
          serverFieldVersion: v,
        })),
        changedFields: [],
      };
    }
    return {
      outcome: 'applied',
      next: { ...current, version: current.version + 1, deleted: true },
      changedFields: [],
    };
  }

  if (current.deleted) {
    return {
      outcome: 'conflict',
      conflicts: [
        {
          field: '__deleted',
          serverValue: true,
          clientValue: false,
          serverFieldVersion: current.version,
        },
      ],
      changedFields: [],
    };
  }
  return planUpdate(op, current, policy);
}

function planUpdate(op: SyncOperation, current: EntityState, policy: SyncPolicy): SyncDecision {
  const base = op.baseVersion ?? 0;
  if (base === current.version) {
    const { next, changed } = applyChanges(current, op.changes);
    return { outcome: 'applied', next, changedFields: changed };
  }
  const accepted: Record<string, Json> = {};
  const conflicts: FieldConflict[] = [];
  for (const [field, value] of Object.entries(op.changes)) {
    const serverFieldVersion = current.fieldVersions[field] ?? 0;
    const serverChanged = serverFieldVersion > base;
    if (!serverChanged || same(current.data[field], value)) {
      accepted[field] = value;
      continue;
    }
    const rule = policy.fieldPolicy?.(op.entityType, field) ?? 'manual';
    if (rule === 'client_wins') accepted[field] = value;
    else if (rule === 'manual')
      conflicts.push({
        field,
        serverValue: current.data[field],
        clientValue: value,
        serverFieldVersion,
      });
    // server_wins: drop the client value silently only for fields configured that way
  }
  const { next, changed } = applyChanges(current, accepted);
  if (conflicts.length) {
    return {
      outcome: 'conflict',
      conflicts,
      ...(changed.length ? { next } : {}),
      changedFields: changed,
    };
  }
  return { outcome: 'merged', next, changedFields: changed };
}

/** In-memory lookup used by tests and the mobile client's local replay. */
export class InMemorySyncStore implements SyncLookup {
  private readonly ops = new Set<string>();
  private readonly entities = new Map<string, EntityState>();
  private readonly locked = new Set<string>();

  hasAppliedOp(opId: string): boolean {
    return this.ops.has(opId);
  }
  getEntity(entityType: string, entityId: string): EntityState | undefined {
    return this.entities.get(`${entityType}:${entityId}`);
  }
  findByContentHash(
    entityType: string,
    parentId: string | undefined,
    contentHash: string,
  ): EntityState | undefined {
    return [...this.entities.values()].find(
      (e) =>
        e.entityType === entityType && e.parentId === parentId && e.contentHash === contentHash,
    );
  }
  isLocked(_entityType: string, _entityId: string, parentId: string | undefined): boolean {
    return parentId !== undefined && this.locked.has(parentId);
  }
  lock(parentId: string): void {
    this.locked.add(parentId);
  }
  /** Plans and commits an operation, recording the op id for idempotency. */
  apply(op: SyncOperation, policy?: SyncPolicy): SyncDecision {
    const decision = planSyncOperation(op, this, policy);
    if (decision.outcome !== 'rejected' && decision.outcome !== 'duplicate_op')
      this.ops.add(op.opId);
    if ('next' in decision) {
      this.entities.set(`${decision.next.entityType}:${decision.next.entityId}`, decision.next);
    }
    return decision;
  }
  all(entityType: string): EntityState[] {
    return [...this.entities.values()].filter((e) => e.entityType === entityType && !e.deleted);
  }
}
