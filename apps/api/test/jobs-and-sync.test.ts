import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, createTestApp, newJobBody, type TestApp } from './helpers.js';

describe('selection changes, portfolios and offline sync', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('changing purpose updates requirements and sections without losing captured data', async () => {
    const job = await t.call<{ id: string; assets: { id: string }[] }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody({
        selection: {
          jurisdiction: 'VIC',
          purpose: 'CGT_RETROSPECTIVE',
          propertyType: 'RESIDENTIAL',
          scope: 'FULL',
          mode: 'SINGLE',
        },
      }),
    );
    expect(job.status).toBe(200);
    const put = await t.call('valuer', 'PUT', `/v1/jobs/${job.body.id}/fields`, {
      values: [
        { fieldId: 'cgt.taxEvent', assetId: null, value: 'Event nominated by the adviser' },
        { fieldId: 'land.area', assetId: job.body.assets[0]!.id, value: 650 },
      ],
    });
    expect(put.status).toBe(200);
    const change = await t.call<{
      diff: {
        noLongerRequired: string[];
        newlyRequired: string[];
        sectionsRemoved: string[];
        retainedValues: { fieldId: string }[];
      };
    }>('valuer', 'PATCH', `/v1/jobs/${job.body.id}/selection`, {
      selection: {
        jurisdiction: 'VIC',
        purpose: 'MARKET_VALUE',
        propertyType: 'RESIDENTIAL',
        scope: 'FULL',
        mode: 'SINGLE',
      },
      reason: 'Client changed instructions',
    });
    expect(change.status).toBe(200);
    expect(change.body.diff.noLongerRequired).toContain('cgt.taxEvent');
    expect(change.body.diff.newlyRequired).toContain('valuation.marketability');
    expect(change.body.diff.sectionsRemoved).toContain('tax_context');
    expect(change.body.diff.retainedValues.map((v) => v.fieldId)).toContain('cgt.taxEvent');
    const req = await t.call<{ requirements: { sections: string[] } }>(
      'valuer',
      'GET',
      `/v1/jobs/${job.body.id}/requirements`,
    );
    expect(req.body.requirements.sections).not.toContain('tax_context');
    const back = await t.call<{ diff: { newlyRequired: string[] } }>(
      'valuer',
      'PATCH',
      `/v1/jobs/${job.body.id}/selection`,
      {
        selection: {
          jurisdiction: 'VIC',
          purpose: 'CGT_RETROSPECTIVE',
          propertyType: 'RESIDENTIAL',
          scope: 'FULL',
          mode: 'SINGLE',
        },
        reason: 'Back to CGT',
      },
    );
    expect(back.body.diff.newlyRequired).toContain('cgt.taxEvent');
    const missing = await t.call<{ missing: { fieldId: string }[] }>(
      'valuer',
      'GET',
      `/v1/jobs/${job.body.id}/requirements`,
    );
    expect(missing.body.missing.map((m) => m.fieldId)).not.toContain('cgt.taxEvent');
  });

  it('enforces single-asset mode and supports portfolio jobs', async () => {
    const two = [
      newJobBody().assets[0],
      {
        label: 'Second',
        address: { formatted: '12 Sample Road, Exampleton VIC 3000' },
        latitude: -37.82,
        longitude: 144.97,
      },
    ];
    expect(
      (await t.call('allocator', 'POST', '/v1/jobs', newJobBody({ assets: two }))).status,
    ).toBe(422);
    const pf = await t.call<{ id: string; assets: unknown[] }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody({
        assets: two,
        selection: {
          jurisdiction: 'NSW',
          purpose: 'MARKET_VALUE',
          propertyType: 'RESIDENTIAL',
          scope: 'DESKTOP',
          mode: 'PORTFOLIO',
        },
      }),
    );
    expect(pf.status).toBe(200);
    expect(pf.body.assets).toHaveLength(2);
    const map = await t.call<{ features: { properties: { jobId: string } }[] }>(
      'valuer',
      'GET',
      `/v1/map/assets?jobId=${pf.body.id}`,
    );
    expect(map.body.features).toHaveLength(2);
  });

  it('hides restricted-portfolio jobs from non-members', async () => {
    const job = await t.call<{ id: string }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody({
        portfolioId: DEMO.restrictedPortfolioId,
        responsibleValuerId: DEMO.users.valuer2,
      }),
    );
    // allocator is not a member of the restricted portfolio
    expect(job.status).toBe(404);
  });

  it('replays offline operations without duplicate assets or photos', async () => {
    const job = await t.call<{ id: string; assets: { id: string }[] }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody({
        selection: {
          jurisdiction: 'VIC',
          purpose: 'MARKET_VALUE',
          propertyType: 'RESIDENTIAL',
          scope: 'FULL',
          mode: 'PORTFOLIO',
        },
      }),
    );
    const jobId = job.body.id;
    const assetId = '22222222-2222-4222-8222-222222222222';
    const createAsset = {
      opId: 'device1-op-0001',
      jobId,
      entityType: 'asset',
      entityId: assetId,
      kind: 'create',
      baseVersion: null,
      changes: {
        label: 'Rear unit',
        address: { formatted: '10A Sample Road' },
        latitude: -37.811,
        longitude: 144.961,
      },
      clientTimestamp: '2026-10-01T23:00:00Z',
    };
    const photo = (opId: string, entityId: string) => ({
      opId,
      jobId,
      entityType: 'photo',
      entityId,
      kind: 'create',
      baseVersion: null,
      changes: { caption: 'Facade', sequence: 1, capturedAt: '2026-10-01T23:05:00Z' },
      clientTimestamp: '2026-10-01T23:05:00Z',
      contentHash: 'b'.repeat(64),
      parentId: assetId,
    });
    const first = await t.call<{ results: { outcome: string }[] }>(
      'inspector',
      'POST',
      '/v1/sync',
      {
        deviceId: 'device-1',
        operations: [createAsset, photo('device1-op-0002', '33333333-3333-4333-8333-333333333333')],
      },
    );
    expect(first.status).toBe(200);
    expect(first.body.results.map((r) => r.outcome)).toEqual(['applied', 'applied']);
    // connection dropped before the acknowledgement: the device replays everything, and a
    // second device captured the same photo under a different id
    const replay = await t.call<{
      results: { outcome: string; detail?: { existingId: string } }[];
    }>('inspector', 'POST', '/v1/sync', {
      deviceId: 'device-1',
      operations: [
        createAsset,
        photo('device1-op-0002', '33333333-3333-4333-8333-333333333333'),
        photo('device2-op-0001', '44444444-4444-4444-8444-444444444444'),
      ],
    });
    expect(replay.body.results.map((r) => r.outcome)).toEqual([
      'duplicate_op',
      'duplicate_op',
      'deduplicated',
    ]);
    expect(replay.body.results[2]!.detail?.existingId).toBe('33333333-3333-4333-8333-333333333333');
    const assets = await t.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM asset WHERE job_id = $1',
      [jobId],
    );
    const photos = await t.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM photo WHERE job_id = $1',
      [jobId],
    );
    expect(assets.rows[0]!.n).toBe(2);
    expect(photos.rows[0]!.n).toBe(1);
  });

  it('merges concurrent edits to different fields and surfaces same-field conflicts', async () => {
    const job = await t.call<{ id: string; assets: { id: string; version: number }[] }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody(),
    );
    const jobId = job.body.id;
    const asset = job.body.assets[0]!;
    const op = (opId: string, changes: Record<string, unknown>) => ({
      opId,
      jobId,
      entityType: 'asset',
      entityId: asset.id,
      kind: 'update',
      baseVersion: asset.version,
      changes,
      clientTimestamp: '2026-10-01T23:00:00Z',
    });
    const r = await t.call<{
      results: { outcome: string; detail?: { conflicts: { field: string }[] } }[];
    }>('inspector', 'POST', '/v1/sync', {
      deviceId: 'tablet',
      operations: [
        op('tablet-0001', { label: 'House' }),
        op('phone-0001', { latitude: -37.8105 }),
        op('phone-0002', { label: 'Dwelling' }),
      ],
    });
    expect(r.body.results.map((x) => x.outcome)).toEqual(['applied', 'merged', 'conflict']);
    expect(r.body.results[2]!.detail?.conflicts.map((c) => c.field)).toEqual(['label']);
    const conflicts = await t.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM sync_conflict WHERE op_id = 'phone-0002'",
    );
    expect(conflicts.rows[0]!.n).toBe(1);
  });

  it('rejects sync changes once the job is locked', async () => {
    const job = await t.call<{ id: string; assets: { id: string; version: number }[] }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody(),
    );
    await t.db.query("UPDATE job SET status = 'submitted' WHERE id = $1", [job.body.id]);
    const r = await t.call<{ results: { outcome: string }[] }>('inspector', 'POST', '/v1/sync', {
      deviceId: 'tablet',
      operations: [
        {
          opId: 'late-0001',
          jobId: job.body.id,
          entityType: 'asset',
          entityId: job.body.assets[0]!.id,
          kind: 'update',
          baseVersion: 1,
          changes: { label: 'x' },
          clientTimestamp: '2026-10-01T23:00:00Z',
        },
      ],
    });
    expect(r.body.results[0]!.outcome).toBe('rejected');
  });
});
