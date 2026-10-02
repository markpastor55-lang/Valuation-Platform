/**
 * Preview state and actions. Everything professional (requirements, areas, validation,
 * certification, QA, workflow guards, report composition, audit chain) is computed by
 * `@vp/domain` — the same code the API runs. This file only holds synthetic demo data and wires
 * user actions to domain functions. Nothing is sent to a server.
 */
import {
  AU_CORE_RULE_SET,
  DEFAULT_CONVENTIONS,
  DEFAULT_TEMPLATE,
  DEFAULT_VALIDATION_CONFIG,
  DomainError,
  FIELD_BY_ID,
  INSPECTION_SCOPE_LABELS,
  JURISDICTION_TIME_ZONES,
  ROLE_PERMISSIONS,
  TRANSITIONS,
  analyseSale,
  answerChecklistItem,
  appendAuditEvent,
  approveMeasurement,
  checkTransition,
  composeReport,
  computeAreaSchedule,
  diffRequirements,
  findMissingFields,
  fieldValueProblem,
  formatAustralianDate,
  hashCanonical,
  isEditable,
  isValuerJudgementField,
  nextSketchVersion,
  resolveRequirements,
  runValidation,
  signCertification,
  startQaReview,
  summariseValidation,
  acknowledgeFinding,
  type Actor,
  type AreaSchedule,
  type AuditEvent,
  type Boundary,
  type Certification,
  type CertificationContent,
  type DataSource,
  type FieldDef,
  type FieldValues,
  type JobAction,
  type JobSelection,
  type JobStatus,
  type MeasurementApproval,
  type MeasurementConvention,
  type MissingField,
  type Permission,
  type Point,
  type Provenance,
  type QaReview,
  type ReportModel,
  type RequirementDiff,
  type ResolvedRequirements,
  type SaleAnalysis,
  type SaleComparable,
  type SketchVersion,
  type TemplateVersion,
  type TransitionCheck,
  type ValidationAcknowledgement,
  type ValidationContext,
  type ValidationResult,
  type ValidationStage,
  type Json,
} from '@vp/domain';

// ── People and fixed job data (synthetic) ──────────────────────────────────

export type PreviewRole = 'valuer' | 'inspector' | 'reviewer';

export interface Person extends Actor {
  readonly displayName: string;
  readonly roleLabel: string;
  readonly credentials: readonly string[];
}

export const PEOPLE: Readonly<Record<PreviewRole, Person>> = {
  valuer: {
    kind: 'human',
    userId: 'u-valuer',
    orgId: 'org-demo',
    roles: ['VALUER'],
    mfaVerified: true,
    displayName: 'Val Valuer',
    roleLabel: 'Responsible valuer',
    credentials: ['AAPI', 'CPV'],
  },
  inspector: {
    kind: 'human',
    userId: 'u-inspector',
    orgId: 'org-demo',
    roles: ['FIELD_INSPECTOR'],
    mfaVerified: true,
    displayName: 'Indy Inspector',
    roleLabel: 'Field inspector',
    credentials: [],
  },
  reviewer: {
    kind: 'human',
    userId: 'u-reviewer',
    orgId: 'org-demo',
    roles: ['QA_REVIEWER'],
    mfaVerified: true,
    displayName: 'Rae Reviewer',
    roleLabel: 'QA reviewer',
    credentials: ['FAPI', 'CPV'],
  },
};

export const USER_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(PEOPLE).map((p) => [p.userId, p.displayName]),
);

export const ASSET_ID = 'a1';
export const JOB = {
  id: 'job-demo',
  reference: 'VAL-2026-DEMO',
  clientName: 'Example Lending Pty Ltd',
  firmName: 'Example Valuers Pty Ltd',
  address: '10 Sample Road, Exampleton VIC 3000',
} as const;
const STREAM = `job:${JOB.id}`;

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
];

const verified = (sourceId: string, effectiveDate: string): Provenance => ({
  origin: 'external_source',
  sourceId,
  retrievedAt: '2026-09-20T00:00:00Z',
  effectiveDate,
  licenceBasis: sourceId === 'ds-sales' ? 'licensed' : 'open_licence',
  verification: 'verified',
  verifiedBy: PEOPLE.valuer.userId,
  verifiedAt: '2026-09-21T00:00:00Z',
  capturedBy: PEOPLE.valuer.userId,
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

export const SALES: readonly SaleComparable[] = [
  sale('s1', '4 Wattle Court, Exampleton VIC', 1_100_000, 640, 205, '2026-06-01', 'inferior'),
  sale('s2', '27 Banksia Street, Exampleton VIC', 1_180_000, 660, 228, '2026-07-15', 'superior'),
  sale('s3', '9 Grevillea Avenue, Exampleton VIC', 1_150_000, 655, 214, '2026-08-20', 'comparable'),
];

export const SALE_ANALYSES: readonly SaleAnalysis[] = SALES.map((s) =>
  analyseSale(s, { computedBy: PEOPLE.valuer.userId, computedAt: '2026-09-30T02:00:00Z' }),
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
  by: string,
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
    measuredBy: by,
    measuredAt: at,
  };
}

function initialSketch(): SketchVersion {
  const by = PEOPLE.inspector.userId;
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
        by,
        at,
      ),
      makeBoundary('b-garage', 'Garage', 'garage', rect(15, 0, 6, 6), by, at),
      makeBoundary('b-alfresco', 'Alfresco', 'alfresco', rect(9, 8, 6, 4), by, at),
      makeBoundary('b-verandah', 'Verandah', 'verandah', rect(0, -2, 9, 2), by, at),
    ],
    basis: 'BUILDING_AREA',
    conventionId: 'res-under-main-roof',
    northBearingDeg: 15,
    suppliedAreas: [
      { label: 'Building permit plans', areaM2: 228, source: 'Client-supplied plans (2005)' },
    ],
    includeInClientReport: true,
    changeSummary: 'Measured on site',
    createdBy: by,
    createdAt: at,
    status: 'working',
  };
}

/** A near-complete market-value job. Two fields and the area approval are left for the user. */
function initialValues(): FieldValues {
  return {
    job: {
      'instruction.clientEntity': JOB.clientName,
      'instruction.instructingParty': 'J. Citizen (credit officer)',
      'instruction.intendedUsers': ['Example Lending Pty Ltd'],
      'instruction.intendedUse': 'First mortgage security',
      'instruction.basisOfValue': 'market_value',
      'instruction.interestValued': 'fee_simple_vacant_possession',
      'instruction.conflictCheck': 'no_conflict',
      'instruction.responsibleValuer': PEOPLE.valuer.userId,
      'instruction.reviewer': PEOPLE.reviewer.userId,
      'instruction.engagementDocuments': ['doc-engagement'],
      'instruction.reliance': 'Reliance is limited to the intended users named above.',
      'instruction.confidentiality': 'Confidential to the intended users.',
      'instruction.feeBasis': 'Fixed fee',
      'instruction.dueDate': '2026-10-05',
      'dates.instruction': '2026-09-25',
      'dates.inspection': '2026-09-30',
      'dates.valuation': '2026-09-30',
      'dates.researchCutOff': '2026-10-01',
      'assumptions.general': ['Title is free of unregistered interests'],
      'assumptions.limitations': ['No structural or pest survey was undertaken'],
      'market.national': 'Lending conditions have eased slightly over the past quarter.',
      'market.state': 'Victorian dwelling values were broadly stable in the year to September.',
    },
    assets: {
      [ASSET_ID]: {
        'instruction.ownership': 'Registered proprietor (withheld in preview)',
        'location.address': { formatted: JOB.address },
        'location.titleReference': 'Lot 1 PS123456',
        'location.lga': 'Example City Council',
        'location.coordinates': { lat: -37.81, lng: 144.96 },
        'scope.areasInspected': 'All internal and external areas',
        'valuation.highestAndBestUse': 'Residential dwelling (existing use)',
        'valuation.approaches': ['direct_comparison', 'summation'],
        'valuation.primaryApproach': 'direct_comparison',
        'valuation.crossCheckApproach': 'summation',
        'valuation.adoptedValue': 1_150_000,
        'valuation.marketability': 'Good: established street, strong owner-occupier demand',
        'valuation.riskCommentary': 'Low risk',
        'market.local': 'Steady demand for family homes near schools and transport.',
        'evidence.sales': SALES.map((s) => s.id),
        'improvements.dwellingType': 'Detached house',
        'improvements.accommodation': '4 bedrooms, 2 bathrooms, open-plan living',
        'improvements.areaSchedule': 'sk-1',
        'improvements.measurementBasis': 'BUILDING_AREA',
        'improvements.yearBuilt': 2005,
        'improvements.effectiveAge': 15,
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
  readonly schema: 1;
  readonly role: PreviewRole;
  readonly status: JobStatus;
  readonly selection: JobSelection;
  readonly values: FieldValues;
  readonly sketch: SketchVersion;
  readonly sketchHistory: readonly SketchVersion[];
  readonly approvals: readonly MeasurementApproval[];
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

export function initialState(now: string = new Date().toISOString()): PreviewState {
  let state: PreviewState = {
    schema: 1,
    role: 'valuer',
    status: 'active',
    selection: DEMO_SELECTION,
    values: initialValues(),
    sketch: initialSketch(),
    sketchHistory: [],
    approvals: [],
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
  state = audit(state, PEOPLE.valuer, now, 'job.engagement_accepted', 'job', JOB.id, {
    reference: JOB.reference,
  });
  return state;
}

// ── Derived data (pure; recomputed on every change) ───────────────────────

export interface Derived {
  readonly requirements: ResolvedRequirements;
  readonly missing: readonly MissingField[];
  readonly requiredCount: number;
  readonly requiredCaptured: number;
  readonly convention: MeasurementConvention;
  readonly schedule: AreaSchedule;
  readonly approval: MeasurementApproval | undefined;
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
export function snapshotHashOf(state: PreviewState, schedule: AreaSchedule): string {
  return hashCanonical({
    selection: state.selection,
    values: state.values as unknown as Json,
    sketchVersionId: state.sketch.id,
    scheduleHash: schedule.scheduleHash,
    approvals: state.approvals.map((a) => ({ id: a.id, scheduleHash: a.scheduleHash })),
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
      {
        fieldId: 'planning.zone',
        assetId: ASSET_ID,
        provenance: verified('ds-planning-vic', '2026-09-20'),
      },
    ],
    dataSources: DATA_SOURCES,
    sales: SALES,
    saleAnalyses: SALE_ANALYSES,
    rentals: [],
    calculations: [],
    commentary: [],
    areaSchedules: [schedule],
    measurementApprovals: state.approvals,
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
  const requiredCount = requirements.fields.filter((f) => f.level === 'required').length;
  const requiredMissing = new Set(
    missing.filter((m) => m.level === 'required').map((m) => m.fieldId),
  );
  const convention = conventionFor(state.sketch.conventionId);
  const schedule = computeAreaSchedule(state.sketch, convention);
  const snapshotHash = snapshotHashOf(state, schedule);
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
      firmName: JOB.firmName,
      job: {
        id: JOB.id,
        reference: JOB.reference,
        selection: state.selection,
        clientName: JOB.clientName,
      },
      valuerName: PEOPLE.valuer.displayName,
      requirements,
      values: state.values,
      assets: [{ id: ASSET_ID, label: JOB.address }],
      sales: SALES,
      saleAnalyses: SALE_ANALYSES,
      rentals: [],
      calculations: [],
      areaSchedules: [schedule],
      sketches: [
        {
          assetId: ASSET_ID,
          sketchId: state.sketch.sketchId,
          sketchVersionId: state.sketch.id,
          version: state.sketch.version,
          includeInClientReport: state.sketch.includeInClientReport,
          ...(state.sketch.northBearingDeg !== undefined
            ? { northBearingDeg: state.sketch.northBearingDeg }
            : {}),
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
    missing,
    requiredCount,
    requiredCaptured: requiredCount - requiredMissing.size,
    convention,
    schedule,
    approval: state.approvals.find(
      (a) => a.sketchVersionId === state.sketch.id && a.scheduleHash === schedule.scheduleHash,
    ),
    snapshotHash,
    certificationCurrent: state.certification?.snapshotHash === snapshotHash,
    validation,
    report,
  };
}

// ── Permissions (role grants from the domain) ──────────────────────────────

export const can = (role: PreviewRole, permission: Permission): boolean =>
  PEOPLE[role].roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));

/** Why the current role cannot edit a field, or undefined when it can. */
export function fieldLockReason(
  state: PreviewState,
  def: FieldDef,
): { kind: 'status' | 'role'; text: string } | undefined {
  if (!isEditable(state.status))
    return { kind: 'status', text: `Locked while the job is ${statusLabel(state.status)}` };
  if (state.role === 'reviewer')
    return { kind: 'role', text: 'QA reviewers comment and approve; they do not edit content' };
  if (isValuerJudgementField(def) && !can(state.role, 'valuation.edit'))
    return { kind: 'role', text: 'Valuer only: professional judgement (needs valuation.edit)' };
  return undefined;
}

// ── Workflow ───────────────────────────────────────────────────────────────

export const STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  draft: 'draft',
  active: 'in progress',
  submitted: 'submitted for QA',
  in_review: 'in QA review',
  returned: 'returned to valuer',
  approved: 'QA approved',
  issued: 'issued',
  cancelled: 'cancelled',
};
export const statusLabel = (s: JobStatus): string => STATUS_LABELS[s];

export interface NextStep {
  readonly action: JobAction;
  readonly label: string;
  readonly role: PreviewRole;
  readonly check: TransitionCheck;
}

const STAGE_FOR: Partial<Record<JobAction, ValidationStage>> = {
  submitForQa: 'submit',
  approve: 'submit',
  issue: 'issue',
};

export function transitionCheck(
  state: PreviewState,
  d: Derived,
  action: JobAction,
  actor: Person,
  reason?: string,
): TransitionCheck {
  const stage = STAGE_FOR[action];
  return checkTransition(action, {
    job: {
      id: JOB.id,
      status: state.status,
      responsibleValuerId: PEOPLE.valuer.userId,
      conflictCheck: 'no_conflict',
      engagementDocumentCount: 1,
    },
    actor,
    currentSnapshotHash: d.snapshotHash,
    ...(stage ? { validation: summariseValidation(d.validation[stage]) } : {}),
    ...(state.certification ? { certification: state.certification } : {}),
    ...(state.qaReview ? { qaReview: state.qaReview } : {}),
    ...(state.approvedSnapshotHash ? { approvedSnapshotHash: state.approvedSnapshotHash } : {}),
    ...(reason ? { reason } : {}),
  });
}

/** The next workflow step and who takes it (evaluated as that person). */
export function nextStep(state: PreviewState, d: Derived): NextStep | undefined {
  const step = (action: JobAction, label: string, role: PreviewRole): NextStep => ({
    action,
    label,
    role,
    check: transitionCheck(state, d, action, PEOPLE[role]),
  });
  switch (state.status) {
    case 'active':
    case 'returned':
      return step('submitForQa', 'Submit for QA', 'valuer');
    case 'submitted':
      return step('startReview', 'Start QA review', 'reviewer');
    case 'in_review':
      return step('approve', 'Approve report', 'reviewer');
    case 'approved':
      return step('issue', 'Issue report', 'valuer');
    default:
      return undefined;
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

export type PreviewAction =
  | { type: 'setRole'; role: PreviewRole }
  | { type: 'setSelection'; selection: JobSelection }
  | { type: 'dismissChange' }
  | { type: 'setField'; fieldId: string; assetId: string | null; value: unknown }
  | { type: 'setBoundaries'; boundaries: readonly Boundary[] }
  | { type: 'setConvention'; conventionId: string }
  | { type: 'approveAreas' }
  | { type: 'acknowledge'; code: string; path: string; reason: string }
  | { type: 'sign' }
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
    streamId: STREAM,
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

function requirePermission(state: PreviewState, permission: Permission, what: string): void {
  if (!can(state.role, permission))
    deny(`${PEOPLE[state.role].roleLabel}s cannot ${what} (needs ${permission})`);
}

function requireEditable(state: PreviewState): void {
  if (!isEditable(state.status))
    deny(`The job is ${statusLabel(state.status)}; content is locked until it is returned`);
}

function certificationContent(state: PreviewState): CertificationContent {
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
  const basis =
    typeof job['instruction.basisOfValue'] === 'string' ? job['instruction.basisOfValue'] : '';
  const valuationDate = typeof job['dates.valuation'] === 'string' ? job['dates.valuation'] : '';
  const inspected = typeof job['dates.inspection'] === 'string' ? job['dates.inspection'] : '';
  return {
    jobId: JOB.id,
    valuer: {
      userId: PEOPLE.valuer.userId,
      fullName: PEOPLE.valuer.displayName,
      credentials: PEOPLE.valuer.credentials,
    },
    role: 'responsible_valuer',
    inspectionScope: state.selection.scope,
    inspectionScopeStatement: `${INSPECTION_SCOPE_LABELS[state.selection.scope]}${
      inspected ? ` on ${formatAustralianDate(inspected)}` : ''
    }.`,
    valuationDate,
    basisOfValue: basis.replaceAll('_', ' '),
    amount: { value: typeof amount === 'number' ? amount : 0, currency: 'AUD', kind },
    independenceStatement: 'I have no pecuniary interest in the property or the parties.',
    conflictsStatement: 'No conflict of interest was identified.',
    assumptions: list(job['assumptions.general']),
    specialAssumptions: list(job['assumptions.special']),
    limitations: list(job['assumptions.limitations']),
    standardsReliedOn: ['Firm valuation methodology v1 (mapped by the standards owner)'],
    clauseVersionIds: DEMO_TEMPLATE.clauses
      .filter((c) => c.clauseId === 'certification-core')
      .map((c) => `${c.clauseId}@${c.version}`),
  };
}

const ACTION_VERBS: Readonly<Record<JobAction, string>> = {
  acceptEngagement: 'accept the engagement',
  submitForQa: 'submit for QA',
  startReview: 'start a QA review',
  returnToValuer: 'return a report to the valuer',
  approve: 'approve a report',
  issue: 'issue a report',
  openAmendment: 'open an amendment',
  cancel: 'cancel a job',
};

export const ATTESTATION =
  'I certify that this valuation is my independent professional opinion, formed on the stated basis and assumptions.';

export function apply(
  state: PreviewState,
  action: PreviewAction,
  now: string = new Date().toISOString(),
): PreviewState {
  const me = PEOPLE[state.role];
  switch (action.type) {
    case 'setRole':
      return { ...state, role: action.role };
    case 'reset':
      return { ...initialState(now), role: state.role };
    case 'dismissChange':
      return { ...state, lastChange: null };
    case 'setSelection': {
      requireEditable(state);
      requirePermission(state, 'job.update', 'change what is being valued');
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
      return audit(next, me, now, 'job.selection_changed', 'job', JOB.id, {
        from: state.selection as unknown as Json,
        to: action.selection as unknown as Json,
      });
    }
    case 'setField': {
      requireEditable(state);
      const def = FIELD_BY_ID.get(action.fieldId);
      if (!def) return deny(`Unknown field ${action.fieldId}`);
      const lock = fieldLockReason(state, def);
      if (lock) deny(lock.text);
      const value = action.value === '' || action.value === undefined ? null : action.value;
      const problem = fieldValueProblem(def, value);
      if (problem) throw new DomainError('INVALID_ARGUMENT', `${def.label}: ${problem}`);
      const values: FieldValues =
        action.assetId === null
          ? { ...state.values, job: { ...state.values.job, [def.id]: value } }
          : {
              ...state.values,
              assets: {
                ...state.values.assets,
                [action.assetId]: { ...state.values.assets[action.assetId], [def.id]: value },
              },
            };
      return audit({ ...state, values }, me, now, 'field.updated', 'field', def.id, {
        assetId: action.assetId,
        personal: def.personal === true,
      });
    }
    case 'setBoundaries':
    case 'setConvention': {
      requireEditable(state);
      requirePermission(state, 'sketch.edit', 'edit the sketch');
      const changes =
        action.type === 'setBoundaries'
          ? { boundaries: action.boundaries }
          : {
              conventionId: action.conventionId,
              basis: conventionFor(action.conventionId).basis,
            };
      if (state.sketch.status === 'working')
        return { ...state, sketch: { ...state.sketch, ...changes } };
      // Approved versions are immutable: editing starts a new version; the approval stays with v1.
      const sketch = nextSketchVersion(state.sketch, changes, {
        id: `sv-${state.sketch.version + 1}`,
        changeSummary: 'Edited after approval',
        createdBy: me.userId,
        createdAt: now,
      });
      const next = { ...state, sketch, sketchHistory: [...state.sketchHistory, state.sketch] };
      return audit(next, me, now, 'sketch.version_created', 'sketch_version', sketch.id, {
        version: sketch.version,
      });
    }
    case 'approveAreas': {
      requireEditable(state);
      requirePermission(state, 'measurement.approve', 'approve measured areas');
      const schedule = computeAreaSchedule(state.sketch, conventionFor(state.sketch.conventionId));
      const { approval, version } = approveMeasurement({
        id: `ap-${state.seq + 1}`,
        version: state.sketch,
        schedule,
        approver: me,
        at: now,
      });
      return audit(
        { ...state, sketch: version, approvals: [...state.approvals, approval] },
        me,
        now,
        'measurement.approved',
        'sketch_version',
        version.id,
        { totalIncludedM2: approval.totalIncludedM2, scheduleHash: approval.scheduleHash },
      );
    }
    case 'acknowledge': {
      requireEditable(state);
      requirePermission(state, 'validation.acknowledge', 'acknowledge warnings');
      const d = derive(state, now);
      const finding = [...d.validation.submit.findings, ...d.validation.issue.findings].find(
        (f) => f.code === action.code && f.path === action.path,
      );
      if (!finding) return deny('That finding no longer applies');
      const ack = acknowledgeFinding(finding, me.userId, now, action.reason);
      return audit(
        { ...state, acknowledgements: [...state.acknowledgements, ack] },
        me,
        now,
        'validation.acknowledged',
        'finding',
        `${action.code}:${action.path}`,
        {},
        ack.reason,
      );
    }
    case 'sign': {
      requireEditable(state);
      requirePermission(state, 'certification.sign', 'sign the certification');
      const d = derive(state, now);
      const certification = signCertification(certificationContent(state), {
        id: `cert-${state.seq + 1}`,
        actor: me,
        responsibleValuerId: PEOPLE.valuer.userId,
        snapshotHash: d.snapshotHash,
        at: now,
        attestationText: ATTESTATION,
      });
      return audit(
        { ...state, certification },
        me,
        now,
        'certification.signed',
        'certification',
        certification.id,
        {
          snapshotHash: d.snapshotHash,
        },
      );
    }
    case 'answerChecklist': {
      requirePermission(state, 'qa.review', 'answer the QA checklist');
      if (!state.qaReview) return deny('The QA review has not started');
      if (state.qaReview.reviewerId !== me.userId) deny('Only the assigned reviewer can answer');
      return {
        ...state,
        qaReview: answerChecklistItem(state.qaReview, action.itemId, action.response, action.note),
      };
    }
    case 'transition': {
      const def = TRANSITIONS[action.action];
      requirePermission(state, def.permission, ACTION_VERBS[action.action]);
      const d = derive(state, now);
      const check = transitionCheck(state, d, action.action, me, action.reason);
      if (!check.allowed)
        throw new DomainError('GUARD_FAILED', check.failures.join('; '), {
          failures: [...check.failures],
        });
      let next: PreviewState = { ...state, status: check.to };
      if (action.action === 'submitForQa')
        next = { ...next, submittedSnapshotHash: d.snapshotHash, qaReview: null };
      if (action.action === 'startReview') {
        if (state.submittedSnapshotHash !== d.snapshotHash)
          deny('Content changed since submission');
        next = {
          ...next,
          qaReview: startQaReview({
            id: `qa-${state.seq + 1}`,
            jobId: JOB.id,
            reviewerId: me.userId,
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
      if (action.action === 'issue') {
        next = { ...next, issuedAt: now };
        if (next.sketch.status === 'approved')
          next = { ...next, sketch: { ...next.sketch, status: 'frozen' } };
      }
      return audit(
        next,
        me,
        now,
        def.auditAction,
        'job',
        JOB.id,
        {
          from: state.status,
          to: check.to,
          snapshotHash: d.snapshotHash,
        },
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
