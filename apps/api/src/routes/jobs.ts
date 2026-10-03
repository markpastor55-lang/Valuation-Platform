import {
  FIELD_BY_ID,
  FIELD_CATALOGUE,
  isValuerJudgementField,
  INSPECTION_SCOPE_LABELS,
  JURISDICTION_LABELS,
  JURISDICTION_TIME_ZONES,
  PROPERTY_TYPE_LABELS,
  REPORT_PURPOSE_LABELS,
  REPORT_SECTIONS,
  assertEditable,
  authorize,
  checkTransition,
  diffRequirements,
  findMissingFields,
  localDateOf,
  resolveRequirements,
  selectRuleSet,
  selectTemplate,
  type JobAction,
  type JobSelection,
  type Principal,
  type RuleSetVersion,
  type TemplateVersion,
} from '@vp/domain';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { denied, HttpError, notFound } from '../http/errors.js';
import type { Router } from '../http/route.js';
import {
  assertOrgClient,
  assertOrgUser,
  authorizeJob,
  authorizeOrThrow,
  getJob,
  jobResource,
  selectionOf,
  touchJob,
  type JobRow,
} from '../repo/jobs.js';
import {
  assetIdsOf,
  engagementDocumentCount,
  jurisdictionToday,
  loadAggregate,
  requirementsOf,
  validate,
  workflowContextOf,
} from '../services/aggregate.js';
import { audit, jobStream } from '../services/audit.js';
import { writeField } from '../services/fields.js';
import {
  AssetInput,
  JobParams,
  LocalDateSchema,
  ProvenanceInput,
  SelectionSchema,
  Uuid,
  compact,
} from './schemas.js';

async function pickConfig(
  db: Db,
  ctx: AppContext,
  orgId: string,
  selection: JobSelection,
  clientId: string,
  date: string,
) {
  const rs = await db.query<{
    id: string;
    content: RuleSetVersion;
    status: RuleSetVersion['status'];
  }>('SELECT id, content, status FROM rule_set_version WHERE org_id = $1', [orgId]);
  const ruleSets = rs.rows.map((r) => ({ ...r.content, status: r.status, dbId: r.id }));
  const ruleSet = selectRuleSet(ruleSets, date, { allowDraft: ctx.config.allowDraftConfig }) as
    (RuleSetVersion & { dbId: string }) | undefined;
  if (!ruleSet)
    throw new HttpError(409, 'NO_RULE_SET', 'no approved rule set is effective for this date');
  const tv = await db.query<{
    id: string;
    content: TemplateVersion;
    status: TemplateVersion['status'];
  }>('SELECT id, content, status FROM template_version WHERE org_id = $1', [orgId]);
  const templates = tv.rows.map((r) => ({ ...r.content, status: r.status, dbId: r.id }));
  const template = selectTemplate(templates, {
    selection,
    clientId,
    date,
    allowDraft: ctx.config.allowDraftConfig,
  }) as (TemplateVersion & { dbId: string }) | undefined;
  return { ruleSet, template };
}

async function insertAsset(
  tx: Db,
  ctx: AppContext,
  principal: Principal,
  job: { id: string; org_id: string },
  a: z.infer<typeof AssetInput>,
): Promise<string> {
  const id = a.id ?? ctx.newId();
  await tx.query(
    `INSERT INTO asset (id, org_id, job_id, label, address, latitude, longitude, geocode_confidence, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [
      id,
      job.org_id,
      job.id,
      a.label,
      JSON.stringify(a.address),
      a.latitude ?? null,
      a.longitude ?? null,
      a.geocodeConfidence ?? null,
      principal.userId,
      ctx.clock.now(),
    ],
  );
  await audit(tx, ctx, {
    orgId: job.org_id,
    streamId: jobStream(job.id),
    actor: principal,
    action: 'asset.created',
    entityType: 'asset',
    entityId: id,
    after: { label: a.label, address: a.address.formatted },
  });
  await writeField(tx, ctx, principal, job, {
    fieldId: 'location.address',
    assetId: id,
    value: a.address,
  });
  if (a.latitude !== undefined && a.longitude !== undefined) {
    await writeField(tx, ctx, principal, job, {
      fieldId: 'location.coordinates',
      assetId: id,
      value: { lat: a.latitude, lng: a.longitude },
    });
  }
  return id;
}

/** Assignees must be active users of the organisation holding the role the assignment needs. */
async function assertAssignees(
  db: Db,
  orgId: string,
  a: { responsibleValuerId?: string; reviewerId?: string; inspectorIds?: readonly string[] },
): Promise<void> {
  if (a.responsibleValuerId)
    await assertOrgUser(db, orgId, a.responsibleValuerId, ['VALUER'], 'responsible valuer');
  if (a.reviewerId) await assertOrgUser(db, orgId, a.reviewerId, ['QA_REVIEWER'], 'reviewer');
  for (const id of a.inspectorIds ?? [])
    await assertOrgUser(db, orgId, id, ['FIELD_INSPECTOR', 'VALUER'], 'inspector');
}

const ACTIONS: readonly JobAction[] = [
  'acceptEngagement',
  'submitForQa',
  'startReview',
  'returnToValuer',
  'approve',
  'issue',
  'openAmendment',
  'cancel',
];

async function jobView(ctx: AppContext, db: Db, principal: Principal, job: JobRow) {
  const agg = await loadAggregate(db, job.id, job);
  const requirements = requirementsOf(agg);
  const missing = findMissingFields(requirements, agg.values, assetIdsOf(agg));
  const validation = validate(agg, 'submit', ctx);
  const wf = workflowContextOf(agg, principal, {
    validation,
    engagementDocumentCount: await engagementDocumentCount(db, agg),
  });
  return {
    id: job.id,
    reference: job.reference,
    status: job.status,
    clientId: job.client_id,
    portfolioId: job.portfolio_id,
    selection: agg.selection,
    responsibleValuerId: job.responsible_valuer_id,
    reviewerId: job.reviewer_id,
    feeCents: job.fee_cents,
    ruleSet: `${agg.ruleSet.id}@${agg.ruleSet.version} (${agg.ruleSet.status})`,
    template: agg.template
      ? `${agg.template.templateId} v${agg.template.version} (${agg.template.status})`
      : null,
    version: job.version,
    assets: agg.assets.map((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      latitude: a.latitude,
      longitude: a.longitude,
      riskLevel: a.risk_level,
      version: a.version,
    })),
    requirements: {
      sections: requirements.sections,
      warnings: requirements.warnings,
      selectionIssues: requirements.selectionIssues,
      specialistReviews: requirements.specialistReviews,
      requiredCount: requirements.fields.filter((f) => f.level === 'required').length,
      missingRequired: missing
        .filter((m) => m.level === 'required')
        .map((m) => ({ fieldId: m.fieldId, assetId: m.assetId })),
    },
    transitions: Object.fromEntries(ACTIONS.map((a) => [a, checkTransition(a, wf)])),
  };
}

export function registerJobRoutes(r: Router): void {
  r.add({
    method: 'GET',
    url: '/v1/reference/selection',
    summary: 'Selection vocabulary (jurisdictions, purposes, property types, scopes)',
    tags: ['reference'],
    handler: () =>
      Promise.resolve({
        jurisdictions: JURISDICTION_LABELS,
        purposes: REPORT_PURPOSE_LABELS,
        propertyTypes: PROPERTY_TYPE_LABELS,
        scopes: INSPECTION_SCOPE_LABELS,
        sections: REPORT_SECTIONS,
      }),
  });

  r.add({
    method: 'GET',
    url: '/v1/reference/fields',
    summary: 'Field catalogue',
    tags: ['reference'],
    handler: () => Promise.resolve({ fields: FIELD_CATALOGUE }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs',
    summary: 'Create a job with one or many assets',
    tags: ['jobs'],
    permission: 'job.create',
    body: z.object({
      reference: z.string().min(3).max(40),
      clientId: Uuid,
      portfolioId: Uuid.optional(),
      selection: SelectionSchema,
      responsibleValuerId: Uuid.optional(),
      reviewerId: Uuid.optional(),
      inspectorIds: z.array(Uuid).default([]),
      feeCents: z.number().int().min(0).optional(),
      /** Date the client instructed; defaults to today in the property's jurisdiction. */
      instructedOn: LocalDateSchema.optional(),
      dueDate: LocalDateSchema.optional(),
      assets: z.array(AssetInput).min(1).max(500),
    }),
    handler: async ({ ctx, principal, body }) => {
      if (body.selection.mode === 'SINGLE' && body.assets.length !== 1) {
        throw new HttpError(422, 'SINGLE_ASSET_MODE', 'single-asset jobs have exactly one asset');
      }
      if (body.responsibleValuerId && body.responsibleValuerId === body.reviewerId) {
        throw denied(
          principal,
          'job.create',
          { type: 'job', id: 'new' },
          'SEPARATION_OF_DUTIES',
          'the reviewer must be a different person from the responsible valuer',
        );
      }
      await assertOrgClient(ctx.db, principal.orgId, body.clientId);
      await assertAssignees(ctx.db, principal.orgId, {
        ...(body.responsibleValuerId ? { responsibleValuerId: body.responsibleValuerId } : {}),
        ...(body.reviewerId ? { reviewerId: body.reviewerId } : {}),
        inspectorIds: body.inspectorIds,
      });
      let portfolioRestricted = false;
      if (body.portfolioId) {
        const p = await ctx.db.query<{ org_id: string; restricted: boolean }>(
          'SELECT org_id, restricted FROM portfolio WHERE id = $1',
          [body.portfolioId],
        );
        if (p.rows[0]?.org_id !== principal.orgId) throw notFound('portfolio');
        portfolioRestricted = p.rows[0].restricted;
      }
      await authorizeOrThrow(
        ctx,
        principal,
        'job.create',
        { orgId: principal.orgId, portfolioId: body.portfolioId ?? null, portfolioRestricted },
        { type: 'job', id: 'new' },
      );
      const today = new Date(ctx.clock.now()).toISOString().slice(0, 10);
      const { ruleSet, template } = await pickConfig(
        ctx.db,
        ctx,
        principal.orgId,
        body.selection,
        body.clientId,
        today,
      );
      const id = ctx.newId();
      await ctx.db.transaction(async (tx) => {
        const now = ctx.clock.now();
        await tx.query(
          `INSERT INTO job (id, org_id, reference, client_id, portfolio_id, status, jurisdiction, purpose, property_type, scope, mode,
                            rule_set_version_id, template_version_id, responsible_valuer_id, reviewer_id, fee_cents, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)`,
          [
            id,
            principal.orgId,
            body.reference,
            body.clientId,
            body.portfolioId ?? null,
            body.selection.jurisdiction,
            body.selection.purpose,
            body.selection.propertyType,
            body.selection.scope,
            body.selection.mode,
            ruleSet.dbId,
            template?.dbId ?? null,
            body.responsibleValuerId ?? null,
            body.reviewerId ?? null,
            body.feeCents ?? null,
            principal.userId,
            now,
          ],
        );
        for (const inspector of body.inspectorIds) {
          await tx.query(
            "INSERT INTO job_assignment (job_id, user_id, role) VALUES ($1, $2, 'inspector')",
            [id, inspector],
          );
        }
        const job = { id, org_id: principal.orgId };
        await audit(tx, ctx, {
          orgId: principal.orgId,
          streamId: jobStream(id),
          actor: principal,
          action: 'job.created',
          entityType: 'job',
          entityId: id,
          after: {
            reference: body.reference,
            selection: body.selection,
            ruleSet: `${ruleSet.id}@${ruleSet.version}`,
            template: template ? `${template.templateId}@${template.version}` : null,
          },
        });
        if (body.responsibleValuerId)
          await writeField(tx, ctx, principal, job, {
            fieldId: 'instruction.responsibleValuer',
            assetId: null,
            value: body.responsibleValuerId,
          });
        if (body.reviewerId)
          await writeField(tx, ctx, principal, job, {
            fieldId: 'instruction.reviewer',
            assetId: null,
            value: body.reviewerId,
          });
        // System-filled fields: set here, never typed by the valuer (see FieldDef.entry)
        await writeField(tx, ctx, principal, job, {
          fieldId: 'dates.instruction',
          assetId: null,
          value:
            body.instructedOn ??
            localDateOf(ctx.clock.now(), JURISDICTION_TIME_ZONES[body.selection.jurisdiction]),
        });
        if (body.dueDate)
          await writeField(tx, ctx, principal, job, {
            fieldId: 'instruction.dueDate',
            assetId: null,
            value: body.dueDate,
          });
        for (const a of body.assets) await insertAsset(tx, ctx, principal, job, a);
      });
      return jobView(ctx, ctx.db, principal, await getJob(ctx.db, id));
    },
  });

  r.add({
    method: 'GET',
    url: '/v1/jobs',
    summary: 'List jobs visible to the user',
    tags: ['jobs'],
    permission: 'job.read',
    query: z.object({ status: z.string().optional() }),
    handler: async ({ ctx, principal, query }) => {
      const { rows } = await ctx.db.query<JobRow>(
        `SELECT * FROM job WHERE org_id = $1 ${query.status ? 'AND status = $2' : ''} ORDER BY created_at DESC LIMIT 500`,
        query.status ? [principal.orgId, query.status] : [principal.orgId],
      );
      const visible = [];
      for (const job of rows) {
        if (authorize(principal, 'job.read', await jobResource(ctx.db, job)).allowed) {
          visible.push({
            id: job.id,
            reference: job.reference,
            status: job.status,
            selection: selectionOf(job),
            responsibleValuerId: job.responsible_valuer_id,
          });
        }
      }
      return { jobs: visible };
    },
  });

  r.add({
    method: 'GET',
    url: '/v1/jobs/:jobId',
    summary: 'Job detail with requirements and available transitions',
    tags: ['jobs'],
    permission: 'job.read',
    params: JobParams,
    handler: async ({ ctx, principal, params }) => {
      const { job } = await authorizeJob(ctx, ctx.db, principal, 'job.read', params.jobId);
      return jobView(ctx, ctx.db, principal, job);
    },
  });

  r.add({
    method: 'PATCH',
    url: '/v1/jobs/:jobId/selection',
    summary: 'Change purpose, property type, scope, jurisdiction or mode (data is retained)',
    tags: ['jobs'],
    permission: 'job.update',
    params: JobParams,
    body: z.object({ selection: SelectionSchema, reason: z.string().min(5) }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'job.update', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        const before = await loadAggregate(tx, job.id, job);
        const prevReq = requirementsOf(before);
        const nextReq = resolveRequirements(
          body.selection,
          before.ruleSet,
          before.values,
          assetIdsOf(before),
        );
        if (body.selection.mode === 'SINGLE' && before.assets.length > 1)
          throw new HttpError(422, 'SINGLE_ASSET_MODE', 'job has several assets');
        const { template } = await pickConfig(
          tx,
          ctx,
          job.org_id,
          body.selection,
          job.client_id,
          jurisdictionToday(before, ctx.clock.now()),
        );
        await tx.query(
          'UPDATE job SET jurisdiction = $2, purpose = $3, property_type = $4, scope = $5, mode = $6, template_version_id = $7 WHERE id = $1',
          [
            job.id,
            body.selection.jurisdiction,
            body.selection.purpose,
            body.selection.propertyType,
            body.selection.scope,
            body.selection.mode,
            template?.dbId ?? null,
          ],
        );
        await touchJob(tx, job.id, ctx.clock.now());
        const diff = diffRequirements(prevReq, nextReq, before.values);
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'job.selection_changed',
          entityType: 'job',
          entityId: job.id,
          reason: body.reason,
          before: { ...selectionOf(job) },
          after: { ...body.selection },
          metadata: {
            newlyRequired: [...diff.newlyRequired],
            noLongerRequired: [...diff.noLongerRequired],
            retainedValues: diff.retainedValues.length,
          },
        });
        return {
          selection: body.selection,
          diff,
          sections: nextReq.sections,
          selectionIssues: nextReq.selectionIssues,
        };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/assign',
    summary: 'Allocate responsible valuer, reviewer and inspectors',
    tags: ['jobs'],
    permission: 'job.allocate',
    params: JobParams,
    body: z.object({
      responsibleValuerId: Uuid.optional(),
      reviewerId: Uuid.optional(),
      inspectorIds: z.array(Uuid).optional(),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'job.allocate', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        const valuer = body.responsibleValuerId ?? job.responsible_valuer_id;
        const reviewer = body.reviewerId ?? job.reviewer_id;
        if (valuer && reviewer && valuer === reviewer) {
          throw denied(
            principal,
            'job.allocate',
            { type: 'job', id: job.id },
            'SEPARATION_OF_DUTIES',
            'the reviewer must be a different person from the responsible valuer',
          );
        }
        await assertAssignees(tx, job.org_id, {
          ...(body.responsibleValuerId ? { responsibleValuerId: body.responsibleValuerId } : {}),
          ...(body.reviewerId ? { reviewerId: body.reviewerId } : {}),
          ...(body.inspectorIds ? { inspectorIds: body.inspectorIds } : {}),
        });
        await tx.query(
          'UPDATE job SET responsible_valuer_id = $2, reviewer_id = $3 WHERE id = $1',
          [job.id, valuer, reviewer],
        );
        if (body.inspectorIds) {
          await tx.query("DELETE FROM job_assignment WHERE job_id = $1 AND role = 'inspector'", [
            job.id,
          ]);
          for (const i of body.inspectorIds)
            await tx.query(
              "INSERT INTO job_assignment (job_id, user_id, role) VALUES ($1, $2, 'inspector')",
              [job.id, i],
            );
        }
        if (valuer)
          await writeField(tx, ctx, principal, job, {
            fieldId: 'instruction.responsibleValuer',
            assetId: null,
            value: valuer,
          });
        if (reviewer)
          await writeField(tx, ctx, principal, job, {
            fieldId: 'instruction.reviewer',
            assetId: null,
            value: reviewer,
          });
        await touchJob(tx, job.id, ctx.clock.now());
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'job.assigned',
          entityType: 'job',
          entityId: job.id,
          after: {
            responsibleValuerId: valuer,
            reviewerId: reviewer,
            inspectorIds: body.inspectorIds ?? null,
          },
        });
        return { responsibleValuerId: valuer, reviewerId: reviewer };
      }),
  });

  r.add({
    method: 'GET',
    url: '/v1/jobs/:jobId/requirements',
    summary: 'Resolved requirements, traced to rules, with missing fields',
    tags: ['jobs'],
    permission: 'job.read',
    params: JobParams,
    handler: async ({ ctx, principal, params }) => {
      const { job } = await authorizeJob(ctx, ctx.db, principal, 'job.read', params.jobId);
      const agg = await loadAggregate(ctx.db, job.id, job);
      const requirements = requirementsOf(agg);
      return {
        requirements,
        missing: findMissingFields(requirements, agg.values, assetIdsOf(agg)),
      };
    },
  });

  r.add({
    method: 'PUT',
    url: '/v1/jobs/:jobId/fields',
    summary: 'Capture field values with provenance (batch)',
    tags: ['jobs'],
    permission: 'job.update | asset.edit',
    params: JobParams,
    body: z.object({
      values: z
        .array(
          z.object({
            fieldId: z.string(),
            assetId: Uuid.nullable().default(null),
            value: z.unknown(),
            provenance: ProvenanceInput.optional(),
            reason: z.string().optional(),
          }),
        )
        .min(1)
        .max(200),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const job = await getJob(tx, params.jobId, true);
        // job-level fields need job.update; asset-level fields can be captured with asset.edit
        const needsJobUpdate = body.values.some((v) => v.assetId === null);
        await authorizeJob(
          ctx,
          tx,
          principal,
          needsJobUpdate ? 'job.update' : 'asset.edit',
          params.jobId,
        );
        // Professional judgement (evidence selection, approaches, rates, conclusions) is the valuer's.
        if (
          body.values.some((v) => {
            const def = FIELD_BY_ID.get(v.fieldId);
            return def !== undefined && isValuerJudgementField(def);
          })
        ) {
          await authorizeJob(ctx, tx, principal, 'valuation.edit', params.jobId);
        }
        assertEditable(job.status);
        const system = body.values.find((v) => FIELD_BY_ID.get(v.fieldId)?.entry === 'system');
        if (system) {
          throw new HttpError(
            422,
            'SYSTEM_FIELD',
            `${FIELD_BY_ID.get(system.fieldId)?.label ?? system.fieldId} is filled in by the platform (job creation, assignment or the asset location)`,
          );
        }
        let changed = 0;
        for (const v of body.values) {
          const res = await writeField(
            tx,
            ctx,
            principal,
            job,
            compact({
              fieldId: v.fieldId,
              assetId: v.assetId,
              value: v.value ?? null,
              provenance: v.provenance ? compact(v.provenance) : undefined,
              reason: v.reason,
            }),
          );
          if (res.changed) changed++;
        }
        if (changed) await touchJob(tx, job.id, ctx.clock.now());
        return { changed };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/assets',
    summary: 'Add an asset to a portfolio job',
    tags: ['jobs'],
    permission: 'asset.edit',
    params: JobParams,
    body: AssetInput,
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'asset.edit', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        if (job.mode === 'SINGLE')
          throw new HttpError(
            422,
            'SINGLE_ASSET_MODE',
            'change the job to portfolio mode to add assets',
          );
        const id = await insertAsset(tx, ctx, principal, job, body);
        await touchJob(tx, job.id, ctx.clock.now());
        return { id };
      }),
  });

  r.add({
    method: 'GET',
    url: '/v1/map/assets',
    summary: 'Assets visible to the user as GeoJSON (permission-aware)',
    tags: ['map'],
    permission: 'job.read',
    query: z.object({ jobId: Uuid.optional() }),
    handler: async ({ ctx, principal, query }) => {
      const { rows } = await ctx.db.query<JobRow>(
        `SELECT * FROM job WHERE org_id = $1 ${query.jobId ? 'AND id = $2' : ''}`,
        query.jobId ? [principal.orgId, query.jobId] : [principal.orgId],
      );
      const features = [];
      for (const job of rows) {
        if (!authorize(principal, 'job.read', await jobResource(ctx.db, job)).allowed) continue;
        const assets = await ctx.db.query<{
          id: string;
          label: string;
          latitude: number | null;
          longitude: number | null;
          risk_level: string;
        }>(
          'SELECT id, label, latitude, longitude, risk_level FROM asset WHERE job_id = $1 AND NOT deleted AND latitude IS NOT NULL ORDER BY created_at',
          [job.id],
        );
        for (const a of assets.rows) {
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [a.longitude, a.latitude] },
            properties: {
              assetId: a.id,
              label: a.label,
              jobId: job.id,
              jobReference: job.reference,
              status: job.status,
              risk: a.risk_level,
              purpose: job.purpose,
            },
          });
        }
      }
      return { type: 'FeatureCollection', features };
    },
  });
}

export { insertAsset };
export type { Principal };
