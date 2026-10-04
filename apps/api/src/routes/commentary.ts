import {
  JURISDICTIONS,
  JURISDICTION_TIME_ZONES,
  PROPERTY_TYPES,
  assertEditable,
  authorize,
  commentaryLocalities,
  commentaryModuleProblems,
  commentaryProvenance,
  commentaryRecord,
  isLocalDate,
  localCommentaryDate,
  localDateOf,
  retrospectiveStatus,
  selectCommentary,
  type CommentaryModule,
  type CommentarySuggestion,
  type LocalDate,
} from '@vp/domain';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { HttpError, notFound } from '../http/errors.js';
import type { Router } from '../http/route.js';
import { insertCommentaryModule } from '../repo/commentary.js';
import { authorizeJob, authorizeOrThrow, touchJob, type JobRow } from '../repo/jobs.js';
import { audit, jobStream, orgStream } from '../services/audit.js';
import { writeField } from '../services/fields.js';
import {
  EvidenceProvenance,
  IdParams,
  JobParams,
  LocalDateSchema,
  Uuid,
  compact,
  provenanceOf,
} from './schemas.js';

const Level = z.enum(['national', 'state', 'local']);

const dateValue = (v: unknown): LocalDate | undefined => (isLocalDate(v) ? v : undefined);

/** Problems with a library paragraph: the domain checks, plus sources missing from the registry. */
async function moduleProblems(db: Db, orgId: string, m: CommentaryModule): Promise<string[]> {
  const ids = [...new Set(m.sources.flatMap((s) => (s.sourceId ? [s.sourceId] : [])))];
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM data_source WHERE org_id = $1 AND id = ANY($2::text[])',
    [orgId, ids],
  );
  const known = new Set(rows.map((r) => r.id));
  return [
    ...commentaryModuleProblems(m),
    ...ids.filter((id) => !known.has(id)).map((id) => `source: ${id} is not a registered source`),
  ];
}

/**
 * The library commentary that fits an asset of a job: its property type and state, the suburb
 * and council of the asset, and the valuation date (inspection date, then today, until the
 * valuation date is recorded). Only approved paragraphs are considered.
 */
async function suggestionsFor(
  ctx: AppContext,
  db: Db,
  job: JobRow,
  assetId: string | undefined,
): Promise<{
  assetId: string;
  valuationDate: LocalDate;
  localAsAt: LocalDate;
  localities: string[];
  suggestions: CommentarySuggestion[];
}> {
  const assets = await db.query<{ id: string; label: string; address: { formatted?: unknown } }>(
    'SELECT id, label, address FROM asset WHERE job_id = $1 AND NOT deleted ORDER BY created_at, id',
    [job.id],
  );
  const asset = assetId ? assets.rows.find((a) => a.id === assetId) : assets.rows[0];
  if (!asset) throw new HttpError(422, 'UNKNOWN_ASSET', 'asset does not belong to this job');
  // Job-level fields have no asset, so `asset_id = $2` is null for them and they are kept.
  const fields = await db.query<{ field_id: string; value: unknown }>(
    `SELECT field_id, value FROM field_value
      WHERE job_id = $1 AND coalesce(asset_id = $2, true) AND field_id = ANY($3::text[])`,
    [
      job.id,
      asset.id,
      [
        'dates.valuation',
        'dates.inspection',
        'dates.instruction',
        'location.address',
        'location.lga',
      ],
    ],
  );
  const value = (id: string) => fields.rows.find((f) => f.field_id === id)?.value;
  const address = (value('location.address') ?? asset.address) as { formatted?: unknown } | null;
  const council = value('location.lga');
  const localities = commentaryLocalities(
    typeof address?.formatted === 'string' ? address.formatted : asset.label,
    typeof council === 'string' ? council : undefined,
  );
  const today = localDateOf(ctx.clock.now(), JURISDICTION_TIME_ZONES[job.jurisdiction]);
  const valuationDate =
    dateValue(value('dates.valuation')) ?? dateValue(value('dates.inspection')) ?? today;
  // Local commentary must be current on the day the report is prepared, unless the valuation is
  // retrospective (01 D17).
  const dates = Object.fromEntries(
    ['dates.valuation', 'dates.inspection', 'dates.instruction'].map((id) => [id, value(id)]),
  );
  const { retrospective } = retrospectiveStatus({ job: dates, assets: {} });
  const localAsAt = localCommentaryDate(valuationDate, retrospective, today);
  const library = await db.query<{ data: CommentaryModule }>(
    "SELECT data FROM commentary_module WHERE org_id = $1 AND status = 'approved' ORDER BY module_id, version",
    [job.org_id],
  );
  return {
    assetId: asset.id,
    valuationDate,
    localAsAt,
    localities,
    suggestions: selectCommentary(
      library.rows.map((r) => r.data),
      {
        propertyType: job.property_type,
        jurisdiction: job.jurisdiction,
        localities,
        valuationDate,
        localAsAt,
      },
    ),
  };
}

export function registerCommentaryRoutes(r: Router): void {
  r.add({
    method: 'GET',
    url: '/v1/commentary-library',
    summary:
      "The firm's market commentary library: every version, newest first per paragraph (standards owners may list it too)",
    tags: ['commentary'],
    permission: 'job.read',
    query: z.object({
      level: Level.optional(),
      jurisdiction: z.enum(JURISDICTIONS).optional(),
      status: z.enum(['draft', 'approved', 'retired']).optional(),
    }),
    handler: async ({ ctx, principal, query }) => {
      // Standards owners write the library without reading jobs, so they may list it too.
      if (!authorize(principal, 'template.edit', { orgId: principal.orgId }).allowed)
        await authorizeOrThrow(
          ctx,
          principal,
          'job.read',
          { orgId: principal.orgId },
          { type: 'commentary_module', id: '*' },
        );
      const { rows } = await ctx.db.query<{ id: string; data: CommentaryModule }>(
        `SELECT id, data FROM commentary_module
          WHERE org_id = $1 AND ($2::text IS NULL OR level = $2)
            AND ($3::text IS NULL OR jurisdiction = $3) AND ($4::text IS NULL OR status = $4)
          ORDER BY module_id, version DESC`,
        [principal.orgId, query.level ?? null, query.jurisdiction ?? null, query.status ?? null],
      );
      return { modules: rows.map((m) => ({ id: m.id, ...m.data })) };
    },
  });

  r.add({
    method: 'POST',
    url: '/v1/commentary-library',
    summary: 'Write a draft version of a library paragraph (approved by another standards owner)',
    tags: ['commentary'],
    permission: 'template.edit',
    body: z.object({
      moduleId: z.string().max(64),
      level: Level,
      title: z.string().max(200),
      jurisdiction: z.enum(JURISDICTIONS).optional(),
      localities: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
      propertyTypes: z.array(z.enum(PROPERTY_TYPES)).optional(),
      asAtDate: LocalDateSchema,
      text: z.string().max(20_000),
      sources: z.array(EvidenceProvenance).max(20).default([]),
    }),
    handler: async ({ ctx, principal, body }) =>
      ctx.db.transaction(async (tx) => {
        await authorizeOrThrow(
          ctx,
          principal,
          'template.edit',
          { orgId: principal.orgId },
          { type: 'commentary_module', id: 'new' },
        );
        const previous = await tx.query<{
          version: number;
          level: string;
          jurisdiction: string | null;
        }>(
          'SELECT version, level, jurisdiction FROM commentary_module WHERE org_id = $1 AND module_id = $2 ORDER BY version DESC LIMIT 1',
          [principal.orgId, body.moduleId],
        );
        const last = previous.rows[0];
        const now = ctx.clock.now();
        const { sources, ...rest } = body;
        const draft: CommentaryModule = {
          ...compact(rest),
          version: (last?.version ?? 0) + 1,
          sources: sources.map((s) => provenanceOf(s, principal.userId, now)),
          status: 'draft',
          authoredBy: principal.userId,
          authoredAt: now,
        };
        const problems = await moduleProblems(tx, principal.orgId, draft);
        if (
          last &&
          (last.level !== draft.level || last.jurisdiction !== (draft.jurisdiction ?? null))
        )
          problems.push('a new version must keep the level and state of the earlier versions');
        if (problems.length)
          throw new HttpError(422, 'INVALID_COMMENTARY', 'the paragraph cannot be saved', {
            problems,
          });
        const id = ctx.newId();
        await insertCommentaryModule(tx, principal.orgId, id, draft);
        await audit(tx, ctx, {
          orgId: principal.orgId,
          streamId: orgStream(principal.orgId),
          actor: principal,
          action: 'commentary.version_created',
          entityType: 'commentary_module',
          entityId: id,
          after: { moduleId: draft.moduleId, version: draft.version, asAtDate: draft.asAtDate },
        });
        return { id, ...draft };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/commentary-library/:id/approve',
    summary: 'Standards owner approves a library paragraph version (not the author; MFA)',
    tags: ['commentary'],
    permission: 'template.approve',
    params: IdParams,
    handler: async ({ ctx, principal, params }) =>
      ctx.db.transaction(async (tx) => {
        const { rows } = await tx.query<{ status: string; data: CommentaryModule }>(
          'SELECT status, data FROM commentary_module WHERE id = $1 AND org_id = $2 FOR UPDATE',
          [params.id, principal.orgId],
        );
        const row = rows[0];
        if (!row) throw notFound('commentary version');
        await authorizeOrThrow(
          ctx,
          principal,
          'template.approve',
          { orgId: principal.orgId, authorId: row.data.authoredBy },
          { type: 'commentary_module', id: params.id },
        );
        if (row.status !== 'draft')
          throw new HttpError(409, 'IMMUTABLE_RECORD', `commentary version is ${row.status}`);
        const problems = await moduleProblems(tx, principal.orgId, row.data);
        if (problems.length)
          throw new HttpError(422, 'INVALID_COMMENTARY', 'the paragraph cannot be approved', {
            problems,
          });
        const approved: CommentaryModule = {
          ...row.data,
          status: 'approved',
          approvedBy: principal.userId,
          approvedAt: ctx.clock.now(),
        };
        await tx.query(
          "UPDATE commentary_module SET status = 'approved', data = $2 WHERE id = $1",
          [params.id, JSON.stringify(approved)],
        );
        await audit(tx, ctx, {
          orgId: principal.orgId,
          streamId: orgStream(principal.orgId),
          actor: principal,
          action: 'commentary.version_approved',
          entityType: 'commentary_module',
          entityId: params.id,
          after: { moduleId: approved.moduleId, version: approved.version },
        });
        return { id: params.id, ...approved };
      }),
  });

  r.add({
    method: 'GET',
    url: '/v1/jobs/:jobId/commentary/suggestions',
    summary:
      'Library commentary that fits the job: property type, state, suburb and council, as at the valuation date (nothing is saved)',
    tags: ['commentary'],
    permission: 'job.read',
    params: JobParams,
    query: z.object({ assetId: Uuid.optional() }),
    handler: async ({ ctx, principal, params, query }) => {
      const { job } = await authorizeJob(ctx, ctx.db, principal, 'job.read', params.jobId);
      return suggestionsFor(ctx, ctx.db, job, query.assetId);
    },
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/commentary/apply',
    summary:
      'Accept library commentary for the chosen levels: fills the commentary fields and records the dated commentary with its sources',
    tags: ['commentary'],
    permission: 'evidence.edit',
    params: JobParams,
    body: z.object({ assetId: Uuid, levels: z.array(Level).min(1).max(3) }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'evidence.edit', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        // Recomputed here: the text written is always the library's, never the client's copy.
        const { assetId, suggestions } = await suggestionsFor(ctx, tx, job, body.assetId);
        const chosen = suggestions.filter((s) => body.levels.includes(s.level));
        const missing = chosen.filter((s) => !s.modules.length).map((s) => s.level);
        if (missing.length)
          throw new HttpError(
            422,
            'NO_LIBRARY_COMMENTARY',
            `the library has no approved ${missing.join(', ')} commentary for this job; write it for the valuation date`,
            { levels: missing },
          );
        const now = ctx.clock.now();
        const records = [];
        for (const s of chosen) {
          const local = s.level === 'local';
          // writeField records who captured it and when
          const { capturedBy, capturedAt, ...provenance } = commentaryProvenance(
            s,
            principal.userId,
            now,
          );
          await writeField(tx, ctx, principal, job, {
            fieldId: s.fieldId,
            assetId: local ? assetId : null,
            value: s.text,
            provenance,
          });
          const record = commentaryRecord(s, {
            id: ctx.newId(),
            assetId,
            by: principal.userId,
            at: now,
          });
          await tx.query(
            'INSERT INTO market_commentary (id, org_id, job_id, asset_id, level, as_at_date, data) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [
              record.id,
              job.org_id,
              job.id,
              record.assetId ?? null,
              record.level,
              record.asAtDate,
              JSON.stringify(record),
            ],
          );
          await audit(tx, ctx, {
            orgId: job.org_id,
            streamId: jobStream(job.id),
            actor: principal,
            action: 'evidence.commentary_added',
            entityType: 'market_commentary',
            entityId: record.id,
            after: { level: record.level, asAtDate: record.asAtDate },
            metadata: {
              level: record.level,
              asAtDate: record.asAtDate,
              library: (record.library ?? []).map((l) => ({ ...l })),
            },
          });
          records.push(record);
        }
        await touchJob(tx, job.id, now);
        return { records };
      }),
  });
}
