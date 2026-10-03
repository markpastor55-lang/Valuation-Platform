import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeReport, DEFAULT_TEMPLATE, resolveRequirements, AU_CORE_RULE_SET } from '@vp/domain';
import { PDFDocument } from 'pdf-lib';
import { PgliteDb } from '../src/db/db.js';
import { loadMigrations, migrate, MigrationDriftError } from '../src/db/migrate.js';
import { RENDERER_VERSION, renderReportPdf } from '../src/services/pdf.js';
import { buildInvoice, renderInvoicePdf } from '../src/services/invoice.js';
import { DEMO, createTestApp, newJobBody, type TestApp } from './helpers.js';

describe('migrations', () => {
  it('apply from empty, are idempotent and detect drift', async () => {
    const db = await PgliteDb.create();
    try {
      const first = await migrate(db);
      expect(first.applied).toEqual([
        '0001_core_schema',
        '0002_immutability',
        '0003_counters_and_sync_scope',
        '0004_cgt_purpose',
        '0005_valuer_profile',
      ]);
      expect((await migrate(db)).applied).toEqual([]);
      const tampered = (await loadMigrations()).map((m) =>
        m.version === 1 ? { ...m, checksum: 'edited' } : m,
      );
      await expect(migrate(db, tampered)).rejects.toBeInstanceOf(MigrationDriftError);
    } finally {
      await db.close();
    }
  });
});

describe('database guards', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('blocks deleting a job under legal hold', async () => {
    const job = await t.call<{ id: string }>('allocator', 'POST', '/v1/jobs', newJobBody());
    const hold = await t.call('admin', 'POST', '/v1/admin/legal-holds', {
      scopeType: 'job',
      scopeId: job.body.id,
      reason: 'Subpoena received for this matter',
    });
    expect(hold.status).toBe(200);
    await expect(t.db.query('DELETE FROM job WHERE id = $1', [job.body.id])).rejects.toThrow(
      /legal hold/,
    );
  });

  it('keeps field history append-only', async () => {
    await expect(t.db.query('UPDATE field_value_history SET reason = $1', ['x'])).rejects.toThrow(
      /immutable/,
    );
  });

  it('only administrators can apply legal holds', async () => {
    const res = await t.call('valuer', 'POST', '/v1/admin/legal-holds', {
      scopeType: 'client',
      scopeId: DEMO.clientId,
      reason: 'Attempted by a valuer',
    });
    expect(res.status).toBe(403);
  });
});

describe('deterministic documents', () => {
  it('renders identical PDF bytes for identical inputs', async () => {
    const selection = {
      jurisdiction: 'VIC',
      purpose: 'MARKET_VALUE',
      propertyType: 'RESIDENTIAL',
      scope: 'FULL',
      mode: 'SINGLE',
    } as const;
    const values = {
      job: { 'dates.valuation': '2026-09-30' },
      assets: { a1: { 'land.area': 650 } },
    };
    const model = composeReport(
      {
        report: { id: 'r1', version: 1, status: 'draft' },
        firmName: 'Example Valuers Pty Ltd',
        job: { id: 'j1', reference: 'VAL-1', selection, clientName: 'Client' },
        valuerName: 'Val Valuer',
        requirements: resolveRequirements(selection, AU_CORE_RULE_SET, values),
        values,
        assets: [{ id: 'a1', label: '10 Sample Road' }],
        sales: [],
        saleAnalyses: [],
        rentals: [],
        calculations: [],
        areaSchedules: [],
        sketches: [
          {
            assetId: 'a1',
            sketchVersionId: 'sv1',
            version: 1,
            includeInClientReport: true,
            northBearingDeg: 30,
          },
        ],
        photos: [
          {
            id: 'p1',
            renderId: 'p1',
            assetId: 'a1',
            caption: 'Façade — street view ≥ 2 storeys',
            sequence: 1,
          },
        ],
      },
      DEFAULT_TEMPLATE,
    );
    const assets = {
      sketches: {
        sv1: {
          boundaries: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 8 },
                { x: 0, y: 8 },
              ],
              label: 'Dwelling',
              role: 'component' as const,
              level: 'Ground',
            },
          ],
          metresPerUnit: 1,
          northBearingDeg: 30,
          scaleStatus: 'not applicable',
        },
      },
      photos: { p1: { sha256: 'a'.repeat(64), caption: 'Façade' } },
      mapPoints: [{ label: '10 Sample Road', lat: -37.81, lng: 144.96 }],
    };
    const a = await renderReportPdf(model, assets, '2026-10-02T00:00:00.000Z');
    const b = await renderReportPdf(model, assets, '2026-10-02T00:00:00.000Z');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const doc = await PDFDocument.load(a, { updateMetadata: false });
    expect(doc.getPageCount()).toBeGreaterThan(3);
    expect(doc.getProducer()).toBe(RENDERER_VERSION);
    expect(doc.getCreationDate()?.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('calculates GST to the cent and renders the invoice deterministically', async () => {
    const inv = buildInvoice({
      number: 'INV-2026-00001',
      issueDate: '2026-10-02',
      supplier: { name: 'Example Valuers Pty Ltd' },
      billTo: { name: 'Client' },
      jobReference: 'VAL-1',
      reportId: 'r1',
      feeCents: 123_45,
      description: 'Valuation',
      gstRate: 0.1,
    });
    expect(inv).toMatchObject({ subtotalCents: 12_345, gstCents: 1_235, totalCents: 13_580 });
    const a = await renderInvoicePdf(inv, '2026-10-02T00:00:00.000Z');
    const b = await renderInvoicePdf(inv, '2026-10-02T00:00:00.000Z');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
