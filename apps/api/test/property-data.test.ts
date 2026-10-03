import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock, type Clock } from '@vp/domain';
import { loadConfig } from '../src/config.js';
import { CoreLogicProvider, type CoreLogicOptions } from '../src/integrations/corelogic.js';
import {
  PropertyDataUnavailableError,
  corelogicService,
} from '../src/integrations/property-data.js';
import { DEMO, createTestApp, newJobBody, type TestApp } from './helpers.js';

const SECRET = 'super-secret-value-123';
const CLIENT_ID = 'client-abc';
const BASE = 'https://corelogic.test';
const TOKEN_URL = `${BASE}/access/oauth/token`;

interface Recorded {
  readonly url: URL;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

type Handler = (req: Recorded) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch stub that records requests (token and API) and answers from `handler`. */
function stubFetch(handler: Handler) {
  const calls: Recorded[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const rec: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body instanceof URLSearchParams ? init.body.toString() : '',
    };
    calls.push(rec);
    return handler(rec);
  }) as typeof fetch;
  return {
    fn,
    calls,
    tokenCalls: () => calls.filter((c) => c.url.pathname === '/access/oauth/token'),
    apiCalls: () => calls.filter((c) => c.url.pathname !== '/access/oauth/token'),
  };
}

/** Connector clock with a controllable "now" (real sleeps, so timeouts still work). */
function fakeClock(start = Date.parse('2026-10-02T01:00:00Z')) {
  let now = start;
  const clock: Clock = { now: () => now, sleep: (ms, signal) => systemClock.sleep(ms, signal) };
  return { clock, advance: (ms: number) => (now += ms) };
}

let tokenCounter = 0;
const tokenResponse = (expiresIn = 3600) =>
  json({ access_token: `tok-${++tokenCounter}`, token_type: 'bearer', expires_in: expiresIn });

function provider(fetchFn: typeof fetch, over: Partial<CoreLogicOptions> = {}) {
  return new CoreLogicProvider({
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    baseUrl: BASE,
    tokenUrl: TOKEN_URL,
    fetch: fetchFn,
    policy: { backoffMs: 1, timeoutMs: 2_000 },
    ...over,
  });
}

const SUGGEST = {
  suggestions: [
    {
      suggestion: '10 Sample Road, Exampleton VIC 3000',
      propertyId: 4242,
      suggestionType: 'address',
      isActiveProperty: true,
      somethingNew: { nested: true },
    },
    { suggestion: 'Exampleton VIC 3000', suggestionType: 'locality' },
  ],
};

describe('CoreLogic provider (stubbed fetch)', () => {
  it('requests a client-credentials token and sends it as a bearer token', async () => {
    const f = stubFetch((r) =>
      r.url.pathname.endsWith('/token') ? tokenResponse() : json(SUGGEST),
    );
    const matches = await provider(f.fn).matchAddress('10 Sample Road Exampleton');
    expect(matches).toEqual([
      { propertyId: '4242', address: '10 Sample Road, Exampleton VIC 3000' },
    ]);
    const [token] = f.tokenCalls();
    expect(token?.method).toBe('POST');
    expect(token?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(token?.body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe(CLIENT_ID);
    expect(form.get('client_secret')).toBe(SECRET);
    expect(token?.url.search).toBe(''); // the secret is not put in the URL by default
    const [api] = f.apiCalls();
    expect(api?.url.pathname).toBe('/property/au/v2/suggest.json');
    expect(api?.url.searchParams.get('q')).toBe('10 Sample Road Exampleton');
    expect(api?.headers.authorization).toMatch(/^Bearer tok-\d+$/);
  });

  it('caches the token until shortly before it expires', async () => {
    const f = stubFetch((r) =>
      r.url.pathname.endsWith('/token') ? tokenResponse(600) : json(SUGGEST),
    );
    const { clock, advance } = fakeClock();
    const p = provider(f.fn, { clock });
    await p.matchAddress('10 Sample Road');
    await p.matchAddress('10 Sample Road');
    expect(f.tokenCalls()).toHaveLength(1);
    advance(530_000); // still fresh: a 600 s token is refreshed 60 s before it expires
    await p.matchAddress('10 Sample Road');
    expect(f.tokenCalls()).toHaveLength(1);
    advance(15_000); // now inside the refresh margin
    await p.matchAddress('10 Sample Road');
    expect(f.tokenCalls()).toHaveLength(2);
    expect(f.apiCalls()).toHaveLength(4);
  });

  it('refreshes the token once and retries when the API answers 401', async () => {
    let apiCalls = 0;
    const f = stubFetch((r) => {
      if (r.url.pathname.endsWith('/token')) return tokenResponse();
      apiCalls++;
      return apiCalls === 1 ? json({ error: 'expired' }, 401) : json(SUGGEST);
    });
    const matches = await provider(f.fn).matchAddress('10 Sample Road');
    expect(matches).toHaveLength(1);
    expect(f.tokenCalls()).toHaveLength(2);
    const auth = f.apiCalls().map((c) => c.headers.authorization);
    expect(auth[0]).not.toBe(auth[1]);
  });

  it('retries a 500 and then succeeds', async () => {
    let apiCalls = 0;
    const f = stubFetch((r) => {
      if (r.url.pathname.endsWith('/token')) return tokenResponse();
      apiCalls++;
      return apiCalls === 1 ? json({ message: 'oops' }, 500) : json(SUGGEST);
    });
    const p = provider(f.fn);
    expect(await p.matchAddress('10 Sample Road')).toHaveLength(1);
    expect(f.apiCalls()).toHaveLength(2);
    expect(f.tokenCalls()).toHaveLength(1);
  });

  it('does not retry rejected credentials and never puts secrets in the error', async () => {
    const f = stubFetch((r) =>
      r.url.pathname.endsWith('/token')
        ? json({ error: 'invalid_client', echo: SECRET }, 401)
        : json(SUGGEST),
    );
    const err = await provider(f.fn)
      .matchAddress('10 Sample Road')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PropertyDataUnavailableError);
    const e = err as PropertyDataUnavailableError;
    expect(e.failure).toBe('failed');
    expect(e.attempts).toBe(1);
    expect(e.message).toContain('HTTP 401');
    expect(e.message).not.toContain(SECRET);
    expect(e.message).not.toContain(CLIENT_ID);
    expect(f.apiCalls()).toHaveLength(0);
  });

  it('maps attributes, sales, comparables and the automated estimate defensively', async () => {
    const f = stubFetch((r) => {
      const path = r.url.pathname;
      if (path.endsWith('/token')) return tokenResponse();
      if (path.endsWith('/attributes/core'))
        return json({
          beds: 4,
          baths: 'two', // wrongly typed: dropped, not fatal
          carSpaces: 2,
          landArea: 650,
          propertyType: 'HOUSE',
          isCalculatedLandArea: false,
        });
      if (path.endsWith('/attributes/additional')) return json({ floorArea: 210, yearBuilt: 1998 });
      if (path.endsWith('/location'))
        return json({
          singleLineAddress: '10 Sample Road, Exampleton VIC 3000',
          latitude: -37.81,
          longitude: 144.96,
          councilArea: 'Example City Council',
        });
      if (path.endsWith('/legal')) return json({}, 403); // not licensed: optional, ignored
      if (path.endsWith('/site')) return json({ zoneDescriptionLocal: 'General Residential Zone' });
      if (path.endsWith('/sales'))
        return json({
          saleList: [
            { id: 77, contractDate: '2019-05-01T00:00:00', price: 820000 },
            { id: 78, contractDate: '2015-02-01', price: 0, isPriceWithheld: true },
            'garbage',
          ],
        });
      if (path.endsWith('/lastSale'))
        return json({
          _embedded: {
            propertySummaryList: [
              {
                propertySummary: {
                  id: 501,
                  address: { singleLineAddress: '12 Wattle Court, Exampleton VIC 3000' },
                  attributes: { beds: 3, landArea: 600 },
                  location: { latitude: -37.812, longitude: 144.962 },
                  lastSale: { contractDate: '2026-06-01', price: 1_050_000 },
                },
              },
              {
                propertySummary: {
                  id: 4242, // the subject itself is excluded
                  address: { singleLineAddress: '10 Sample Road' },
                  location: { latitude: -37.81, longitude: 144.96 },
                  lastSale: { contractDate: '2026-05-01', price: 999_000 },
                },
              },
              {
                propertySummary: {
                  id: 502, // too far away
                  address: { singleLineAddress: '1 Far Away Road' },
                  location: { latitude: -37.5, longitude: 144.5 },
                  lastSale: { contractDate: '2026-04-01', price: 700_000 },
                },
              },
            ],
          },
        });
      if (path.endsWith('/current'))
        return json({
          estimate: 1_100_000,
          lowEstimate: 1_000_000,
          highEstimate: 1_200_000,
          fsd: 0.09,
          valuationDate: '2026-09-28',
        });
      return json({}, 404);
    });
    const p = provider(f.fn);
    const a = await p.attributes('4242');
    expect(a).toMatchObject({
      propertyId: '4242',
      address: '10 Sample Road, Exampleton VIC 3000',
      propertyType: 'HOUSE',
      landAreaM2: 650,
      floorAreaM2: 210,
      bedrooms: 4,
      carSpaces: 2,
      yearBuilt: 1998,
      lga: 'Example City Council',
      zoning: 'General Residential Zone',
      latitude: -37.81,
    });
    expect(a).not.toHaveProperty('bathrooms');
    expect(a).not.toHaveProperty('titleReference');
    expect(a).not.toHaveProperty('isCalculatedLandArea');

    const history = await p.salesHistory('4242');
    expect(history).toEqual([
      {
        providerSaleId: '77',
        propertyId: '4242',
        address: '',
        contractDate: '2019-05-01',
        price: 820000,
      },
    ]);

    const comps = await p.comparableSales({
      propertyId: '4242',
      latitude: -37.81,
      longitude: 144.96,
      radiusKm: 2,
      months: 12,
      toDate: '2026-10-02',
      propertyType: 'RESIDENTIAL',
      limit: 10,
    });
    expect(comps.map((c) => c.address)).toEqual(['12 Wattle Court, Exampleton VIC 3000']);
    expect(comps[0]?.distanceKm).toBeLessThan(1);
    const search = f.apiCalls().find((c) => c.url.pathname.endsWith('/lastSale'));
    expect(search?.url.searchParams.get('pTypes')).toBe('HOUSE');
    expect(search?.url.searchParams.get('fromDate')).toBe('2025-10-02');

    expect(await p.automatedEstimate('4242')).toEqual({
      estimate: 1_100_000,
      low: 1_000_000,
      high: 1_200_000,
      confidence: 'high',
      asAt: '2026-09-28',
      model: 'CoreLogic IntelliVal',
    });
  });

  it('reports an unexpected response shape as unavailable', async () => {
    const f = stubFetch((r) =>
      r.url.pathname.endsWith('/token') ? tokenResponse() : json({ suggestions: 'nope' }),
    );
    // A wrongly typed list is treated as empty rather than failing.
    expect(await provider(f.fn).matchAddress('10 Sample Road')).toEqual([]);
    const g = stubFetch((r) =>
      r.url.pathname.endsWith('/token') ? tokenResponse() : json(['not', 'an', 'object']),
    );
    await expect(provider(g.fn).matchAddress('10 Sample Road')).rejects.toBeInstanceOf(
      PropertyDataUnavailableError,
    );
  });
});

describe('property data configuration', () => {
  it('defaults to CoreLogic only when both keys are supplied', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).propertyData.mode).toBe('sample');
    expect(loadConfig({ NODE_ENV: 'development' }).propertyData.mode).toBe('sample');
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://db/app',
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_AUDIENCE: 'api',
      OIDC_JWKS_URL: 'https://idp.example.com/jwks',
    };
    expect(loadConfig(prod).propertyData.mode).toBe('off');
    const live = loadConfig({
      ...prod,
      CORELOGIC_CLIENT_ID: CLIENT_ID,
      CORELOGIC_CLIENT_SECRET: SECRET,
    }).propertyData;
    expect(live.mode).toBe('corelogic');
    expect(live.corelogic.tokenUrl).toBe('https://api.corelogic.asia/access/oauth/token');
    expect(
      loadConfig({ NODE_ENV: 'test', PROPERTY_DATA_MODE: 'corelogic' }).propertyData.mode,
    ).toBe('off');
    expect(() => loadConfig({ ...prod, PROPERTY_DATA_MODE: 'sample' })).toThrow(/sample/);
    expect(() =>
      loadConfig({ NODE_ENV: 'test', CORELOGIC_PATHS: '{"unknownEndpoint":"/x"}' }),
    ).toThrow(/CORELOGIC_PATHS/);
    expect(
      loadConfig({ NODE_ENV: 'test', CORELOGIC_PATHS: '{"avm":"/avm/au/x"}' }).propertyData
        .corelogic.paths,
    ).toEqual({ avm: '/avm/au/x' });
  });
});

async function createJob(t: TestApp, over: Record<string, unknown> = {}) {
  const job = await t.call<{ id: string; assets: { id: string }[] }>(
    'allocator',
    'POST',
    '/v1/jobs',
    newJobBody(over),
  );
  expect(job.status).toBe(200);
  return { jobId: job.body.id, assetId: job.body.assets[0]!.id };
}

describe('property data turned off', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ PROPERTY_DATA_MODE: 'off' });
  });
  afterAll(async () => t.close());

  it('answers 503 with the reason and still searches jobs', async () => {
    const { jobId, assetId } = await createJob(t);
    const res = await t.call<{ error: { code: string; message: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/assets/${assetId}/property-data`,
      {},
    );
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PROPERTY_DATA_NOT_CONFIGURED');
    expect(res.body.error.message).toContain('CoreLogic API keys not supplied');
    const comps = await t.call<{ error: { code: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/assets/${assetId}/comparables/search`,
      {},
    );
    expect(comps.status).toBe(503);
    const status = await t.call<{ propertyData: { state: string; reason: string } }>(
      'valuer',
      'GET',
      '/v1/integrations/status',
    );
    expect(status.body.propertyData).toEqual({
      state: 'not_configured',
      provider: 'CoreLogic (Cotality)',
      reason: 'CoreLogic API keys not supplied',
    });
    const search = await t.call<{ matches: unknown[]; jobs: { id: string }[] }>(
      'valuer',
      'GET',
      '/v1/property-search?q=sample%20road',
    );
    expect(search.status).toBe(200);
    expect(search.body.matches).toEqual([]);
    expect(search.body.jobs.map((j) => j.id)).toContain(jobId);
  });
});

describe('CoreLogic through the API (stubbed fetch)', () => {
  it('maps a timeout to 502 with the manual-entry fallback and no secrets', async () => {
    const f = stubFetch(
      (r) =>
        r.url.pathname.endsWith('/token')
          ? tokenResponse()
          : new Promise<Response>(() => undefined), // never answers
    );
    const p = provider(f.fn, { policy: { timeoutMs: 50, maxRetries: 0, backoffMs: 1 } });
    const t = await createTestApp({}, { propertyData: corelogicService(p) });
    try {
      const { jobId, assetId } = await createJob(t);
      const res = await t.call<{
        error: { code: string; message: string; details: Record<string, unknown> };
      }>('valuer', 'POST', `/v1/jobs/${jobId}/assets/${assetId}/property-data`, {
        propertyId: '4242',
      });
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('PROPERTY_DATA_UNAVAILABLE');
      expect(res.body.error.details).toMatchObject({
        failure: 'timeout',
        fallback: 'manual_entry',
      });
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
      // Searching still returns the user's jobs, with the problem reported alongside.
      const search = await t.call<{
        jobs: { id: string }[];
        propertyDataProblem: { code: string };
        status: { state: string };
      }>('valuer', 'GET', '/v1/property-search?q=sample%20road');
      expect(search.status).toBe(200);
      expect(search.body.status.state).toBe('connected');
      expect(search.body.jobs.map((j) => j.id)).toContain(jobId);
      expect(search.body.propertyDataProblem.code).toBe('PROPERTY_DATA_UNAVAILABLE');
    } finally {
      await t.close();
    }
  });

  it('requires the CoreLogic data source to be registered for the organisation', async () => {
    const f = stubFetch((r) =>
      r.url.pathname.endsWith('/token') ? tokenResponse() : json(SUGGEST),
    );
    const t = await createTestApp({}, { propertyData: corelogicService(provider(f.fn)) });
    try {
      const { jobId, assetId } = await createJob(t);
      await t.db.query("UPDATE data_source SET status = 'suspended' WHERE id = 'ds-corelogic'");
      const res = await t.call<{ error: { code: string } }>(
        'valuer',
        'POST',
        `/v1/jobs/${jobId}/assets/${assetId}/property-data`,
        {},
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DATA_SOURCE_NOT_REGISTERED');
      expect(f.calls).toHaveLength(0);
    } finally {
      await t.close();
    }
  });
});

describe('sample property data end to end', () => {
  let t: TestApp;
  let jobId: string;
  let assetId: string;
  beforeAll(async () => {
    t = await createTestApp();
    ({ jobId, assetId } = await createJob(t));
  });
  afterAll(async () => t.close());

  it('reports sample status and the state map services', async () => {
    const res = await t.call<{
      propertyData: { state: string; reason: string };
      maps: Record<string, { viewer: { name: string } }>;
    }>('valuer', 'GET', '/v1/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.propertyData.state).toBe('sample');
    expect(res.body.propertyData.reason).toContain('CoreLogic API keys not supplied');
    expect(res.body.maps['VIC']?.viewer.name).toBe('VicPlan');
    expect(Object.keys(res.body.maps)).toHaveLength(8);
    const client = await t.call('client', 'GET', '/v1/integrations/status');
    expect(client.status).toBe(403);
  });

  interface Suggestion {
    fieldId: string;
    assetId: string;
    value: unknown;
    provenance: {
      origin: string;
      sourceId: string;
      sourceRef: string;
      retrievedAt: string;
      effectiveDate: string;
      licenceBasis: string;
      verification: string;
      capturedBy: string;
    };
  }

  it('suggests fields with provenance and saves nothing until the valuer accepts', async () => {
    const res = await t.call<{
      propertyId: string;
      source: { id: string; reportable: boolean };
      suggestions: Suggestion[];
      salesHistory: { address: string }[];
      avm: { estimate: number; notice: string; source: string } | null;
    }>('valuer', 'POST', `/v1/jobs/${jobId}/assets/${assetId}/property-data`, {});
    expect(res.status).toBe(200);
    expect(res.body.propertyId).toBe('S-VIC-0001');
    expect(res.body.source).toMatchObject({ id: 'ds-sample-property-data', reportable: false });
    const land = res.body.suggestions.find((s) => s.fieldId === 'land.area');
    expect(land?.provenance).toMatchObject({
      origin: 'external_source',
      sourceId: 'ds-sample-property-data',
      verification: 'unverified',
      capturedBy: DEMO.users.valuer,
      retrievedAt: t.clock.now(),
    });
    expect(res.body.salesHistory.length).toBeGreaterThan(0);
    expect(res.body.salesHistory.every((s) => s.address.length > 0)).toBe(true);
    expect(res.body.avm?.source).toBe('ds-sample-avm');
    expect(res.body.avm?.notice).toMatch(/cross-check only/);

    const stored = await t.db.query(
      "SELECT 1 FROM field_value WHERE job_id = $1 AND field_id = 'land.area'",
      [jobId],
    );
    expect(stored.rows).toHaveLength(0);
    const events = await t.db.query<{ event: { metadata: Record<string, unknown> } }>(
      "SELECT event FROM audit_event WHERE stream_id = $1 AND action = 'property_data.retrieved'",
      [`job:${jobId}`],
    );
    expect(events.rows).toHaveLength(1);
    const meta = events.rows[0]!.event.metadata;
    expect(meta).toMatchObject({ kind: 'property', provider: 'sample', propertyId: 'S-VIC-0001' });
    expect(JSON.stringify(meta)).not.toContain(String(land?.value));

    // The valuer accepts the land area: PUT /fields with the returned provenance, now verified.
    const { capturedBy: _c, ...provenance } = land!.provenance;
    const put = await t.call<{ changed: number }>('valuer', 'PUT', `/v1/jobs/${jobId}/fields`, {
      values: [
        {
          fieldId: land!.fieldId,
          assetId,
          value: land!.value,
          provenance: { ...provenance, verification: 'verified' },
        },
      ],
    });
    expect(put.status).toBe(200);
    expect(put.body.changed).toBe(1);
    const saved = await t.db.query<{ provenance: Record<string, unknown> }>(
      "SELECT provenance FROM field_value WHERE job_id = $1 AND field_id = 'land.area'",
      [jobId],
    );
    expect(saved.rows[0]?.provenance).toMatchObject({
      sourceId: 'ds-sample-property-data',
      verification: 'verified',
      verifiedBy: DEMO.users.valuer,
    });
  });

  it('withholds the automated estimate from people without valuation rights', async () => {
    const res = await t.call<{ avm: unknown; suggestions: unknown[] }>(
      'inspector',
      'POST',
      `/v1/jobs/${jobId}/assets/${assetId}/property-data`,
      { propertyId: 'S-VIC-0001' },
    );
    expect(res.status).toBe(200);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    expect(res.body.avm).toBeNull();
    const client = await t.call(
      'client',
      'POST',
      `/v1/jobs/${jobId}/assets/${assetId}/property-data`,
      {},
    );
    expect([403, 404]).toContain(client.status);
  });

  it('rejects unknown properties, unmatched addresses and assets of other jobs', async () => {
    const unknown = await t.call<{ error: { code: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/assets/${assetId}/property-data`,
      { propertyId: 'S-NOPE-0001' },
    );
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('NO_PROPERTY_MATCH');
    const other = await createJob(t, {
      assets: [
        {
          label: '99 Nowhere Lane, Unknownville VIC 3999',
          address: { formatted: '99 Nowhere Lane, Unknownville VIC 3999' },
        },
      ],
    });
    const noMatch = await t.call<{ error: { code: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${other.jobId}/assets/${other.assetId}/property-data`,
      {},
    );
    expect(noMatch.status).toBe(422);
    expect(noMatch.body.error.code).toBe('NO_PROPERTY_MATCH');
    const crossJob = await t.call<{ error: { code: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/assets/${other.assetId}/property-data`,
      {},
    );
    expect(crossJob.status).toBe(422);
    expect(crossJob.body.error.code).toBe('UNKNOWN_ASSET');
  });

  it('finds comparable sales, adds one as evidence, and VAL-PROV-003 then blocks issue', async () => {
    const search = await t.call<{
      source: { id: string };
      search: { radiusKm: number; months: number; toDate: string };
      candidates: {
        sale: { providerSaleId: string; distanceKm: number; contractDate: string };
        evidence: Record<string, unknown> & {
          provenance: Record<string, unknown>;
        };
      }[];
    }>('valuer', 'POST', `/v1/jobs/${jobId}/assets/${assetId}/comparables/search`, {
      radiusKm: 2,
      months: 12,
      limit: 5,
    });
    expect(search.status).toBe(200);
    expect(search.body.source.id).toBe('ds-sample-property-data');
    expect(search.body.search).toMatchObject({ radiusKm: 2, months: 12, toDate: '2026-10-02' });
    expect(search.body.candidates.length).toBeGreaterThan(0);
    expect(search.body.candidates.length).toBeLessThanOrEqual(5);
    for (const c of search.body.candidates) {
      expect(c.sale.distanceKm).toBeLessThanOrEqual(2);
      expect(c.evidence.provenance).toMatchObject({
        sourceId: 'ds-sample-property-data',
        verification: 'unverified',
      });
    }
    const before = await t.db.query('SELECT 1 FROM sale_comparable WHERE job_id = $1', [jobId]);
    expect(before.rows).toHaveLength(0);

    const { id: _id, provenance, ...evidence } = search.body.candidates[0]!.evidence;
    const { capturedBy: _c, capturedAt: _a, ...prov } = provenance;
    const added = await t.call<{ sale: { id: string } }>(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/sales`,
      {
        ...evidence,
        provenance: { ...prov, verification: 'verified' },
      },
    );
    expect(added.status).toBe(200);

    const validation = await t.call<{
      findings: { code: string; severity: string; path: string }[];
    }>('valuer', 'POST', `/v1/jobs/${jobId}/validate`, { stage: 'issue' });
    expect(validation.status).toBe(200);
    const prov003 = validation.body.findings.filter((f) => f.code === 'VAL-PROV-003');
    expect(prov003.map((f) => f.path)).toContain(`asset:${assetId}/sale:${added.body.sale.id}`);
    expect(prov003.every((f) => f.severity === 'blocking')).toBe(true);

    const inspector = await t.call(
      'inspector',
      'POST',
      `/v1/jobs/${jobId}/assets/${assetId}/comparables/search`,
      {},
    );
    expect(inspector.status).toBe(403);
    const tooWide = await t.call(
      'valuer',
      'POST',
      `/v1/jobs/${jobId}/assets/${assetId}/comparables/search`,
      {
        radiusKm: 25,
      },
    );
    expect(tooWide.status).toBe(400);
  });

  it('shows the job on its state map service', async () => {
    const res = await t.call<{
      service: { jurisdiction: string; viewer: { name: string } };
      subject: { assetId: string; latitude: number }[];
      sales: unknown[];
      notes: string[];
    }>('valuer', 'GET', `/v1/jobs/${jobId}/map`);
    expect(res.status).toBe(200);
    expect(res.body.service.jurisdiction).toBe('VIC');
    expect(res.body.subject).toEqual([expect.objectContaining({ assetId, latitude: -37.81 })]);
    expect(res.body.sales).toEqual([]);
    expect(res.body.notes.join(' ')).toMatch(/coordinates/);
    const outsider = await t.call('valuer2', 'GET', `/v1/jobs/${jobId}/map`);
    expect([403, 404]).toContain(outsider.status);
  });

  it('property search returns provider matches and existing jobs', async () => {
    const res = await t.call<{
      status: { state: string };
      matches: { propertyId: string; address: string }[];
      jobs: { id: string; stage: string; addresses: string[] }[];
    }>('valuer', 'GET', '/v1/property-search?q=10%20sample%20road');
    expect(res.status).toBe(200);
    expect(res.body.status.state).toBe('sample');
    expect(res.body.matches.map((m) => m.propertyId)).toEqual(['S-VIC-0001']);
    expect(res.body.jobs.map((j) => j.id)).toContain(jobId);
    expect(res.body.jobs.find((j) => j.id === jobId)?.addresses).toEqual([
      '10 Sample Road, Exampleton VIC 3000',
    ]);
    const nothing = await t.call<{ matches: unknown[]; jobs: unknown[] }>(
      'valuer',
      'GET',
      '/v1/property-search?q=zzzz%20qqqq',
    );
    expect(nothing.body).toMatchObject({ matches: [], jobs: [] });
    const short = await t.call('valuer', 'GET', '/v1/property-search?q=a');
    expect(short.status).toBe(400);
    const client = await t.call('client', 'GET', '/v1/property-search?q=sample');
    expect(client.status).toBe(403);
  });
});
