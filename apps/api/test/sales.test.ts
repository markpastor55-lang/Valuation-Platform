import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SaleComparable } from '@vp/domain';
import { loadAggregate } from '../src/services/aggregate.js';
import { createTestApp, newJobBody, saleBody, submitDirectly, type TestApp } from './helpers.js';

type ErrorBody = { error: { code: string } };

describe('adding and removing sales', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  async function job(over: Record<string, unknown> = {}) {
    const res = await t.call<{ id: string; assets: { id: string }[] }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody(over),
    );
    expect(res.status).toBe(200);
    return { jobId: res.body.id, assetId: res.body.assets[0]!.id };
  }

  const addSale = (jobId: string, body: Record<string, unknown>) =>
    t.call<{ sale: SaleComparable }>('valuer', 'POST', `/v1/jobs/${jobId}/sales`, body);

  it('removes a sale with its analysed rates, takes it off the evidence list and audits it', async () => {
    const { jobId, assetId } = await job();
    const a = await addSale(jobId, saleBody(assetId, 1, 1_100_000, 640, '2026-08-01'));
    const b = await addSale(jobId, saleBody(assetId, 2, 1_180_000, 660, '2026-08-20'));
    expect([a.status, b.status]).toEqual([200, 200]);
    const [first, second] = [a.body.sale.id, b.body.sale.id];
    const put = await t.call('valuer', 'PUT', `/v1/jobs/${jobId}/fields`, {
      values: [{ fieldId: 'evidence.sales', assetId, value: [first, second] }],
    });
    expect(put.status).toBe(200);

    const removed = await t.call('valuer', 'DELETE', `/v1/jobs/${jobId}/sales/${first}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ removed: first });

    const agg = await loadAggregate(t.db, jobId);
    expect(agg.sales.map((s) => s.id)).toEqual([second]);
    expect(agg.saleAnalyses.map((x) => x.saleId)).toEqual([second]);
    expect(agg.values.assets[assetId]?.['evidence.sales']).toEqual([second]);
    const events = await t.db.query<{ event: { before: { address: string } } }>(
      "SELECT event FROM audit_event WHERE stream_id = $1 AND action = 'evidence.sale_removed'",
      [`job:${jobId}`],
    );
    expect(events.rows.map((r) => r.event.before.address)).toEqual([
      '1 Comparable Street, Exampleton VIC',
    ]);

    // the last sale empties the evidence list
    expect((await t.call('valuer', 'DELETE', `/v1/jobs/${jobId}/sales/${second}`)).status).toBe(
      200,
    );
    expect(
      (await loadAggregate(t.db, jobId)).values.assets[assetId]?.['evidence.sales'],
    ).toBeNull();
    const again = await t.call<ErrorBody>('valuer', 'DELETE', `/v1/jobs/${jobId}/sales/${second}`);
    expect(again.status).toBe(404);
  });

  it('takes a sale the valuer typed in, including a unit sale', async () => {
    const { jobId, assetId } = await job({
      selection: { ...newJobBody().selection, propertyType: 'RESIDENTIAL_UNIT' },
    });
    const res = await addSale(jobId, {
      assetId,
      address: '7/12 Station Street, Exampleton VIC 3000',
      contractDate: '2026-09-12',
      price: 640_000,
      interest: 'fee_simple_vacant_possession',
      propertyType: 'RESIDENTIAL_UNIT',
      buildingAreaM2: 82,
      provenance: {
        origin: 'manual_entry',
        sourceRef: 'Selling agent',
        verification: 'unverified',
      },
      comparability: 'comparable',
      analysisBasis: 'building_rate',
    });
    expect(res.status).toBe(200);
    expect(res.body.sale).toMatchObject({
      propertyType: 'RESIDENTIAL_UNIT',
      provenance: { origin: 'manual_entry', sourceRef: 'Selling agent' },
    });
  });

  it('only lets the valuer remove sales while the job is editable', async () => {
    const { jobId, assetId } = await job();
    const sale = (await addSale(jobId, saleBody(assetId, 3, 1_150_000, 655, '2026-08-25'))).body
      .sale;
    const url = `/v1/jobs/${jobId}/sales/${sale.id}`;
    expect((await t.call('inspector', 'DELETE', url)).status).toBe(403);
    expect((await t.call('valuer2', 'DELETE', url)).status).toBe(403);
    await submitDirectly(t, jobId);
    const locked = await t.call<ErrorBody>('valuer', 'DELETE', url);
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('RECORD_LOCKED');
    expect((await loadAggregate(t.db, jobId)).sales).toHaveLength(1);
  });
});
