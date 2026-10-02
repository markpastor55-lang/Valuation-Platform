import {
  DEFAULT_CONVENTIONS,
  approveMeasurement,
  assertEditable,
  calibrateFromStatedScale,
  calibrateTwoPoint,
  computeAreaSchedule,
  confirmCalibration,
  createAiSuggestion,
  decideAiSuggestion,
  excludePhoto,
  flagPhotoPrivacy,
  hashCanonical,
  nextSketchVersion,
  recordConsent,
  recordRedaction,
  type AiSuggestion,
  type Boundary,
  type Json,
  type PhotoRecord,
  type ScaleCalibration,
  type SketchVersion,
} from '@vp/domain';
import { z } from 'zod';
import type { Db } from '../db/db.js';
import { HttpError, notFound } from '../http/errors.js';
import type { Router } from '../http/route.js';
import {
  assertAssetInJob,
  assertPhotoInJob,
  authorizeJob,
  touchJob,
  type JobRow,
} from '../repo/jobs.js';
import { audit, jobStream } from '../services/audit.js';
import { writeField } from '../services/fields.js';
import { InstantSchema, JobParams, PointSchema, Uuid, compact } from './schemas.js';

const BoundaryInput = z.object({
  id: Uuid.optional(),
  level: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  role: z.enum(['component', 'deduction']),
  componentType: z.string().min(2),
  points: z.array(PointSchema).min(2).max(500),
  closed: z.boolean(),
  dimensionSource: z.enum(['measured', 'supplied', 'scaled', 'estimated']),
  origin: z.enum(['drawn', 'traced', 'imported']).default('drawn'),
  notes: z.string().optional(),
});

const CalibrationInput = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('two_point'),
    p1: PointSchema,
    p2: PointSchema,
    knownDistanceM: z.number().positive(),
  }),
  z.object({
    method: z.literal('stated_scale'),
    ratio: z.number().positive(),
    dpi: z.number().positive(),
  }),
]);

async function latestVersion(db: Db, sketchId: string): Promise<SketchVersion | undefined> {
  const { rows } = await db.query<{ data: SketchVersion }>(
    'SELECT data FROM sketch_version WHERE sketch_id = $1 ORDER BY version DESC LIMIT 1',
    [sketchId],
  );
  return rows[0]?.data;
}

async function insertVersion(tx: Db, job: JobRow, v: SketchVersion): Promise<void> {
  await tx.query(
    `INSERT INTO sketch_version (id, org_id, job_id, asset_id, sketch_id, version, status, data, content_hash, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      v.id,
      job.org_id,
      job.id,
      v.assetId,
      v.sketchId,
      v.version,
      v.status,
      JSON.stringify(v),
      hashCanonical({ ...v, status: undefined }),
      v.createdBy,
      v.createdAt,
    ],
  );
}

function scheduleFor(v: SketchVersion) {
  const convention = DEFAULT_CONVENTIONS.find((c) => c.id === v.conventionId);
  if (!convention)
    throw new HttpError(
      422,
      'UNKNOWN_CONVENTION',
      `unknown measurement convention ${v.conventionId}`,
    );
  return computeAreaSchedule(v, convention);
}

async function loadPhoto(db: Db, job: JobRow, photoId: string): Promise<PhotoRecord> {
  const { rows } = await db.query<{ data: PhotoRecord }>(
    'SELECT data FROM photo WHERE id = $1 AND job_id = $2 AND NOT deleted',
    [photoId, job.id],
  );
  if (!rows[0]) throw notFound('photo');
  return rows[0].data;
}

export function registerInspectionRoutes(r: Router): void {
  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/assets/:assetId/sketches',
    summary: 'Create a sketch or a new sketch version; returns the area schedule',
    tags: ['areas'],
    permission: 'sketch.edit',
    params: z.object({ jobId: Uuid, assetId: Uuid }),
    body: z.object({
      sketchId: Uuid.optional(),
      units: z.enum(['metres', 'plan_units']).optional(),
      sourcePlanId: Uuid.optional(),
      calibration: CalibrationInput.optional(),
      boundaries: z.array(BoundaryInput).max(300).optional(),
      basis: z
        .enum(['GFA', 'GBA', 'GLA', 'NLA', 'BUILDING_AREA', 'SITE_COVERAGE', 'OTHER'])
        .optional(),
      conventionId: z.string().optional(),
      northBearingDeg: z.number().min(0).max(360).optional(),
      suppliedAreas: z
        .array(
          z.object({
            label: z.string(),
            areaM2: z.number().positive(),
            level: z.string().optional(),
            source: z.string(),
          }),
        )
        .optional(),
      includeInClientReport: z.boolean().optional(),
      changeSummary: z.string().min(3),
      useForReport: z.boolean().default(true),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'sketch.edit', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        const asset = await tx.query(
          'SELECT 1 FROM asset WHERE id = $1 AND job_id = $2 AND NOT deleted',
          [params.assetId, job.id],
        );
        if (!asset.rows.length) throw notFound('asset');
        const now = ctx.clock.now();
        const previous = body.sketchId ? await latestVersion(tx, body.sketchId) : undefined;
        if (body.sketchId && !previous) throw notFound('sketch');
        if (previous && previous.assetId !== params.assetId)
          throw new HttpError(422, 'SKETCH_ASSET_MISMATCH', 'sketch belongs to another asset');

        let calibration: ScaleCalibration | undefined = previous?.calibration;
        if (body.calibration) {
          if (!body.sourcePlanId && !previous?.sourcePlanId)
            throw new HttpError(422, 'SOURCE_PLAN_REQUIRED', 'calibration needs the source plan');
          const meta = {
            id: ctx.newId(),
            sourcePlanId: (body.sourcePlanId ?? previous?.sourcePlanId) as string,
            createdBy: principal.userId,
            createdAt: now,
          };
          calibration =
            body.calibration.method === 'two_point'
              ? calibrateTwoPoint({
                  ...meta,
                  p1: body.calibration.p1,
                  p2: body.calibration.p2,
                  knownDistanceM: body.calibration.knownDistanceM,
                  ...(previous?.calibration ? { supersedesId: previous.calibration.id } : {}),
                })
              : calibrateFromStatedScale({
                  ...meta,
                  ratio: body.calibration.ratio,
                  dpi: body.calibration.dpi,
                });
        }
        const boundaries: Boundary[] | undefined = body.boundaries?.map(
          (b) =>
            compact({
              ...b,
              id: b.id ?? ctx.newId(),
              reviewStatus: 'accepted' as const,
              measuredBy: principal.userId,
              measuredAt: now,
            }) as Boundary,
        );
        let version: SketchVersion;
        if (previous) {
          version = nextSketchVersion(
            previous,
            compact({
              boundaries,
              calibration,
              basis: body.basis,
              conventionId: body.conventionId,
              northBearingDeg: body.northBearingDeg,
              suppliedAreas: body.suppliedAreas?.map((s) => compact(s)),
              includeInClientReport: body.includeInClientReport,
              units: body.units,
              sourcePlanId: body.sourcePlanId,
            }),
            {
              id: ctx.newId(),
              changeSummary: body.changeSummary,
              createdBy: principal.userId,
              createdAt: now,
            },
          );
        } else {
          if (!body.units || !body.basis || !body.conventionId || !boundaries) {
            throw new HttpError(
              422,
              'SKETCH_INCOMPLETE',
              'a new sketch needs units, basis, conventionId and boundaries',
            );
          }
          version = {
            id: ctx.newId(),
            sketchId: ctx.newId(),
            assetId: params.assetId,
            version: 1,
            units: body.units,
            ...(body.sourcePlanId ? { sourcePlanId: body.sourcePlanId } : {}),
            ...(calibration ? { calibration } : {}),
            boundaries,
            basis: body.basis,
            conventionId: body.conventionId,
            ...(body.northBearingDeg !== undefined
              ? { northBearingDeg: body.northBearingDeg }
              : {}),
            ...(body.suppliedAreas
              ? { suppliedAreas: body.suppliedAreas.map((s) => compact(s)) }
              : {}),
            includeInClientReport: body.includeInClientReport ?? true,
            changeSummary: body.changeSummary,
            createdBy: principal.userId,
            createdAt: now,
            status: 'working',
          };
        }
        const schedule = scheduleFor(version);
        await insertVersion(tx, job, version);
        if (body.useForReport) {
          await writeField(tx, ctx, principal, job, {
            fieldId: 'improvements.areaSchedule',
            assetId: params.assetId,
            value: version.sketchId,
          });
          await writeField(tx, ctx, principal, job, {
            fieldId: 'improvements.measurementBasis',
            assetId: params.assetId,
            value: version.basis,
          });
        }
        await touchJob(tx, job.id, now);
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'sketch.version_created',
          entityType: 'sketch_version',
          entityId: version.id,
          after: {
            sketchId: version.sketchId,
            version: version.version,
            changeSummary: version.changeSummary,
            totalIncludedM2: schedule.totalIncludedM2,
            scheduleHash: schedule.scheduleHash,
          },
        });
        if (body.calibration && calibration) {
          await audit(tx, ctx, {
            orgId: job.org_id,
            streamId: jobStream(job.id),
            actor: principal,
            action: 'calibration.created',
            entityType: 'scale_calibration',
            entityId: calibration.id,
            after: calibration as unknown as Json,
          });
        }
        return { version, schedule };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/sketch-versions/:versionId/confirm-scale',
    summary: 'Valuer confirms the plan scale (creates a new version)',
    tags: ['areas'],
    permission: 'measurement.approve',
    params: z.object({ jobId: Uuid, versionId: Uuid }),
    body: z.object({ checkNote: z.string().min(5) }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(
          ctx,
          tx,
          principal,
          'measurement.approve',
          params.jobId,
          { forUpdate: true },
        );
        assertEditable(job.status);
        if (principal.kind !== 'human')
          throw new HttpError(403, 'HUMAN_REQUIRED', 'scale is confirmed by a person');
        const { rows } = await tx.query<{ data: SketchVersion }>(
          'SELECT data FROM sketch_version WHERE id = $1 AND job_id = $2',
          [params.versionId, job.id],
        );
        const v = rows[0]?.data;
        if (!v) throw notFound('sketch version');
        if (!v.calibration)
          throw new HttpError(422, 'NO_CALIBRATION', 'this sketch has no calibration to confirm');
        const latest = await latestVersion(tx, v.sketchId);
        if (latest?.id !== v.id)
          throw new HttpError(409, 'STALE_VERSION', 'confirm the scale on the latest version');
        const now = ctx.clock.now();
        const confirmed = confirmCalibration(v.calibration, principal.userId, now);
        const next = nextSketchVersion(
          v,
          { calibration: confirmed },
          {
            id: ctx.newId(),
            changeSummary: `Scale confirmed: ${body.checkNote}`,
            createdBy: principal.userId,
            createdAt: now,
          },
        );
        await insertVersion(tx, job, next);
        await touchJob(tx, job.id, now);
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'calibration.confirmed',
          entityType: 'scale_calibration',
          entityId: confirmed.id,
          reason: body.checkNote,
          after: { sketchVersionId: next.id, metresPerUnit: confirmed.metresPerUnit },
        });
        return { version: next, schedule: scheduleFor(next) };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/sketch-versions/:versionId/approve',
    summary: 'Valuer approves the area schedule of a sketch version',
    tags: ['areas'],
    permission: 'measurement.approve',
    params: z.object({ jobId: Uuid, versionId: Uuid }),
    handler: async ({ ctx, principal, params }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(
          ctx,
          tx,
          principal,
          'measurement.approve',
          params.jobId,
          { forUpdate: true },
        );
        assertEditable(job.status);
        const { rows } = await tx.query<{ data: SketchVersion }>(
          'SELECT data FROM sketch_version WHERE id = $1 AND job_id = $2',
          [params.versionId, job.id],
        );
        const v = rows[0]?.data;
        if (!v) throw notFound('sketch version');
        const latest = await latestVersion(tx, v.sketchId);
        if (latest?.id !== v.id)
          throw new HttpError(409, 'STALE_VERSION', 'approve the latest version of the sketch');
        const schedule = scheduleFor(v);
        const now = ctx.clock.now();
        const { approval, version } = approveMeasurement({
          id: ctx.newId(),
          version: v,
          schedule,
          approver: principal,
          at: now,
        });
        await tx.query('UPDATE sketch_version SET status = $2, data = $3 WHERE id = $1', [
          v.id,
          version.status,
          JSON.stringify(version),
        ]);
        await tx.query(
          'INSERT INTO measurement_approval (id, org_id, job_id, sketch_version_id, schedule, schedule_hash, approved_by, approved_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            approval.id,
            job.org_id,
            job.id,
            v.id,
            JSON.stringify(schedule),
            schedule.scheduleHash,
            principal.userId,
            now,
          ],
        );
        await touchJob(tx, job.id, now);
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'measurement.approved',
          entityType: 'sketch_version',
          entityId: v.id,
          after: {
            scheduleHash: schedule.scheduleHash,
            totalIncludedM2: schedule.totalIncludedM2,
            basis: schedule.basis,
          },
        });
        return { approval, schedule };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/photos',
    summary: 'Register a captured photo (de-duplicated by content hash per asset)',
    tags: ['inspection'],
    permission: 'photo.capture',
    params: JobParams,
    body: z.object({
      id: Uuid.optional(),
      assetId: Uuid,
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      dHash: z
        .string()
        .regex(/^[0-9a-f]{16}$/)
        .optional(),
      sequence: z.number().int().min(0),
      capturedAt: InstantSchema,
      gps: z
        .object({ lat: z.number(), lng: z.number(), accuracyM: z.number().nonnegative() })
        .optional(),
      caption: z.string().max(200).optional(),
      roomOrArea: z.string().max(80).optional(),
      quality: z.object({ isBlurry: z.boolean(), isLowLight: z.boolean() }).optional(),
      qualityOverrideReason: z.string().optional(),
      includeInReport: z.boolean().default(false),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'photo.capture', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        await assertAssetInJob(tx, job.id, body.assetId);
        const existing = await tx.query<{ id: string }>(
          'SELECT id FROM photo WHERE asset_id = $1 AND sha256 = $2 AND NOT deleted',
          [body.assetId, body.sha256],
        );
        if (existing.rows[0]) return { id: existing.rows[0].id, deduplicated: true };
        const photo = compact({
          ...body,
          id: body.id ?? ctx.newId(),
          capturedBy: principal.userId,
          privacyFlags: [],
          privacyStatus: 'clear' as const,
        }) as PhotoRecord;
        await tx.query(
          'INSERT INTO photo (id, org_id, job_id, asset_id, sha256, data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            photo.id,
            job.org_id,
            job.id,
            photo.assetId,
            photo.sha256,
            JSON.stringify(photo),
            ctx.clock.now(),
          ],
        );
        await touchJob(tx, job.id, ctx.clock.now());
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'photo.captured',
          entityType: 'photo',
          entityId: photo.id,
          after: { sha256: photo.sha256, assetId: photo.assetId },
        });
        return { id: photo.id, deduplicated: false };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/photos/:photoId/privacy',
    summary: 'Flag sensitive content, record redaction or consent, or exclude a photo',
    tags: ['inspection'],
    permission: 'photo.redact',
    params: z.object({ jobId: Uuid, photoId: Uuid }),
    body: z.discriminatedUnion('action', [
      z.object({
        action: z.literal('flag'),
        flags: z
          .array(
            z.enum([
              'person',
              'child',
              'personal_document',
              'number_plate',
              'screen_or_display',
              'personal_effects',
              'other_sensitive',
            ]),
          )
          .min(1),
      }),
      z.object({ action: z.literal('redact'), redactedPhotoId: Uuid }),
      z.object({ action: z.literal('consent'), consentRef: z.string().min(3) }),
      z.object({ action: z.literal('exclude') }),
    ]),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'photo.redact', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        const photo = await loadPhoto(tx, job, params.photoId);
        if (body.action === 'redact') {
          await assertPhotoInJob(tx, job.id, body.redactedPhotoId);
          if (body.redactedPhotoId === photo.id)
            throw new HttpError(
              422,
              'INVALID_REDACTION',
              'the redacted derivative must be a separate image',
            );
        }
        const next =
          body.action === 'flag'
            ? flagPhotoPrivacy(photo, body.flags)
            : body.action === 'redact'
              ? recordRedaction(photo, body.redactedPhotoId)
              : body.action === 'consent'
                ? recordConsent(photo, body.consentRef)
                : excludePhoto(photo);
        await tx.query('UPDATE photo SET data = $2, version = version + 1 WHERE id = $1', [
          photo.id,
          JSON.stringify(next),
        ]);
        await touchJob(tx, job.id, ctx.clock.now());
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: body.action === 'flag' ? 'photo.privacy_flagged' : 'photo.redacted',
          entityType: 'photo',
          entityId: photo.id,
          before: { privacyStatus: photo.privacyStatus },
          after: { privacyStatus: next.privacyStatus, action: body.action },
        });
        return next;
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/ai-suggestions',
    summary: 'AI service submits a suggestion (pending until a person decides)',
    tags: ['ai'],
    permission: 'inspection.capture (AI service accounts only)',
    params: JobParams,
    body: z.object({
      assetId: Uuid,
      kind: z.enum(['room_classification', 'visible_attribute', 'sketch_outline', 'room_label']),
      photoId: Uuid.optional(),
      sourcePlanId: Uuid.optional(),
      label: z.string().min(1).max(60),
      value: z.unknown().optional(),
      confidence: z.number().min(0).max(1),
      model: z.object({ provider: z.string(), model: z.string(), version: z.string() }),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        if (principal.kind !== 'ai')
          throw new HttpError(403, 'AI_SERVICE_ONLY', 'only the AI service submits suggestions');
        const { job } = await authorizeJob(ctx, tx, principal, 'inspection.capture', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        await assertAssetInJob(tx, job.id, body.assetId);
        if (body.photoId) await assertPhotoInJob(tx, job.id, body.photoId);
        const suggestion = createAiSuggestion(
          compact({
            ...body,
            id: ctx.newId(),
            createdAt: ctx.clock.now(),
            value: body.value as Json | undefined,
          }),
        );
        await tx.query(
          "INSERT INTO ai_suggestion (id, org_id, job_id, asset_id, status, data) VALUES ($1, $2, $3, $4, 'pending', $5)",
          [suggestion.id, job.org_id, job.id, suggestion.assetId, JSON.stringify(suggestion)],
        );
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'ai.suggestion_created',
          entityType: 'ai_suggestion',
          entityId: suggestion.id,
          after: {
            label: suggestion.label,
            confidence: suggestion.confidence,
            model: { ...suggestion.model },
          },
        });
        return suggestion;
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/ai-suggestions/:suggestionId/decision',
    summary: 'Accept, edit or reject an AI suggestion (the only path to a fact)',
    tags: ['ai'],
    permission: 'ai.decide',
    params: z.object({ jobId: Uuid, suggestionId: Uuid }),
    body: z.object({
      decision: z.enum(['accept', 'edit', 'reject']),
      editedLabel: z.string().optional(),
      editedValue: z.unknown().optional(),
      reason: z.string().optional(),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'ai.decide', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        const { rows } = await tx.query<{ data: AiSuggestion }>(
          'SELECT data FROM ai_suggestion WHERE id = $1 AND job_id = $2 FOR UPDATE',
          [params.suggestionId, job.id],
        );
        const s = rows[0]?.data;
        if (!s) throw notFound('suggestion');
        const { suggestion, fact } = decideAiSuggestion(
          s,
          compact({
            decision: body.decision,
            actor: principal,
            at: ctx.clock.now(),
            factId: ctx.newId(),
            editedLabel: body.editedLabel,
            editedValue: body.editedValue as Json | undefined,
            reason: body.reason,
          }),
        );
        await tx.query('UPDATE ai_suggestion SET status = $2, data = $3 WHERE id = $1', [
          s.id,
          suggestion.status,
          JSON.stringify(suggestion),
        ]);
        if (fact) {
          await tx.query(
            'INSERT INTO accepted_fact (id, org_id, job_id, asset_id, suggestion_id, data) VALUES ($1, $2, $3, $4, $5, $6)',
            [fact.id, job.org_id, job.id, fact.assetId, s.id, JSON.stringify(fact)],
          );
        }
        await touchJob(tx, job.id, ctx.clock.now());
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: `ai.suggestion_${suggestion.status}`,
          entityType: 'ai_suggestion',
          entityId: s.id,
          after: { label: fact?.label ?? s.label, factId: fact?.id ?? null },
        });
        return { suggestion, fact: fact ?? null };
      }),
  });
}
