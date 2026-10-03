import type { Instant } from '../core/dates.js';
import { DomainError } from '../core/errors.js';
import { hashCanonical } from '../core/hash.js';
import type { Json } from '../core/canonical-json.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditActorRef {
  readonly userId: string;
  readonly kind: 'human' | 'system' | 'ai';
  readonly roles: readonly string[];
}

/** Input for a new audit event; sequence and hashes are assigned by `appendAuditEvent`. */
export interface AuditEventInput {
  readonly id: string;
  readonly orgId: string;
  /** Chain the event belongs to, e.g. `job:<id>` or `org:<id>`. */
  readonly streamId: string;
  readonly at: Instant;
  readonly actor: AuditActorRef;
  /** `<entity>.<past_tense_verb>` — see docs/spec/00 §8. */
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly reason?: string;
  readonly before?: Json;
  readonly after?: Json;
  readonly metadata?: Readonly<Record<string, Json>>;
}

export interface AuditEvent extends AuditEventInput {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

const ACTION_RE = /^[a-z_]+\.[a-z_]+$/;

function eventHash(event: Omit<AuditEvent, 'hash'>): string {
  return hashCanonical(event);
}

/**
 * Appends an event to a hash chain. Each event commits to its predecessor's hash, so editing,
 * deleting or re-ordering any stored event is detectable by `verifyAuditChain`.
 */
export function appendAuditEvent(previous: AuditEvent | null, input: AuditEventInput): AuditEvent {
  if (!ACTION_RE.test(input.action)) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `audit action must look like entity.verb: ${input.action}`,
    );
  }
  if (previous && previous.streamId !== input.streamId) {
    throw new DomainError('INVALID_ARGUMENT', 'previous event belongs to a different stream');
  }
  const unsigned: Omit<AuditEvent, 'hash'> = {
    ...input,
    seq: previous ? previous.seq + 1 : 1,
    prevHash: previous ? previous.hash : GENESIS_HASH,
  };
  return { ...unsigned, hash: eventHash(unsigned) };
}

export type AuditVerification =
  | { readonly valid: true; readonly count: number; readonly headHash: string }
  | { readonly valid: false; readonly brokenAtSeq: number; readonly reason: string };

/** Verifies an ordered stream: sequence continuity, back-links and every event's hash. */
export function verifyAuditChain(events: readonly AuditEvent[]): AuditVerification {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as AuditEvent;
    if (e.seq !== i + 1)
      return { valid: false, brokenAtSeq: i + 1, reason: `expected seq ${i + 1}, found ${e.seq}` };
    if (i > 0 && e.streamId !== (events[0] as AuditEvent).streamId) {
      return { valid: false, brokenAtSeq: e.seq, reason: 'event from another stream' };
    }
    if (e.prevHash !== prevHash)
      return { valid: false, brokenAtSeq: e.seq, reason: 'back-link does not match previous hash' };
    const { hash, ...unsigned } = e;
    if (eventHash(unsigned) !== hash)
      return { valid: false, brokenAtSeq: e.seq, reason: 'event content does not match its hash' };
    prevHash = hash;
  }
  return { valid: true, count: events.length, headHash: prevHash };
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export interface Snapshot<T> {
  readonly data: T;
  readonly hash: string;
  readonly canonicalVersion: number;
}

/** Freezes a value with its canonical hash (used for QA submission, approval and issue). */
export function createSnapshot<T>(data: T): Snapshot<T> {
  return { data, hash: hashCanonical(data), canonicalVersion: 1 };
}

export const verifySnapshot = <T>(snapshot: Snapshot<T>): boolean =>
  hashCanonical(snapshot.data) === snapshot.hash;
