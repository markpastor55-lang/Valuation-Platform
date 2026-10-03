/**
 * Preview state and actions. Everything professional (requirements, retrospective detection,
 * areas, validation, certification, QA, workflow guards, report composition, audit chain) is
 * computed by `@vp/domain`, the same code the API runs. This file only holds synthetic demo data
 * and wires user actions to domain functions. Nothing is sent to a server.
 *
 * One valuer inspects, values and signs. The QA reviewer is a different person who only acts once
 * the valuer sends the job to QA.
 */
import {
  AU_CORE_RULE_SET,
  DEFAULT_CONVENTIONS,
  DEFAULT_TEMPLATE,
  DEFAULT_VALIDATION_CONFIG,
  DomainError,
  SAMPLE_AVM_SOURCE,
  SAMPLE_PROPERTY_SOURCE,
  addDays,
  signingProblems,
  valuerIdentityFor,
  FIELD_BY_ID,
  INSPECTION_SCOPE_LABELS,
  JURISDICTION_TIME_ZONES,
  ROLE_PERMISSIONS,
  TRANSITIONS,
  acknowledgeFinding,
  analyseSale,
  answerChecklistItem,
  appendAuditEvent,
  checkTransition,
  composeReport,
  computeAreaSchedule,
  diffRequirements,
  fieldValueProblem,
  findMissingFields,
  formatAustralianDate,
  hashCanonical,
  inputTabForField,
  isEditable,
  resolveRequirements,
  retrospectiveStatus,
  runValidation,
  signCertification,
  startQaReview,
  summariseValidation,
  type Actor,
  type AreaSchedule,
  type AuditEvent,
  type Boundary,
  type Certification,
  type CertificationContent,
  type DataSource,
  type FieldSuggestion,
  type LocalDate,
  type FieldValues,
  type InputTabId,
  type JobAction,
  type JobSelection,
  type JobStatus,
  type Json,
  type MeasurementConvention,
  type MissingField,
  type Permission,
  type Point,
  type Provenance,
  type ValuerProfile,
  type QaReview,
  type ReportModel,
  type RequirementDiff,
  type ResolvedRequirements,
  type RetrospectiveStatus,
  type SaleAnalysis,
  type SaleComparable,
  type SketchVersion,
  type TemplateVersion,
  type TransitionCheck,
  type ValidationAcknowledgement,
  type ValidationContext,
  type ValidationResult,
  type ValidationStage,
} from '@vp/domain';

// ── People and fixed job data (synthetic) ──────────────────────────────────

export interface Person extends Actor {
  readonly displayName: string;
  readonly roleLabel: string;
  readonly credentials: readonly string[];
}

export const VALUER: Person = {
  kind: 'human',
  userId: 'u-valuer',
  orgId: 'org-demo',
  roles: ['VALUER'],
  mfaVerified: true,
  displayName: 'Val Valuer',
  roleLabel: 'Valuer',
  credentials: ['AAPI', 'CPV'],
};

export const REVIEWER: Person = {
  kind: 'human',
  userId: 'u-reviewer',
  orgId: 'org-demo',
  roles: ['QA_REVIEWER'],
  mfaVerified: true,
  displayName: 'Rae Reviewer',
  roleLabel: 'QA reviewer',
  credentials: ['FAPI', 'CPV'],
};

export const USER_NAMES: Readonly<Record<string, string>> = {
  [VALUER.userId]: VALUER.displayName,
  [REVIEWER.userId]: REVIEWER.displayName,
};

export const ASSET_ID = 'a1';
export const FIRM_NAME = 'Example Valuers Pty Ltd';

/** The parts of a job that identify it (set when the job is created). */
export interface JobMeta {
  readonly id: string;
  readonly reference: string;
  readonly clientName: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  /** Provider property id, when the address was matched. */
  readonly propertyId?: string;
}

export const DEMO_JOB: JobMeta = {
  id: 'job-0141',
  reference: 'VAL-2026-0141',
  clientName: 'Example Lending Pty Ltd',
  address: '10 Sample Road, Exampleton VIC 3000',
  lat: -37.81,
  lng: 144.96,
  propertyId: 'S-VIC-0001',
};

export const DATA_SOURCES: readonly DataSource[] = [
  {
    id: 'ds-sales',
    name: 'Licensed sales feed (example)',
    provider: 'Example Data Co',
    kind: 'sales',
    licence: {
      basis: 'licensed',
      reference: 'Licence agreement (example)',
      permitsStorage: true,
      permitsReportReproduction: true,
      permitsBulkUse: false,
    },
    freshnessDays: 365,
    status: 'active',
  },
  {
    id: 'ds-planning-vic',
    name: 'Victorian planning data (example)',
    provider: 'State government',
    kind: 'planning',
    jurisdictions: ['VIC'],
    licence: {
      basis: 'open_licence',
      permitsStorage: true,
      permitsReportReproduction: true,
      permitsBulkUse: false,
    },
    freshnessDays: 90,
    status: 'active',
  },
  SAMPLE_PROPERTY_SOURCE,
  SAMPLE_AVM_SOURCE,
];

export const verified = (sourceId: string, effectiveDate: string): Provenance => ({
  origin: 'external_source',
  sourceId,
  retrievedAt: '2026-09-20T00:00:00Z',
  effectiveDate,
  licenceBasis: sourceId === 'ds-sales' ? 'licensed' : 'open_licence',
  verification: 'verified',
  verifiedBy: VALUER.userId,
  verifiedAt: '2026-09-21T00:00:00Z',
  capturedBy: VALUER.userId,
  capturedAt: '2026-09-20T00:00:00Z',
});

const sale = (
  id: string,
  address: string,
  price: number,
  landAreaM2: number,
  buildingAreaM2: number,
  contractDate: string,
  comparability: SaleComparable['comparability'],
): SaleComparable => ({
  id,
  assetId: ASSET_ID,
  address,
  contractDate,
  price,
  interest: 'fee_simple_vacant_possession',
  propertyType: 'RESIDENTIAL',
  landAreaM2,
  buildingAreaM2,
  provenance: verified('ds-sales', contractDate),
  comparability,
  adjustments:
    comparability === 'comparable'
      ? []
      : [
          {
            factor: 'condition',
            kind: 'percent',
            value: comparability === 'superior' ? -0.03 : 0.03,
            rationale:
              comparability === 'superior'
                ? 'Superior renovation'
                : 'Inferior condition and finish',
          },
        ],
  analysisBasis: 'land_rate',
});

/** Example sales from the (fictional) licensed feed for the demo job. */
export const EXAMPLE_SALES: readonly SaleComparable[] = [
  sale('s1', '4 Wattle Court, Exampleton VIC', 1_100_000, 640, 205, '2026-06-01', 'inferior'),
  sale('s2', '27 Banksia Street, Exampleton VIC', 1_180_000, 660, 228, '2026-07-15', 'superior'),
  sale('s3', '9 Grevillea Avenue, Exampleton VIC', 1_150_000, 655, 214, '2026-08-20', 'comparable'),
];

export const EXAMPLE_SALE_LOCATIONS: Readonly<Record<string, { lat: number; lng: number }>> = {
  s1: { lat: -37.8062, lng: 144.9551 },
  s2: { lat: -37.8158, lng: 144.9667 },
  s3: { lat: -37.8121, lng: 144.9531 },
};

export const analysesOf = (sales: readonly SaleComparable[]): SaleAnalysis[] =>
  sales.map((s) =>
    analyseSale(s, { computedBy: VALUER.userId, computedAt: '2026-09-30T02:00:00Z' }),
  );

/** Demo template: the seed template with stand-in clause wording, treated as approved. */
export const DEMO_TEMPLATE: TemplateVersion = {
  ...DEFAULT_TEMPLATE,
  status: 'approved',
  clauses: DEFAULT_TEMPLATE.clauses.map((c) => ({
    ...c,
    status: 'approved',
    text: `${c.title}: stand-in wording for this preview. Each firm authors and approves its own clause text.`,
  })),
};

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

export function makeBoundary(
  id: string,
  label: string,
  componentType: Boundary['componentType'],
  points: readonly Point[],
  at: string,
  role: Boundary['role'] = 'component',
): Boundary {
  return {
    id,
    level: 'Ground',
    label,
    role,
    componentType,
    points,
    closed: true,
    dimensionSource: 'measured',
    origin: 'drawn',
    reviewStatus: 'accepted',
    measuredBy: VALUER.userId,
    measuredAt: at,
  };
}

/** The valuer's on-site sketch. Working notes only: it is not included in the report. */
function initialSketch(): SketchVersion {
  const at = '2026-09-30T01:30:00Z';
  return {
    id: 'sv-1',
    sketchId: 'sk-1',
    assetId: ASSET_ID,
    version: 1,
    units: 'metres',
    boundaries: [
      makeBoundary(
        'b-living',
        'Living',
        'living',
        [
          { x: 0, y: 0 },
          { x: 15, y: 0 },
          { x: 15, y: 8 },
          { x: 9, y: 8 },
          { x: 9, y: 12 },
          { x: 0, y: 12 },
        ],
        at,
      ),
      makeBoundary('b-garage', 'Garage', 'garage', rect(15, 0, 6, 6), at),
      makeBoundary('b-alfresco', 'Alfresco', 'alfresco', rect(9, 8, 6, 4), at),
      makeBoundary('b-verandah', 'Verandah', 'verandah', rect(0, -2, 9, 2), at),
    ],
    basis: 'BUILDING_AREA',
    conventionId: 'res-under-main-roof',
    northBearingDeg: 15,
    includeInClientReport: false,
    changeSummary: 'Measured on site',
    createdBy: VALUER.userId,
    createdAt: at,
    status: 'working',
  };
}

/**
 * A near-complete market-value job. Three things are left for the user: the dwelling's
 * condition, the building area (from the sketch) and the reconciliation.
 */
export function demoValues(
  meta: JobMeta,
  today: LocalDate,
  sales: readonly SaleComparable[],
): FieldValues {
  const inspected = addDays(today, -2);
  return {
    job: {
      'instruction.clientEntity': meta.clientName,
      'instruction.intendedUsers': [meta.clientName],
      'instruction.intendedUse': 'First mortgage security',
      'instruction.basisOfValue': 'market_value',
      'instruction.interestValued': 'fee_simple_vacant_possession',
      'instruction.conflictCheck': 'no_conflict',
      'instruction.responsibleValuer': VALUER.userId,
      'instruction.reviewer': REVIEWER.userId,
      'instruction.engagementDocuments': ['doc-engagement'],
      'instruction.dueDate': addDays(today, 3),
      'dates.instruction': addDays(today, -7),
      'dates.inspection': inspected,
      'dates.valuation': inspected,
      'assumptions.general': ['Title is free of unregistered interests'],
      'assumptions.limitations': ['No structural or pest survey was undertaken'],
    },
    assets: {
      [ASSET_ID]: {
        'instruction.ownership': 'Registered proprietor (withheld in preview)',
        'location.address': { formatted: meta.address },
        'location.titleReference': 'Lot 1 PS123456',
        'location.lga': 'Example City Council',
        'location.coordinates': { lat: meta.lat, lng: meta.lng },
        'scope.areasInspected': 'All internal and external areas',
        'valuation.highestAndBestUse': 'Residential dwelling (existing use)',
        'valuation.approaches': ['direct_comparison', 'summation'],
        'valuation.primaryApproach': 'direct_comparison',
        'valuation.crossCheckApproach': 'summation',
        'valuation.adoptedValue': 1_150_000,
        'valuation.marketability': 'Good: established street, strong owner-occupier demand',
        'valuation.riskCommentary': 'Low risk',
        'market.local': 'Steady demand for family homes near schools and transport.',
        'evidence.sales': sales.map((s) => s.id),
        'improvements.dwellingType': 'Detached house',
        'improvements.accommodation': '4 bedrooms, 2 bathrooms, open-plan living',
        'improvements.yearBuilt': 2005,
        'improvements.construction': 'Brick veneer walls, concrete tile roof',
        'improvements.renovations': 'Kitchen renovated 2021',
        'improvements.fixturesFinishes': 'Stone benchtops, timber floors to living areas',
        'improvements.outdoorImprovements': 'Paved alfresco, colorbond fencing',
        'improvements.parking': 'Double garage',
        'land.area': 650,
        'land.areaSource': 'Title plan',
        'land.environmental': 'None identified',
        'land.easements': 'Drainage easement along the rear boundary',
        'planning.zone': 'General Residential Zone (GRZ1)',
        'planning.overlays': ['None'],
        'planning.instrument': 'Example Planning Scheme',
        'planning.source': ['ds-planning-vic'],
        'planning.reportDocument': ['doc-planning'],
        'occupancy.status': 'owner_occupied',
      },
    },
  };
}

// ── State ──────────────────────────────────────────────────────────────────

export interface PreviewState {
  readonly schema: 3;
  readonly job: JobMeta;
  readonly status: JobStatus;
  readonly selection: JobSelection;
  readonly values: FieldValues;
  readonly sketch: SketchVersion;
  /** Sales evidence for the property (with provenance). */
  readonly sales: readonly SaleComparable[];
  /** Where each sale is, for the map. */
  readonly saleLocations: Readonly<Record<string, { readonly lat: number; readonly lng: number }>>;
  /** Provenance of field values that came from a data provider. */
  readonly provenance: readonly {
    readonly fieldId: string;
    readonly assetId: string | null;
    readonly provenance: Provenance;
  }[];
  readonly acknowledgements: readonly ValidationAcknowledgement[];
  readonly certification: Certification | null;
  readonly submittedSnapshotHash: string | null;
  readonly qaReview: QaReview | null;
  readonly approvedSnapshotHash: string | null;
  readonly issuedAt: string | null;
  readonly audit: readonly AuditEvent[];
  readonly lastChange: { readonly from: JobSelection; readonly diff: RequirementDiff } | null;
  readonly seq: number;
}

export const DEMO_SELECTION: JobSelection = {
  jurisdiction: 'VIC',
  purpose: 'MARKET_VALUE',
  propertyType: 'RESIDENTIAL',
  scope: 'FULL',
  mode: 'SINGLE',
};

const todayOf = (now: string): LocalDate => now.slice(0, 10);

/** The demo job: inspected two days ago, three things left to do. */
export function initialState(now: string = new Date().toISOString()): PreviewState {
  const state: PreviewState = {
    schema: 3,
    job: DEMO_JOB,
    status: 'active',
    selection: DEMO_SELECTION,
    values: demoValues(DEMO_JOB, todayOf(now), EXAMPLE_SALES),
    sketch: initialSketch(),
    sales: EXAMPLE_SALES,
    saleLocations: EXAMPLE_SALE_LOCATIONS,
    provenance: [],
    acknowledgements: [],
    certification: null,
    submittedSnapshotHash: null,
    qaReview: null,
    approvedSnapshotHash: null,
    issuedAt: null,
    audit: [],
    lastChange: null,
    seq: 0,
  };
  return audit(state, VALUER, now, 'job.engagement_accepted', 'job', DEMO_JOB.id, {
    reference: DEMO_JOB.reference,
  });
}

/** A new instruction (WIP stage "New instructions") for a matched or typed address. */
export function newJobState(
  meta: JobMeta,
  selection: JobSelection,
  now: string,
  opts: { readonly dueDate?: LocalDate; readonly inspectionDate?: LocalDate } = {},
): PreviewState {
  const state: PreviewState = {
    schema: 3,
    job: meta,
    status: 'draft',
    selection,
    values: {
      job: {
        'instruction.clientEntity': meta.clientName,
        'instruction.intendedUsers': [meta.clientName],
        'instruction.basisOfValue': 'market_value',
        'instruction.interestValued': 'fee_simple_vacant_possession',
        'instruction.conflictCheck': 'no_conflict',
        'instruction.responsibleValuer': VALUER.userId,
        'instruction.reviewer': REVIEWER.userId,
        'instruction.engagementDocuments': ['doc-engagement'],
        'dates.instruction': todayOf(now),
        ...(opts.dueDate ? { 'instruction.dueDate': opts.dueDate } : {}),
        ...(opts.inspectionDate
          ? { 'dates.inspection': opts.inspectionDate, 'dates.valuation': opts.inspectionDate }
          : {}),
        'assumptions.limitations': ['No structural or pest survey was undertaken'],
      },
      assets: {
        [ASSET_ID]: {
          'location.address': { formatted: meta.address },
          'location.coordinates': { lat: meta.lat, lng: meta.lng },
        },
      },
    },
    sketch: { ...initialSketch(), boundaries: [] },
    sales: [],
    saleLocations: {},
    provenance: [],
    acknowledgements: [],
    certification: null,
    submittedSnapshotHash: null,
    qaReview: null,
    approvedSnapshotHash: null,
    issuedAt: null,
    audit: [],
    lastChange: null,
    seq: 0,
  };
  return audit(state, VALUER, now, 'job.created', 'job', meta.id, { reference: meta.reference });
}

// ── Derived data (pure; recomputed on every change) ───────────────────────

export interface Derived {
  readonly requirements: ResolvedRequirements;
  readonly retrospective: RetrospectiveStatus;
  readonly missing: readonly MissingField[];
  /** Missing required fields per input tab. */
  readonly missingByTab: Readonly<Partial<Record<InputTabId, number>>>;
  readonly requiredCount: number;
  readonly requiredCaptured: number;
  readonly convention: MeasurementConvention;
  readonly schedule: AreaSchedule;
  readonly snapshotHash: string;
  readonly certificationCurrent: boolean;
  readonly validation: Readonly<Record<ValidationStage, ValidationResult>>;
  readonly report: ReportModel;
}

export function conventionFor(id: string): MeasurementConvention {
  const c = DEFAULT_CONVENTIONS.find((x) => x.id === id) ?? DEFAULT_CONVENTIONS[0];
  if (!c) throw new Error('no measurement conventions configured');
  return c;
}

/** Content the certification, QA review and issue bind to (process records excluded). */
export function snapshotHashOf(state: PreviewState): string {
  return hashCanonical({
    selection: state.selection,
    values: state.values,
    sales: state.sales.map((x) => ({ id: x.id, verification: x.provenance.verification })),
  });
}

export function validationContext(
  state: PreviewState,
  stage: ValidationStage,
  requirements: ResolvedRequirements,
  schedule: AreaSchedule,
  now: string,
): ValidationContext {
  return {
    stage,
    now,
    timeZone: JURISDICTION_TIME_ZONES[state.selection.jurisdiction],
    selection: state.selection,
    requirements,
    values: state.values,
    assetIds: [ASSET_ID],
    provenance: [
      ...(state.job.id === DEMO_JOB.id
        ? [
            {
              fieldId: 'planning.zone',
              assetId: ASSET_ID,
              provenance: verified('ds-planning-vic', '2026-09-20'),
            },
          ]
        : []),
      ...state.provenance,
    ],
    dataSources: DATA_SOURCES,
    sales: state.sales,
    saleAnalyses: analysesOf(state.sales),
    rentals: [],
    calculations: [],
    commentary: [],
    // The sketch is working notes: the engine checks it only if the report relies on it.
    areaSchedules: [schedule],
    measurementApprovals: [],
    photos: [],
    aiSuggestions: [],
    riskFlags: [],
    ...(state.certification ? { certification: state.certification } : {}),
    ...(state.qaReview ? { qaReview: state.qaReview } : {}),
    ruleSetStatus: 'approved',
    templateStatus: 'approved',
    acknowledgements: state.acknowledgements,
    config: DEFAULT_VALIDATION_CONFIG,
  };
}

export function derive(state: PreviewState, now: string = new Date().toISOString()): Derived {
  const requirements = resolveRequirements(state.selection, AU_CORE_RULE_SET, state.values, [
    ASSET_ID,
  ]);
  const missing = findMissingFields(requirements, state.values, [ASSET_ID]);
  const missingByTab: Partial<Record<InputTabId, number>> = {};
  for (const m of missing) {
    if (m.level !== 'required') continue;
    const tab = inputTabForField(m.fieldId);
    if (tab) missingByTab[tab] = (missingByTab[tab] ?? 0) + 1;
  }
  const requiredCount = requirements.fields.filter((f) => f.level === 'required').length;
  const convention = conventionFor(state.sketch.conventionId);
  const schedule = computeAreaSchedule(state.sketch, convention);
  const snapshotHash = snapshotHashOf(state);
  const validation = {
    draft: runValidation(validationContext(state, 'draft', requirements, schedule, now)),
    submit: runValidation(validationContext(state, 'submit', requirements, schedule, now)),
    issue: runValidation(validationContext(state, 'issue', requirements, schedule, now)),
  };
  const report = composeReport(
    {
      report: {
        id: 'report-demo',
        version: 1,
        status: state.issuedAt ? 'final' : 'draft',
        ...(state.issuedAt ? { issueDate: state.issuedAt.slice(0, 10) } : {}),
      },
      firmName: FIRM_NAME,
      job: {
        id: state.job.id,
        reference: state.job.reference,
        selection: state.selection,
        clientName: state.job.clientName,
      },
      valuerName: VALUER.displayName,
      requirements,
      values: state.values,
      assets: [{ id: ASSET_ID, label: state.job.address }],
      sales: state.sales,
      saleAnalyses: analysesOf(state.sales),
      rentals: [],
      calculations: [],
      areaSchedules: [schedule],
      sketches: [
        {
          assetId: ASSET_ID,
          sketchId: state.sketch.sketchId,
          sketchVersionId: state.sketch.id,
          version: state.sketch.version,
          includeInClientReport: false,
        },
      ],
      photos: [],
      ...(state.certification ? { certification: state.certification } : {}),
      userNames: USER_NAMES,
      snapshotHash,
    },
    DEMO_TEMPLATE,
  );
  return {
    requirements,
    retrospective: retrospectiveStatus(state.values),
    missing,
    missingByTab,
    requiredCount,
    requiredCaptured: requiredCount - missing.filter((m) => m.level === 'required').length,
    convention,
    schedule,
    snapshotHash,
    certificationCurrent: state.certification?.snapshotHash === snapshotHash,
    validation,
    report,
  };
}

// ── Permissions and locks ──────────────────────────────────────────────────

const can = (person: Person, permission: Permission): boolean =>
  person.roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));

export const isLocked = (state: PreviewState): boolean => !isEditable(state.status);

export const STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  draft: 'draft',
  active: 'in progress',
  submitted: 'with QA',
  in_review: 'in QA review',
  returned: 'returned by QA',
  approved: 'QA approved',
  issued: 'issued',
  cancelled: 'cancelled',
};
export const statusLabel = (s: JobStatus): string => STATUS_LABELS[s];

/** The QA tab exists only once the valuer has sent the job to QA. */
export const qaVisible = (state: PreviewState): boolean =>
  state.status !== 'active' && state.status !== 'draft' && state.status !== 'cancelled';

// ── Workflow ───────────────────────────────────────────────────────────────

const STAGE_FOR: Partial<Record<JobAction, ValidationStage>> = {
  submitForQa: 'submit',
  approve: 'submit',
  issue: 'issue',
};

const QA_ACTIONS: ReadonlySet<JobAction> = new Set(['startReview', 'approve', 'returnToValuer']);

/** Who takes a workflow action: QA steps belong to the reviewer, everything else to the valuer. */
export const actorFor = (action: JobAction): Person => (QA_ACTIONS.has(action) ? REVIEWER : VALUER);

export function transitionCheck(
  state: PreviewState,
  d: Derived,
  action: JobAction,
  reason?: string,
  certification: Certification | null = state.certification,
): TransitionCheck {
  const stage = STAGE_FOR[action];
  return checkTransition(action, {
    job: {
      id: state.job.id,
      status: state.status,
      responsibleValuerId: VALUER.userId,
      conflictCheck: 'no_conflict',
      engagementDocumentCount: 1,
    },
    actor: actorFor(action),
    currentSnapshotHash: d.snapshotHash,
    ...(stage ? { validation: summariseValidation(d.validation[stage]) } : {}),
    ...(certification ? { certification } : {}),
    ...(state.qaReview ? { qaReview: state.qaReview } : {}),
    ...(state.approvedSnapshotHash ? { approvedSnapshotHash: state.approvedSnapshotHash } : {}),
    ...(reason ? { reason } : {}),
  });
}

// ── Actions ────────────────────────────────────────────────────────────────

export type PreviewAction =
  | { type: 'setSelection'; selection: JobSelection }
  | { type: 'dismissChange' }
  | { type: 'setField'; fieldId: string; assetId: string | null; value: unknown }
  | { type: 'setBoundaries'; boundaries: readonly Boundary[] }
  | { type: 'setConvention'; conventionId: string }
  | { type: 'useSketchArea' }
  | { type: 'acknowledge'; code: string; path: string; reason: string }
  /** Signs the certification (with the valuer's profile) and sends the job to QA in one step. */
  | { type: 'sendToQa'; profile: ValuerProfile }
  | { type: 'acceptJob' }
  /** Uses provider values the valuer has checked (recorded with their provenance). */
  | { type: 'applySuggestions'; suggestions: readonly FieldSuggestion[] }
  | { type: 'addSale'; sale: SaleComparable; location?: { lat: number; lng: number } }
  | { type: 'removeSale'; saleId: string }
  | { type: 'verifySale'; saleId: string }
  | { type: 'transition'; action: JobAction; reason?: string }
  | { type: 'answerChecklist'; itemId: string; response: 'yes' | 'no' | 'na'; note?: string }
  | { type: 'reset' };

function audit(
  state: PreviewState,
  actor: Actor,
  at: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, Json> = {},
  reason?: string,
): PreviewState {
  const previous = state.audit[state.audit.length - 1] ?? null;
  const event = appendAuditEvent(previous, {
    id: `ev-${state.seq + 1}`,
    orgId: actor.orgId,
    streamId: `job:${state.job.id}`,
    at,
    actor: { userId: actor.userId, kind: actor.kind, roles: actor.roles },
    action,
    entityType,
    entityId,
    metadata,
    ...(reason ? { reason } : {}),
  });
  return { ...state, audit: [...state.audit, event], seq: state.seq + 1 };
}

const deny = (message: string): never => {
  throw new DomainError('FORBIDDEN', message);
};

function requireEditable(state: PreviewState): void {
  if (isLocked(state))
    deny(
      state.status === 'issued'
        ? 'The report is issued; changes need an amendment'
        : `The job is ${statusLabel(state.status)}, so it is locked until QA returns it`,
    );
}

function certificationContent(state: PreviewState, profile: ValuerProfile): CertificationContent {
  const job = state.values.job;
  const asset = state.values.assets[ASSET_ID] ?? {};
  const purpose = state.selection.purpose;
  const kind =
    purpose === 'RENTAL_ASSESSMENT'
      ? 'market_rent'
      : purpose === 'INSURANCE_REPLACEMENT'
        ? 'sum_insured'
        : 'value';
  const amountField =
    kind === 'market_rent'
      ? 'rent.adoptedMarketRent'
      : kind === 'sum_insured'
        ? 'ins.sumInsured'
        : 'valuation.adoptedValue';
  const amount = asset[amountField];
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  const inspected = text(job['dates.inspection']);
  const limitations = list(job['assumptions.limitations']);
  return {
    jobId: state.job.id,
    valuer: valuerIdentityFor(profile, state.selection.jurisdiction),
    role: 'responsible_valuer',
    inspectionScope: state.selection.scope,
    inspectionScopeStatement: `${INSPECTION_SCOPE_LABELS[state.selection.scope]}${
      inspected ? ` on ${formatAustralianDate(inspected)}` : ''
    }.`,
    valuationDate: text(job['dates.valuation']),
    basisOfValue: text(job['instruction.basisOfValue']).replaceAll('_', ' '),
    amount: { value: typeof amount === 'number' ? amount : 0, currency: 'AUD', kind },
    independenceStatement: 'I have no pecuniary interest in the property or the parties.',
    conflictsStatement: 'No conflict of interest was identified.',
    assumptions: list(job['assumptions.general']),
    specialAssumptions: list(job['assumptions.special']),
    limitations: limitations.length
      ? limitations
      : ['The standard limitations in this report apply'],
    standardsReliedOn: ['Firm valuation methodology v1 (mapped by the standards owner)'],
    clauseVersionIds: DEMO_TEMPLATE.clauses
      .filter((c) => c.clauseId === 'certification-core')
      .map((c) => `${c.clauseId}@${c.version}`),
  };
}

export const ATTESTATION =
  'I certify that this valuation is my independent professional opinion, formed on the stated basis and assumptions.';

function withField(
  state: PreviewState,
  fieldId: string,
  assetId: string | null,
  value: unknown,
): FieldValues {
  return assetId === null
    ? { ...state.values, job: { ...state.values.job, [fieldId]: value } }
    : {
        ...state.values,
        assets: {
          ...state.values.assets,
          [assetId]: { ...state.values.assets[assetId], [fieldId]: value },
        },
      };
}

export function apply(
  state: PreviewState,
  action: PreviewAction,
  now: string = new Date().toISOString(),
): PreviewState {
  switch (action.type) {
    case 'reset':
      return initialState(now);
    case 'dismissChange':
      return { ...state, lastChange: null };
    case 'setSelection': {
      requireEditable(state);
      const before = resolveRequirements(state.selection, AU_CORE_RULE_SET, state.values, [
        ASSET_ID,
      ]);
      const after = resolveRequirements(action.selection, AU_CORE_RULE_SET, state.values, [
        ASSET_ID,
      ]);
      const next = {
        ...state,
        selection: action.selection,
        lastChange: { from: state.selection, diff: diffRequirements(before, after, state.values) },
      };
      return audit(next, VALUER, now, 'job.selection_changed', 'job', state.job.id, {
        from: state.selection as unknown as Json,
        to: action.selection as unknown as Json,
      });
    }
    case 'setField': {
      requireEditable(state);
      const def = FIELD_BY_ID.get(action.fieldId);
      if (!def) return deny(`Unknown field ${action.fieldId}`);
      if (def.entry === 'system') deny(`${def.label} is filled in by the system`);
      const value = action.value === '' || action.value === undefined ? null : action.value;
      const problem = fieldValueProblem(def, value);
      if (problem) throw new DomainError('INVALID_ARGUMENT', `${def.label}: ${problem}`);
      // Changing the dates can make the valuation retrospective; the requirements follow.
      const before = resolveRequirements(state.selection, AU_CORE_RULE_SET, state.values, [
        ASSET_ID,
      ]);
      const values = withField(state, def.id, action.assetId, value);
      const after = resolveRequirements(state.selection, AU_CORE_RULE_SET, values, [ASSET_ID]);
      const lastChange =
        before.retrospective !== after.retrospective
          ? { from: state.selection, diff: diffRequirements(before, after, values) }
          : state.lastChange;
      // A value typed by the valuer replaces any provider value and its provenance.
      const provenance = state.provenance.filter(
        (p) => !(p.fieldId === def.id && p.assetId === action.assetId),
      );
      return audit(
        { ...state, values, lastChange, provenance },
        VALUER,
        now,
        'field.updated',
        'field',
        def.id,
        {
          assetId: action.assetId,
          personal: def.personal === true,
        },
      );
    }
    case 'setBoundaries':
    case 'setConvention': {
      requireEditable(state);
      const changes =
        action.type === 'setBoundaries'
          ? { boundaries: action.boundaries }
          : {
              conventionId: action.conventionId,
              basis: conventionFor(action.conventionId).basis,
            };
      return { ...state, sketch: { ...state.sketch, ...changes } };
    }
    case 'useSketchArea': {
      requireEditable(state);
      const schedule = computeAreaSchedule(state.sketch, conventionFor(state.sketch.conventionId));
      return apply(
        state,
        {
          type: 'setField',
          fieldId: 'improvements.buildingArea',
          assetId: ASSET_ID,
          value: schedule.totalIncludedM2,
        },
        now,
      );
    }
    case 'acknowledge': {
      requireEditable(state);
      const d = derive(state, now);
      const finding = [...d.validation.submit.findings, ...d.validation.issue.findings].find(
        (f) => f.code === action.code && f.path === action.path,
      );
      if (!finding) return deny('That item no longer applies');
      const ack = acknowledgeFinding(finding, VALUER.userId, now, action.reason);
      return audit(
        { ...state, acknowledgements: [...state.acknowledgements, ack] },
        VALUER,
        now,
        'validation.acknowledged',
        'finding',
        `${action.code}:${action.path}`,
        {},
        ack.reason,
      );
    }
    case 'sendToQa': {
      requireEditable(state);
      if (action.profile.userId !== VALUER.userId) deny('Only the responsible valuer can sign');
      const problems = signingProblems(
        action.profile,
        state.selection.jurisdiction,
        now.slice(0, 10),
      );
      if (problems.length)
        throw new DomainError('GUARD_FAILED', 'Your profile is not ready to sign this job', {
          issues: problems,
        });
      const d = derive(state, now);
      const certification = signCertification(certificationContent(state, action.profile), {
        id: `cert-${state.seq + 1}`,
        actor: VALUER,
        responsibleValuerId: VALUER.userId,
        snapshotHash: d.snapshotHash,
        at: now,
        attestationText: ATTESTATION,
      });
      // The certification's own consistency checks run before submission.
      const signed = { ...state, certification };
      const signedD = derive(signed, now);
      const check = transitionCheck(signed, signedD, 'submitForQa');
      if (!check.allowed)
        throw new DomainError('GUARD_FAILED', check.failures.join('; '), {
          failures: [...check.failures],
        });
      let next = audit(
        signed,
        VALUER,
        now,
        'certification.signed',
        'certification',
        certification.id,
        {
          snapshotHash: d.snapshotHash,
        },
      );
      next = { ...next, status: check.to, submittedSnapshotHash: d.snapshotHash, qaReview: null };
      return audit(next, VALUER, now, TRANSITIONS.submitForQa.auditAction, 'job', state.job.id, {
        from: state.status,
        to: check.to,
        snapshotHash: d.snapshotHash,
      });
    }
    case 'acceptJob': {
      const d = derive(state, now);
      const check = transitionCheck(state, d, 'acceptEngagement');
      if (!check.allowed)
        throw new DomainError('GUARD_FAILED', check.failures.join('; '), {
          failures: [...check.failures],
        });
      return audit(
        { ...state, status: check.to },
        VALUER,
        now,
        TRANSITIONS.acceptEngagement.auditAction,
        'job',
        state.job.id,
        { from: state.status, to: check.to },
      );
    }
    case 'applySuggestions': {
      requireEditable(state);
      let next = state;
      for (const s of action.suggestions) {
        next = apply(
          next,
          { type: 'setField', fieldId: s.fieldId, assetId: s.assetId, value: s.value },
          now,
        );
        // The valuer checked the value before using it.
        next = {
          ...next,
          provenance: [
            ...next.provenance,
            {
              fieldId: s.fieldId,
              assetId: s.assetId,
              provenance: {
                ...s.provenance,
                verification: 'verified',
                verifiedBy: VALUER.userId,
                verifiedAt: now,
              },
            },
          ],
        };
      }
      return next;
    }
    case 'addSale': {
      requireEditable(state);
      if (state.sales.some((x) => x.id === action.sale.id)) return state;
      const sales = [...state.sales, action.sale];
      const next = {
        ...state,
        sales,
        saleLocations: action.location
          ? { ...state.saleLocations, [action.sale.id]: action.location }
          : state.saleLocations,
        values: withField(
          state,
          'evidence.sales',
          ASSET_ID,
          sales.map((x) => x.id),
        ),
      };
      return audit(next, VALUER, now, 'evidence.sale_added', 'sale', action.sale.id, {
        source: action.sale.provenance.sourceId ?? null,
      });
    }
    case 'removeSale': {
      requireEditable(state);
      const sales = state.sales.filter((x) => x.id !== action.saleId);
      return {
        ...state,
        sales,
        values: withField(
          state,
          'evidence.sales',
          ASSET_ID,
          sales.length ? sales.map((x) => x.id) : null,
        ),
      };
    }
    case 'verifySale': {
      requireEditable(state);
      return {
        ...state,
        sales: state.sales.map((x) =>
          x.id === action.saleId
            ? {
                ...x,
                provenance: {
                  ...x.provenance,
                  verification: 'verified',
                  verifiedBy: VALUER.userId,
                  verifiedAt: now,
                },
              }
            : x,
        ),
      };
    }
    case 'answerChecklist': {
      if (!state.qaReview) return deny('The QA review has not started');
      if (!can(REVIEWER, 'qa.review')) deny('Only the QA reviewer answers the checklist');
      return {
        ...state,
        qaReview: answerChecklistItem(state.qaReview, action.itemId, action.response, action.note),
      };
    }
    case 'transition': {
      const def = TRANSITIONS[action.action];
      const actor = actorFor(action.action);
      if (!can(actor, def.permission)) deny(`${actor.roleLabel}s cannot do that`);
      const d = derive(state, now);
      const check = transitionCheck(state, d, action.action, action.reason);
      if (!check.allowed)
        throw new DomainError('GUARD_FAILED', check.failures.join('; '), {
          failures: [...check.failures],
        });
      let next: PreviewState = { ...state, status: check.to };
      if (action.action === 'startReview') {
        if (state.submittedSnapshotHash !== d.snapshotHash)
          deny('Content changed since it was sent to QA');
        next = {
          ...next,
          qaReview: startQaReview({
            id: `qa-${state.seq + 1}`,
            jobId: state.job.id,
            reviewerId: REVIEWER.userId,
            snapshotHash: d.snapshotHash,
            at: now,
          }),
        };
      }
      if (action.action === 'approve' && state.qaReview)
        next = {
          ...next,
          qaReview: { ...state.qaReview, outcome: 'approved', completedAt: now },
          approvedSnapshotHash: d.snapshotHash,
        };
      if (action.action === 'returnToValuer' && state.qaReview)
        next = {
          ...next,
          qaReview: { ...state.qaReview, outcome: 'returned', completedAt: now },
        };
      if (action.action === 'issue') next = { ...next, issuedAt: now };
      return audit(
        next,
        actor,
        now,
        def.auditAction,
        'job',
        state.job.id,
        { from: state.status, to: check.to, snapshotHash: d.snapshotHash },
        action.reason,
      );
    }
  }
}

// ── Helpers for the UI ─────────────────────────────────────────────────────

export function fieldValue(state: PreviewState, fieldId: string, assetId: string | null): unknown {
  return assetId === null ? state.values.job[fieldId] : state.values.assets[assetId]?.[fieldId];
}

export const describeError = (e: unknown): string =>
  e instanceof DomainError
    ? Array.isArray((e.details as { issues?: unknown } | undefined)?.issues)
      ? `${e.message}: ${(e.details as { issues: string[] }).issues.join('; ')}`
      : e.message
    : e instanceof Error
      ? e.message
      : String(e);
