import {
  AVM_NOTICE,
  JURISDICTION_TIME_ZONES,
  STATE_MAP_SERVICES,
  authorize,
  buildWip,
  localDateOf,
  saleFromProvider,
  suggestFieldsFromAttributes,
  type DataSource,
  type PropertyDataProvider,
  type PropertyMatch,
} from '@vp/domain';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { HttpError } from '../http/errors.js';
import type { Router } from '../http/route.js';
import {
  PropertyDataUnavailableError,
  PropertyNotFoundError,
  type PropertyDataService,
} from '../integrations/property-data.js';
import { authorizeJob, authorizeOrThrow } from '../repo/jobs.js';
import { audit, jobStream } from '../services/audit.js';
import { loadVisibleJobs, wipJobView, wipToday } from '../services/wip.js';
import { JobParams, Uuid } from './schemas.js';

const AssetParams = z.object({ jobId: Uuid, assetId: Uuid });

const ProviderPropertyId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, 'unexpected characters in property id');

interface AssetLocation {
  readonly id: string;
  readonly label: string;
  readonly address: Record<string, unknown>;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

async function loadAsset(db: Db, jobId: string, assetId: string): Promise<AssetLocation> {
  const { rows } = await db.query<AssetLocation>(
    'SELECT id, label, address, latitude, longitude FROM asset WHERE id = $1 AND job_id = $2 AND NOT deleted',
    [assetId, jobId],
  );
  const asset = rows[0];
  if (!asset) throw new HttpError(422, 'UNKNOWN_ASSET', 'asset does not belong to this job');
  return asset;
}

const addressOf = (a: AssetLocation): string =>
  typeof a.address['formatted'] === 'string' ? a.address['formatted'] : a.label;

function reasonOf(service: PropertyDataService): string {
  return 'reason' in service.status ? service.status.reason : 'property data is not configured';
}

/** The provider for this request, or 503 when property data is off or keys are not supplied. */
function requireProvider(ctx: AppContext, service: PropertyDataService): PropertyDataProvider {
  const provider = service.provider(wipToday(ctx));
  if (!provider)
    throw new HttpError(
      503,
      'PROPERTY_DATA_NOT_CONFIGURED',
      `Property data is not available (${reasonOf(service)}). Enter the details manually.`,
      { status: service.status },
    );
  return provider;
}

type SourceRow = {
  id: string;
  name: string;
  provider: string;
  kind: DataSource['kind'];
  licence: DataSource['licence'];
  freshness_days: number | null;
  status: DataSource['status'];
};

const toSource = (s: SourceRow): DataSource => ({
  id: s.id,
  name: s.name,
  provider: s.provider,
  kind: s.kind,
  licence: s.licence,
  ...(s.freshness_days !== null ? { freshnessDays: s.freshness_days } : {}),
  status: s.status,
});

/**
 * The provider's data sources as registered for the organisation (the registry is authoritative
 * for licence terms). The property source must be registered and active; the automated estimate
 * is only fetched when its own source is registered and active.
 */
async function registeredSources(
  db: Db,
  orgId: string,
  provider: PropertyDataProvider,
): Promise<{ source: DataSource; avmSource: DataSource | null }> {
  const { rows } = await db.query<SourceRow>(
    "SELECT id, name, provider, kind, licence, freshness_days, status FROM data_source WHERE org_id = $1 AND id = ANY($2::text[]) AND status = 'active'",
    [orgId, [provider.source.id, provider.avmSource.id]],
  );
  const source = rows.find((r) => r.id === provider.source.id);
  if (!source)
    throw new HttpError(
      409,
      'DATA_SOURCE_NOT_REGISTERED',
      `register the data source "${provider.source.name}" (${provider.source.id}) for your organisation before using property data`,
      { sourceId: provider.source.id },
    );
  const avm = rows.find((r) => r.id === provider.avmSource.id);
  return { source: toSource(source), avmSource: avm ? toSource(avm) : null };
}

const sourceView = (s: DataSource) => ({
  id: s.id,
  name: s.name,
  provider: s.provider,
  attribution: s.licence.attribution ?? null,
  licenceBasis: s.licence.basis,
  /** False for sample data and automated estimates: VAL-PROV-003 blocks issue if relied on. */
  reportable: s.licence.permitsReportReproduction,
});

const unavailable = (err: PropertyDataUnavailableError): HttpError =>
  new HttpError(
    502,
    'PROPERTY_DATA_UNAVAILABLE',
    `Property data is unavailable right now (${err.failure}). Enter the details manually.`,
    { failure: err.failure, attempts: err.attempts, fallback: err.fallback },
  );

/** Runs provider calls and maps their failures to stable API errors. */
async function providerCall<T>(req: FastifyRequest, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof PropertyNotFoundError)
      throw new HttpError(
        422,
        'NO_PROPERTY_MATCH',
        'the data provider has no property with this identifier; search again or enter the details manually',
      );
    if (err instanceof PropertyDataUnavailableError) {
      req.log.warn({ failure: err.failure, attempts: err.attempts }, 'property data unavailable');
      throw unavailable(err);
    }
    // Anything else from a provider is treated as an outage; the message is not passed on.
    req.log.warn({ errName: err instanceof Error ? err.name : 'unknown' }, 'property data failed');
    throw unavailable(new PropertyDataUnavailableError('failed', 1, 'provider error'));
  }
}

/** The provider property for the asset: the given id, or the best match for its address. */
async function resolveProperty(
  provider: PropertyDataProvider,
  asset: AssetLocation,
  propertyId: string | undefined,
): Promise<{ propertyId: string; match: PropertyMatch | null }> {
  if (propertyId) return { propertyId, match: null };
  const matches = await provider.matchAddress(addressOf(asset));
  const best = [...matches].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  if (!best)
    throw new HttpError(
      422,
      'NO_PROPERTY_MATCH',
      "no property matched the asset's address; search by address and pass a propertyId, or enter the details manually",
    );
  return { propertyId: best.propertyId, match: best };
}

export function registerPropertyDataRoutes(r: Router, service: PropertyDataService): void {
  r.add({
    method: 'GET',
    url: '/v1/integrations/status',
    summary: 'Property data provider status and state government map services',
    tags: ['integrations'],
    permission: 'job.read',
    handler: async ({ ctx, principal }) => {
      await authorizeOrThrow(
        ctx,
        principal,
        'job.read',
        { orgId: principal.orgId },
        { type: 'org', id: principal.orgId },
      );
      return { propertyData: service.status, maps: STATE_MAP_SERVICES };
    },
  });

  r.add({
    method: 'GET',
    url: '/v1/property-search',
    summary: 'Search by address: provider property matches and existing jobs the user can see',
    tags: ['integrations'],
    permission: 'job.read',
    query: z.object({ q: z.string().trim().min(2).max(200) }),
    handler: async ({ ctx, principal, query, req }) => {
      await authorizeOrThrow(
        ctx,
        principal,
        'job.read',
        { orgId: principal.orgId },
        { type: 'org', id: principal.orgId },
      );
      const today = wipToday(ctx);
      const visible = await loadVisibleJobs(ctx, principal);
      const rows = new Map(visible.map((v) => [v.row.id, v.row]));
      const jobs = buildWip(
        visible.map((v) => v.wip),
        today,
        { query: query.q },
      )
        .rows.slice(0, 25)
        .flatMap((w) => {
          const row = rows.get(w.job.id);
          return row ? [wipJobView(row, w)] : [];
        });
      const provider = service.provider(today);
      let matches: PropertyMatch[] = [];
      let problem: { code: string; message: string; details?: Record<string, unknown> } | null =
        null;
      if (provider) {
        // A provider problem never hides the user's own jobs: it is reported alongside them.
        try {
          await registeredSources(ctx.db, principal.orgId, provider);
          matches = await providerCall(req, () => provider.matchAddress(query.q));
        } catch (err) {
          if (!(err instanceof HttpError)) throw err;
          problem = {
            code: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
          };
        }
      }
      return {
        status: service.status,
        matches,
        jobs,
        ...(problem ? { propertyDataProblem: problem } : {}),
      };
    },
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/assets/:assetId/property-data',
    summary:
      'Look up licensed property data for an asset: field suggestions with provenance, sales history and an automated estimate (nothing is saved)',
    tags: ['integrations'],
    permission: 'asset.edit',
    params: AssetParams,
    body: z.object({ propertyId: ProviderPropertyId.optional() }),
    handler: async ({ ctx, principal, params, body, req }) => {
      const { job, resource } = await authorizeJob(
        ctx,
        ctx.db,
        principal,
        'asset.edit',
        params.jobId,
      );
      const provider = requireProvider(ctx, service);
      const asset = await loadAsset(ctx.db, job.id, params.assetId);
      const { source, avmSource } = await registeredSources(ctx.db, job.org_id, provider);
      // The automated estimate is a cross-check for the valuer, so only valuation users see it.
      const avmAllowed =
        avmSource !== null && authorize(principal, 'valuation.edit', resource).allowed;
      const retrievedAt = ctx.clock.now();
      const { propertyId, match } = await providerCall(req, () =>
        resolveProperty(provider, asset, body.propertyId),
      );
      const [attributes, history, estimate] = await providerCall(req, () =>
        Promise.all([
          provider.attributes(propertyId),
          provider.salesHistory(propertyId),
          avmAllowed ? provider.automatedEstimate(propertyId) : Promise.resolve(null),
        ]),
      );
      const suggestions = suggestFieldsFromAttributes(attributes, {
        assetId: asset.id,
        source,
        retrievedAt,
        capturedBy: principal.userId,
      });
      const salesHistory = history.map((s) =>
        s.address ? s : { ...s, address: attributes.address },
      );
      await ctx.db.transaction((tx) =>
        audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'property_data.retrieved',
          entityType: 'asset',
          entityId: asset.id,
          metadata: {
            kind: 'property',
            provider: provider.id,
            sourceId: source.id,
            propertyId,
            matchedByAddress: body.propertyId === undefined,
            suggestions: suggestions.length,
            sales: salesHistory.length,
            avm: estimate !== null,
          },
        }),
      );
      return {
        status: service.status,
        source: sourceView(source),
        propertyId,
        match,
        attributes,
        suggestions,
        salesHistory,
        avm:
          estimate && avmSource ? { ...estimate, notice: AVM_NOTICE, source: avmSource.id } : null,
      };
    },
  });

  r.add({
    method: 'POST',
    url: '/v1/jobs/:jobId/assets/:assetId/comparables/search',
    summary:
      'Search the provider for recent nearby sales as candidate evidence (nothing is saved; add chosen sales with POST /sales)',
    tags: ['integrations'],
    permission: 'evidence.edit',
    params: AssetParams,
    body: z.object({
      radiusKm: z.number().min(0.5).max(10).default(2),
      months: z.number().int().min(3).max(36).default(12),
      limit: z.number().int().min(1).max(20).default(10),
      propertyId: ProviderPropertyId.optional(),
    }),
    handler: async ({ ctx, principal, params, body, req }) => {
      const { job } = await authorizeJob(ctx, ctx.db, principal, 'evidence.edit', params.jobId);
      const provider = requireProvider(ctx, service);
      const asset = await loadAsset(ctx.db, job.id, params.assetId);
      const { source } = await registeredSources(ctx.db, job.org_id, provider);
      const retrievedAt = ctx.clock.now();
      const { propertyId, match } = await providerCall(req, () =>
        resolveProperty(provider, asset, body.propertyId),
      );
      let latitude = asset.latitude ?? match?.latitude;
      let longitude = asset.longitude ?? match?.longitude;
      if (latitude === undefined || longitude === undefined) {
        const a = await providerCall(req, () => provider.attributes(propertyId));
        latitude = a.latitude;
        longitude = a.longitude;
      }
      if (latitude === undefined || longitude === undefined)
        throw new HttpError(
          422,
          'SUBJECT_LOCATION_REQUIRED',
          'the asset has no coordinates; set its location before searching for nearby sales',
        );
      const toDate = localDateOf(retrievedAt, JURISDICTION_TIME_ZONES[job.jurisdiction]);
      const subject = { latitude, longitude };
      const sales = await providerCall(req, () =>
        provider.comparableSales({
          propertyId,
          ...subject,
          radiusKm: body.radiusKm,
          months: body.months,
          toDate,
          propertyType: job.property_type,
          limit: body.limit,
        }),
      );
      const candidates = sales.slice(0, body.limit).map((sale) => ({
        sale,
        evidence: saleFromProvider(sale, {
          assetId: asset.id,
          source,
          retrievedAt,
          capturedBy: principal.userId,
          propertyType: job.property_type,
        }),
      }));
      await ctx.db.transaction((tx) =>
        audit(tx, ctx, {
          orgId: job.org_id,
          streamId: jobStream(job.id),
          actor: principal,
          action: 'property_data.retrieved',
          entityType: 'asset',
          entityId: asset.id,
          metadata: {
            kind: 'comparables',
            provider: provider.id,
            sourceId: source.id,
            propertyId,
            radiusKm: body.radiusKm,
            months: body.months,
            candidates: candidates.length,
          },
        }),
      );
      return {
        status: service.status,
        source: sourceView(source),
        propertyId,
        search: { ...subject, radiusKm: body.radiusKm, months: body.months, toDate },
        candidates,
      };
    },
  });

  r.add({
    method: 'GET',
    url: '/v1/jobs/:jobId/map',
    summary: "Map for a job: the state's government map service, the subject properties and sales",
    tags: ['map'],
    permission: 'job.read',
    params: JobParams,
    handler: async ({ ctx, principal, params }) => {
      const { job } = await authorizeJob(ctx, ctx.db, principal, 'job.read', params.jobId);
      const [assets, sales] = await Promise.all([
        ctx.db.query<AssetLocation & { risk_level: string }>(
          'SELECT id, label, address, latitude, longitude, risk_level FROM asset WHERE job_id = $1 AND NOT deleted ORDER BY created_at, id',
          [job.id],
        ),
        ctx.db.query<{ id: string; asset_id: string; data: Record<string, unknown> }>(
          'SELECT id, asset_id, data FROM sale_comparable WHERE job_id = $1 ORDER BY created_at, id',
          [job.id],
        ),
      ]);
      const subject = assets.rows.flatMap((a) =>
        a.latitude !== null && a.longitude !== null
          ? [
              {
                assetId: a.id,
                label: a.label,
                address: addressOf(a),
                latitude: a.latitude,
                longitude: a.longitude,
                risk: a.risk_level,
              },
            ]
          : [],
      );
      const located = sales.rows.flatMap((s) => {
        const { latitude, longitude, address, price, contractDate } = s.data;
        return typeof latitude === 'number' && typeof longitude === 'number'
          ? [
              {
                saleId: s.id,
                assetId: s.asset_id,
                address,
                price,
                contractDate,
                latitude,
                longitude,
              },
            ]
          : [];
      });
      const notes: string[] = [];
      if (subject.length < assets.rows.length)
        notes.push('Some properties have no coordinates and are not shown.');
      if (sales.rows.length > located.length)
        notes.push(
          'Sales evidence does not store coordinates yet, so sales without them are not shown.',
        );
      return {
        jurisdiction: job.jurisdiction,
        service: STATE_MAP_SERVICES[job.jurisdiction],
        subject,
        sales: located,
        notes,
      };
    },
  });
}
