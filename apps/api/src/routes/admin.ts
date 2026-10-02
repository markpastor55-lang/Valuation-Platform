import {
  SPECIALIST_REVIEWERS,
  approveClause,
  approveTemplateVersion,
  hashCanonical,
  lintRuleSet,
  lintTemplate,
  verifyAuditChain,
  type Json,
  type RuleSetVersion,
  type TemplateVersion,
} from '@vp/domain';
import { z } from 'zod';
import type { Db } from '../db/db.js';
import { denied, HttpError, notFound } from '../http/errors.js';
import type { Router } from '../http/route.js';
import { authorizeJob, authorizeOrThrow } from '../repo/jobs.js';
import { audit, jobStream, loadStream, orgStream } from '../services/audit.js';
import { JobParams, Uuid } from './schemas.js';

export function registerAdminRoutes(r: Router): void {
  r.add({
    method: 'GET',
    url: '/v1/admin/templates',
    summary: 'List template versions',
    tags: ['administration'],
    permission: 'template.edit',
    handler: async ({ ctx, principal }) => {
      await authorizeOrThrow(
        ctx,
        principal,
        'template.edit',
        { orgId: principal.orgId },
        { type: 'template', id: '*' },
      );
      const { rows } = await ctx.db.query(
        'SELECT template_id, version, status, authored_by, approved_by, approved_at, content_hash FROM template_version WHERE org_id = $1 ORDER BY template_id, version',
        [principal.orgId],
      );
      return { templates: rows };
    },
  });

  r.add({
    method: 'POST',
    url: '/v1/admin/templates',
    summary: 'Create a new draft template version (clause wording authored by the firm)',
    tags: ['administration'],
    permission: 'template.edit',
    body: z.object({ template: z.record(z.string(), z.unknown()) }),
    handler: async ({ ctx, principal, body }) => {
      await authorizeOrThrow(
        ctx,
        principal,
        'template.edit',
        { orgId: principal.orgId },
        { type: 'template', id: 'new' },
      );
      const input = body.template as unknown as TemplateVersion;
      if (
        typeof input.templateId !== 'string' ||
        !Array.isArray(input.sections) ||
        !Array.isArray(input.clauses)
      ) {
        throw new HttpError(
          422,
          'INVALID_TEMPLATE',
          'template must include templateId, sections and clauses',
        );
      }
      const problems = lintTemplate(input);
      if (problems.length)
        throw new HttpError(422, 'INVALID_TEMPLATE', 'template has structural problems', {
          problems,
        });
      return ctx.db.transaction(async (tx) => {
        const { rows } = await tx.query<{ v: number | null }>(
          'SELECT max(version) AS v FROM template_version WHERE org_id = $1 AND template_id = $2',
          [principal.orgId, input.templateId],
        );
        const version = (rows[0]?.v ?? 0) + 1;
        const now = ctx.clock.now();
        const template: TemplateVersion = {
          ...input,
          version,
          status: 'draft',
          reviews: [],
          authoredBy: principal.userId,
          createdAt: now,
          clauses: input.clauses.map((c) => ({
            ...c,
            status: c.status === 'placeholder' ? 'placeholder' : 'draft',
          })),
        };
        const id = ctx.newId();
        await tx.query(
          'INSERT INTO template_version (id, org_id, template_id, version, status, content, content_hash, authored_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [
            id,
            principal.orgId,
            template.templateId,
            version,
            'draft',
            JSON.stringify(template),
            hashCanonical(template),
            principal.userId,
            now,
          ],
        );
        await audit(tx, ctx, {
          orgId: principal.orgId,
          streamId: orgStream(principal.orgId),
          actor: principal,
          action: 'template.version_created',
          entityType: 'template_version',
          entityId: id,
          after: { templateId: template.templateId, version },
        });
        return { id, templateId: template.templateId, version, status: 'draft' };
      });
    },
  });

  const templateRow = async (db: Db, orgId: string, templateId: string, version: number) => {
    const { rows } = await db.query<{
      id: string;
      content: TemplateVersion;
      status: TemplateVersion['status'];
    }>(
      'SELECT id, content, status FROM template_version WHERE org_id = $1 AND template_id = $2 AND version = $3 FOR UPDATE',
      [orgId, templateId, version],
    );
    if (!rows[0]) throw notFound('template version');
    return rows[0];
  };

  r.add({
    method: 'POST',
    url: '/v1/admin/templates/:templateId/versions/:version/reviews',
    summary: 'Record a specialist review outcome for a template version',
    tags: ['administration'],
    permission: 'template.approve',
    params: z.object({ templateId: z.string(), version: z.coerce.number().int().positive() }),
    body: z.object({
      reviewer: z.enum(SPECIALIST_REVIEWERS),
      outcome: z.enum(['approved', 'changes_requested']),
      notes: z.string().min(5),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        await authorizeOrThrow(
          ctx,
          principal,
          'template.approve',
          { orgId: principal.orgId },
          { type: 'template', id: params.templateId },
        );
        const row = await templateRow(tx, principal.orgId, params.templateId, params.version);
        if (row.status === 'approved' || row.status === 'retired')
          throw new HttpError(409, 'IMMUTABLE_RECORD', `template is ${row.status}`);
        const updated: TemplateVersion = {
          ...row.content,
          status: 'in_review',
          reviews: [
            ...row.content.reviews,
            {
              reviewer: body.reviewer,
              userId: principal.userId,
              at: ctx.clock.now(),
              outcome: body.outcome,
              notes: body.notes,
            },
          ],
        };
        await tx.query(
          "UPDATE template_version SET content = $2, status = 'in_review', content_hash = $3 WHERE id = $1",
          [row.id, JSON.stringify(updated), hashCanonical(updated)],
        );
        await audit(tx, ctx, {
          orgId: principal.orgId,
          streamId: orgStream(principal.orgId),
          actor: principal,
          action: 'template.review_recorded',
          entityType: 'template_version',
          entityId: row.id,
          after: { reviewer: body.reviewer, outcome: body.outcome },
        });
        return { status: 'in_review', reviews: updated.reviews };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/admin/templates/:templateId/versions/:version/approve',
    summary: 'Standards owner approves a template version and its clauses (not the author; MFA)',
    tags: ['administration'],
    permission: 'template.approve',
    params: z.object({ templateId: z.string(), version: z.coerce.number().int().positive() }),
    handler: async ({ ctx, principal, params }) =>
      ctx.db.transaction(async (tx) => {
        const row = await templateRow(tx, principal.orgId, params.templateId, params.version);
        await authorizeOrThrow(
          ctx,
          principal,
          'template.approve',
          { orgId: principal.orgId, authorId: row.content.authoredBy },
          { type: 'template', id: row.id },
        );
        const now = ctx.clock.now();
        const withClauses: TemplateVersion = {
          ...row.content,
          status: row.status,
          clauses: row.content.clauses.map((c) =>
            c.status === 'approved' ? c : approveClause(c, principal, now),
          ),
        };
        const approved = approveTemplateVersion(withClauses, principal, now);
        await tx.query(
          "UPDATE template_version SET content = $2, status = 'approved', content_hash = $3, approved_by = $4, approved_at = $5 WHERE id = $1",
          [row.id, JSON.stringify(approved), hashCanonical(approved), principal.userId, now],
        );
        await audit(tx, ctx, {
          orgId: principal.orgId,
          streamId: orgStream(principal.orgId),
          actor: principal,
          action: 'template.version_approved',
          entityType: 'template_version',
          entityId: row.id,
          after: { templateId: approved.templateId, version: approved.version },
        });
        return { id: row.id, status: 'approved' };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/admin/rulesets/:ruleSetId/versions/:version/approve',
    summary: 'Standards owner approves a rule-set version (not the author; MFA)',
    tags: ['administration'],
    permission: 'ruleset.approve',
    params: z.object({ ruleSetId: z.string(), version: z.string() }),
    body: z.object({ notes: z.string().min(5) }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { rows } = await tx.query<{
          id: string;
          content: RuleSetVersion;
          status: string;
          authored_by: string;
        }>(
          'SELECT id, content, status, authored_by FROM rule_set_version WHERE org_id = $1 AND rule_set_id = $2 AND version = $3 FOR UPDATE',
          [principal.orgId, params.ruleSetId, params.version],
        );
        const row = rows[0];
        if (!row) throw notFound('rule set version');
        await authorizeOrThrow(
          ctx,
          principal,
          'ruleset.approve',
          { orgId: principal.orgId, authorId: row.authored_by },
          { type: 'rule_set', id: row.id },
        );
        if (row.status === 'approved' || row.status === 'retired')
          throw new HttpError(409, 'IMMUTABLE_RECORD', `rule set is ${row.status}`);
        const problems = lintRuleSet(row.content);
        if (problems.length)
          throw new HttpError(422, 'INVALID_RULE_SET', 'rule set has problems', { problems });
        const now = ctx.clock.now();
        await tx.query(
          "UPDATE rule_set_version SET status = 'approved', approved_by = $2, approved_at = $3 WHERE id = $1",
          [row.id, principal.userId, now],
        );
        await audit(tx, ctx, {
          orgId: principal.orgId,
          streamId: orgStream(principal.orgId),
          actor: principal,
          action: 'ruleset.version_approved',
          entityType: 'rule_set_version',
          entityId: row.id,
          reason: body.notes,
          after: { ruleSetId: params.ruleSetId, version: params.version },
        });
        return { id: row.id, status: 'approved' };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/admin/clients/:clientId/recipients',
    summary: 'Approve an email recipient for a client',
    tags: ['administration'],
    permission: 'job.allocate',
    params: z.object({ clientId: Uuid }),
    body: z.object({ email: z.email() }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const c = await tx.query<{ org_id: string }>('SELECT org_id FROM client WHERE id = $1', [
          params.clientId,
        ]);
        if (c.rows[0]?.org_id !== principal.orgId) throw notFound('client');
        await authorizeOrThrow(
          ctx,
          principal,
          'job.allocate',
          { orgId: principal.orgId },
          { type: 'client', id: params.clientId },
        );
        const id = ctx.newId();
        await tx.query(
          'INSERT INTO approved_recipient (id, org_id, client_id, email, approved_by, approved_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [id, principal.orgId, params.clientId, body.email, principal.userId, ctx.clock.now()],
        );
        await audit(tx, ctx, {
          orgId: principal.orgId,
          streamId: orgStream(principal.orgId),
          actor: principal,
          action: 'recipient.approved',
          entityType: 'approved_recipient',
          entityId: id,
          after: { clientId: params.clientId, email: body.email },
        });
        return { id };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/admin/legal-holds',
    summary: 'Apply a legal hold (blocks deletion and retention disposal)',
    tags: ['administration'],
    permission: 'legal_hold.manage',
    body: z.object({
      scopeType: z.enum(['job', 'client', 'portfolio']),
      scopeId: Uuid,
      reason: z.string().min(10),
    }),
    handler: async ({ ctx, principal, body }) =>
      ctx.db.transaction(async (tx) => {
        await authorizeOrThrow(
          ctx,
          principal,
          'legal_hold.manage',
          { orgId: principal.orgId },
          { type: 'legal_hold', id: body.scopeId },
        );
        const id = ctx.newId();
        await tx.query(
          'INSERT INTO legal_hold (id, org_id, scope_type, scope_id, reason, applied_by, applied_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            id,
            principal.orgId,
            body.scopeType,
            body.scopeId,
            body.reason,
            principal.userId,
            ctx.clock.now(),
          ],
        );
        await audit(tx, ctx, {
          orgId: principal.orgId,
          streamId: orgStream(principal.orgId),
          actor: principal,
          action: 'legal_hold.applied',
          entityType: body.scopeType,
          entityId: body.scopeId,
          reason: body.reason,
        });
        return { id };
      }),
  });

  r.add({
    method: 'GET',
    url: '/v1/jobs/:jobId/audit',
    summary: 'Audit events for a job (hash chained)',
    tags: ['audit'],
    permission: 'audit.read',
    params: JobParams,
    handler: async ({ ctx, principal, params }) => {
      await authorizeJob(ctx, ctx.db, principal, 'audit.read', params.jobId);
      return { events: await loadStream(ctx.db, jobStream(params.jobId)) };
    },
  });

  r.add({
    method: 'GET',
    url: '/v1/jobs/:jobId/audit/verify',
    summary: 'Verify the integrity of the job audit chain',
    tags: ['audit'],
    permission: 'audit.read',
    params: JobParams,
    handler: async ({ ctx, principal, params }) => {
      await authorizeJob(ctx, ctx.db, principal, 'audit.read', params.jobId);
      return verifyAuditChain(await loadStream(ctx.db, jobStream(params.jobId)));
    },
  });

  r.add({
    method: 'GET',
    url: '/v1/admin/security-events',
    summary: 'Organisation security stream (authorisation denials, configuration approvals)',
    tags: ['audit'],
    permission: 'audit.read',
    handler: async ({ ctx, principal }) => {
      await authorizeOrThrow(
        ctx,
        principal,
        'audit.read',
        { orgId: principal.orgId },
        { type: 'org', id: principal.orgId },
      );
      if (!principal.roles.includes('ADMINISTRATOR'))
        throw denied(
          principal,
          'audit.read',
          { type: 'org', id: principal.orgId },
          'ADMIN_ONLY',
          'the security stream is restricted to administrators',
        );
      const events = await loadStream(ctx.db, orgStream(principal.orgId));
      return {
        verification: verifyAuditChain(events),
        events: events.slice(-200) as unknown as Json,
      };
    },
  });
}
