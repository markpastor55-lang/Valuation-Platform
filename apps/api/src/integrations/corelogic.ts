import {
  CORELOGIC_AVM_SOURCE,
  CORELOGIC_SOURCE,
  DEFAULT_CONNECTOR_POLICY,
  PermanentConnectorError,
  addMonths,
  callWithPolicy,
  createConnectorRuntime,
  distanceKm,
  localDateOf,
  systemClock as connectorSystemClock,
  type AutomatedEstimate,
  type Clock as ConnectorClock,
  type ComparableSearch,
  type ConnectorPolicy,
  type ConnectorRuntime,
  type LocalDate,
  type PropertyAttributes,
  type PropertyDataProvider,
  type PropertyMatch,
  type PropertyType,
  type ProviderSale,
} from '@vp/domain';
import { z } from 'zod';
import { PropertyDataUnavailableError, PropertyNotFoundError } from './errors.js';

/**
 * CoreLogic Australia (Cotality) property data over its REST APIs: OAuth 2.0 client credentials,
 * bearer requests, every request through the domain connector policy (timeout, retries with
 * backoff, rate limit, circuit breaker; manual entry is the fallback). Responses are parsed
 * defensively: unknown fields are ignored, wrongly typed optional fields are dropped, and only the
 * values the domain contract needs are kept. Nothing here logs credentials, tokens or response
 * bodies, and error messages carry only the endpoint name and HTTP status.
 */

// Verify against the Cotality developer portal under your licence [REVIEW: DATA_LICENSING]
// These are the paths we believe CoreLogic Australia's property APIs use (developer.corelogic.asia
// is behind a login). `{propertyId}` is substituted. An empty string turns an optional endpoint
// off (its values are then simply not suggested). Override any of them with CORELOGIC_PATHS.
export const CORELOGIC_DEFAULT_PATHS = {
  /** Address suggest (type-ahead): ?q=&suggestionTypes=address&limit= */
  suggest: '/property/au/v2/suggest.json',
  /** Core attributes: bedrooms, bathrooms, car spaces, land area, property type. Required. */
  attributesCore: '/property-details/au/properties/{propertyId}/attributes/core',
  /** Additional attributes: floor area, year built. Optional. */
  attributesAdditional: '/property-details/au/properties/{propertyId}/attributes/additional',
  /** Location: single-line address, coordinates, council area. Optional. */
  location: '/property-details/au/properties/{propertyId}/location',
  /** Legal: lot/plan and title reference. Optional. */
  legal: '/property-details/au/properties/{propertyId}/legal',
  /** Site: zoning. Optional. */
  site: '/property-details/au/properties/{propertyId}/site',
  /** Sales history of the property. */
  salesHistory: '/property-details/au/properties/{propertyId}/sales',
  /** Comparable sales: last sales within a radius (?lat=&lon=&radius=&pTypes=&fromDate=&toDate=&size=). */
  comparables: '/search/au/property/geo/radius/lastSale',
  /** IntelliVal automated valuation estimate (current). */
  avm: '/avm/au/properties/{propertyId}/avm/intellival/consumer/current',
} as const;

export type CoreLogicEndpoint = keyof typeof CORELOGIC_DEFAULT_PATHS;
export type CoreLogicPaths = Readonly<Record<CoreLogicEndpoint, string>>;

/** Property type filter sent with comparable searches. [REVIEW: DATA_LICENSING] */
export const CORELOGIC_PROPERTY_TYPES: Readonly<Record<PropertyType, string | undefined>> = {
  RESIDENTIAL: 'HOUSE',
  RESIDENTIAL_UNIT: 'UNIT',
  VACANT_LAND: 'LAND',
  COMMERCIAL_OFFICE: 'COMMERCIAL',
  COMMERCIAL_RETAIL: 'COMMERCIAL',
  INDUSTRIAL: 'INDUSTRIAL',
  SPECIALISED_MIXED_USE: undefined,
};

/**
 * How the client credentials are presented to the token endpoint: `body` (form fields, the
 * default), `basic` (HTTP Basic header) or `query` (URL parameters; only if the portal requires
 * it, because the URL then carries the secret).
 */
export type CoreLogicTokenAuth = 'body' | 'basic' | 'query';

export interface CoreLogicOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl: string;
  readonly tokenUrl: string;
  readonly tokenAuth?: CoreLogicTokenAuth;
  readonly paths?: Partial<CoreLogicPaths>;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
  readonly policy?: Partial<ConnectorPolicy>;
  readonly clock?: ConnectorClock;
  /** Refresh the token this long before it expires (default 60 s). */
  readonly tokenRefreshMarginMs?: number;
}

/** CoreLogic data is current at retrieval; record dates are Australian. */
const AU_TIME_ZONE = 'Australia/Sydney';

// ── Defensive response schemas (zod 4 looseObject = passthrough; unknown fields ignored) ──────

const optNum = z.number().optional().catch(undefined);
const optStr = z.string().trim().min(1).optional().catch(undefined);
const optBool = z.boolean().optional().catch(undefined);
const optId = z
  .union([z.string().min(1), z.number().int()])
  .optional()
  .catch(undefined);
const list = z.array(z.unknown()).catch([]);

const TokenSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().optional().catch(undefined),
});

const SuggestItem = z.looseObject({
  suggestion: optStr,
  propertyId: optId,
  suggestionType: optStr,
  isActiveProperty: optBool,
});
const SuggestSchema = z.looseObject({ suggestions: list });

const CoreSchema = z.looseObject({
  beds: optNum,
  baths: optNum,
  carSpaces: optNum,
  lockUpGarages: optNum,
  landArea: optNum,
  propertyType: optStr,
  propertySubType: optStr,
});
const AdditionalSchema = z.looseObject({ floorArea: optNum, yearBuilt: optNum });
const LocationSchema = z.looseObject({
  singleLineAddress: optStr,
  latitude: optNum,
  longitude: optNum,
  councilArea: optStr,
});
const LegalSchema = z.looseObject({ lotPlan: optStr, titleReference: optStr });
const SiteSchema = z.looseObject({ zoneDescriptionLocal: optStr, zoneCodeLocal: optStr });

const SaleItem = z.looseObject({
  id: optId,
  saleId: optId,
  contractDate: optStr,
  settlementDate: optStr,
  price: optNum,
  isPriceWithheld: optBool,
});
const SalesSchema = z.looseObject({ saleList: list });

const SummarySchema = z.looseObject({
  id: optId,
  propertyId: optId,
  propertyType: optStr,
  address: z.looseObject({ singleLineAddress: optStr }).optional().catch(undefined),
  attributes: z
    .looseObject({ beds: optNum, baths: optNum, landArea: optNum, floorArea: optNum })
    .optional()
    .catch(undefined),
  location: z.looseObject({ latitude: optNum, longitude: optNum }).optional().catch(undefined),
  lastSale: SaleItem.optional().catch(undefined),
  distance: optNum,
});
const ComparablesSchema = z.looseObject({
  _embedded: z.looseObject({ propertySummaryList: list }).optional().catch(undefined),
  properties: list,
});

const AvmBody = z.looseObject({
  estimate: optNum,
  lowEstimate: optNum,
  highEstimate: optNum,
  confidence: optStr,
  fsd: optNum,
  valuationDate: optStr,
});
const AvmSchema = AvmBody.extend({ avmDetail: AvmBody.optional().catch(undefined) });

/** Parses each element on its own so one malformed record never discards the rest. */
function items<T>(schema: z.ZodType<T>, values: readonly unknown[]): T[] {
  const out: T[] = [];
  for (const v of values) {
    const r = schema.safeParse(v);
    if (r.success) out.push(r.data);
  }
  return out;
}

const dateOf = (v: string | undefined): LocalDate | undefined =>
  v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined;

const positive = (n: number | undefined): number | undefined =>
  n !== undefined && n > 0 ? n : undefined;

const defined = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

function confidenceOf(label: string | undefined, fsd: number | undefined) {
  if (label) {
    if (/high/i.test(label)) return 'high' as const;
    if (/med/i.test(label)) return 'medium' as const;
    if (/low/i.test(label)) return 'low' as const;
  }
  if (fsd !== undefined) return fsd <= 0.1 ? 'high' : fsd <= 0.2 ? 'medium' : 'low';
  return 'low' as const;
}

class HttpStatusError extends Error {
  constructor(endpoint: string, status: number) {
    super(`CoreLogic ${endpoint} returned HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

/** CoreLogic (Cotality) implementation of the provider-neutral property data contract. */
export class CoreLogicProvider implements PropertyDataProvider {
  readonly id = 'corelogic';
  readonly source = CORELOGIC_SOURCE;
  readonly avmSource = CORELOGIC_AVM_SOURCE;
  readonly paths: CoreLogicPaths;
  readonly runtime: ConnectorRuntime;

  private readonly fetchFn: typeof fetch;
  private readonly clock: ConnectorClock;
  private readonly marginMs: number;
  private cached: { readonly token: string; readonly expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly opts: CoreLogicOptions) {
    this.paths = { ...CORELOGIC_DEFAULT_PATHS, ...opts.paths };
    this.fetchFn = opts.fetch ?? fetch;
    this.clock = opts.clock ?? connectorSystemClock;
    this.marginMs = opts.tokenRefreshMarginMs ?? 60_000;
    this.runtime = createConnectorRuntime(
      { ...DEFAULT_CONNECTOR_POLICY, freshnessDays: 365, ...opts.policy },
      this.clock,
    );
  }

  /** Removes anything credential-like from a message before it leaves the provider. */
  private scrub(message: string): string {
    let m = message;
    for (const secret of [this.opts.clientSecret, this.opts.clientId, this.cached?.token]) {
      if (secret) m = m.split(secret).join('[redacted]');
    }
    return m;
  }

  private today(): LocalDate {
    return localDateOf(new Date(this.clock.now()), AU_TIME_ZONE);
  }

  // ── OAuth 2.0 client credentials ───────────────────────────────────────────────────────────

  private token(signal: AbortSignal): Promise<string> {
    if (this.cached && this.clock.now() < this.cached.expiresAt)
      return Promise.resolve(this.cached.token);
    this.inflight ??= this.fetchToken(signal).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchToken(signal: AbortSignal): Promise<string> {
    const { clientId, clientSecret, tokenAuth = 'body' } = this.opts;
    const url = new URL(this.opts.tokenUrl);
    const headers: Record<string, string> = { accept: 'application/json' };
    let body: URLSearchParams | undefined = new URLSearchParams({
      grant_type: 'client_credentials',
    });
    if (tokenAuth === 'body') {
      body.set('client_id', clientId);
      body.set('client_secret', clientSecret);
    } else if (tokenAuth === 'basic') {
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`;
    } else {
      url.searchParams.set('grant_type', 'client_credentials');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('client_secret', clientSecret);
      body = undefined;
    }
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers,
      ...(body ? { body } : {}),
      signal,
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new PermanentConnectorError(
        `CoreLogic rejected the API credentials (HTTP ${res.status})`,
      );
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpStatusError('token service', res.status);
    }
    const parsed = TokenSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new PermanentConnectorError('unexpected CoreLogic token response');
    const lifetimeMs = (parsed.data.expires_in ?? 300) * 1000;
    this.cached = {
      token: parsed.data.access_token,
      expiresAt: this.clock.now() + lifetimeMs - Math.min(this.marginMs, lifetimeMs / 2),
    };
    return parsed.data.access_token;
  }

  // ── Requests ───────────────────────────────────────────────────────────────────────────────

  private url(endpoint: CoreLogicEndpoint, propertyId?: string): URL {
    const path = this.paths[endpoint].replace('{propertyId}', encodeURIComponent(propertyId ?? ''));
    return new URL(this.opts.baseUrl.replace(/\/+$/, '') + path);
  }

  private async send(url: URL, token: string, signal: AbortSignal): Promise<Response> {
    return this.fetchFn(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal,
    });
  }

  /**
   * One GET through the connector policy. A 401 refreshes the token and retries once. 404 (and
   * 403 for optional endpoints the licence may not cover) mean "no data" and return null.
   * 429 and 5xx are retried; other 4xx are permanent.
   */
  private async get(
    endpoint: CoreLogicEndpoint,
    url: URL,
    opts: { readonly optional?: boolean } = {},
  ): Promise<unknown> {
    const result = await callWithPolicy(async (signal) => {
      let res = await this.send(url, await this.token(signal), signal);
      if (res.status === 401) {
        await res.body?.cancel();
        this.cached = null;
        res = await this.send(url, await this.token(signal), signal);
        if (res.status === 401) {
          await res.body?.cancel();
          throw new PermanentConnectorError(
            `CoreLogic refused the access token for ${endpoint} (HTTP 401)`,
          );
        }
      }
      if (res.status === 404 || (opts.optional === true && res.status === 403)) {
        await res.body?.cancel();
        return null;
      }
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel();
        throw new HttpStatusError(endpoint, res.status);
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new PermanentConnectorError(`CoreLogic ${endpoint} returned HTTP ${res.status}`);
      }
      try {
        return await res.json();
      } catch {
        throw new PermanentConnectorError(`CoreLogic ${endpoint} returned a body that is not JSON`);
      }
    }, this.runtime);
    if (!result.ok)
      throw new PropertyDataUnavailableError(
        result.error,
        result.attempts,
        this.scrub(result.message),
      );
    return result.value;
  }

  private parse<T>(endpoint: CoreLogicEndpoint, schema: z.ZodType<T>, json: unknown): T {
    const r = schema.safeParse(json);
    if (!r.success)
      throw new PropertyDataUnavailableError(
        'failed',
        1,
        `unexpected CoreLogic ${endpoint} response`,
      );
    return r.data;
  }

  // ── PropertyDataProvider ───────────────────────────────────────────────────────────────────

  async matchAddress(query: string): Promise<PropertyMatch[]> {
    if (!query.trim()) return [];
    const url = this.url('suggest');
    url.searchParams.set('q', query);
    url.searchParams.set('suggestionTypes', 'address');
    url.searchParams.set('limit', '5');
    const json = await this.get('suggest', url);
    if (json === null) return [];
    const body = this.parse('suggest', SuggestSchema, json);
    return items(SuggestItem, body.suggestions)
      .filter(
        (s) =>
          s.propertyId !== undefined &&
          s.suggestion !== undefined &&
          (s.suggestionType === undefined || /address/i.test(s.suggestionType)) &&
          s.isActiveProperty !== false,
      )
      .map((s) => ({ propertyId: String(s.propertyId), address: s.suggestion as string }));
  }

  async attributes(propertyId: string): Promise<PropertyAttributes> {
    // Optional parts never fail the lookup: without them those values are simply not suggested.
    const optional = async <T>(endpoint: CoreLogicEndpoint, schema: z.ZodType<T>) => {
      if (!this.paths[endpoint]) return undefined;
      try {
        const json = await this.get(endpoint, this.url(endpoint, propertyId), { optional: true });
        const r = schema.safeParse(json);
        return json !== null && r.success ? r.data : undefined;
      } catch (err) {
        if (err instanceof PropertyDataUnavailableError) return undefined;
        throw err;
      }
    };
    const [coreJson, additional, location, legal, site] = await Promise.all([
      this.get('attributesCore', this.url('attributesCore', propertyId)),
      optional('attributesAdditional', AdditionalSchema),
      optional('location', LocationSchema),
      optional('legal', LegalSchema),
      optional('site', SiteSchema),
    ]);
    if (coreJson === null) throw new PropertyNotFoundError(propertyId);
    const core = this.parse('attributesCore', CoreSchema, coreJson);
    return {
      propertyId,
      address: location?.singleLineAddress ?? `CoreLogic property ${propertyId}`,
      ...defined({
        propertyType: core.propertySubType ?? core.propertyType,
        landAreaM2: positive(core.landArea),
        floorAreaM2: positive(additional?.floorArea),
        bedrooms: core.beds,
        bathrooms: core.baths,
        carSpaces: core.carSpaces ?? core.lockUpGarages,
        yearBuilt:
          additional?.yearBuilt !== undefined && Number.isInteger(additional.yearBuilt)
            ? additional.yearBuilt
            : undefined,
        titleReference: legal?.titleReference ?? legal?.lotPlan,
        lga: location?.councilArea,
        zoning: site?.zoneDescriptionLocal ?? site?.zoneCodeLocal,
        latitude: location?.latitude,
        longitude: location?.longitude,
      }),
      asAt: this.today(),
    };
  }

  async salesHistory(propertyId: string): Promise<ProviderSale[]> {
    const json = await this.get('salesHistory', this.url('salesHistory', propertyId));
    if (json === null) return [];
    const body = this.parse('salesHistory', SalesSchema, json);
    const out: ProviderSale[] = [];
    items(SaleItem, body.saleList).forEach((s, i) => {
      const contractDate = dateOf(s.contractDate);
      const price = positive(s.price);
      if (!contractDate || price === undefined || s.isPriceWithheld === true) return;
      out.push({
        providerSaleId: String(s.id ?? s.saleId ?? `${propertyId}-${contractDate}-${i + 1}`),
        propertyId,
        address: '',
        contractDate,
        price,
      });
    });
    return out.sort((a, b) => b.contractDate.localeCompare(a.contractDate));
  }

  async comparableSales(search: ComparableSearch): Promise<ProviderSale[]> {
    const fromDate = addMonths(search.toDate, -search.months);
    const url = this.url('comparables');
    url.searchParams.set('lat', String(search.latitude));
    url.searchParams.set('lon', String(search.longitude));
    url.searchParams.set('radius', String(search.radiusKm));
    const pTypes = CORELOGIC_PROPERTY_TYPES[search.propertyType];
    if (pTypes) url.searchParams.set('pTypes', pTypes);
    url.searchParams.set('fromDate', fromDate);
    url.searchParams.set('toDate', search.toDate);
    url.searchParams.set('size', String(Math.min(50, search.limit * 3)));
    url.searchParams.set('sort', 'lastSaleDate,desc');
    const json = await this.get('comparables', url);
    if (json === null) return [];
    const body = this.parse('comparables', ComparablesSchema, json);
    const raw = [...(body._embedded?.propertySummaryList ?? []), ...body.properties].map((v) =>
      v !== null && typeof v === 'object' && 'propertySummary' in v ? v.propertySummary : v,
    );
    const out: ProviderSale[] = [];
    for (const p of items(SummarySchema, raw)) {
      const id = p.id ?? p.propertyId;
      const sale = p.lastSale;
      const contractDate = dateOf(sale?.contractDate);
      const price = positive(sale?.price);
      const address = p.address?.singleLineAddress;
      if (!contractDate || price === undefined || !address || sale?.isPriceWithheld === true)
        continue;
      if (id !== undefined && String(id) === search.propertyId) continue;
      if (contractDate < fromDate || contractDate > search.toDate) continue;
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      const km =
        lat !== undefined && lng !== undefined
          ? distanceKm({ lat: search.latitude, lng: search.longitude }, { lat, lng })
          : p.distance;
      if (km !== undefined && km > search.radiusKm) continue;
      out.push({
        providerSaleId: String(
          sale?.id ?? sale?.saleId ?? `${id !== undefined ? String(id) : address}-${contractDate}`,
        ),
        address,
        contractDate,
        price,
        ...defined({
          propertyId: id !== undefined ? String(id) : undefined,
          landAreaM2: positive(p.attributes?.landArea),
          floorAreaM2: positive(p.attributes?.floorArea),
          bedrooms: p.attributes?.beds,
          bathrooms: p.attributes?.baths,
          latitude: lat,
          longitude: lng,
          distanceKm: km !== undefined ? Math.round(km * 100) / 100 : undefined,
        }),
      });
    }
    return out.sort((a, b) => b.contractDate.localeCompare(a.contractDate)).slice(0, search.limit);
  }

  async automatedEstimate(propertyId: string): Promise<AutomatedEstimate | null> {
    const json = await this.get('avm', this.url('avm', propertyId), { optional: true });
    if (json === null) return null;
    const body = this.parse('avm', AvmSchema, json);
    const d = body.avmDetail ?? body;
    const estimate = positive(d.estimate);
    if (estimate === undefined) return null;
    return {
      estimate,
      low: positive(d.lowEstimate) ?? estimate,
      high: positive(d.highEstimate) ?? estimate,
      confidence: confidenceOf(d.confidence, d.fsd),
      asAt: dateOf(d.valuationDate) ?? this.today(),
      model: 'CoreLogic IntelliVal',
    };
  }
}
