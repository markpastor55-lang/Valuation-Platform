/**
 * The preview's whole state: every job on the work-in-progress list plus the valuer's profile.
 * Demo jobs are created by replaying the same actions a valuer would take, so each sits in a
 * real workflow stage (new, to inspect, in progress, with QA, ready to issue, issued).
 */
import {
  DEFAULT_QA_CHECKLIST,
  FIELD_BY_ID,
  createSamplePropertyDataProvider,
  addDays,
  findMissingFields,
  profileProblems,
  resolveRequirements,
  AU_CORE_RULE_SET,
  DomainError,
  type FieldDef,
  type JobSelection,
  type LocalDate,
  type ValuerProfile,
  type WipJob,
} from '@vp/domain';
import {
  ASSET_ID,
  DEMO_JOB,
  EXAMPLE_SALES,
  REVIEWER,
  VALUER,
  apply,
  demoValues,
  derive,
  initialState,
  newJobState,
  verified,
  type JobMeta,
  type PreviewAction,
  type PreviewState,
} from './model.js';

export interface AppState {
  readonly schema: 3;
  readonly jobs: Readonly<Record<string, PreviewState>>;
  readonly profile: ValuerProfile;
  readonly nextNumber: number;
}

/** A blank 1×1 transparent PNG is not a signature; the demo starts with a typed one. */
export const DEMO_PROFILE: ValuerProfile = {
  userId: VALUER.userId,
  fullName: VALUER.displayName,
  credentials: ['AAPI', 'CPV'],
  apiMemberNumber: '00000-DEMO',
  registrations: [{ jurisdiction: 'QLD', number: 'QLD-DEMO-0001' }],
  signature: { kind: 'typed', value: VALUER.displayName, updatedAt: '2026-09-01T00:00:00Z' },
};

const todayOf = (now: string): LocalDate => now.slice(0, 10);

function demoValue(def: FieldDef): unknown {
  switch (def.type) {
    case 'text':
    case 'longtext':
      return `${def.label}: recorded for the demo`;
    case 'date':
      return '2026-09-01';
    case 'number':
    case 'integer':
    case 'money':
    case 'area':
    case 'length':
      return 1;
    case 'ratio':
      return 0.5;
    case 'boolean':
      return true;
    case 'enum':
      return def.options?.[0] ?? null;
    case 'multi_enum':
      return def.options?.slice(0, 1) ?? [];
    case 'list':
      return [`${def.label}: recorded for the demo`];
    case 'document_refs':
    case 'datasource_refs':
    case 'evidence_list':
      return ['demo-ref'];
    case 'address':
      return { formatted: 'Recorded for the demo' };
    default:
      return null;
  }
}

/** Fills every missing required field with a plausible demo value (seeding only). */
function fillMissing(state: PreviewState, now: string): PreviewState {
  let s = state;
  for (let round = 0; round < 3; round++) {
    const req = resolveRequirements(s.selection, AU_CORE_RULE_SET, s.values, [ASSET_ID]);
    const missing = findMissingFields(req, s.values, [ASSET_ID]).filter(
      (m) => m.level === 'required',
    );
    if (!missing.length) break;
    for (const m of missing) {
      const def = FIELD_BY_ID.get(m.fieldId);
      if (!def || def.entry === 'system') continue;
      s = apply(
        s,
        { type: 'setField', fieldId: def.id, assetId: m.assetId, value: demoValue(def) },
        now,
      );
    }
  }
  return s;
}

/** Sales near the property, from the fictional licensed feed, already checked by the valuer. */
async function demoSales(
  meta: JobMeta,
  today: LocalDate,
): Promise<{
  sales: PreviewState['sales'];
  locations: PreviewState['saleLocations'];
}> {
  const provider = createSamplePropertyDataProvider(today);
  const found = await provider.comparableSales({
    propertyId: meta.propertyId ?? meta.id,
    latitude: meta.lat,
    longitude: meta.lng,
    radiusKm: 2,
    months: 9,
    toDate: addDays(today, -14),
    propertyType: 'RESIDENTIAL',
    limit: 10,
  });
  const sales = found.slice(0, 3).map((s, i) => ({
    id: `${meta.id}-s${i + 1}`,
    assetId: ASSET_ID,
    address: s.address,
    contractDate: s.contractDate,
    price: s.price,
    interest: 'fee_simple_vacant_possession',
    propertyType: 'RESIDENTIAL' as const,
    ...(s.landAreaM2 !== undefined ? { landAreaM2: s.landAreaM2 } : {}),
    ...(s.floorAreaM2 !== undefined ? { buildingAreaM2: s.floorAreaM2 } : {}),
    provenance: verified('ds-sales', s.contractDate),
    comparability: 'comparable' as const,
    adjustments: [],
    analysisBasis: 'land_rate' as const,
  }));
  const locations = Object.fromEntries(
    found
      .slice(0, 3)
      .map((s, i) => [
        `${meta.id}-s${i + 1}`,
        { lat: s.latitude ?? meta.lat, lng: s.longitude ?? meta.lng },
      ]),
  );
  return { sales, locations };
}

const run = (s: PreviewState, now: string, ...actions: PreviewAction[]): PreviewState =>
  actions.reduce((acc, a) => apply(acc, a, now), s);

async function inspectedJob(
  meta: JobMeta,
  selection: JobSelection,
  now: string,
  profile: ValuerProfile,
  stage: 'with_qa' | 'to_issue' | 'issued',
): Promise<PreviewState> {
  const today = todayOf(now);
  const { sales, locations } = await demoSales(meta, today);
  const base = initialState(now);
  let s: PreviewState = {
    ...base,
    job: meta,
    selection,
    values: (() => {
      const v = demoValues(meta, today, sales);
      const prices = sales.map((x) => x.price).sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)] ?? 1_000_000;
      return {
        ...v,
        assets: { [ASSET_ID]: { ...v.assets[ASSET_ID], 'valuation.adoptedValue': median } },
      };
    })(),
    sales,
    saleLocations: locations,
    audit: [],
    seq: 0,
  };
  s = run(
    s,
    now,
    { type: 'setField', fieldId: 'improvements.condition', assetId: ASSET_ID, value: 'Good' },
    { type: 'useSketchArea' },
    {
      type: 'setField',
      fieldId: 'valuation.reconciliation',
      assetId: ASSET_ID,
      value: 'Direct comparison adopted, supported by summation.',
    },
  );
  s = fillMissing(s, now);
  for (const f of derive(s, now).validation.submit.findings)
    if (f.severity === 'warning' && !f.acknowledgement)
      s = apply(
        s,
        {
          type: 'acknowledge',
          code: f.code,
          path: f.path,
          reason: 'Considered; not material for this demo job',
        },
        now,
      );
  s = run(s, now, { type: 'sendToQa', profile });
  if (stage === 'with_qa') return s;
  s = run(
    s,
    now,
    { type: 'transition', action: 'startReview' },
    ...DEFAULT_QA_CHECKLIST.map((c): PreviewAction => ({
      type: 'answerChecklist',
      itemId: c.id,
      response: 'yes',
    })),
    { type: 'transition', action: 'approve' },
  );
  if (stage === 'to_issue') return s;
  return run(s, now, { type: 'transition', action: 'issue' });
}

const VIC_MV: JobSelection = {
  jurisdiction: 'VIC',
  purpose: 'MARKET_VALUE',
  propertyType: 'RESIDENTIAL',
  scope: 'FULL',
  mode: 'SINGLE',
};

/** Six demo jobs, one in each main WIP stage. */
export async function seedApp(now: string = new Date().toISOString()): Promise<AppState> {
  const today = todayOf(now);
  const profile = DEMO_PROFILE;
  const jobs: PreviewState[] = [];

  jobs.push(initialState(now));

  jobs.push(
    newJobState(
      {
        id: 'job-0144',
        reference: 'VAL-2026-0144',
        clientName: 'Western Mortgage Co (example)',
        address: '41 Trial Way, Testford WA 6000',
        lat: -31.95,
        lng: 115.86,
        propertyId: 'S-WA-0001',
      },
      { ...VIC_MV, jurisdiction: 'WA' },
      now,
      { dueDate: addDays(today, 8), inspectionDate: addDays(today, 5) },
    ),
  );

  const unit = run(
    newJobState(
      {
        id: 'job-0143',
        reference: 'VAL-2026-0143',
        clientName: 'Example Lending Pty Ltd',
        address: 'Unit 5, 18 Harbour View Lane, Exampleton VIC 3000',
        lat: -37.8152,
        lng: 144.9581,
        propertyId: 'S-VIC-0004',
      },
      { ...VIC_MV, propertyType: 'RESIDENTIAL_UNIT' },
      now,
      { dueDate: addDays(today, 5), inspectionDate: addDays(today, 2) },
    ),
    now,
    { type: 'acceptJob' },
    { type: 'setField', fieldId: 'strata.titleType', assetId: ASSET_ID, value: 'strata_title' },
    {
      type: 'setField',
      fieldId: 'strata.ownersCorporation',
      assetId: ASSET_ID,
      value: 'Owners Corporation PS 812345 (example)',
    },
  );
  jobs.push({ ...unit, lastChange: null });

  const cgt = run(
    newJobState(
      {
        id: 'job-0142',
        reference: 'VAL-2026-0142',
        clientName: 'J & K Taxation Services (example)',
        address: '3 Example Street, Sampleville NSW 2000',
        lat: -33.87,
        lng: 151.21,
        propertyId: 'S-NSW-0001',
      },
      { ...VIC_MV, jurisdiction: 'NSW', purpose: 'CGT' },
      now,
      { dueDate: addDays(today, 6), inspectionDate: addDays(today, 3) },
    ),
    now,
    { type: 'acceptJob' },
    { type: 'setField', fieldId: 'dates.valuation', assetId: null, value: '2019-06-30' },
    {
      type: 'setField',
      fieldId: 'cgt.taxEvent',
      assetId: null,
      value: 'Property became income-producing (as advised by the client)',
    },
  );
  jobs.push({ ...cgt, lastChange: null });

  jobs.push(
    await inspectedJob(
      {
        id: 'job-0139',
        reference: 'VAL-2026-0139',
        clientName: 'Example Lending Pty Ltd',
        address: '22 Demo Avenue, Exampleton VIC 3000',
        lat: -37.8131,
        lng: 144.9652,
        propertyId: 'S-VIC-0002',
      },
      VIC_MV,
      now,
      profile,
      'with_qa',
    ),
  );
  jobs.push(
    await inspectedJob(
      {
        id: 'job-0136',
        reference: 'VAL-2026-0136',
        clientName: 'Smith & Co Family Lawyers (example)',
        address: '15 Test Crescent, Demo Heights QLD 4000',
        lat: -27.47,
        lng: 153.02,
        propertyId: 'S-QLD-0001',
      },
      { ...VIC_MV, jurisdiction: 'QLD', purpose: 'FAMILY_LAW' },
      now,
      profile,
      'to_issue',
    ),
  );
  jobs.push(
    await inspectedJob(
      {
        id: 'job-0130',
        reference: 'VAL-2026-0130',
        clientName: 'Example Lending Pty Ltd',
        address: '7 Placeholder Parade, Mockbury VIC 3011',
        lat: -37.799,
        lng: 144.901,
        propertyId: 'S-VIC-0003',
      },
      VIC_MV,
      now,
      profile,
      'issued',
    ),
  );
  return {
    schema: 3,
    jobs: Object.fromEntries(jobs.map((j) => [j.job.id, j])),
    profile,
    nextNumber: 145,
  };
}

export function applyToJob(
  app: AppState,
  jobId: string,
  action: PreviewAction,
  now: string,
): AppState {
  const job = app.jobs[jobId];
  if (!job) throw new DomainError('NOT_FOUND', 'That job no longer exists');
  const withProfile: PreviewAction =
    action.type === 'sendToQa' ? { ...action, profile: app.profile } : action;
  return { ...app, jobs: { ...app.jobs, [jobId]: apply(job, withProfile, now) } };
}

export function createJob(
  app: AppState,
  input: {
    readonly address: string;
    readonly lat: number;
    readonly lng: number;
    readonly propertyId?: string;
    readonly clientName: string;
    readonly selection: JobSelection;
    readonly dueDate?: LocalDate;
    readonly inspectionDate?: LocalDate;
  },
  now: string,
): { app: AppState; jobId: string } {
  if (!input.clientName.trim()) throw new DomainError('INVALID_ARGUMENT', 'Enter the client');
  const number = app.nextNumber;
  const meta: JobMeta = {
    id: `job-${String(number).padStart(4, '0')}`,
    reference: `VAL-2026-${String(number).padStart(4, '0')}`,
    clientName: input.clientName.trim(),
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    ...(input.propertyId ? { propertyId: input.propertyId } : {}),
  };
  const state = newJobState(meta, input.selection, now, {
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(input.inspectionDate ? { inspectionDate: input.inspectionDate } : {}),
  });
  return {
    app: { ...app, jobs: { ...app.jobs, [meta.id]: state }, nextNumber: number + 1 },
    jobId: meta.id,
  };
}

export function updateProfile(app: AppState, profile: ValuerProfile): AppState {
  const problems = profileProblems(profile);
  if (problems.length)
    throw new DomainError('INVALID_ARGUMENT', 'The profile has problems', { issues: problems });
  return { ...app, profile };
}

/** The WIP view of every job. */
export function wipJobs(app: AppState): WipJob[] {
  return Object.values(app.jobs).map((s) => {
    const job = s.values.job;
    const due = job['instruction.dueDate'];
    const inspection = job['dates.inspection'];
    return {
      id: s.job.id,
      reference: s.job.reference,
      status: s.status,
      selection: s.selection,
      clientName: s.job.clientName,
      addresses: [s.job.address],
      valuerName: VALUER.displayName,
      ...(typeof due === 'string' ? { dueDate: due } : {}),
      ...(typeof inspection === 'string' ? { inspectionDate: inspection } : {}),
    };
  });
}

export { REVIEWER, VALUER, DEMO_JOB, EXAMPLE_SALES };
