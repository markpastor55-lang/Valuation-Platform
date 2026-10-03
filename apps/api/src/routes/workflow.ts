import {
  acknowledgeFinding,
  answerChecklistItem,
  assertEditable,
  closeFinding,
  completeQaReview,
  raiseFinding,
  respondToFinding,
  signCertification,
  startQaReview,
  transitionJob,
  type CertificationContent,
  type JobAction,
  type Json,
  type Permission,
  type Principal,
  type QaReview,
} from '@vp/domain';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { denied, HttpError, notFound } from '../http/errors.js';
import type { Router } from '../http/route.js';
import { authorizeJob, touchJob, type JobRow } from '../repo/jobs.js';
import {
  engagementDocumentCount,
  loadAggregate,
  snapshotHashOf,
  validate,
  workflowContextOf,
  type JobAggregate,
} from '../services/aggregate.js';
import { audit, jobStream } from '../services/audit.js';
import { JobParams, LocalDateSchema, Uuid } from './schemas.js';

async function transition(
  tx: Db,
  ctx: AppContext,
  principal: Principal,
  job: JobRow,
  agg: JobAggregate,
  action: JobAction,
  extras: { reason?: string } = {},
) {
  const stage = action === 'issue' ? 'issue' : 'submit';
  const validation = validate(agg, stage, ctx);
  const wf = workflowContextOf(agg, principal, {
    validation,
    engagementDocumentCount: await engagementDocumentCount(tx, agg),
    ...extras,
  });
  const { status, auditAction } = transitionJob(action, wf);
  await tx.query('UPDATE job SET status = $2, updated_at = $3 WHERE id = $1', [
    job.id,
    status,
    ctx.clock.now(),
  ]);
  await audit(tx, ctx, {
    orgId: job.org_id,
    streamId: jobStream(job.id),
    actor: principal,
    action: auditAction,
    entityType: 'job',
    entityId: job.id,
    ...(extras.reason ? { reason: extras.reason } : {}),
    before: { status: job.status },
    after: { status, snapshotHash: wf.currentSnapshotHash ?? null },
  });
  return { status, snapshotHash: wf.currentSnapshotHash, validation };
}

async function saveReview(tx: Db, review: QaReview): Promise<void> {
  await tx.query('UPDATE qa_review SET data = $2, outcome = $3, completed_at = $4 WHERE id = $1', [
    review.id,
    JSON.stringify(review),
    review.outcome ?? null,
    review.completedAt ?? null,
  ]);
}

async function currentReview(tx: Db, job: JobRow): Promise<QaReview> {
  const { rows } = await tx.query<{ data: QaReview }>(
    'SELECT data FROM qa_review WHERE job_id = $1 ORDER BY started_at DESC, id DESC LIMIT 1',
    [job.id],
  );
  if (!rows[0]) throw new HttpError(409, 'NO_QA_REVIEW', 'QA review has not been started');
  return rows[0].data;
}

const CertificationBody = z.object({
  valuer: z.object({
    fullName: z.string().min(2),
    credentials: z.array(z.string()).min(1),
    registration: z.object({ jurisdiction: z.string(), number: z.string() }).optional(),
  }),
  inspectionScopeStatement: z.string().min(5),
  valuationDate: LocalDateSchema,
  basisOfValue: z.string().min(3),
  amount: z.object({
    value: z.number().positive(),
    kind: z.enum(['value', 'market_rent', 'sum_insured']),
  }),
  independenceStatement: z.string().min(5),
  conflictsStatement: z.string().min(2),
  assumptions: z.array(z.string()),
  specialAssumptions: z.array(z.string()),
  limitations: z.array(z.string()).min(1),
  standardsReliedOn: z.array(z.string()).min(1),
  attestationText: z.string().min(20),
});

export function registerWorkflowRoutes(r: Router): void {
  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/validate',
    summary: 'Run the validation rules catalogue for a stage',
    tags: ['validation'],
    permission: 'job.read',
    params: JobParams,
    body: z.object({ stage: z.enum(['draft', 'submit', 'issue']).default('submit') }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'job.read', params.jobId);
        const agg = await loadAggregate(tx, job.id, job);
        const result = validate(agg, body.stage, ctx);
        await tx.query(
          'INSERT INTO validation_run (id, org_id, job_id, stage, result, ran_by, ran_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            ctx.newId(),
            job.org_id,
            job.id,
            body.stage,
            JSON.stringify(result),
            principal.userId,
            ctx.clock.now(),
          ],
        );
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'validation.run',
          entityType: 'job',
          entityId: job.id,
          after: {
            stage: body.stage,
            blocking: result.blockingCount,
            warnings: result.unacknowledgedWarningCount,
          },
        });
        return result;
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/acknowledgements',
    summary: 'Acknowledge a warning with a reason (blocking findings cannot be acknowledged)',
    tags: ['validation'],
    permission: 'validation.acknowledge',
    params: JobParams,
    body: z.object({ code: z.string(), path: z.string(), reason: z.string() }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(
          ctx,
          tx,
          principal,
          'validation.acknowledge',
          params.jobId,
          { forUpdate: true },
        );
        assertEditable(job.status);
        const agg = await loadAggregate(tx, job.id, job);
        const finding = validate(agg, 'submit', ctx).findings.find(
          (f) => f.code === body.code && f.path === body.path,
        );
        if (!finding) throw notFound('finding');
        const ack = acknowledgeFinding(finding, principal.userId, ctx.clock.now(), body.reason);
        await tx.query(
          `INSERT INTO validation_acknowledgement (id, org_id, job_id, code, path, reason, ack_by, ack_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (job_id, code, path) DO UPDATE SET reason = EXCLUDED.reason, ack_by = EXCLUDED.ack_by, ack_at = EXCLUDED.ack_at`,
          [ctx.newId(), job.org_id, job.id, ack.code, ack.path, ack.reason, ack.by, ack.at],
        );
        await touchJob(tx, job.id, ack.at);
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'validation.acknowledged',
          entityType: 'job',
          entityId: job.id,
          reason: ack.reason,
          after: { code: ack.code, path: ack.path },
        });
        return ack;
      }),
  });

  const simpleTransition = (
    url: string,
    action: JobAction,
    permission: Permission,
    summary: string,
    needsReason: boolean,
  ) => {
    r.add({
      method: 'POST',
      url,
      summary,
      tags: ['workflow'],
      permission,
      params: JobParams,
      body: z.object({ reason: needsReason ? z.string().min(10) : z.string().optional() }),
      handler: async ({ ctx, principal, params, body }) =>
        ctx.db.transaction(async (tx) => {
          const { job } = await authorizeJob(ctx, tx, principal, permission, params.jobId, {
            forUpdate: true,
          });
          const agg = await loadAggregate(tx, job.id, job);
          const res = await transition(
            tx,
            ctx,
            principal,
            job,
            agg,
            action,
            body.reason ? { reason: body.reason } : {},
          );
          return { status: res.status };
        }),
    });
  };

  simpleTransition(
    '/v1/jobs/:jobId/engagement/accept',
    'acceptEngagement',
    'engagement.accept',
    'Accept the engagement (conflict check, allocation and documents required)',
    false,
  );
  simpleTransition(
    '/v1/jobs/:jobId/cancel',
    'cancel',
    'job.cancel',
    'Cancel a job (reason required)',
    true,
  );
  simpleTransition(
    '/v1/jobs/:jobId/amend',
    'openAmendment',
    'job.update',
    'Open an amendment of an issued report (new version; issued copy is kept)',
    true,
  );

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/certification',
    summary: 'Responsible valuer signs the certification for the current content (MFA, human only)',
    tags: ['workflow'],
    permission: 'certification.sign',
    params: JobParams,
    body: CertificationBody,
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'certification.sign', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        const agg = await loadAggregate(tx, job.id, job);
        const snapshotHash = snapshotHashOf(agg);
        const content: CertificationContent = {
          jobId: job.id,
          valuer: {
            userId: principal.userId,
            fullName: body.valuer.fullName,
            credentials: body.valuer.credentials,
            ...(body.valuer.registration ? { registration: body.valuer.registration } : {}),
          },
          role: 'responsible_valuer',
          inspectionScope: agg.selection.scope,
          inspectionScopeStatement: body.inspectionScopeStatement,
          valuationDate: body.valuationDate,
          basisOfValue: body.basisOfValue,
          amount: { value: body.amount.value, currency: 'AUD', kind: body.amount.kind },
          independenceStatement: body.independenceStatement,
          conflictsStatement: body.conflictsStatement,
          assumptions: body.assumptions,
          specialAssumptions: body.specialAssumptions,
          limitations: body.limitations,
          standardsReliedOn: body.standardsReliedOn,
          clauseVersionIds: (agg.template?.clauses ?? [])
            .filter((c) => c.clauseId === 'certification-core')
            .map((c) => `${c.clauseId}@${c.version}`),
        };
        if (agg.values.job['dates.valuation'] !== body.valuationDate) {
          throw new HttpError(
            422,
            'CERTIFICATION_MISMATCH',
            'certified valuation date must match the job valuation date',
          );
        }
        const cert = signCertification(content, {
          id: ctx.newId(),
          actor: principal,
          responsibleValuerId: job.responsible_valuer_id ?? '',
          snapshotHash,
          at: ctx.clock.now(),
          attestationText: body.attestationText,
        });
        await tx.query(
          'INSERT INTO certification (id, org_id, job_id, data, snapshot_hash, signed_by, signed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            cert.id,
            job.org_id,
            job.id,
            JSON.stringify(cert),
            snapshotHash,
            principal.userId,
            cert.signedAt,
          ],
        );
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'certification.signed',
          entityType: 'certification',
          entityId: cert.id,
          after: {
            snapshotHash,
            amount: cert.amount.value,
            attestationHash: cert.signature.attestationHash,
          },
        });
        return cert;
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/submit',
    summary: 'Submit for QA: requires clean validation and a current certification; locks content',
    tags: ['workflow'],
    permission: 'certification.sign',
    params: JobParams,
    handler: async ({ ctx, principal, params }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'certification.sign', params.jobId, {
          forUpdate: true,
        });
        const agg = await loadAggregate(tx, job.id, job);
        const res = await transition(tx, ctx, principal, job, agg, 'submitForQa');
        await tx.query('UPDATE job SET submitted_snapshot_hash = $2 WHERE id = $1', [
          job.id,
          res.snapshotHash,
        ]);
        return { status: res.status, snapshotHash: res.snapshotHash };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/qa/self-approval-exception',
    summary: 'Authorise a documented self-approval exception (another person, MFA)',
    tags: ['qa'],
    permission: 'qa.self_approval_exception',
    params: JobParams,
    body: z.object({ reason: z.string().min(20) }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(
          ctx,
          tx,
          principal,
          'qa.self_approval_exception',
          params.jobId,
          { forUpdate: true },
        );
        const id = ctx.newId();
        await tx.query(
          'INSERT INTO self_approval_exception (id, org_id, job_id, authorised_by, reason, authorised_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [id, job.org_id, job.id, principal.userId, body.reason, ctx.clock.now()],
        );
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'qa.self_approval_exception_authorised',
          entityType: 'job',
          entityId: job.id,
          reason: body.reason,
        });
        return { id };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/qa/start',
    summary: 'Reviewer starts QA on the submitted snapshot',
    tags: ['qa'],
    permission: 'qa.review',
    params: JobParams,
    handler: async ({ ctx, principal, params }) =>
      ctx.db.transaction(async (tx) => {
        const { job, resource } = await authorizeJob(
          ctx,
          tx,
          principal,
          'qa.review',
          params.jobId,
          { forUpdate: true },
        );
        const agg = await loadAggregate(tx, job.id, job);
        if (job.submitted_snapshot_hash !== snapshotHashOf(agg)) {
          throw new HttpError(
            409,
            'SNAPSHOT_MISMATCH',
            'content differs from the submitted snapshot',
          );
        }
        const res = await transition(tx, ctx, principal, job, agg, 'startReview');
        const exception = resource.selfApprovalExceptionAuthorised
          ? (
              await tx.query<{
                authorised_by: string;
                reason: string;
                authorised_at: Date | string;
              }>(
                'SELECT authorised_by, reason, authorised_at FROM self_approval_exception WHERE job_id = $1 ORDER BY authorised_at DESC LIMIT 1',
                [job.id],
              )
            ).rows[0]
          : undefined;
        const fresh = startQaReview({
          id: ctx.newId(),
          jobId: job.id,
          reviewerId: principal.userId,
          snapshotHash: res.snapshotHash ?? '',
          at: ctx.clock.now(),
          ...(exception
            ? {
                selfApprovalException: {
                  authorisedBy: exception.authorised_by,
                  reason: exception.reason,
                  at: new Date(exception.authorised_at).toISOString(),
                },
              }
            : {}),
        });
        // Findings from a review that returned the job carry forward until the reviewer closes them.
        const carried = agg.qaReview?.outcome === 'returned' ? agg.qaReview.findings : [];
        const review: QaReview = { ...fresh, findings: carried };
        await tx.query(
          'INSERT INTO qa_review (id, org_id, job_id, reviewer_id, reviewed_snapshot_hash, data, started_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            review.id,
            job.org_id,
            job.id,
            principal.userId,
            review.reviewedSnapshotHash,
            JSON.stringify(review),
            review.startedAt,
          ],
        );
        await tx.query('UPDATE job SET reviewer_id = $2 WHERE id = $1', [job.id, principal.userId]);
        return review;
      }),
  });

  const reviewEdit = <B>(
    url: string,
    summary: string,
    permission: Permission,
    body: z.ZodType<B>,
    apply: (
      review: QaReview,
      body: B,
      principal: Principal,
      at: string,
      ctx: AppContext,
      job: JobRow,
    ) => QaReview,
    auditAction: string,
  ) => {
    r.add({
      method: 'POST',
      url,
      summary,
      tags: ['qa'],
      permission,
      params: z.object({ jobId: Uuid, findingId: z.string().optional() }),
      body,
      handler: async ({ ctx, principal, params, body: b }) =>
        ctx.db.transaction(async (tx) => {
          const { job } = await authorizeJob(ctx, tx, principal, permission, params.jobId, {
            forUpdate: true,
          });
          const review = await currentReview(tx, job);
          const updated = apply(
            review,
            { ...b, findingId: params.findingId },
            principal,
            ctx.clock.now(),
            ctx,
            job,
          );
          await saveReview(tx, updated);
          await audit(tx, ctx, {
            orgId: job.org_id,
            streamId: jobStream(job.id),
            actor: principal,
            action: auditAction,
            entityType: 'qa_review',
            entityId: review.id,
            after: b as unknown as Json,
          });
          return updated;
        }),
    });
  };

  reviewEdit(
    '/v1/jobs/:jobId/qa/checklist',
    'Answer a QA checklist item',
    'qa.review',
    z.object({
      itemId: z.string(),
      response: z.enum(['yes', 'no', 'na']),
      note: z.string().optional(),
    }),
    (review, b, principal) => {
      if (review.reviewerId !== principal.userId)
        throw denied(
          principal,
          'qa.review',
          { type: 'job', id: review.jobId },
          'NOT_REVIEWER',
          'only the assigned reviewer can answer the checklist',
        );
      return answerChecklistItem(review, b.itemId, b.response, b.note);
    },
    'qa.checklist_answered',
  );

  reviewEdit(
    '/v1/jobs/:jobId/qa/findings',
    'Raise a QA finding with severity',
    'qa.review',
    z.object({
      severity: z.enum(['critical', 'major', 'minor', 'observation']),
      category: z.string().min(2),
      description: z.string().min(5),
      ref: z.string().optional(),
    }),
    (review, b, principal, at, ctx) => {
      if (review.reviewerId !== principal.userId)
        throw denied(
          principal,
          'qa.review',
          { type: 'job', id: review.jobId },
          'NOT_REVIEWER',
          'only the assigned reviewer can raise findings',
        );
      return raiseFinding(review, {
        id: ctx.newId(),
        severity: b.severity,
        category: b.category,
        description: b.description,
        raisedAt: at,
        ...(b.ref ? { ref: b.ref } : {}),
      });
    },
    'qa.finding_raised',
  );

  reviewEdit(
    '/v1/jobs/:jobId/qa/findings/:findingId/respond',
    'Valuer responds to a finding',
    'job.update',
    z.object({ response: z.string().min(3), findingId: z.string().optional() }),
    (review, b, principal, at, _ctx, job) => {
      if (job.responsible_valuer_id !== principal.userId) {
        throw denied(
          principal,
          'job.update',
          { type: 'job', id: job.id },
          'NOT_RESPONSIBLE_VALUER',
          'only the responsible valuer responds to findings',
        );
      }
      if (job.status !== 'returned') {
        throw new HttpError(
          409,
          'INVALID_TRANSITION',
          'findings are answered after the job is returned',
        );
      }
      return respondToFinding(review, b.findingId ?? '', b.response, principal.userId, at);
    },
    'qa.finding_responded',
  );

  reviewEdit(
    '/v1/jobs/:jobId/qa/findings/:findingId/close',
    'Reviewer records the disposition of a finding',
    'qa.review',
    z.object({
      status: z.enum(['resolved', 'accepted', 'withdrawn']),
      note: z.string().default(''),
      findingId: z.string().optional(),
    }),
    (review, b, principal, at) =>
      closeFinding(review, b.findingId ?? '', {
        status: b.status,
        note: b.note,
        by: principal.userId,
        at,
      }),
    'qa.finding_closed',
  );

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/qa/return',
    summary: 'Return the job to the valuer (unlocks content)',
    tags: ['qa'],
    permission: 'qa.review',
    params: JobParams,
    body: z.object({ reason: z.string().optional() }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'qa.review', params.jobId, {
          forUpdate: true,
        });
        const agg = await loadAggregate(tx, job.id, job);
        if (agg.qaReview && agg.qaReview.reviewerId !== principal.userId) {
          throw denied(
            principal,
            'qa.review',
            { type: 'job', id: job.id },
            'NOT_REVIEWER',
            'only the reviewer conducting the review can return the job',
          );
        }
        const res = await transition(
          tx,
          ctx,
          principal,
          job,
          agg,
          'returnToValuer',
          body.reason ? { reason: body.reason } : {},
        );
        if (agg.qaReview)
          await saveReview(tx, completeQaReview(agg.qaReview, 'returned', ctx.clock.now()));
        return { status: res.status };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/qa/approve',
    summary: 'Approve after an independent review (checklist complete, findings closed)',
    tags: ['qa'],
    permission: 'qa.approve',
    params: JobParams,
    handler: async ({ ctx, principal, params }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'qa.approve', params.jobId, {
          forUpdate: true,
        });
        const agg = await loadAggregate(tx, job.id, job);
        const res = await transition(tx, ctx, principal, job, agg, 'approve');
        if (!agg.qaReview)
          throw new HttpError(409, 'NO_QA_REVIEW', 'QA review has not been started');
        await saveReview(tx, completeQaReview(agg.qaReview, 'approved', ctx.clock.now()));
        await tx.query('UPDATE job SET approved_snapshot_hash = $2 WHERE id = $1', [
          job.id,
          res.snapshotHash,
        ]);
        await touchJob(tx, job.id, ctx.clock.now());
        return { status: res.status, approvedSnapshotHash: res.snapshotHash };
      }),
  });
}
