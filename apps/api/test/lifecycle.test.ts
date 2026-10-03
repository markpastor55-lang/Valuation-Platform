import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO,
  approveConfiguration,
  createTestApp,
  marketValueFieldValues,
  newJobBody,
  rect,
  saleBody,
  type TestApp,
} from './helpers.js';

/**
 * End-to-end: allocation → engagement → capture → evidence → areas → AI review → validation →
 * certification → QA → issue → reproduction → audit verification. Each step asserts the
 * guardrails that apply at that point.
 */
describe('job lifecycle (market value, residential, VIC)', () => {
  let t: TestApp;
  let jobId: string;
  let assetId: string;
  let reportId: string;

  beforeAll(async () => {
    t = await createTestApp();
    await approveConfiguration(t);
    const approve = await t.call(
      'allocator',
      'POST',
      `/v1/admin/clients/${DEMO.clientId}/recipients`,
      { email: 'credit@lender.example' },
    );
    expect(approve.status).toBe(200);
  });
  afterAll(async () => t.close());

  it('allocator creates a job with requirements resolved from the selection', async () => {
    const res = await t.call<{
      id: string;
      status: string;
      assets: { id: string }[];
      template: string;
      ruleSet: string;
      requirements: { sections: string[]; missingRequired: unknown[] };
    }>('allocator', 'POST', '/v1/jobs', newJobBody());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draft');
    expect(res.body.ruleSet).toContain('approved');
    expect(res.body.template).toBe('au-generic v2 (approved)');
    expect(res.body.requirements.sections).toEqual(
      expect.arrayContaining(['sales_evidence', 'improvements', 'certification']),
    );
    expect(res.body.requirements.missingRequired.length).toBeGreaterThan(10);
    jobId = res.body.id;
    assetId = res.body.assets[0]!.id;
  });

  it('shows the asset on the permission-aware map only to authorised users', async () => {
    const valuer = await t.call<{ features: { properties: { jobId: string } }[] }>(
      'valuer',
      'GET',
      '/v1/map/assets',
    );
    expect(valuer.body.features.map((f) => f.properties.jobId)).toContain(jobId);
    const outsider = await t.call<{ features: unknown[] }>('valuer2', 'GET', '/v1/map/assets');
    expect(outsider.body.features).toEqual([]);
    const outsiderDetail = await t.call('valuer2', 'GET', `/v1/jobs/${jobId}`);
    expect(outsiderDetail.status).toBe(403);
  });

  it('cannot accept the engagement before the conflict check and documents', async () => {
    const res = await t.call<{ error: { code: string; details: { failures: string[] } } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/engagement/accept`,
      {},
    );
    expect(res.status).toBe(409);
    expect(res.body.error.details.failures).toEqual(
      expect.arrayContaining([
        'conflict-of-interest check has not been recorded',
        'engagement documents must be attached',
      ]),
    );
  });

  it('valuer captures field values with type checking', async () => {
    const bad = await t.call<{ error: { code: string } }>(
      'valuer',
      'PUT',
      `/v1/jobs/${jobId}/fields`,
      { values: [{ fieldId: 'dates.valuation', assetId: null, value: '30/09/2026' }] },
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVALID_FIELD_VALUE');
    const res = await t.call<{ changed: number }>('valuer', 'PUT', `/v1/jobs/${jobId}/fields`, {
      values: marketValueFieldValues(assetId),
    });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(marketValueFieldValues(assetId).length);
  });

  it('accepts the engagement', async () => {
    const res = await t.call<{ status: string }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/engagement/accept`,
      {},
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('records sales evidence with traced rates', async () => {
    for (const [n, price, land, date] of [
      [1, 1_100_000, 640, '2026-06-01'],
      [2, 1_180_000, 660, '2026-07-15'],
      [3, 1_150_000, 655, '2026-08-20'],
    ] as const) {
      const res = await t.call<{
        analysis: { landRate: { output: { value: number }; traceHash: string; formulaId: string } };
      }>('valuer', 'POST', `/v1/jobs/${jobId}/sales`, saleBody(assetId, n, price, land, date));
      expect(res.status).toBe(200);
      expect(res.body.analysis.landRate.formulaId).toBe('land.rate_per_m2');
      expect(res.body.analysis.landRate.output.value).toBeCloseTo(price / land, 2);
    }
  });

  it('rejects overrides without a reason and records them with one', async () => {
    const calc = await t.call<{ id: string; output: { value: number } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/calculations`,
      {
        assetId,
        formulaId: 'improvements.rate_per_m2',
        inputs: [
          {
            name: 'price',
            value: 1_150_000,
            unit: 'AUD',
            sourceRef: `field:valuation.adoptedValue@asset:${assetId}`,
          },
          { name: 'buildingArea', value: 216, unit: 'm2' },
        ],
      },
    );
    expect(calc.status).toBe(200);
    const noReason = await t.call<{ error: { code: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/calculations/${calc.body.id}/override`,
      { value: 5300, reason: 'rounded' },
    );
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.code).toBe('OVERRIDE_REASON_REQUIRED');
    const ok = await t.call<{
      override: { value: number; reason: string };
      output: { value: number };
    }>('valuer', 'POST', `/v1/jobs/${jobId}/calculations/${calc.body.id}/override`, {
      value: 5300,
      reason: 'Rounded to the nearest $100/m² consistent with evidence range',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.output.value).toBe(calc.body.output.value);
    expect(ok.body.override.value).toBe(5300);
  });

  it('draws, measures and approves the improvement areas', async () => {
    const sketch = await t.call<{
      version: { id: string; sketchId: string };
      schedule: { totalIncludedM2: number; reportable: boolean };
    }>('inspector', 'POST', `/v1/jobs/${jobId}/assets/${assetId}/sketches`, {
      units: 'metres',
      basis: 'BUILDING_AREA',
      conventionId: 'res-under-main-roof',
      northBearingDeg: 15,
      changeSummary: 'Measured on site',
      boundaries: [
        {
          level: 'Ground',
          label: 'Dwelling',
          role: 'component',
          componentType: 'living',
          points: rect(0, 0, 15, 12),
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
      ],
    });
    expect(sketch.status).toBe(200);
    expect(sketch.body.schedule).toMatchObject({ totalIncludedM2: 216, reportable: true });
    // Inspectors measure; only the valuer approves.
    const inspectorApprove = await t.call(
      'inspector',
      'POST',
      `/v1/jobs/${jobId}/sketch-versions/${sketch.body.version.id}/approve`,
    );
    expect(inspectorApprove.status).toBe(403);
    const approve = await t.call<{ approval: { totalIncludedM2: number; approvedBy: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/sketch-versions/${sketch.body.version.id}/approve`,
    );
    expect(approve.status).toBe(200);
    expect(approve.body.approval).toMatchObject({
      totalIncludedM2: 216,
      approvedBy: DEMO.users.valuer,
    });
  });

  it('keeps AI suggestions pending until a person decides', async () => {
    const photo = await t.call<{ id: string }>('inspector', 'POST', `/v1/jobs/${jobId}/photos`, {
      assetId,
      sha256: 'a'.repeat(64),
      sequence: 1,
      capturedAt: '2026-09-30T01:00:00Z',
      caption: 'Kitchen',
      includeInReport: true,
    });
    expect(photo.status).toBe(200);
    const asHuman = await t.call('inspector', 'POST', `/v1/jobs/${jobId}/ai-suggestions`, {
      assetId,
      kind: 'visible_attribute',
      photoId: photo.body.id,
      label: 'stone_benchtop',
      confidence: 0.97,
      model: { provider: 'example', model: 'attributes', version: '1' },
    });
    expect(asHuman.status).toBe(403);
    const prohibited = await t.call<{ error: { code: string } }>(
      'aiService',
      'POST',
      `/v1/jobs/${jobId}/ai-suggestions`,
      {
        assetId,
        kind: 'visible_attribute',
        photoId: photo.body.id,
        label: 'Smeg brand oven',
        confidence: 0.99,
        model: { provider: 'example', model: 'attributes', version: '1' },
      },
      { kind: 'ai' },
    );
    expect(prohibited.status).toBe(422);
    expect(prohibited.body.error.code).toBe('AI_INFERENCE_PROHIBITED');
    const s = await t.call<{ id: string; status: string }>(
      'aiService',
      'POST',
      `/v1/jobs/${jobId}/ai-suggestions`,
      {
        assetId,
        kind: 'visible_attribute',
        photoId: photo.body.id,
        label: 'stone_benchtop',
        confidence: 0.97,
        model: { provider: 'example', model: 'attributes', version: '1' },
      },
      { kind: 'ai' },
    );
    expect(s.body.status).toBe('pending');
    const aiDecides = await t.call(
      'aiService',
      'POST',
      `/v1/jobs/${jobId}/ai-suggestions/${s.body.id}/decision`,
      { decision: 'accept' },
      { kind: 'ai' },
    );
    expect(aiDecides.status).toBe(403);

    const blocked = await t.call<{ findings: { code: string }[] }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/validate`,
      { stage: 'submit' },
    );
    expect(blocked.body.findings.map((f) => f.code)).toContain('VAL-AI-001');

    const accept = await t.call<{
      fact: { provenance: { sourceRef: string; capturedBy: string } };
    }>('inspector', 'POST', `/v1/jobs/${jobId}/ai-suggestions/${s.body.id}/decision`, {
      decision: 'accept',
    });
    expect(accept.status).toBe(200);
    expect(accept.body.fact.provenance).toMatchObject({
      sourceRef: `photo:${photo.body.id}`,
      capturedBy: DEMO.users.inspector,
    });
  });

  it('validates cleanly once warnings are acknowledged with reasons', async () => {
    const v = await t.call<{
      blockingCount: number;
      findings: { code: string; path: string; severity: string; acknowledgement?: unknown }[];
    }>('valuer', 'POST', `/v1/jobs/${jobId}/validate`, { stage: 'submit' });
    expect(v.status).toBe(200);
    expect(v.body.findings.filter((f) => f.severity === 'blocking')).toEqual([]);
    for (const f of v.body.findings.filter((x) => x.severity === 'warning' && !x.acknowledgement)) {
      const ack = await t.call('valuer', 'POST', `/v1/jobs/${jobId}/acknowledgements`, {
        code: f.code,
        path: f.path,
        reason: 'Considered and not applicable to this property',
      });
      expect(ack.status).toBe(200);
    }
    const again = await t.call<{ blockingCount: number; unacknowledgedWarningCount: number }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/validate`,
      { stage: 'submit' },
    );
    expect(again.body).toMatchObject({ blockingCount: 0, unacknowledgedWarningCount: 0 });
  });

  const certification = {
    valuer: { fullName: 'Val Valuer', credentials: ['AAPI', 'CPV'] },
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
  };

  it('only the responsible valuer, with MFA, can certify; then submit locks the job', async () => {
    const noMfa = await t.call<{ error: { code: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/certification`,
      certification,
      { mfa: false },
    );
    expect(noMfa.status).toBe(403);
    expect(noMfa.body.error.code).toBe('MFA_REQUIRED');
    const other = await t.call('valuer2', 'POST', `/v1/jobs/${jobId}/certification`, certification);
    expect(other.status).toBe(403);
    const cert = await t.call<{ snapshotHash: string }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/certification`,
      certification,
    );
    expect(cert.status).toBe(200);
    const submit = await t.call<{ status: string; snapshotHash: string }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/submit`,
    );
    expect(submit.status).toBe(200);
    expect(submit.body).toMatchObject({
      status: 'submitted',
      snapshotHash: cert.body.snapshotHash,
    });
    const edit = await t.call<{ error: { code: string } }>(
      'valuer',
      'PUT',
      `/v1/jobs/${jobId}/fields`,
      { values: [{ fieldId: 'valuation.marketability', assetId, value: 'Fair' }] },
    );
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('RECORD_LOCKED');
  });

  it('independent QA review approves after the checklist is complete', async () => {
    const start = await t.call<{ checklist: { id: string }[] }>(
      'reviewer',
      'POST',
      `/v1/jobs/${jobId}/qa/start`,
    );
    expect(start.status).toBe(200);
    const early = await t.call<{ error: { details: { failures: string[] } } }>(
      'reviewer',
      'POST',
      `/v1/jobs/${jobId}/qa/approve`,
    );
    expect(early.status).toBe(409);
    expect(early.body.error.details.failures[0]).toMatch(/checklist item\(s\) unanswered/);
    for (const item of start.body.checklist) {
      const r = await t.call('reviewer', 'POST', `/v1/jobs/${jobId}/qa/checklist`, {
        itemId: item.id,
        response: 'yes',
      });
      expect(r.status).toBe(200);
    }
    const approve = await t.call<{ status: string }>(
      'reviewer',
      'POST',
      `/v1/jobs/${jobId}/qa/approve`,
    );
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('approved');
  });

  it('refuses unapproved recipients and issues the final report, invoice and deliveries', async () => {
    const bad = await t.call<{ error: { code: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/issue`,
      { recipients: ['someone@else.example'] },
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('UNAPPROVED_RECIPIENTS');
    const notResponsible = await t.call('valuer2', 'POST', `/v1/jobs/${jobId}/issue`, {
      recipients: ['credit@lender.example'],
    });
    expect([403, 404]).toContain(notResponsible.status);

    await t.db.query('UPDATE organisation SET abn = NULL WHERE id = $1', [DEMO.orgId]);
    const noAbn = await t.call<{ error: { code: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/issue`,
      {
        recipients: ['credit@lender.example'],
      },
    );
    expect(noAbn.status).toBe(422);
    expect(noAbn.body.error.code).toBe('SUPPLIER_ABN_REQUIRED');
    await t.db.query("UPDATE organisation SET abn = '00 000 000 001' WHERE id = $1", [DEMO.orgId]);

    const issue = await t.call<{
      reportId: string;
      version: number;
      pdfSha256: string;
      invoice: { totalCents: number; gstCents: number };
      deliveries: { status: string }[];
    }>('valuer', 'POST', `/v1/jobs/${jobId}/issue`, { recipients: ['credit@lender.example'] });
    expect(issue.status).toBe(200);
    expect(issue.body.version).toBe(1);
    expect(issue.body.invoice).toEqual(
      expect.objectContaining({ gstCents: 8_800, totalCents: 96_800 }),
    );
    expect(issue.body.deliveries).toEqual([expect.objectContaining({ status: 'sent' })]);
    expect(t.email.sent).toHaveLength(1);
    expect(t.email.sent[0]!.attachments.map((a) => a.sha256)).toContain(issue.body.pdfSha256);
    reportId = issue.body.reportId;

    const pdf = await t.call('valuer', 'GET', `/v1/reports/${reportId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.raw.subarray(0, 5).toString()).toBe('%PDF-');

    const job = await t.call<{ status: string }>('valuer', 'GET', `/v1/jobs/${jobId}`);
    expect(job.body.status).toBe('issued');
  });

  it('reproduces the issued PDF, invoice and email records from the immutable snapshot', async () => {
    const res = await t.call<{
      reproducible: boolean;
      snapshotIntact: boolean;
      pdf: { match: boolean };
      invoice: { match: boolean };
      emails: { match: boolean }[];
    }>('reviewer', 'POST', `/v1/reports/${reportId}/reproduce`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      reproducible: true,
      snapshotIntact: true,
      pdf: { match: true },
      invoice: { match: true },
    });
    expect(res.body.emails.every((e) => e.match)).toBe(true);
  });

  it('lets the client read the issued report but not the job', async () => {
    const meta = await t.call<{ status: string }>('client', 'GET', `/v1/reports/${reportId}`);
    expect(meta.status).toBe(200);
    expect(meta.body.status).toBe('issued');
    expect((await t.call('client', 'GET', `/v1/jobs/${jobId}`)).status).toBe(403);
  });

  it('keeps an intact, append-only audit chain', async () => {
    const verify = await t.call<{ valid: boolean; count: number }>(
      'reviewer',
      'GET',
      `/v1/jobs/${jobId}/audit/verify`,
    );
    expect(verify.body.valid).toBe(true);
    expect(verify.body.count).toBeGreaterThan(80);
    const events = await t.call<{ events: { action: string }[] }>(
      'reviewer',
      'GET',
      `/v1/jobs/${jobId}/audit`,
    );
    const actions = new Set(events.body.events.map((e) => e.action));
    for (const a of [
      'job.created',
      'field.updated',
      'job.engagement_accepted',
      'evidence.sale_added',
      'calculation.overridden',
      'measurement.approved',
      'ai.suggestion_accepted',
      'certification.signed',
      'job.submitted',
      'qa.started',
      'qa.approved',
      'report.issued',
      'invoice.created',
      'email.sent',
    ]) {
      expect(actions).toContain(a);
    }
    await expect(
      t.db.query("UPDATE audit_event SET action = 'tampered' WHERE stream_id = $1", [
        `job:${jobId}`,
      ]),
    ).rejects.toThrow(/immutable/);
    await expect(
      t.db.query('DELETE FROM audit_event WHERE stream_id = $1', [`job:${jobId}`]),
    ).rejects.toThrow(/immutable/);
    await expect(
      t.db.query("UPDATE report SET snapshot = '{}'::jsonb WHERE id = $1", [reportId]),
    ).rejects.toThrow(/immutable/);
    await expect(
      t.db.query(
        "UPDATE sketch_version SET data = '{}'::jsonb WHERE job_id = $1 AND status = 'frozen'",
        [jobId],
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('records authorisation denials in the security stream', async () => {
    const sec = await t.call<{
      verification: { valid: boolean };
      events: { action: string; metadata?: { code: string } }[];
    }>('admin', 'GET', '/v1/admin/security-events');
    expect(sec.body.verification.valid).toBe(true);
    expect(sec.body.events.filter((e) => e.action === 'auth.denied').length).toBeGreaterThan(0);
  });
});
