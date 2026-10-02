import {
  authorize,
  composeReport,
  freezeSketchVersion,
  hashCanonical,
  sha256Hex,
  type ReportData,
  type SketchVersion,
  type TemplateVersion,
} from '@vp/domain';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { HttpError, notFound } from '../http/errors.js';
import type { Router } from '../http/route.js';
import { authorizeJob, authorizeOrThrow, getJob, jobResource } from '../repo/jobs.js';
import {
  jurisdictionToday,
  loadAggregate,
  reportDataOf,
  snapshotHashOf,
  validate,
  workflowContextOf,
  engagementDocumentCount,
  type JobAggregate,
} from '../services/aggregate.js';
import { audit, jobStream } from '../services/audit.js';
import { emailPayloadHash, type EmailMessage } from '../services/email.js';
import { buildInvoice, renderInvoicePdf, type InvoiceData } from '../services/invoice.js';
import { RENDERER_VERSION, renderReportPdf, type RenderAssets } from '../services/pdf.js';
import { transitionJob } from '@vp/domain';
import { JobParams, Uuid } from './schemas.js';

/** Everything needed to reproduce the issued PDF, invoice and email deliveries. */
export interface IssueSnapshot {
  readonly schema: 'issue-snapshot@1';
  readonly renderer: string;
  readonly issuedAt: string;
  readonly issueDate: string;
  readonly contentHash: string;
  readonly reportData: ReportData;
  readonly template: TemplateVersion;
  readonly renderAssets: RenderAssets;
  readonly invoice: InvoiceData;
  readonly emails: readonly {
    to: string;
    from: string;
    subject: string;
    text: string;
    attachments: { filename: string; contentType: string; sha256: string }[];
  }[];
}

export function renderAssetsOf(agg: JobAggregate): RenderAssets {
  const sketches: Record<string, RenderAssets['sketches'][string]> = {};
  for (const v of agg.reportingSketches) {
    const schedule = agg.schedules.find((s) => s.sketchVersionId === v.id);
    sketches[v.id] = {
      boundaries: v.boundaries
        .filter((b) => b.reviewStatus === 'accepted' && b.closed)
        .map((b) => ({ points: b.points, label: b.label, role: b.role, level: b.level })),
      metresPerUnit: v.units === 'metres' ? 1 : (v.calibration?.metresPerUnit ?? 1),
      ...(v.northBearingDeg !== undefined ? { northBearingDeg: v.northBearingDeg } : {}),
      scaleStatus: schedule?.scaleStatus ?? 'unknown',
    };
  }
  const photos: Record<string, { sha256: string; caption: string }> = {};
  for (const p of agg.photos) photos[p.id] = { sha256: p.sha256, caption: p.caption ?? '' };
  return {
    sketches,
    photos,
    mapPoints: agg.assets
      .filter((a) => a.latitude !== null && a.longitude !== null)
      .map((a) => ({ label: a.label, lat: a.latitude as number, lng: a.longitude as number })),
  };
}

const emailFor = (
  from: string,
  to: string,
  ref: string,
  version: number,
  attachments: EmailMessage['attachments'],
): EmailMessage => ({
  from,
  to,
  subject: `Valuation report ${ref} (version ${version})`,
  text: `Please find attached valuation report ${ref}, version ${version}, and the associated tax invoice. This report is for the intended users named in it only.`,
  attachments,
});

async function nextInvoiceNumber(tx: Db, orgId: string, issueDate: string): Promise<string> {
  const year = issueDate.slice(0, 4);
  const { rows } = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM invoice WHERE org_id = $1 AND number LIKE $2',
    [orgId, `INV-${year}-%`],
  );
  return `INV-${year}-${String((rows[0]?.n ?? 0) + 1).padStart(5, '0')}`;
}

async function sendQueued(
  ctx: AppContext,
  jobId: string,
  orgId: string,
  deliveries: { id: string; message: EmailMessage }[],
  actor: { userId: string; kind: 'human' | 'system' | 'ai'; roles: readonly string[] },
) {
  const results = [];
  for (const d of deliveries) {
    let status: 'sent' | 'failed' = 'sent';
    let providerMessageId: string | null = null;
    try {
      providerMessageId = (await ctx.email.send(d.message)).providerMessageId;
    } catch {
      status = 'failed';
    }
    await ctx.db.transaction(async (tx) => {
      await tx.query(
        'UPDATE email_delivery SET status = $2, provider_message_id = $3, attempts = attempts + 1, updated_at = $4 WHERE id = $1',
        [d.id, status, providerMessageId, ctx.clock.now()],
      );
      await audit(tx, ctx, {
        orgId,
        streamId: jobStream(jobId),
        actor: actor as never,
        action: status === 'sent' ? 'email.sent' : 'email.delivery_updated',
        entityType: 'email_delivery',
        entityId: d.id,
        after: { status, recipient: d.message.to },
      });
    });
    results.push({ id: d.id, recipient: d.message.to, status, providerMessageId });
  }
  return results;
}

export function registerReportRoutes(r: Router): void {
  r.add({
    method: 'GET',
    url: '/v1/jobs/:jobId/report/draft.pdf',
    summary: 'Render a watermarked draft report (not stored, not for reliance)',
    tags: ['reports'],
    permission: 'report.generate_draft',
    params: JobParams,
    produces: 'application/pdf',
    handler: async ({ ctx, principal, params, reply }) => {
      const { job } = await authorizeJob(
        ctx,
        ctx.db,
        principal,
        'report.generate_draft',
        params.jobId,
      );
      const agg = await loadAggregate(ctx.db, job.id, job);
      if (!agg.template)
        throw new HttpError(409, 'NO_TEMPLATE', 'no report template is selected for this job');
      const data = reportDataOf(
        agg,
        { id: `draft-${job.reference}`, version: 0, status: 'draft' },
        agg.template.branding.firmName,
      );
      const pdf = await renderReportPdf(
        composeReport(data, agg.template),
        renderAssetsOf(agg),
        ctx.clock.now(),
      );
      await ctx.db.transaction((tx) =>
        audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'report.draft_generated',
          entityType: 'job',
          entityId: job.id,
          after: { sha256: sha256Hex(pdf) },
        }),
      );
      return reply.type('application/pdf').send(Buffer.from(pdf));
    },
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/issue',
    summary:
      'Issue the final report: versioned watermarked PDF, separate invoice, delivery to approved recipients',
    tags: ['reports'],
    permission: 'report.issue',
    params: JobParams,
    body: z.object({
      recipients: z.array(z.email()).min(1).max(20),
      invoiceDescription: z.string().default('Professional valuation services'),
    }),
    handler: async ({ ctx, principal, params, body }) => {
      const prepared = await ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'report.issue', params.jobId, {
          forUpdate: true,
        });
        const agg = await loadAggregate(tx, job.id, job);
        if (!agg.template)
          throw new HttpError(409, 'NO_TEMPLATE', 'no report template is selected for this job');
        if (job.fee_cents === null)
          throw new HttpError(422, 'FEE_REQUIRED', 'the job fee must be recorded before invoicing');

        const approved = await tx.query<{ email: string }>(
          'SELECT lower(email) AS email FROM approved_recipient WHERE client_id = $1 AND revoked_at IS NULL',
          [job.client_id],
        );
        const allowed = new Set(approved.rows.map((r) => r.email));
        const unapproved = body.recipients.filter((e) => !allowed.has(e.toLowerCase()));
        if (unapproved.length)
          throw new HttpError(
            422,
            'UNAPPROVED_RECIPIENTS',
            'reports may only be emailed to approved recipients',
            { unapproved },
          );

        // Workflow guard (approved, unchanged since approval, certification current, issue-stage validation clean).
        const validation = validate(agg, 'issue', ctx);
        const wf = workflowContextOf(agg, principal, {
          validation,
          engagementDocumentCount: await engagementDocumentCount(tx, agg),
        });
        const { status, auditAction } = transitionJob('issue', wf);

        const issuedAt = ctx.clock.now();
        const issueDate = jurisdictionToday(agg, issuedAt);
        const prev = await tx.query<{ v: number | null }>(
          'SELECT max(version) AS v FROM report WHERE job_id = $1',
          [job.id],
        );
        const version = (prev.rows[0]?.v ?? 0) + 1;
        const reportId = ctx.newId();
        const contentHash = snapshotHashOf(agg);
        // Render from JSON round-tripped inputs: exactly what is stored and later reproduced.
        const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
        const reportData = roundTrip(
          reportDataOf(
            agg,
            { id: reportId, version, status: 'final', issueDate },
            agg.template.branding.firmName,
            contentHash,
          ),
        );
        const template = roundTrip(agg.template);
        const model = composeReport(reportData, template);
        if (model.problems.length)
          throw new HttpError(409, 'REPORT_NOT_ISSUABLE', 'the report cannot be issued', {
            problems: model.problems,
          });
        const renderAssets = roundTrip(renderAssetsOf(agg));
        const pdf = await renderReportPdf(model, renderAssets, issuedAt);
        const pdfSha = sha256Hex(pdf);

        const invoice = roundTrip(
          buildInvoice({
            number: await nextInvoiceNumber(tx, job.org_id, issueDate),
            issueDate,
            supplier: { name: template.branding.firmName },
            billTo: { name: agg.clientName },
            jobReference: job.reference,
            reportId,
            feeCents: job.fee_cents,
            description: body.invoiceDescription,
            gstRate: ctx.config.gstRate,
          }),
        );
        const invoicePdf = await renderInvoicePdf(invoice, issuedAt);
        const invoiceSha = sha256Hex(invoicePdf);
        const attachments: EmailMessage['attachments'] = [
          {
            filename: `${job.reference}-v${version}.pdf`,
            contentType: 'application/pdf',
            sha256: pdfSha,
            bytes: pdf,
          },
          {
            filename: `${invoice.number}.pdf`,
            contentType: 'application/pdf',
            sha256: invoiceSha,
            bytes: invoicePdf,
          },
        ];
        const messages = body.recipients.map((to) =>
          emailFor(ctx.config.emailFrom, to, job.reference, version, attachments),
        );

        const storedSnapshot: IssueSnapshot = roundTrip({
          schema: 'issue-snapshot@1',
          renderer: RENDERER_VERSION,
          issuedAt,
          issueDate,
          contentHash,
          reportData,
          template,
          renderAssets,
          invoice,
          emails: messages.map((m) => ({
            to: m.to,
            from: m.from,
            subject: m.subject,
            text: m.text,
            attachments: m.attachments.map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              sha256: a.sha256,
            })),
          })),
        });
        const snapshotHash = hashCanonical(storedSnapshot);

        await tx.query(
          "UPDATE report SET status = 'superseded' WHERE job_id = $1 AND status = 'issued'",
          [job.id],
        );
        await tx.query(
          `INSERT INTO report (id, org_id, job_id, version, status, snapshot, snapshot_hash, pdf, pdf_sha256, template_version_id, issued_by, issued_at)
           VALUES ($1, $2, $3, $4, 'issued', $5, $6, $7, $8, $9, $10, $11)`,
          [
            reportId,
            job.org_id,
            job.id,
            version,
            JSON.stringify(storedSnapshot),
            snapshotHash,
            Buffer.from(pdf),
            pdfSha,
            job.template_version_id,
            principal.userId,
            issuedAt,
          ],
        );
        const invoiceId = ctx.newId();
        await tx.query(
          `INSERT INTO invoice (id, org_id, job_id, report_id, number, data, subtotal_cents, gst_cents, total_cents, pdf, pdf_sha256, issued_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            invoiceId,
            job.org_id,
            job.id,
            reportId,
            invoice.number,
            JSON.stringify(invoice),
            invoice.subtotalCents,
            invoice.gstCents,
            invoice.totalCents,
            Buffer.from(invoicePdf),
            invoiceSha,
            issuedAt,
          ],
        );
        const deliveries: { id: string; message: EmailMessage }[] = [];
        for (const message of messages) {
          const id = ctx.newId();
          await tx.query(
            `INSERT INTO email_delivery (id, org_id, job_id, report_id, recipient, payload_hash, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $7)`,
            [id, job.org_id, job.id, reportId, message.to, emailPayloadHash(message), issuedAt],
          );
          deliveries.push({ id, message });
        }
        for (const v of agg.reportingSketches) {
          if (v.status === 'approved') {
            const frozen: SketchVersion = freezeSketchVersion(v);
            await tx.query('UPDATE sketch_version SET status = $2, data = $3 WHERE id = $1', [
              v.id,
              frozen.status,
              JSON.stringify(frozen),
            ]);
          }
        }
        await tx.query('UPDATE job SET status = $2, updated_at = $3 WHERE id = $1', [
          job.id,
          status,
          issuedAt,
        ]);
        const stream = jobStream(job.id);
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: stream,
          actor: principal,
          action: auditAction,
          entityType: 'report',
          entityId: reportId,
          before: { status: job.status },
          after: { status, version, snapshotHash, contentHash, pdfSha256: pdfSha },
        });
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: stream,
          actor: principal,
          action: 'invoice.created',
          entityType: 'invoice',
          entityId: invoiceId,
          after: { number: invoice.number, totalCents: invoice.totalCents, pdfSha256: invoiceSha },
        });
        for (const d of deliveries) {
          await audit(tx, ctx, {
            orgId: job.org_id,
            streamId: stream,
            actor: principal,
            action: 'email.queued',
            entityType: 'email_delivery',
            entityId: d.id,
            after: { recipient: d.message.to, payloadHash: emailPayloadHash(d.message) },
          });
        }
        return {
          job,
          reportId,
          version,
          snapshotHash,
          contentHash,
          pdfSha,
          invoice,
          invoiceSha,
          deliveries,
        };
      });

      const sent = await sendQueued(
        ctx,
        prepared.job.id,
        prepared.job.org_id,
        prepared.deliveries,
        principal,
      );
      return {
        reportId: prepared.reportId,
        version: prepared.version,
        snapshotHash: prepared.snapshotHash,
        contentHash: prepared.contentHash,
        pdfSha256: prepared.pdfSha,
        invoice: {
          number: prepared.invoice.number,
          totalCents: prepared.invoice.totalCents,
          gstCents: prepared.invoice.gstCents,
          pdfSha256: prepared.invoiceSha,
        },
        deliveries: sent,
      };
    },
  });

  const reportAccess = async (
    ctx: AppContext,
    principal: Parameters<typeof authorize>[0],
    reportId: string,
  ) => {
    const { rows } = await ctx.db.query<{
      id: string;
      job_id: string;
      org_id: string;
      version: number;
      status: string;
      snapshot_hash: string;
      pdf_sha256: string;
      issued_at: Date | string;
    }>(
      'SELECT id, job_id, org_id, version, status, snapshot_hash, pdf_sha256, issued_at FROM report WHERE id = $1',
      [reportId],
    );
    const report = rows[0];
    if (!report || report.org_id !== principal.orgId) throw notFound('report');
    const job = await getJob(ctx.db, report.job_id);
    const resource = { ...(await jobResource(ctx.db, job)), reportIssued: true };
    const canJob = authorize(principal, 'job.read', resource).allowed;
    if (!canJob)
      await authorizeOrThrow(ctx, principal, 'report.read_issued', resource, {
        type: 'report',
        id: reportId,
      });
    return { report, job, resource };
  };

  r.add({
    method: 'GET',
    url: '/v1/reports/:reportId',
    summary: 'Issued report metadata and delivery status',
    tags: ['reports'],
    permission: 'report.read_issued | job.read',
    params: z.object({ reportId: Uuid }),
    handler: async ({ ctx, principal, params }) => {
      const { report } = await reportAccess(ctx, principal, params.reportId);
      const deliveries = await ctx.db.query(
        'SELECT id, recipient, status, provider_message_id, payload_hash FROM email_delivery WHERE report_id = $1 ORDER BY created_at, id',
        [report.id],
      );
      const invoice = await ctx.db.query(
        'SELECT number, subtotal_cents, gst_cents, total_cents, pdf_sha256 FROM invoice WHERE report_id = $1',
        [report.id],
      );
      return {
        ...report,
        issued_at: new Date(report.issued_at).toISOString(),
        invoice: invoice.rows[0] ?? null,
        deliveries: deliveries.rows,
      };
    },
  });

  r.add({
    method: 'GET',
    url: '/v1/reports/:reportId/pdf',
    summary: 'Download the immutable issued PDF',
    tags: ['reports'],
    permission: 'report.read_issued | job.read',
    params: z.object({ reportId: Uuid }),
    produces: 'application/pdf',
    handler: async ({ ctx, principal, params, reply }) => {
      const { report, job } = await reportAccess(ctx, principal, params.reportId);
      const { rows } = await ctx.db.query<{ pdf: Uint8Array }>(
        'SELECT pdf FROM report WHERE id = $1',
        [report.id],
      );
      await ctx.db.transaction((tx) =>
        audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'report.accessed',
          entityType: 'report',
          entityId: report.id,
        }),
      );
      return reply.type('application/pdf').send(Buffer.from(rows[0]?.pdf ?? new Uint8Array()));
    },
  });

  r.add({
    method: 'GET',
    url: '/v1/reports/:reportId/invoice.pdf',
    summary: 'Download the tax invoice for an issued report',
    tags: ['reports'],
    permission: 'invoice.read',
    params: z.object({ reportId: Uuid }),
    produces: 'application/pdf',
    handler: async ({ ctx, principal, params, reply }) => {
      const { report, resource } = await reportAccess(ctx, principal, params.reportId);
      await authorizeOrThrow(ctx, principal, 'invoice.read', resource, {
        type: 'invoice',
        id: report.id,
      });
      const { rows } = await ctx.db.query<{ pdf: Uint8Array }>(
        'SELECT pdf FROM invoice WHERE report_id = $1',
        [report.id],
      );
      if (!rows[0]) throw notFound('invoice');
      return reply.type('application/pdf').send(Buffer.from(rows[0].pdf));
    },
  });

  r.add({
    method: 'POST',
    url: '/v1/reports/:reportId/reproduce',
    summary:
      'Re-render the PDF, invoice and email payloads from the immutable snapshot and compare hashes',
    tags: ['reports'],
    permission: 'job.read',
    params: z.object({ reportId: Uuid }),
    handler: async ({ ctx, principal, params }) => {
      const { report } = await reportAccess(ctx, principal, params.reportId);
      const { rows } = await ctx.db.query<{
        snapshot: IssueSnapshot;
        snapshot_hash: string;
        pdf_sha256: string;
      }>('SELECT snapshot, snapshot_hash, pdf_sha256 FROM report WHERE id = $1', [report.id]);
      const row = rows[0];
      if (!row) throw notFound('report');
      const s = row.snapshot;
      const snapshotIntact = hashCanonical(s) === row.snapshot_hash;
      const pdf = await renderReportPdf(
        composeReport(s.reportData, s.template),
        s.renderAssets,
        s.issuedAt,
      );
      const invoicePdf = await renderInvoicePdf(s.invoice, s.issuedAt);
      const inv = await ctx.db.query<{ pdf_sha256: string }>(
        'SELECT pdf_sha256 FROM invoice WHERE report_id = $1',
        [report.id],
      );
      const deliveries = await ctx.db.query<{ recipient: string; payload_hash: string }>(
        'SELECT recipient, payload_hash FROM email_delivery WHERE report_id = $1 ORDER BY created_at, id',
        [report.id],
      );
      const emails = deliveries.rows.map((d) => {
        const e = s.emails.find((m) => m.to === d.recipient);
        const reproduced = e
          ? emailPayloadHash({
              ...e,
              attachments: e.attachments.map((a) => ({ ...a, bytes: new Uint8Array() })),
            })
          : null;
        return {
          recipient: d.recipient,
          stored: d.payload_hash,
          reproduced,
          match: reproduced === d.payload_hash,
        };
      });
      const pdfSha = sha256Hex(pdf);
      const invoiceSha = sha256Hex(invoicePdf);
      const result = {
        snapshotIntact,
        pdf: { stored: row.pdf_sha256, reproduced: pdfSha, match: pdfSha === row.pdf_sha256 },
        invoice: {
          stored: inv.rows[0]?.pdf_sha256 ?? null,
          reproduced: invoiceSha,
          match: invoiceSha === inv.rows[0]?.pdf_sha256,
        },
        emails,
      };
      return {
        ...result,
        reproducible:
          snapshotIntact &&
          result.pdf.match &&
          result.invoice.match &&
          emails.every((e) => e.match),
      };
    },
  });

  r.add({
    method: 'POST',
    url: '/v1/email-deliveries/:id/status',
    summary: 'Email provider delivery-status callback (system actor)',
    tags: ['reports'],
    permission: 'email.send (system)',
    params: z.object({ id: Uuid }),
    body: z.object({
      status: z.enum(['delivered', 'bounced', 'failed']),
      providerMessageId: z.string().optional(),
    }),
    handler: async ({ ctx, principal, params, body }) => {
      if (principal.kind !== 'system')
        throw new HttpError(
          403,
          'SYSTEM_ONLY',
          'delivery callbacks come from the email integration',
        );
      return ctx.db.transaction(async (tx) => {
        const { rows } = await tx.query<{ job_id: string; org_id: string; status: string }>(
          'SELECT job_id, org_id, status FROM email_delivery WHERE id = $1 FOR UPDATE',
          [params.id],
        );
        const d = rows[0];
        if (!d || d.org_id !== principal.orgId) throw notFound('delivery');
        await tx.query('UPDATE email_delivery SET status = $2, updated_at = $3 WHERE id = $1', [
          params.id,
          body.status,
          ctx.clock.now(),
        ]);
        await audit(tx, ctx, {
          orgId: d.org_id,
          streamId: jobStream(d.job_id),
          actor: principal,
          action: 'email.delivery_updated',
          entityType: 'email_delivery',
          entityId: params.id,
          before: { status: d.status },
          after: { status: body.status },
        });
        return { id: params.id, status: body.status };
      });
    },
  });
}
