import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  appendAuditEvent,
  createSnapshot,
  verifyAuditChain,
  verifySnapshot,
  type AuditEvent,
  type AuditEventInput,
} from '../src/index.js';

const input = (n: number, over: Partial<AuditEventInput> = {}): AuditEventInput => ({
  id: `e${n}`,
  orgId: 'org1',
  streamId: 'job:j1',
  at: `2026-10-02T00:00:0${n}Z`,
  actor: { userId: 'valuer1', kind: 'human', roles: ['VALUER'] },
  action: 'field.updated',
  entityType: 'field_value',
  entityId: `fv${n}`,
  after: { value: n },
  ...over,
});

function chain(n: number): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (let i = 1; i <= n; i++) events.push(appendAuditEvent(events.at(-1) ?? null, input(i)));
  return events;
}

describe('audit hash chain', () => {
  it('links events from the genesis hash', () => {
    const events = chain(3);
    expect(events[0]!.prevHash).toBe(GENESIS_HASH);
    expect(events[1]!.prevHash).toBe(events[0]!.hash);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(verifyAuditChain(events)).toEqual({ valid: true, count: 3, headHash: events[2]!.hash });
  });

  it('detects edited content', () => {
    const events = chain(3);
    const tampered = [...events];
    tampered[1] = { ...events[1]!, after: { value: 999 } };
    expect(verifyAuditChain(tampered)).toMatchObject({ valid: false, brokenAtSeq: 2 });
  });

  it('detects deletion and re-ordering', () => {
    const events = chain(4);
    expect(verifyAuditChain([events[0]!, events[2]!, events[3]!])).toMatchObject({
      valid: false,
      brokenAtSeq: 2,
    });
    expect(verifyAuditChain([events[1]!, events[0]!])).toMatchObject({
      valid: false,
      brokenAtSeq: 1,
    });
  });

  it('detects a recomputed hash that breaks the next back-link', () => {
    const events = chain(3);
    const forged = appendAuditEvent(events[0]!, { ...input(2), reason: 'forged' });
    expect(verifyAuditChain([events[0]!, forged, events[2]!])).toMatchObject({
      valid: false,
      brokenAtSeq: 3,
      reason: 'back-link does not match previous hash',
    });
  });

  it('rejects malformed actions and cross-stream appends', () => {
    expect(() => appendAuditEvent(null, input(1, { action: 'Updated' }))).toThrow(/entity.verb/);
    const first = appendAuditEvent(null, input(1));
    expect(() => appendAuditEvent(first, input(2, { streamId: 'job:j2' }))).toThrow(
      /different stream/,
    );
  });
});

describe('snapshots', () => {
  it('hashes canonical content and detects modification', () => {
    const s = createSnapshot({ b: [1, 2], a: 'x' });
    expect(verifySnapshot(s)).toBe(true);
    expect(createSnapshot({ a: 'x', b: [1, 2] }).hash).toBe(s.hash);
    expect(verifySnapshot({ ...s, data: { a: 'y', b: [1, 2] } })).toBe(false);
  });
});
