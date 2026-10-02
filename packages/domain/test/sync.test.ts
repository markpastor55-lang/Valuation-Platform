import { describe, expect, it } from 'vitest';
import { InMemorySyncStore, type SyncOperation } from '../src/index.js';

const op = (over: Partial<SyncOperation>): SyncOperation => ({
  opId: 'op1',
  deviceId: 'd1',
  userId: 'u1',
  entityType: 'asset',
  entityId: 'a1',
  kind: 'create',
  baseVersion: null,
  changes: { address: '1 Example St', 'land.area': 650 },
  clientTimestamp: '2026-10-02T00:00:00Z',
  ...over,
});

describe('offline sync', () => {
  it('replaying the same operation is idempotent (no duplicate assets)', () => {
    const store = new InMemorySyncStore();
    expect(store.apply(op({})).outcome).toBe('applied');
    expect(store.apply(op({})).outcome).toBe('duplicate_op');
    // Same asset created again under a new op id after a lost acknowledgement
    expect(store.apply(op({ opId: 'op1-retry' })).outcome).toBe('duplicate_op');
    expect(store.all('asset')).toHaveLength(1);
  });

  it('de-duplicates photos by content hash within an asset', () => {
    const store = new InMemorySyncStore();
    const photo = (opId: string, entityId: string, parentId = 'a1') =>
      op({
        opId,
        entityType: 'photo',
        entityId,
        contentHash: 'sha-abc',
        parentId,
        changes: { caption: 'Kitchen' },
      });
    expect(store.apply(photo('p-op1', 'p1')).outcome).toBe('applied');
    expect(store.apply(photo('p-op2', 'p2'))).toEqual({
      outcome: 'deduplicated',
      existingId: 'p1',
    });
    expect(store.apply(photo('p-op3', 'p3', 'a2')).outcome).toBe('applied');
    expect(store.all('photo')).toHaveLength(2);
  });

  it('applies updates at the current version', () => {
    const store = new InMemorySyncStore();
    store.apply(op({}));
    const r = store.apply(
      op({ opId: 'op2', kind: 'update', baseVersion: 1, changes: { 'land.area': 655 } }),
    );
    expect(r).toMatchObject({ outcome: 'applied', changedFields: ['land.area'] });
    expect(store.getEntity('asset', 'a1')?.version).toBe(2);
  });

  it('merges concurrent edits to different fields', () => {
    const store = new InMemorySyncStore();
    store.apply(op({}));
    store.apply(
      op({
        opId: 'tablet',
        deviceId: 'd2',
        kind: 'update',
        baseVersion: 1,
        changes: { 'land.area': 651 },
      }),
    );
    const phone = store.apply(
      op({
        opId: 'phone',
        kind: 'update',
        baseVersion: 1,
        changes: { address: '1 Example Street' },
      }),
    );
    expect(phone).toMatchObject({ outcome: 'merged', changedFields: ['address'] });
    expect(store.getEntity('asset', 'a1')?.data).toEqual({
      address: '1 Example Street',
      'land.area': 651,
    });
  });

  it('surfaces conflicting edits to the same field instead of overwriting', () => {
    const store = new InMemorySyncStore();
    store.apply(op({}));
    store.apply(
      op({ opId: 'tablet', kind: 'update', baseVersion: 1, changes: { 'land.area': 651 } }),
    );
    const r = store.apply(
      op({
        opId: 'phone',
        kind: 'update',
        baseVersion: 1,
        changes: { 'land.area': 700, address: '1 Example Street' },
      }),
    );
    expect(r.outcome).toBe('conflict');
    if (r.outcome !== 'conflict') return;
    expect(r.conflicts).toEqual([
      { field: 'land.area', serverValue: 651, clientValue: 700, serverFieldVersion: 2 },
    ]);
    expect(r.changedFields).toEqual(['address']);
    expect(store.getEntity('asset', 'a1')?.data['land.area']).toBe(651);
  });

  it('honours client-wins policy for non-material fields', () => {
    const store = new InMemorySyncStore();
    store.apply(op({ changes: { caption: 'a' } }));
    store.apply(op({ opId: 'x', kind: 'update', baseVersion: 1, changes: { caption: 'b' } }));
    const r = store.apply(
      op({ opId: 'y', kind: 'update', baseVersion: 1, changes: { caption: 'c' } }),
      {
        fieldPolicy: (_t, f) => (f === 'caption' ? 'client_wins' : 'manual'),
      },
    );
    expect(r.outcome).toBe('merged');
    expect(store.getEntity('asset', 'a1')?.data['caption']).toBe('c');
  });

  it('detects update-after-delete and delete-after-update conflicts', () => {
    const store = new InMemorySyncStore();
    store.apply(op({}));
    store.apply(op({ opId: 'edit', kind: 'update', baseVersion: 1, changes: { 'land.area': 1 } }));
    expect(
      store.apply(op({ opId: 'del', kind: 'delete', baseVersion: 1, changes: {} })).outcome,
    ).toBe('conflict');
    expect(
      store.apply(op({ opId: 'del2', kind: 'delete', baseVersion: 2, changes: {} })).outcome,
    ).toBe('applied');
    expect(
      store.apply(op({ opId: 'late', kind: 'update', baseVersion: 2, changes: { address: 'x' } }))
        .outcome,
    ).toBe('conflict');
  });

  it('rejects edits to locked jobs and unknown or future versions', () => {
    const store = new InMemorySyncStore();
    store.apply(op({ parentId: 'job1' }));
    expect(
      store.apply(op({ opId: 'f', kind: 'update', baseVersion: 9, changes: { address: 'x' } }))
        .outcome,
    ).toBe('rejected');
    expect(
      store.apply(op({ opId: 'u', kind: 'update', entityId: 'nope', baseVersion: 1 })).outcome,
    ).toBe('rejected');
    store.lock('job1');
    const locked = store.apply(
      op({
        opId: 'l',
        kind: 'update',
        baseVersion: 1,
        parentId: 'job1',
        changes: { address: 'x' },
      }),
    );
    expect(locked).toMatchObject({
      outcome: 'rejected',
      reason: expect.stringContaining('locked'),
    });
  });
});
