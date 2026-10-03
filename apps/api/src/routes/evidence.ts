import {
  analyseSale,
  assertEditable,
  overrideCalculation,
  runCalculation,
  type CalculationRecord,
  type Json,
  type MarketCommentary,
  type Provenance,
  type RentalComparable,
  type RiskFlag,
  type SaleComparable,
} from '@vp/domain';
import { z } from 'zod';
import type { Db } from '../db/db.js';
import { HttpError, notFound } from '../http/errors.js';
import type { Router } from '../http/route.js';
import { assertAssetInJob, authorizeJob, touchJob, type JobRow } from '../repo/jobs.js';
import { audit, jobStream } from '../services/audit.js';
import { JobParams, LocalDateSchema, ProvenanceInput, Uuid, compact } from './schemas.js';

const AdjustmentSchema = z.object({
  factor: z.enum([
    'time',
    'location',
    'land_size',
    'building_size',
    'condition',
    'quality',
    'accommodation',
    'improvements',
    'zoning',
    'tenure',
    'lease_terms',
    'other',
  ]),
  kind: z.enum(['percent', 'absolute']),
  value: z.number(),
  rationale: z.string().min(3),
});

const EvidenceProvenance = ProvenanceInput.extend({
  origin: z.enum(['external_source', 'client_supplied', 'manual_entry']),
});

const assetOfJob = (db: Db, job: JobRow, assetId: string): Promise<void> =>
  assertAssetInJob(db, job.id, assetId);

async function insertCalculation(
  tx: Db,
  job: JobRow,
  calc: CalculationRecord,
  refs: { assetId?: string | null; saleId?: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO calculation (id, org_id, job_id, asset_id, sale_id, formula_id, formula_version, record, trace_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      calc.id,
      job.org_id,
      job.id,
      refs.assetId ?? null,
      refs.saleId ?? null,
      calc.formulaId,
      calc.formulaVersion,
      JSON.stringify(calc),
      calc.traceHash,
      calc.computedAt,
    ],
  );
}

/** The capturing user attests verification, so verified data records who verified it and when. */
const provenanceOf = (
  p: z.infer<typeof EvidenceProvenance>,
  userId: string,
  now: string,
): Provenance => ({
  ...compact(p),
  ...(p.verification === 'verified' ? { verifiedBy: userId, verifiedAt: now } : {}),
  capturedBy: userId,
  capturedAt: now,
});

export function registerEvidenceRoutes(r: Router): void {
  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/sales',
    summary: 'Add a sale comparable; land, building and adjusted rates are calculated and traced',
    tags: ['evidence'],
    permission: 'evidence.edit',
    params: JobParams,
    body: z.object({
      id: Uuid.optional(),
      assetId: Uuid,
      address: z.string().min(3),
      contractDate: LocalDateSchema,
      settlementDate: LocalDateSchema.optional(),
      price: z.number().positive(),
      interest: z.string().min(2),
      propertyType: z.enum([
        'VACANT_LAND',
        'RESIDENTIAL',
        'COMMERCIAL_OFFICE',
        'COMMERCIAL_RETAIL',
        'INDUSTRIAL',
        'SPECIALISED_MIXED_USE',
      ]),
      landAreaM2: z.number().positive().optional(),
      buildingAreaM2: z.number().positive().optional(),
      zoning: z.string().optional(),
      provenance: EvidenceProvenance,
      comparability: z.enum(['superior', 'comparable', 'inferior']),
      adjustments: z.array(AdjustmentSchema).default([]),
      analysisBasis: z.enum(['land_rate', 'building_rate', 'price']),
      postValuationDateUse: z.object({ reason: z.string().min(5) }).optional(),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'evidence.edit', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        await assetOfJob(tx, job, body.assetId);
        const now = ctx.clock.now();
        const { id: givenId, provenance, ...rest } = body;
        const sale = {
          ...compact(rest),
          id: givenId ?? ctx.newId(),
          provenance: provenanceOf(provenance, principal.userId, now),
        } as SaleComparable;
        const analysis = analyseSale(sale, { computedBy: principal.userId, computedAt: now });
        await tx.query(
          'INSERT INTO sale_comparable (id, org_id, job_id, asset_id, data, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [sale.id, job.org_id, job.id, sale.assetId, JSON.stringify(sale), principal.userId, now],
        );
        for (const calc of [analysis.landRate, analysis.buildingRate, analysis.adjusted]) {
          if (calc)
            await insertCalculation(tx, job, calc, { assetId: sale.assetId, saleId: sale.id });
        }
        await touchJob(tx, job.id, now);
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'evidence.sale_added',
          entityType: 'sale_comparable',
          entityId: sale.id,
          after: sale as unknown as Json,
        });
        return { sale, analysis };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/rentals',
    summary: 'Add a rental comparable',
    tags: ['evidence'],
    permission: 'evidence.edit',
    params: JobParams,
    body: z.object({
      id: Uuid.optional(),
      assetId: Uuid,
      address: z.string().min(3),
      leaseStartDate: LocalDateSchema,
      faceRentPa: z.number().positive(),
      rentBasis: z.enum(['gross', 'semi_gross', 'net']),
      leaseAreaM2: z.number().positive(),
      incentiveRatio: z.number().min(0).max(1).optional(),
      termYears: z.number().positive().optional(),
      provenance: EvidenceProvenance,
      comparability: z.enum(['superior', 'comparable', 'inferior']),
      adjustments: z.array(AdjustmentSchema).default([]),
      postValuationDateUse: z.object({ reason: z.string().min(5) }).optional(),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'evidence.edit', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        await assetOfJob(tx, job, body.assetId);
        const now = ctx.clock.now();
        const { id: givenId, provenance, ...rest } = body;
        const rental = {
          ...compact(rest),
          id: givenId ?? ctx.newId(),
          provenance: provenanceOf(provenance, principal.userId, now),
        } as RentalComparable;
        await tx.query(
          'INSERT INTO rental_comparable (id, org_id, job_id, asset_id, data, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [
            rental.id,
            job.org_id,
            job.id,
            rental.assetId,
            JSON.stringify(rental),
            principal.userId,
            now,
          ],
        );
        await touchJob(tx, job.id, now);
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'evidence.rental_added',
          entityType: 'rental_comparable',
          entityId: rental.id,
          after: rental as unknown as Json,
        });
        return { rental };
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/calculations',
    summary: 'Run a registered formula with traced inputs and units',
    tags: ['calculations'],
    permission: 'calculation.run',
    params: JobParams,
    body: z.object({
      assetId: Uuid.optional(),
      formulaId: z.string(),
      formulaVersion: z.number().int().positive().optional(),
      inputs: z
        .array(
          z.object({
            name: z.string(),
            value: z.number(),
            unit: z.string(),
            sourceRef: z.string().optional(),
          }),
        )
        .min(1),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'calculation.run', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        if (body.assetId) await assetOfJob(tx, job, body.assetId);
        const calc = runCalculation({
          id: ctx.newId(),
          formulaId: body.formulaId,
          ...(body.formulaVersion ? { formulaVersion: body.formulaVersion } : {}),
          inputs: body.inputs.map((i) => compact(i)) as Parameters<
            typeof runCalculation
          >[0]['inputs'],
          computedBy: principal.userId,
          computedAt: ctx.clock.now(),
        });
        await insertCalculation(tx, job, calc, { assetId: body.assetId ?? null });
        await touchJob(tx, job.id, calc.computedAt);
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'calculation.run',
          entityType: 'calculation',
          entityId: calc.id,
          after: {
            formula: `${calc.formulaId}@${calc.formulaVersion}`,
            output: calc.output.value,
            traceHash: calc.traceHash,
          },
        });
        return calc;
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/calculations/:calcId/override',
    summary: 'Override a calculated value (reason required; original retained)',
    tags: ['calculations'],
    permission: 'calculation.override',
    params: z.object({ jobId: Uuid, calcId: z.string().min(1) }),
    body: z.object({ value: z.number(), reason: z.string() }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(
          ctx,
          tx,
          principal,
          'calculation.override',
          params.jobId,
          { forUpdate: true },
        );
        assertEditable(job.status);
        const { rows } = await tx.query<{ record: CalculationRecord }>(
          'SELECT record FROM calculation WHERE id = $1 AND job_id = $2',
          [params.calcId, job.id],
        );
        const existing = rows[0]?.record;
        if (!existing) throw notFound('calculation');
        const updated = overrideCalculation(existing, {
          value: body.value,
          reason: body.reason,
          by: principal.userId,
          at: ctx.clock.now(),
        });
        await tx.query('UPDATE calculation SET record = $2 WHERE id = $1', [
          existing.id,
          JSON.stringify(updated),
        ]);
        await touchJob(tx, job.id, ctx.clock.now());
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'calculation.overridden',
          entityType: 'calculation',
          entityId: existing.id,
          reason: updated.override?.reason ?? body.reason,
          before: { value: existing.override?.value ?? existing.output.value },
          after: { value: body.value },
        });
        return updated;
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/commentary',
    summary: 'Add a dated national, state or local market commentary module',
    tags: ['evidence'],
    permission: 'evidence.edit',
    params: JobParams,
    body: z.object({
      level: z.enum(['national', 'state', 'local']),
      assetId: Uuid.optional(),
      asAtDate: LocalDateSchema,
      text: z.string().min(10),
      sources: z.array(EvidenceProvenance).default([]),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'evidence.edit', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        const now = ctx.clock.now();
        const c: MarketCommentary = {
          id: ctx.newId(),
          level: body.level,
          ...(body.assetId ? { assetId: body.assetId } : {}),
          asAtDate: body.asAtDate,
          text: body.text,
          authoredBy: principal.userId,
          authoredAt: now,
          sources: body.sources.map((s) => provenanceOf(s, principal.userId, now)),
        };
        await tx.query(
          'INSERT INTO market_commentary (id, org_id, job_id, asset_id, level, as_at_date, data) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [c.id, job.org_id, job.id, body.assetId ?? null, c.level, c.asAtDate, JSON.stringify(c)],
        );
        await touchJob(tx, job.id, now);
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'evidence.commentary_added',
          entityType: 'market_commentary',
          entityId: c.id,
          after: { level: c.level, asAtDate: c.asAtDate },
        });
        return c;
      }),
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/risk-flags',
    summary: 'Raise or update a risk flag (escalation triggers)',
    tags: ['evidence'],
    permission: 'inspection.capture',
    params: JobParams,
    body: z.object({
      id: Uuid.optional(),
      assetId: Uuid.optional(),
      category: z.enum([
        'environmental',
        'structural_observation',
        'title',
        'planning',
        'market',
        'data_quality',
        'access',
        'other',
      ]),
      description: z.string().min(5),
      severity: z.enum(['low', 'medium', 'high']),
      requiresEscalation: z.boolean(),
      status: z.enum(['open', 'resolved', 'accepted']).default('open'),
      resolutionNote: z.string().optional(),
    }),
    handler: async ({ ctx, principal, params, body }) =>
      ctx.db.transaction(async (tx) => {
        const { job } = await authorizeJob(ctx, tx, principal, 'inspection.capture', params.jobId, {
          forUpdate: true,
        });
        assertEditable(job.status);
        if (body.status !== 'open' && !body.resolutionNote?.trim())
          throw new HttpError(
            422,
            'RESOLUTION_NOTE_REQUIRED',
            'closing a risk flag requires a note',
          );
        if (body.assetId) await assetOfJob(tx, job, body.assetId);
        // Accepting or resolving a risk (which clears VAL-RISK-001 / VAL-SCOPE-001) is the valuer's decision.
        if (body.status !== 'open') {
          await authorizeJob(ctx, tx, principal, 'validation.acknowledge', params.jobId);
        }
        let previousAssetId: string | null = null;
        if (body.id) {
          const existing = await tx.query<{ job_id: string; asset_id: string | null }>(
            'SELECT job_id, asset_id FROM risk_flag WHERE id = $1 FOR UPDATE',
            [body.id],
          );
          if (existing.rows[0] && existing.rows[0].job_id !== job.id) {
            throw new HttpError(422, 'UNKNOWN_RISK_FLAG', 'risk flag belongs to another job');
          }
          previousAssetId = existing.rows[0]?.asset_id ?? null;
        }
        const flag = compact({ ...body, id: body.id ?? ctx.newId() }) as RiskFlag;
        await tx.query(
          `INSERT INTO risk_flag (id, org_id, job_id, asset_id, status, data) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET asset_id = EXCLUDED.asset_id, status = EXCLUDED.status, data = EXCLUDED.data`,
          [flag.id, job.org_id, job.id, flag.assetId ?? null, flag.status, JSON.stringify(flag)],
        );
        // Recompute the map risk level for every asset the flag touched (old and new).
        for (const assetId of new Set(
          [flag.assetId, previousAssetId].filter((a): a is string => typeof a === 'string'),
        )) {
          await tx.query(
            `UPDATE asset SET risk_level = (SELECT CASE coalesce(max(CASE data->>'severity' WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END), 0)
               WHEN 3 THEN 'high' WHEN 2 THEN 'medium' WHEN 1 THEN 'low' ELSE 'none' END FROM risk_flag WHERE asset_id = $1 AND status = 'open') WHERE id = $1`,
            [assetId],
          );
        }
        await touchJob(tx, job.id, ctx.clock.now());
        await audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'risk.flag_recorded',
          entityType: 'risk_flag',
          entityId: flag.id,
          after: flag as unknown as Json,
        });
        return flag;
      }),
  });
}
