import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { PgliteDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { DEMO, seedDemo } from '../src/db/seed.js';
import { RecordingEmailTransport } from '../src/services/email.js';

export { DEMO };
export type UserKey = keyof typeof DEMO.users;

export interface TestApp {
  readonly app: FastifyInstance;
  readonly db: Db;
  readonly ctx: AppContext;
  readonly email: RecordingEmailTransport;
  readonly clock: { now: () => string; set: (iso: string) => void; advance: (ms: number) => void };
  call<T = Record<string, unknown>>(
    user: UserKey | null,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    opts?: { mfa?: boolean; kind?: 'human' | 'ai' | 'system'; headers?: Record<string, string> },
  ): Promise<{ status: number; body: T; raw: Buffer; headers: Record<string, unknown> }>;
  close(): Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const db = await PgliteDb.create();
  await migrate(db);
  await seedDemo(db);
  let now = new Date('2026-10-02T01:00:00.000Z').getTime();
  const clock = {
    now: () => new Date(now).toISOString(),
    set: (iso: string) => {
      now = new Date(iso).getTime();
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
  const config: AppConfig = loadConfig({ NODE_ENV: 'test', ...env });
  const email = new RecordingEmailTransport();
  const { app, ctx } = await buildApp({ config, db, clock: { now: () => clock.now() }, email });
  return {
    app,
    db,
    ctx,
    email,
    clock,
    async call(user, method, url, body, opts = {}) {
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      if (user) headers['x-user-id'] = DEMO.users[user];
      headers['x-mfa'] = String(opts.mfa ?? true);
      if (opts.kind) headers['x-actor-kind'] = opts.kind;
      const res = await app.inject({
        method,
        url,
        headers,
        ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
      });
      const isJson = (res.headers['content-type'] ?? '').includes('json');
      return {
        status: res.statusCode,
        body: (isJson ? res.json() : {}) as never,
        raw: res.rawPayload,
        headers: res.headers,
      };
    },
    async close() {
      await app.close();
      await db.close();
    },
  };
}

/** Approves the seed rule set and publishes an approved template with firm-authored clause wording. */
export async function approveConfiguration(t: TestApp): Promise<void> {
  const rs = await t.call('legal', 'POST', '/v1/admin/rulesets/au-core/versions/2026.1/approve', {
    notes: 'Reviewed against current firm methodology',
  });
  if (rs.status !== 200) throw new Error(`rule set approval failed: ${JSON.stringify(rs.body)}`);
  const { DEFAULT_TEMPLATE } = await import('@vp/domain');
  const template = {
    ...DEFAULT_TEMPLATE,
    clauses: DEFAULT_TEMPLATE.clauses.map((c) => ({
      ...c,
      status: 'draft',
      text: `${c.title}. Firm-authored wording reviewed for {{job.purpose}} reports.`,
    })),
  };
  const created = await t.call<{ version: number }>(
    'standardsOwner',
    'POST',
    '/v1/admin/templates',
    { template },
  );
  if (created.status !== 200)
    throw new Error(`template create failed: ${JSON.stringify(created.body)}`);
  const v = created.body.version;
  for (const reviewer of ['API_STANDARDS', 'LEGAL']) {
    const rev = await t.call(
      'standardsOwner',
      'POST',
      `/v1/admin/templates/au-generic/versions/${v}/reviews`,
      { reviewer, outcome: 'approved', notes: 'Wording reviewed and accepted' },
    );
    if (rev.status !== 200) throw new Error(`review failed: ${JSON.stringify(rev.body)}`);
  }
  const ap = await t.call('legal', 'POST', `/v1/admin/templates/au-generic/versions/${v}/approve`);
  if (ap.status !== 200) throw new Error(`template approval failed: ${JSON.stringify(ap.body)}`);
}

export const ASSET_ID = '11111111-1111-4111-8111-111111111111';

export function newJobBody(over: Record<string, unknown> = {}) {
  return {
    reference: `VAL-2026-${Math.floor(Math.random() * 1e6)}`,
    clientId: DEMO.clientId,
    portfolioId: DEMO.portfolioId,
    selection: {
      jurisdiction: 'VIC',
      purpose: 'MARKET_VALUE',
      propertyType: 'RESIDENTIAL',
      scope: 'FULL',
      mode: 'SINGLE',
    },
    responsibleValuerId: DEMO.users.valuer,
    reviewerId: DEMO.users.reviewer,
    inspectorIds: [DEMO.users.inspector],
    feeCents: 88_000,
    assets: [
      {
        label: '10 Sample Road, Exampleton VIC 3000',
        address: { formatted: '10 Sample Road, Exampleton VIC 3000' },
        latitude: -37.81,
        longitude: 144.96,
      },
    ],
    ...over,
  };
}

export function marketValueFieldValues(assetId: string) {
  const job = (fieldId: string, value: unknown) => ({ fieldId, assetId: null, value });
  const asset = (fieldId: string, value: unknown) => ({ fieldId, assetId, value });
  return [
    job('instruction.clientEntity', 'Example Lending Pty Ltd'),
    job('instruction.instructingParty', 'Credit team'),
    job('instruction.intendedUsers', ['Example Lending Pty Ltd']),
    job('instruction.intendedUse', 'First mortgage security'),
    job('instruction.basisOfValue', 'market_value'),
    job('instruction.interestValued', 'fee_simple_vacant_possession'),
    job('instruction.conflictCheck', 'no_conflict'),
    job('instruction.engagementDocuments', ['doc-engagement-letter']),
    job('instruction.reliance', 'Reliance is limited to the intended users named in this report.'),
    job('instruction.confidentiality', 'Confidential to the intended users.'),
    job('instruction.feeBasis', 'Fixed fee'),
    job('instruction.dueDate', '2026-10-05'),
    job('dates.instruction', '2026-09-25'),
    job('dates.inspection', '2026-09-30'),
    job('dates.valuation', '2026-09-30'),
    job('dates.researchCutOff', '2026-10-01'),
    job('assumptions.general', ['Title is free of unregistered interests']),
    job('assumptions.limitations', ['No structural or pest survey was undertaken']),
    job('market.national', 'National housing conditions summarised from public sources.'),
    job('market.state', 'Victorian market conditions summarised from public sources.'),
    asset('instruction.ownership', 'Registered proprietor (withheld)'),
    asset('location.titleReference', 'Lot 1 PS123456'),
    asset('location.lga', 'Example City Council'),
    asset('scope.areasInspected', 'All internal and external areas'),
    asset('valuation.highestAndBestUse', 'Residential dwelling (existing use)'),
    asset('valuation.approaches', ['direct_comparison', 'summation']),
    asset('valuation.primaryApproach', 'direct_comparison'),
    asset('valuation.crossCheckApproach', 'summation'),
    asset(
      'valuation.reconciliation',
      'Direct comparison adopted; summation supports the conclusion.',
    ),
    asset('valuation.adoptedValue', 1_150_000),
    asset('valuation.marketability', 'Good'),
    asset('valuation.riskCommentary', 'Low risk'),
    asset('market.local', 'Local market commentary.'),
    asset('evidence.sales', ['see sales evidence']),
    asset('improvements.dwellingType', 'Detached house'),
    asset('improvements.accommodation', '4 bedrooms, 2 bathrooms'),
    asset('improvements.yearBuilt', 2005),
    asset('improvements.effectiveAge', 15),
    asset('improvements.construction', 'Brick veneer, tiled roof'),
    asset('improvements.condition', 'Good'),
    asset('improvements.renovations', 'Kitchen 2021'),
    asset('improvements.fixturesFinishes', 'Stone benchtops'),
    asset('improvements.outdoorImprovements', 'Paving and fencing'),
    asset('improvements.parking', 'Double garage'),
    asset('land.area', 650),
    asset('land.areaSource', 'Title plan'),
    asset('land.environmental', 'None identified'),
    asset('land.easements', 'Drainage easement (rear)'),
    asset('planning.zone', 'General Residential Zone'),
    asset('planning.overlays', ['None']),
    asset('planning.instrument', 'Example Planning Scheme'),
    asset('planning.source', ['ds-planning-vic']),
    asset('planning.reportDocument', ['doc-planning-report']),
    asset('occupancy.status', 'owner_occupied'),
  ];
}

export const saleBody = (
  assetId: string,
  n: number,
  price: number,
  landAreaM2: number,
  contractDate: string,
) => ({
  assetId,
  address: `${n} Comparable Street, Exampleton VIC`,
  contractDate,
  price,
  interest: 'fee_simple_vacant_possession',
  propertyType: 'RESIDENTIAL',
  landAreaM2,
  buildingAreaM2: 200,
  provenance: {
    origin: 'external_source',
    sourceId: 'ds-sales',
    retrievedAt: '2026-09-20T00:00:00Z',
    effectiveDate: contractDate,
    licenceBasis: 'licensed',
    verification: 'verified',
  },
  comparability: 'comparable',
  adjustments: [
    { factor: 'condition', kind: 'percent', value: 0.02, rationale: 'Inferior condition' },
  ],
  analysisBasis: 'land_rate',
});

export const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Test shortcut: marks a job submitted with the snapshot hash a real submission would record. */
export async function submitDirectly(t: TestApp, jobId: string): Promise<void> {
  const { loadAggregate, snapshotHashOf } = await import('../src/services/aggregate.js');
  const hash = snapshotHashOf(await loadAggregate(t.db, jobId));
  await t.db.query(
    "UPDATE job SET status = 'submitted', submitted_snapshot_hash = $2 WHERE id = $1",
    [jobId, hash],
  );
}
