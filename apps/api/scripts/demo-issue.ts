/**
 * Drives a complete market-value job through the API (in-process, embedded PostgreSQL) and writes
 * the issued report and tax invoice to an output directory:
 *
 *   pnpm --filter @vp/api demo [outDir]
 *
 * Uses the demo organisation and the same steps as the end-to-end test. All data is synthetic.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FIRM_TEMPLATE } from '@vp/domain';
import {
  ASSET_ID,
  approveConfiguration,
  createTestApp,
  marketValueFieldValues,
  newJobBody,
  rect,
  saleBody,
  DEMO,
} from '../test/helpers.js';

const outDir = resolve(process.argv[2] ?? 'demo-output');
const t = await createTestApp();

function must<T>(res: { status: number; body: T }, step: string): T {
  if (res.status !== 200)
    throw new Error(`${step} failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body;
}

try {
  // Fair Market Valuations' template, with its draft standard clauses approved for the demo
  await approveConfiguration(t, { template: FIRM_TEMPLATE });
  must(
    await t.call('allocator', 'POST', `/v1/admin/clients/${DEMO.clientId}/recipients`, {
      email: 'credit@lender.example',
    }),
    'approve recipient',
  );
  const job = must(
    await t.call<{ id: string; assets: { id: string }[] }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody({
        reference: 'VAL-2026-DEMO',
        assets: [
          {
            id: ASSET_ID,
            label: '10 Sample Road, Exampleton VIC 3000',
            address: { formatted: '10 Sample Road, Exampleton VIC 3000' },
            latitude: -37.81,
            longitude: 144.96,
          },
        ],
      }),
    ),
    'create job',
  );
  const jobId = job.id;
  const assetId = job.assets[0]?.id ?? ASSET_ID;
  must(
    await t.call('valuer', 'PUT', `/v1/jobs/${jobId}/fields`, {
      values: marketValueFieldValues(assetId),
    }),
    'capture fields',
  );
  // National, state and local commentary from the firm's library, for this property type and suburb
  must(
    await t.call('valuer', 'POST', `/v1/jobs/${jobId}/commentary/apply`, {
      assetId,
      levels: ['national', 'state', 'local'],
    }),
    'use market commentary',
  );
  must(
    await t.call('valuer', 'POST', `/v1/jobs/${jobId}/engagement/accept`, {}),
    'accept engagement',
  );
  for (const [n, price, land, date] of [
    [1, 1_100_000, 640, '2026-06-01'],
    [2, 1_180_000, 660, '2026-07-15'],
    [3, 1_150_000, 655, '2026-08-20'],
  ] as const) {
    must(
      await t.call(
        'valuer',
        'POST',
        `/v1/jobs/${jobId}/sales`,
        saleBody(assetId, n, price, land, date),
      ),
      `sale ${n}`,
    );
  }
  const sketch = must(
    await t.call<{ version: { id: string } }>(
      'inspector',
      'POST',
      `/v1/jobs/${jobId}/assets/${assetId}/sketches`,
      {
        units: 'metres',
        basis: 'BUILDING_AREA',
        conventionId: 'res-under-main-roof',
        northBearingDeg: 15,
        changeSummary: 'Measured on site',
        boundaries: [
          {
            level: 'Ground',
            label: 'Living',
            role: 'component',
            componentType: 'living',
            points: [
              { x: 0, y: 0 },
              { x: 15, y: 0 },
              { x: 15, y: 8 },
              { x: 9, y: 8 },
              { x: 9, y: 12 },
              { x: 0, y: 12 },
            ],
            closed: true,
            dimensionSource: 'measured',
          },
          {
            level: 'Ground',
            label: 'Garage',
            role: 'component',
            componentType: 'garage',
            points: rect(15, 0, 6, 6),
            closed: true,
            dimensionSource: 'measured',
          },
          {
            level: 'Ground',
            label: 'Alfresco',
            role: 'component',
            componentType: 'alfresco',
            points: rect(9, 8, 6, 4),
            closed: true,
            dimensionSource: 'measured',
          },
          {
            level: 'Ground',
            label: 'Verandah',
            role: 'component',
            componentType: 'verandah',
            points: rect(0, -2, 9, 2),
            closed: true,
            dimensionSource: 'measured',
          },
        ],
      },
    ),
    'sketch',
  );
  must(
    await t.call(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/sketch-versions/${sketch.version.id}/approve`,
    ),
    'approve areas',
  );
  must(
    await t.call('inspector', 'POST', `/v1/jobs/${jobId}/photos`, {
      assetId,
      sha256: 'd'.repeat(64),
      sequence: 1,
      capturedAt: '2026-09-30T01:00:00Z',
      caption: 'Front elevation',
      includeInReport: true,
    }),
    'photo',
  );
  const v = must(
    await t.call<{ findings: { code: string; path: string; severity: string }[] }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/validate`,
      { stage: 'submit' },
    ),
    'validate',
  );
  for (const f of v.findings.filter((x) => x.severity === 'warning')) {
    must(
      await t.call('valuer', 'POST', `/v1/jobs/${jobId}/acknowledgements`, {
        code: f.code,
        path: f.path,
        reason: 'Considered; not applicable to this property',
      }),
      'acknowledge',
    );
  }
  must(
    // Name, designations, API member number and signature come from the valuer's saved profile.
    await t.call('valuer', 'POST', `/v1/jobs/${jobId}/certification`, {
      inspectionScopeStatement: 'Full internal and external inspection on 30 September 2026.',
      valuationDate: '2026-09-30',
      basisOfValue: 'Market value',
      amount: { value: 1_150_000, kind: 'value' },
      independenceStatement: 'I have no interest in the property or the parties.',
      conflictsStatement: 'No conflict of interest identified.',
      assumptions: ['Title is free of unregistered interests'],
      specialAssumptions: [],
      limitations: ['No structural or pest survey was undertaken'],
      standardsReliedOn: ['Firm valuation methodology v1 (mapped by the standards owner)'],
      attestationText: 'I certify that this valuation is my independent professional opinion.',
    }),
    'certify',
  );
  must(await t.call('valuer', 'POST', `/v1/jobs/${jobId}/submit`), 'submit');
  const review = must(
    await t.call<{ checklist: { id: string }[] }>('reviewer', 'POST', `/v1/jobs/${jobId}/qa/start`),
    'start QA',
  );
  for (const item of review.checklist)
    must(
      await t.call('reviewer', 'POST', `/v1/jobs/${jobId}/qa/checklist`, {
        itemId: item.id,
        response: 'yes',
      }),
      'checklist',
    );
  must(await t.call('reviewer', 'POST', `/v1/jobs/${jobId}/qa/approve`), 'QA approve');
  const issued = must(
    await t.call<{ reportId: string; pdfSha256: string; invoice: { number: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/issue`,
      { recipients: ['credit@lender.example'] },
    ),
    'issue',
  );
  const reproduce = must(
    await t.call<{ reproducible: boolean }>(
      'reviewer',
      'POST',
      `/v1/reports/${issued.reportId}/reproduce`,
    ),
    'reproduce',
  );
  const pdf = await t.call('valuer', 'GET', `/v1/reports/${issued.reportId}/pdf`);
  const invoice = await t.call('finance', 'GET', `/v1/reports/${issued.reportId}/invoice.pdf`);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'sample-report-VAL-2026-DEMO-v1.pdf'), pdf.raw);
  await writeFile(join(outDir, `sample-invoice-${issued.invoice.number}.pdf`), invoice.raw);
  process.stdout.write(
    `issued report ${issued.reportId} (sha256 ${issued.pdfSha256.slice(0, 16)}…), reproducible: ${String(reproduce.reproducible)}\nwritten to ${outDir}\n`,
  );
} finally {
  await t.close();
}
