import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, createTestApp, newJobBody, type TestApp } from './helpers.js';

/** Regressions for issues found in code review: actor limits, judgement fields, sync, tenancy. */
describe('review hardening', () => {
  let t: TestApp;
  let jobId: string;
  let assetId: string;
  beforeAll(async () => {
    t = await createTestApp();
    const job = await t.call<{ id: string; assets: { id: string }[] }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody(),
    );
    jobId = job.body.id;
    assetId = job.body.assets[0]!.id;
  });
  afterAll(async () => t.close());

  it('AI and service accounts can only call the routes opened to them', async () => {
    const fields = await t.call<{ error: { code: string } }>(
      'aiService',
      'PUT',
      `/v1/jobs/${jobId}/fields`,
      { values: [{ fieldId: 'land.area', assetId, value: 900 }] },
      { kind: 'ai' },
    );
    expect(fields.status).toBe(403);
    expect(fields.body.error.code).toBe('ACTOR_NOT_PERMITTED');
    const sketch = await t.call(
      'aiService',
      'POST',
      `/v1/jobs/${jobId}/assets/${assetId}/sketches`,
      { changeSummary: 'x' },
      { kind: 'ai' },
    );
    expect(sketch.status).toBe(403);
    const sec = await t.call<{ events: { action: string; metadata?: { code: string } }[] }>(
      'admin',
      'GET',
      '/v1/admin/security-events',
    );
    expect(
      sec.body.events.some(
        (e) => e.action === 'auth.denied' && e.metadata?.code === 'ACTOR_NOT_PERMITTED',
      ),
    ).toBe(true);
  });

  it('only valuers record professional judgement; inspectors capture facts', async () => {
    const judgement = await t.call<{ error: { code: string } }>(
      'inspector',
      'PUT',
      `/v1/jobs/${jobId}/fields`,
      { values: [{ fieldId: 'valuation.adoptedValue', assetId, value: 2_000_000 }] },
    );
    expect(judgement.status).toBe(403);
    const fact = await t.call('inspector', 'PUT', `/v1/jobs/${jobId}/fields`, {
      values: [{ fieldId: 'improvements.condition', assetId, value: 'Good' }],
    });
    expect(fact.status).toBe(200);
    const valuer = await t.call('valuer', 'PUT', `/v1/jobs/${jobId}/fields`, {
      values: [{ fieldId: 'valuation.adoptedValue', assetId, value: 1_150_000 }],
    });
    expect(valuer.status).toBe(200);
  });

  it('only the valuer can accept or resolve a risk flag, and the map risk follows', async () => {
    const flag = await t.call<{ id: string }>('inspector', 'POST', `/v1/jobs/${jobId}/risk-flags`, {
      assetId,
      category: 'environmental',
      description: 'Flood overlay',
      severity: 'high',
      requiresEscalation: true,
    });
    expect(flag.status).toBe(200);
    const close = {
      id: flag.body.id,
      assetId,
      category: 'environmental',
      description: 'Flood overlay',
      severity: 'high',
      requiresEscalation: true,
      status: 'accepted',
      resolutionNote: 'Floor level above flood level per survey',
    };
    expect((await t.call('inspector', 'POST', `/v1/jobs/${jobId}/risk-flags`, close)).status).toBe(
      403,
    );
    const map1 = await t.call<{ features: { properties: { risk: string } }[] }>(
      'valuer',
      'GET',
      `/v1/map/assets?jobId=${jobId}`,
    );
    expect(map1.body.features[0]!.properties.risk).toBe('high');
    expect((await t.call('valuer', 'POST', `/v1/jobs/${jobId}/risk-flags`, close)).status).toBe(
      200,
    );
    const map2 = await t.call<{ features: { properties: { risk: string } }[] }>(
      'valuer',
      'GET',
      `/v1/map/assets?jobId=${jobId}`,
    );
    expect(map2.body.features[0]!.properties.risk).toBe('none');
  });

  it('sync cannot change photo privacy state or attach photos to another job', async () => {
    const photo = await t.call<{ id: string }>('inspector', 'POST', `/v1/jobs/${jobId}/photos`, {
      assetId,
      sha256: 'e'.repeat(64),
      sequence: 1,
      capturedAt: '2026-10-01T00:00:00Z',
    });
    await t.call('inspector', 'POST', `/v1/jobs/${jobId}/photos/${photo.body.id}/privacy`, {
      action: 'flag',
      flags: ['child'],
    });
    const bypass = await t.call<{ error: { code: string } }>('inspector', 'POST', '/v1/sync', {
      deviceId: 'tablet-1',
      operations: [
        {
          opId: 'priv-0001',
          jobId,
          entityType: 'photo',
          entityId: photo.body.id,
          kind: 'update',
          baseVersion: 2,
          changes: { privacyStatus: 'clear', privacyFlags: [] },
          clientTimestamp: '2026-10-01T00:00:00Z',
        },
      ],
    });
    expect(bypass.status).toBe(422);
    expect(bypass.body.error.code).toBe('UNKNOWN_FIELD');

    const other = await t.call<{ id: string; assets: { id: string }[] }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody(),
    );
    const foreign = await t.call<{ error: { code: string } }>('inspector', 'POST', '/v1/sync', {
      deviceId: 'tablet-1',
      operations: [
        {
          opId: 'foreign-0001',
          jobId,
          entityType: 'photo',
          entityId: '66666666-6666-4666-8666-666666666666',
          kind: 'create',
          baseVersion: null,
          changes: { caption: 'x' },
          clientTimestamp: '2026-10-01T00:00:00Z',
          contentHash: 'f'.repeat(64),
          parentId: other.body.assets[0]!.id,
        },
      ],
    });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error.code).toBe('UNKNOWN_ASSET');
  });

  it('scopes sync idempotency to the device', async () => {
    const op = (deviceId: string, entityId: string) => ({
      deviceId,
      operations: [
        {
          opId: 'same-op-id-0001',
          jobId,
          entityType: 'asset',
          entityId,
          kind: 'create',
          baseVersion: null,
          changes: { label: 'Unit', address: { formatted: '1 Unit St' } },
          clientTimestamp: '2026-10-01T00:00:00Z',
        },
      ],
    });
    await t.db.query("UPDATE job SET mode = 'PORTFOLIO' WHERE id = $1", [jobId]);
    const a = await t.call<{ results: { outcome: string }[] }>(
      'inspector',
      'POST',
      '/v1/sync',
      op('device-a', '77777777-7777-4777-8777-777777777777'),
    );
    const b = await t.call<{ results: { outcome: string }[] }>(
      'inspector',
      'POST',
      '/v1/sync',
      op('device-b', '88888888-8888-4888-8888-888888888888'),
    );
    expect([a.body.results[0]!.outcome, b.body.results[0]!.outcome]).toEqual([
      'applied',
      'applied',
    ]);
  });

  it('rejects clients and assignees from another organisation', async () => {
    await t.db.query(
      "INSERT INTO organisation (id, name) VALUES ('99999999-9999-4999-8999-999999999999', 'Other firm')",
    );
    await t.db.query(
      "INSERT INTO client (id, org_id, name) VALUES ('99999999-9999-4999-8999-999999999998', '99999999-9999-4999-8999-999999999999', 'Other client')",
    );
    const foreignClient = await t.call<{ error: { code: string } }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody({ clientId: '99999999-9999-4999-8999-999999999998' }),
    );
    expect(foreignClient.status).toBe(422);
    expect(foreignClient.body.error.code).toBe('UNKNOWN_CLIENT');
    const wrongRole = await t.call<{ error: { code: string } }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody({ responsibleValuerId: DEMO.users.finance }),
    );
    expect(wrongRole.status).toBe(422);
    expect(wrongRole.body.error.code).toBe('ROLE_REQUIRED');
  });

  it('records hidden cross-barrier attempts while returning 404', async () => {
    const res = await t.call(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody({
        portfolioId: DEMO.restrictedPortfolioId,
        responsibleValuerId: DEMO.users.valuer2,
      }),
    );
    expect(res.status).toBe(404);
    const sec = await t.call<{ events: { action: string; metadata?: { code: string } }[] }>(
      'admin',
      'GET',
      '/v1/admin/security-events',
    );
    expect(sec.body.events.some((e) => e.metadata?.code === 'RESTRICTED_PORTFOLIO')).toBe(true);
  });

  it('only the responsible valuer answers QA findings', async () => {
    const res = await t.call<{ error: { code: string } }>(
      'allocator',
      'POST',
      `/v1/jobs/${jobId}/qa/findings/f1/respond`,
      { response: 'Answered by allocator' },
    );
    expect([403, 409]).toContain(res.status);
  });
});
