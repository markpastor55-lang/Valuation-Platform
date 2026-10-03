import {
  AU_CORE_RULE_SET,
  DEFAULT_CONVENTIONS,
  DEFAULT_VALIDATION_CONFIG,
  analyseSale,
  approveMeasurement,
  computeAreaSchedule,
  resolveRequirements,
  type Actor,
  type DataSource,
  type FieldValues,
  type JobSelection,
  type Point,
  type Provenance,
  type SaleComparable,
  type SketchVersion,
  type ValidationContext,
} from '../src/index.js';

export const NOW = '2026-10-02T00:00:00Z';
export const valuer: Actor = {
  kind: 'human',
  userId: 'valuer1',
  orgId: 'org1',
  roles: ['VALUER'],
  mfaVerified: true,
};

export const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

export const salesSource: DataSource = {
  id: 'ds-sales',
  name: 'Licensed sales feed',
  provider: 'Example Data Co',
  kind: 'sales',
  licence: {
    basis: 'licensed',
    reference: 'Agreement 2026-01',
    permitsStorage: true,
    permitsReportReproduction: true,
    permitsBulkUse: false,
  },
  freshnessDays: 365,
  status: 'active',
};

export const planningSource: DataSource = {
  id: 'ds-vicplan',
  name: 'State planning service',
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
};

export const verified = (sourceId: string, effectiveDate: string): Provenance => ({
  origin: 'external_source',
  sourceId,
  retrievedAt: '2026-09-20T00:00:00Z',
  effectiveDate,
  licenceBasis: 'licensed',
  verification: 'verified',
  verifiedBy: 'valuer1',
  verifiedAt: '2026-09-21T00:00:00Z',
  capturedBy: 'valuer1',
  capturedAt: '2026-09-20T00:00:00Z',
});

export const sale = (
  id: string,
  price: number,
  landAreaM2: number,
  contractDate: string,
  over: Partial<SaleComparable> = {},
): SaleComparable => ({
  id,
  assetId: 'a1',
  address: `${id} Example Street, Exampleton VIC`,
  contractDate,
  price,
  interest: 'fee_simple_vacant_possession',
  propertyType: 'RESIDENTIAL',
  landAreaM2,
  buildingAreaM2: 200,
  provenance: verified('ds-sales', contractDate),
  comparability: 'comparable',
  adjustments: [
    { factor: 'condition', kind: 'percent', value: 0.02, rationale: 'Inferior condition' },
  ],
  analysisBasis: 'land_rate',
  ...over,
});

export const selection: JobSelection = {
  jurisdiction: 'VIC',
  purpose: 'MARKET_VALUE',
  propertyType: 'RESIDENTIAL',
  scope: 'FULL',
  mode: 'SINGLE',
};

export function sketch(): SketchVersion {
  return {
    id: 'sv1',
    sketchId: 'sk1',
    assetId: 'a1',
    version: 1,
    units: 'metres',
    boundaries: [
      {
        id: 'b1',
        level: 'Ground',
        label: 'Dwelling',
        role: 'component',
        componentType: 'living',
        points: rect(0, 0, 15, 12),
        closed: true,
        dimensionSource: 'measured',
        origin: 'drawn',
        reviewStatus: 'accepted',
        measuredBy: 'valuer1',
        measuredAt: NOW,
      },
      {
        id: 'b2',
        level: 'Ground',
        label: 'Garage',
        role: 'component',
        componentType: 'garage',
        points: rect(15, 0, 6, 6),
        closed: true,
        dimensionSource: 'measured',
        origin: 'drawn',
        reviewStatus: 'accepted',
        measuredBy: 'valuer1',
        measuredAt: NOW,
      },
    ],
    basis: 'BUILDING_AREA',
    conventionId: 'res-under-main-roof',
    includeInClientReport: true,
    changeSummary: 'Initial',
    createdBy: 'valuer1',
    createdAt: NOW,
    status: 'working',
  };
}

export function marketValueValues(): FieldValues {
  return {
    job: {
      'instruction.clientEntity': 'Example Lending Pty Ltd',
      'instruction.instructingParty': 'J. Citizen',
      'instruction.intendedUsers': ['Example Lending Pty Ltd'],
      'instruction.intendedUse': 'First mortgage security',
      'instruction.basisOfValue': 'market_value',
      'instruction.interestValued': 'fee_simple_vacant_possession',
      'instruction.conflictCheck': 'no_conflict',
      'instruction.responsibleValuer': 'valuer1',
      'instruction.reviewer': 'reviewer1',
      'instruction.engagementDocuments': ['doc-engagement'],
      'instruction.reliance': 'Reliance limited to the intended users.',
      'instruction.confidentiality': 'Confidential to the intended users.',
      'instruction.feeBasis': 'Fixed fee',
      'instruction.dueDate': '2026-10-05',
      'dates.instruction': '2026-09-25',
      'dates.inspection': '2026-09-30',
      'dates.valuation': '2026-09-30',
      'dates.researchCutOff': '2026-10-01',
      'assumptions.general': ['Title is free of unregistered interests'],
      'assumptions.limitations': ['No structural survey was undertaken'],
      'market.national': 'National commentary.',
      'market.state': 'State commentary.',
    },
    assets: {
      a1: {
        'instruction.ownership': 'Registered proprietor (withheld)',
        'location.address': { formatted: '10 Sample Road, Exampleton VIC 3000' },
        'location.titleReference': 'Lot 1 PS123456',
        'location.lga': 'Example City Council',
        'location.coordinates': { lat: -37.8, lng: 144.9 },
        'scope.areasInspected': 'All internal and external areas',
        'valuation.highestAndBestUse': 'Residential dwelling (existing use)',
        'valuation.approaches': ['direct_comparison', 'summation'],
        'valuation.primaryApproach': 'direct_comparison',
        'valuation.crossCheckApproach': 'summation',
        'valuation.reconciliation': 'Direct comparison adopted, supported by summation.',
        'valuation.adoptedValue': 1_150_000,
        'valuation.marketability': 'Good',
        'valuation.riskCommentary': 'Low risk',
        'market.local': 'Local commentary.',
        'evidence.sales': ['s1', 's2', 's3'],
        'improvements.dwellingType': 'Detached house',
        'improvements.accommodation': '4 bed, 2 bath',
        'improvements.areaSchedule': 'sv1',
        'improvements.measurementBasis': 'BUILDING_AREA',
        'improvements.yearBuilt': 2005,
        'improvements.effectiveAge': 15,
        'improvements.construction': 'Brick veneer, tiled roof',
        'improvements.condition': 'Good',
        'improvements.renovations': 'Kitchen 2021',
        'improvements.fixturesFinishes': 'Stone benchtops',
        'improvements.outdoorImprovements': 'Paving, fencing',
        'improvements.parking': 'Double garage',
        'land.area': 650,
        'land.areaSource': 'Title plan',
        'land.environmental': 'None identified',
        'land.easements': 'Drainage easement (rear)',
        'planning.zone': 'General Residential Zone',
        'planning.overlays': ['None'],
        'planning.instrument': 'Example Planning Scheme',
        'planning.source': ['ds-vicplan'],
        'planning.reportDocument': ['doc-planning'],
        'occupancy.status': 'owner_occupied',
      },
    },
  };
}

/** A complete, clean market-value residential job at the submit stage. */
export function cleanContext(over: Partial<ValidationContext> = {}): ValidationContext {
  const values = over.values ?? marketValueValues();
  const sales = [
    sale('s1', 1_100_000, 640, '2026-06-01'),
    sale('s2', 1_180_000, 660, '2026-07-15'),
    sale('s3', 1_150_000, 655, '2026-08-20'),
  ];
  const v = sketch();
  const schedule = computeAreaSchedule(
    v,
    DEFAULT_CONVENTIONS.find((c) => c.id === 'res-under-main-roof')!,
  );
  const { approval } = approveMeasurement({
    id: 'ap1',
    version: v,
    schedule,
    approver: valuer,
    at: NOW,
  });
  return {
    stage: 'submit',
    now: NOW,
    timeZone: 'Australia/Melbourne',
    selection,
    requirements: resolveRequirements(over.selection ?? selection, AU_CORE_RULE_SET, values),
    values,
    assetIds: ['a1'],
    provenance: [
      {
        fieldId: 'planning.zone',
        assetId: 'a1',
        provenance: { ...verified('ds-vicplan', '2026-09-20'), licenceBasis: 'open_licence' },
      },
    ],
    dataSources: [salesSource, planningSource],
    sales,
    saleAnalyses: sales.map((s) => analyseSale(s, { computedBy: 'valuer1', computedAt: NOW })),
    rentals: [],
    calculations: [],
    commentary: [],
    areaSchedules: [schedule],
    measurementApprovals: [approval],
    photos: [],
    aiSuggestions: [],
    riskFlags: [],
    ruleSetStatus: 'approved',
    templateStatus: 'approved',
    acknowledgements: [],
    config: DEFAULT_VALIDATION_CONFIG,
    ...over,
  };
}
