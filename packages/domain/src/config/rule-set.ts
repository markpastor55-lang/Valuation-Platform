import type {
  AssetMode,
  InspectionScope,
  Jurisdiction,
  PropertyType,
  ReportPurpose,
  SpecialistReviewer,
} from './codes.js';
import type { SectionId } from './sections.js';
import type { LocalDate } from '../core/dates.js';
import { compareDates } from '../core/dates.js';

/** Condition on a captured field value. Asset-level fields are evaluated per asset. */
export interface FieldCondition {
  readonly fieldId: string;
  readonly equals?: string | boolean;
  readonly in?: readonly string[];
  /** For list / multi-enum values: the list contains this item. */
  readonly includes?: string;
  readonly present?: boolean;
}

export interface RuleCondition {
  readonly purposes?: readonly ReportPurpose[];
  readonly propertyTypes?: readonly PropertyType[];
  readonly scopes?: readonly InspectionScope[];
  readonly jurisdictions?: readonly Jurisdiction[];
  readonly modes?: readonly AssetMode[];
  readonly fields?: readonly FieldCondition[];
  /**
   * Matches retrospective (or current) valuations. Derived from the dates, never selected:
   * see `retrospectiveStatus`.
   */
  readonly retrospective?: boolean;
}

export interface RuleWarning {
  readonly code: string;
  readonly message: string;
  readonly review?: SpecialistReviewer;
}

export interface RequirementRule {
  readonly id: string;
  readonly description: string;
  readonly when: RuleCondition;
  readonly require?: readonly string[];
  readonly recommend?: readonly string[];
  readonly sections?: readonly SectionId[];
  readonly warnings?: readonly RuleWarning[];
  readonly specialistReview?: readonly SpecialistReviewer[];
  /** Formula ids made available to the user by this rule (informational for the UI). */
  readonly formulas?: readonly string[];
}

export interface SelectionRule {
  readonly id: string;
  readonly description: string;
  readonly when: RuleCondition;
  readonly severity: 'blocking' | 'warning';
  readonly message: string;
  readonly review?: SpecialistReviewer;
}

export type RuleSetStatus = 'draft' | 'in_review' | 'approved' | 'retired';

export interface RuleSetVersion {
  readonly id: string;
  readonly version: string;
  readonly status: RuleSetStatus;
  readonly effectiveFrom: LocalDate;
  readonly effectiveTo?: LocalDate;
  readonly fieldCatalogueVersion: number;
  readonly rules: readonly RequirementRule[];
  readonly selectionRules: readonly SelectionRule[];
  readonly authoredBy: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly notes: string;
}

const VALUE_PURPOSES: readonly ReportPurpose[] = [
  'MARKET_VALUE',
  'CGT',
  'FAMILY_LAW',
  'FINANCIAL_REPORTING',
];
const COMMERCIAL: readonly PropertyType[] = ['COMMERCIAL_OFFICE', 'COMMERCIAL_RETAIL'];
const VALUATION_CORE = [
  'valuation.highestAndBestUse',
  'valuation.approaches',
  'valuation.primaryApproach',
  'valuation.reconciliation',
  'valuation.adoptedValue',
] as const;

/** National, state and local commentary, offered from the firm's library by property type and location. */
const MARKET_COMMENTARY = ['market.national', 'market.state', 'market.local'] as const;

/**
 * Australian core rule set — **draft**. This is the starting configuration for the
 * purpose × property type × scope × jurisdiction matrix. It must be reviewed and approved by
 * the nominated standards owner (and the specialist reviewers named on individual rules)
 * before it is used for issued reports. See docs/spec/03-field-matrix.md.
 */
export const AU_CORE_RULE_SET: RuleSetVersion = {
  id: 'au-core',
  version: '2026.1',
  status: 'draft',
  effectiveFrom: '2026-01-01',
  fieldCatalogueVersion: 1,
  authoredBy: 'system-seed',
  notes:
    'Seed configuration authored from the product brief, revised after product owner review (unreleased draft): fewer per-job inputs, CGT as a purpose with retrospective rules derived from the dates, and the sketch kept as working notes. Requires API_STANDARDS approval; purpose rules carry their own specialist-review tags.',
  rules: [
    // ── Base: every job ──────────────────────────────────────────────────────
    {
      id: 'REQ-BASE-001',
      description:
        'Instruction, key dates and location for every job. The client is the instructing party; reliance, confidentiality and standard limitations come from approved template clauses, not per-job inputs.',
      when: {},
      require: [
        'instruction.clientEntity',
        'instruction.intendedUsers',
        'instruction.intendedUse',
        'instruction.basisOfValue',
        'instruction.interestValued',
        'instruction.conflictCheck',
        'instruction.responsibleValuer',
        'instruction.engagementDocuments',
        'dates.instruction',
        'dates.valuation',
        'location.address',
        'location.titleReference',
      ],
      recommend: [
        'instruction.dueDate',
        'instruction.reviewer',
        'instruction.ownership',
        'location.lga',
        'location.coordinates',
        'assumptions.general',
        'assumptions.limitations',
      ],
      sections: [
        'instructions',
        'scope',
        'basis',
        'location',
        'assumptions',
        'certification',
        'appendices',
        'audit_metadata',
      ],
    },
    {
      id: 'REQ-BASE-002',
      description: 'A disclosed and managed conflict must be described',
      when: {
        fields: [{ fieldId: 'instruction.conflictCheck', equals: 'conflict_disclosed_managed' }],
      },
      require: ['instruction.conflictDisclosure'],
    },

    // ── Inspection scope ─────────────────────────────────────────────────────
    {
      id: 'REQ-SCOPE-FULL-001',
      description: 'Full inspection',
      when: { scopes: ['FULL'] },
      require: ['dates.inspection', 'scope.areasInspected'],
      sections: ['photos'],
    },
    {
      id: 'REQ-SCOPE-KERB-001',
      description: 'Kerbside (external-only) inspection',
      when: { scopes: ['KERBSIDE'] },
      require: [
        'dates.inspection',
        'scope.areasInspected',
        'scope.areasNotInspected',
        'scope.obstructionNotes',
        'scope.internalConditionAssumption',
        'scope.escalationDecision',
      ],
      sections: ['restricted_access', 'photos'],
      warnings: [
        {
          code: 'W-SCOPE-KERB',
          message:
            'Internal condition is assumed, not observed: disclose the assumption and consider risk flags.',
        },
      ],
    },
    {
      id: 'REQ-SCOPE-RESTR-001',
      description: 'Restricted-access inspection',
      when: { scopes: ['RESTRICTED'] },
      require: [
        'dates.inspection',
        'scope.areasInspected',
        'scope.areasNotInspected',
        'scope.accessAttempts',
        'scope.obstructionNotes',
        'scope.internalConditionAssumption',
        'scope.escalationDecision',
      ],
      sections: ['restricted_access', 'photos'],
    },
    {
      id: 'REQ-SCOPE-DESK-001',
      description: 'Desktop assessment (no inspection)',
      when: { scopes: ['DESKTOP'] },
      require: [
        'desktop.dataSourceRegister',
        'desktop.imageryDates',
        'desktop.informationGaps',
        'desktop.confidenceStatement',
        'scope.escalationDecision',
      ],
      sections: ['desktop_data_register'],
      warnings: [
        {
          code: 'W-SCOPE-DESK',
          message:
            'No physical inspection: escalation triggers (risk flags, low data confidence, unusual property) must be assessed.',
        },
      ],
    },
    {
      id: 'REQ-SCOPE-ESC-001',
      description: 'Proceeding without escalation must be justified',
      when: {
        fields: [{ fieldId: 'scope.escalationDecision', equals: 'proceed_with_justification' }],
      },
      require: ['scope.escalationJustification'],
    },

    // ── Report purpose ───────────────────────────────────────────────────────
    {
      id: 'REQ-PUR-MV-001',
      description: 'Market value',
      when: { purposes: ['MARKET_VALUE'] },
      require: [
        ...VALUATION_CORE,
        'valuation.marketability',
        ...MARKET_COMMENTARY,
        'evidence.sales',
      ],
      recommend: ['valuation.crossCheckApproach', 'valuation.riskCommentary'],
      sections: ['market', 'hbu', 'sales_evidence', 'valuation_approach', 'reconciliation', 'risk'],
      specialistReview: ['API_STANDARDS'],
    },
    {
      id: 'REQ-PUR-CGT-001',
      description:
        'Capital gains tax valuation. The client (often the tax agent) instructs; whether it is retrospective follows from the dates (REQ-RETRO-001).',
      when: { purposes: ['CGT'] },
      require: [...VALUATION_CORE, 'cgt.taxEvent', ...MARKET_COMMENTARY, 'evidence.sales'],
      sections: [
        'tax_context',
        'market',
        'hbu',
        'sales_evidence',
        'valuation_approach',
        'reconciliation',
      ],
      specialistReview: ['TAX', 'API_STANDARDS'],
    },
    {
      id: 'REQ-RETRO-001',
      description:
        'Retrospective valuation (any purpose): the valuation date is before the inspection date, so the basis of the historical assessment must be stated.',
      when: { retrospective: true },
      require: ['retro.evidenceBasis'],
      recommend: ['dates.retrospectiveDataCutOff', 'retro.chronology'],
      sections: ['retrospective'],
      specialistReview: ['API_STANDARDS'],
      warnings: [
        {
          code: 'W-RETRO-HINDSIGHT',
          message:
            'Retrospective valuation: rely only on information known or reasonably foreseeable at the valuation date. Later sales are flagged.',
          review: 'API_STANDARDS',
        },
      ],
    },
    {
      id: 'REQ-PUR-FL-001',
      description: 'Family law expert valuation',
      when: { purposes: ['FAMILY_LAW'] },
      require: [
        ...VALUATION_CORE,
        'fl.court',
        'fl.proceedingNumber',
        'fl.parties',
        'fl.ordersOrQuestions',
        'fl.singleExpert',
        'fl.expertCodeAcknowledged',
        'fl.instructionsReceived',
        'fl.documentsReliedOn',
        'fl.independenceDeclaration',
        'fl.reasons',
        'fl.declaration',
        ...MARKET_COMMENTARY,
        'evidence.sales',
      ],
      recommend: ['fl.conferenceOrJointStatement'],
      sections: [
        'expert_compliance',
        'market',
        'hbu',
        'sales_evidence',
        'valuation_approach',
        'reconciliation',
      ],
      specialistReview: ['FAMILY_LAW', 'API_STANDARDS'],
      warnings: [
        {
          code: 'W-FL-LEGAL-REVIEW',
          message: 'Expert-report template wording must be legally reviewed before issue.',
          review: 'FAMILY_LAW',
        },
      ],
    },
    {
      id: 'REQ-PUR-FR-001',
      description: 'Financial reporting — fair value (AASB 13, configurable)',
      when: { purposes: ['FINANCIAL_REPORTING'] },
      require: [
        ...VALUATION_CORE,
        'fr.accountingStandard',
        'fr.reportingEntity',
        'fr.reportingDate',
        'fr.unitOfAccount',
        'fr.principalMarket',
        'fr.marketParticipantAssumptions',
        'fr.valuationPremise',
        'fr.valuationTechnique',
        'fr.significantInputs',
        'fr.fairValueHierarchyLevel',
        'fr.sensitivityAnalysis',
        'fr.disclosureSchedule',
      ],
      recommend: [...MARKET_COMMENTARY, 'evidence.sales'],
      sections: ['fair_value', 'market', 'hbu', 'valuation_approach', 'reconciliation'],
      specialistReview: ['ACCOUNTING', 'API_STANDARDS'],
      formulas: ['fv.sensitivity'],
    },
    {
      id: 'REQ-PUR-RENT-001',
      description: 'Rental assessment',
      when: { purposes: ['RENTAL_ASSESSMENT'] },
      require: [
        'rent.basis',
        'rent.reviewDate',
        'rent.reviewMechanism',
        'rent.leaseArea',
        'rent.permittedUse',
        'rent.incentives',
        'rent.outgoings',
        'rent.termAndOptions',
        'rent.vacancy',
        'rent.faceRent',
        'rent.effectiveRent',
        'rent.ratePerM2',
        'rent.adoptedMarketRent',
        'evidence.rentals',
      ],
      recommend: [...MARKET_COMMENTARY],
      sections: ['market', 'rental_evidence', 'rental_determination'],
      specialistReview: ['API_STANDARDS'],
      formulas: ['income.effective_rent', 'income.rent_rate_per_m2'],
    },
    {
      id: 'REQ-PUR-INS-001',
      description: 'Insurance replacement / reinstatement cost',
      when: { purposes: ['INSURANCE_REPLACEMENT'] },
      require: [
        'ins.basis',
        'improvements.areaSchedule',
        'improvements.measurementBasis',
        'ins.constructionType',
        'ins.quality',
        'ins.services',
        'ins.costDataSource',
        'ins.demolitionDebris',
        'ins.professionalFees',
        'ins.escalation',
        'ins.leadTimeMonths',
        'ins.codeUpgradeAllowance',
        'ins.locationFactor',
        'ins.gstTreatment',
        'ins.exclusions',
        'ins.sumInsured',
      ],
      sections: ['improvements', 'areas', 'cost_approach', 'insurance'],
      specialistReview: ['QUANTITY_SURVEYOR'],
      formulas: ['cost.replacement'],
      warnings: [
        {
          code: 'W-INS-COST-DATA',
          message:
            'Published cost indices are indicative; record edition, locality, date and every adjustment, and apply project-specific judgement.',
          review: 'QUANTITY_SURVEYOR',
        },
      ],
    },

    // ── Property type: physical description (all purposes) ──────────────────
    {
      id: 'REQ-PT-VL-001',
      description: 'Vacant land site, planning and development potential',
      when: { propertyTypes: ['VACANT_LAND'] },
      require: [
        'land.area',
        'land.areaSource',
        'land.dimensions',
        'land.frontage',
        'land.shape',
        'land.topography',
        'land.access',
        'land.services',
        'land.easements',
        'land.environmental',
        'planning.zone',
        'planning.overlays',
        'planning.source',
        'land.developmentPotential',
      ],
      recommend: ['planning.permissibleUses', 'planning.prohibitedUses'],
      sections: ['land', 'planning'],
      formulas: ['land.rate_per_m2', 'land.rate_per_ha'],
    },
    {
      id: 'REQ-PT-RES-001',
      description:
        'Residential dwelling description. The building area is entered directly (the sketch is working notes and is not reported).',
      when: { propertyTypes: ['RESIDENTIAL'] },
      require: [
        'improvements.dwellingType',
        'improvements.accommodation',
        'improvements.buildingArea',
        'improvements.yearBuilt',
        'improvements.construction',
        'improvements.condition',
      ],
      recommend: [
        'improvements.renovations',
        'improvements.fixturesFinishes',
        'improvements.outdoorImprovements',
      ],
      sections: ['improvements'],
    },
    {
      id: 'REQ-PT-UNIT-001',
      description:
        'Unit, apartment or townhouse: the lot, its internal area (usually from the strata plan) and the building it is in.',
      when: { propertyTypes: ['RESIDENTIAL_UNIT'] },
      require: [
        'strata.titleType',
        'unit.unitType',
        'improvements.accommodation',
        'unit.internalArea',
        'improvements.parking',
        'improvements.yearBuilt',
        'improvements.construction',
        'improvements.condition',
      ],
      recommend: [
        'unit.level',
        'unit.internalAreaSource',
        'unit.outdoorArea',
        'unit.storage',
        'unit.unitsInComplex',
        'unit.buildingAmenities',
        'unit.aspect',
        'improvements.renovations',
        'improvements.fixturesFinishes',
      ],
      sections: ['improvements', 'strata'],
      formulas: ['improvements.rate_per_m2', 'comparison.adjusted_rate'],
    },
    {
      id: 'REQ-PT-UNIT-002',
      description:
        'Unit valuation analytics: occupancy, with zoning and the site of the complex as context (no land valuation of the lot).',
      when: {
        purposes: [...VALUE_PURPOSES, 'RENTAL_ASSESSMENT'],
        propertyTypes: ['RESIDENTIAL_UNIT'],
      },
      require: ['occupancy.status'],
      recommend: ['planning.zone', 'land.area', 'land.environmental'],
      sections: ['planning', 'occupancy'],
    },
    {
      id: 'REQ-STRATA-001',
      description:
        'Strata, community or stratum title (any property type): the scheme, the lot entitlement, levies and known building defects.',
      when: {
        fields: [
          { fieldId: 'strata.titleType', in: ['strata_title', 'community_title', 'stratum_title'] },
        ],
      },
      require: [
        'strata.planNumber',
        'strata.lotNumber',
        'strata.unitEntitlement',
        'strata.ownersCorporation',
        'strata.adminLevy',
        'strata.capitalWorksLevy',
        'strata.buildingDefects',
      ],
      recommend: ['strata.specialLevies', 'strata.byLaws', 'strata.ownersCorporationCertificate'],
      sections: ['strata'],
      warnings: [
        {
          code: 'W-STRATA-RECORDS',
          message:
            'Check the owners corporation certificate or strata report for special levies, building defects (including combustible cladding) and disputes before relying on the value.',
          review: 'API_STANDARDS',
        },
      ],
    },
    {
      id: 'REQ-STRATA-002',
      description: 'Company title: the company, shares held and restrictions on sale or lending.',
      when: { fields: [{ fieldId: 'strata.titleType', equals: 'company_title' }] },
      require: ['strata.companyTitleDetails'],
      recommend: ['strata.ownersCorporationCertificate'],
      sections: ['strata'],
      warnings: [
        {
          code: 'W-COMPANY-TITLE',
          message:
            'Company title can restrict who may buy and lend; state any restrictions and how they affect value.',
          review: 'LEGAL',
        },
      ],
    },
    {
      id: 'REQ-PT-COM-001',
      description: 'Commercial building description and areas',
      when: { propertyTypes: COMMERCIAL },
      require: [
        'improvements.use',
        'improvements.lettableArea',
        'improvements.floorAreas',
        'improvements.measurementBasis',
        'improvements.fitout',
        'improvements.services',
        'improvements.parking',
        'improvements.construction',
        'improvements.condition',
      ],
      recommend: ['strata.titleType', 'improvements.yearBuilt'],
      sections: ['improvements', 'areas'],
    },
    {
      id: 'REQ-PT-OFF-001',
      description: 'Office grade',
      when: { propertyTypes: ['COMMERCIAL_OFFICE'] },
      recommend: ['improvements.grade'],
    },
    {
      id: 'REQ-PT-RET-001',
      description: 'Retail trading context (only where data use is authorised)',
      when: { propertyTypes: ['COMMERCIAL_RETAIL'] },
      recommend: ['retail.tradeArea', 'retail.frontage', 'retail.footfall', 'retail.centreMetrics'],
      sections: ['retail_metrics'],
      warnings: [
        {
          code: 'W-RET-AUTHORISED-DATA',
          message:
            'Footfall and centre metrics may only be used where the data owner has authorised their use.',
          review: 'DATA_LICENSING',
        },
      ],
    },
    {
      id: 'REQ-PT-IND-001',
      description: 'Industrial building description and areas',
      when: { propertyTypes: ['INDUSTRIAL'] },
      require: [
        'improvements.use',
        'improvements.warehouseArea',
        'improvements.officeArea',
        'improvements.areaSchedule',
        'improvements.measurementBasis',
        'improvements.siteCoverage',
        'improvements.clearance',
        'improvements.loading',
        'improvements.hardstand',
        'improvements.power',
        'improvements.fireServices',
        'improvements.construction',
        'improvements.condition',
        'improvements.functionalObsolescence',
        'planning.useCompliance',
      ],
      recommend: ['strata.titleType', 'improvements.cranes'],
      sections: ['improvements', 'areas', 'planning'],
    },
    {
      id: 'REQ-PT-SPEC-001',
      description: 'Specialised or mixed-use components',
      when: { propertyTypes: ['SPECIALISED_MIXED_USE'] },
      require: [
        'specialised.componentSchedule',
        'specialised.allocationMethod',
        'specialised.licences',
        'specialised.goingConcernBoundary',
        'specialised.specialistReview',
        'improvements.areaSchedule',
        'improvements.measurementBasis',
      ],
      sections: ['specialised', 'improvements', 'areas'],
      specialistReview: ['API_STANDARDS'],
      warnings: [
        {
          code: 'W-SPEC-REVIEW',
          message: 'Specialised assets may require specialist input; record triggers and outcome.',
        },
      ],
    },

    // ── Property type: valuation analytics (value purposes only) ─────────────
    {
      id: 'REQ-PT-VAL-LAND-001',
      description: 'Site and planning data for valuing improved property',
      when: {
        purposes: [...VALUE_PURPOSES, 'RENTAL_ASSESSMENT'],
        propertyTypes: ['RESIDENTIAL', ...COMMERCIAL, 'INDUSTRIAL', 'SPECIALISED_MIXED_USE'],
      },
      require: [
        'land.area',
        'land.areaSource',
        'planning.zone',
        'planning.source',
        'occupancy.status',
      ],
      recommend: ['land.environmental', 'planning.overlays', 'land.easements'],
      sections: ['land', 'planning', 'occupancy'],
    },
    {
      id: 'REQ-PT-RES-002',
      description: 'Residential valuation analytics',
      when: { purposes: VALUE_PURPOSES, propertyTypes: ['RESIDENTIAL'] },
      require: ['improvements.parking'],
      formulas: ['improvements.rate_per_m2', 'land.rate_per_m2', 'comparison.adjusted_rate'],
    },
    {
      id: 'REQ-PT-COM-002',
      description: 'Commercial income analytics',
      when: { purposes: VALUE_PURPOSES, propertyTypes: COMMERCIAL },
      require: [
        'tenancy.schedule',
        'tenancy.wale',
        'tenancy.occupancyRate',
        'tenancy.incentives',
        'tenancy.outgoings',
        'tenancy.passingIncome',
        'income.marketIncome',
        'income.capRate',
        'evidence.rentals',
        'valuation.crossCheckApproach',
      ],
      recommend: ['income.discountRate', 'income.terminalYield'],
      sections: ['tenancy_schedule', 'income_approach', 'rental_evidence'],
      formulas: [
        'income.initial_yield',
        'income.capitalised_value',
        'income.wale',
        'improvements.rate_per_m2',
      ],
    },
    {
      id: 'REQ-PT-IND-002',
      description: 'Industrial income and rate analytics',
      when: { purposes: VALUE_PURPOSES, propertyTypes: ['INDUSTRIAL'] },
      require: [
        'income.marketIncome',
        'income.capRate',
        'evidence.rentals',
        'valuation.crossCheckApproach',
      ],
      recommend: ['tenancy.schedule', 'tenancy.wale'],
      sections: ['income_approach', 'rental_evidence'],
      formulas: [
        'improvements.rate_per_m2',
        'land.rate_per_m2',
        'income.initial_yield',
        'income.capitalised_value',
      ],
    },

    // ── Conditional on captured values ───────────────────────────────────────
    {
      id: 'REQ-OCC-001',
      description: 'Leased property requires lease facts and evidence',
      when: { fields: [{ fieldId: 'occupancy.status', in: ['leased', 'part_leased'] }] },
      require: ['occupancy.leaseSummary', 'occupancy.evidence'],
      sections: ['occupancy'],
    },
    {
      id: 'REQ-INT-001',
      description: 'Interest subject to lease requires lease summary',
      when: {
        fields: [{ fieldId: 'instruction.interestValued', equals: 'fee_simple_subject_to_lease' }],
      },
      require: ['occupancy.leaseSummary'],
      sections: ['occupancy'],
    },
    {
      id: 'REQ-APP-CAP-001',
      description: 'Capitalisation approach inputs',
      when: { fields: [{ fieldId: 'valuation.approaches', includes: 'capitalisation' }] },
      require: ['income.marketIncome', 'income.capRate'],
      sections: ['income_approach'],
    },
    {
      id: 'REQ-APP-DCF-001',
      description: 'Discounted cash flow inputs',
      when: { fields: [{ fieldId: 'valuation.approaches', includes: 'discounted_cash_flow' }] },
      require: ['income.discountRate', 'income.terminalYield'],
      sections: ['income_approach'],
    },
    {
      id: 'REQ-APP-SUM-001',
      description: 'Summation approach inputs',
      when: { fields: [{ fieldId: 'valuation.approaches', includes: 'summation' }] },
      require: ['land.area', 'improvements.buildingArea'],
      sections: ['cost_approach'],
    },
    {
      id: 'REQ-UNC-001',
      description:
        'Special assumptions must be accompanied by a statement on uncertainty where relevant',
      when: { fields: [{ fieldId: 'assumptions.special', present: true }] },
      recommend: ['assumptions.materialUncertainty'],
    },

    // ── Asset mode ───────────────────────────────────────────────────────────
    {
      id: 'REQ-MODE-PF-001',
      description: 'Portfolio aggregation and summary',
      when: { modes: ['PORTFOLIO'] },
      require: ['portfolio.aggregationBasis', 'portfolio.summarySchedule'],
      sections: ['portfolio_summary'],
      warnings: [
        {
          code: 'W-PF-AGGREGATION',
          message:
            'State whether the portfolio figure is the sum of individual values or reflects a justified portfolio premium/discount.',
          review: 'API_STANDARDS',
        },
      ],
    },

    // ── Jurisdiction ─────────────────────────────────────────────────────────
    {
      id: 'REQ-JUR-VIC-001',
      description: 'Victoria: attach the planning property report',
      when: { jurisdictions: ['VIC'] },
      recommend: ['planning.reportDocument', 'planning.instrument'],
    },
    {
      id: 'REQ-JUR-NSW-001',
      description: 'New South Wales: attach the council planning certificate where obtained',
      when: { jurisdictions: ['NSW'] },
      recommend: ['planning.reportDocument', 'planning.instrument'],
    },
    {
      id: 'REQ-JUR-QLD-001',
      description: 'Queensland: identify the local planning scheme',
      when: { jurisdictions: ['QLD'] },
      recommend: ['planning.instrument'],
    },
  ],
  selectionRules: [
    {
      id: 'SEL-001',
      description: 'Insurance replacement cost of vacant land',
      when: { purposes: ['INSURANCE_REPLACEMENT'], propertyTypes: ['VACANT_LAND'] },
      severity: 'blocking',
      message:
        'Insurance replacement cost requires insurable improvements; it cannot be selected for vacant land.',
    },
    {
      id: 'SEL-002',
      description: 'Rental assessment of vacant land',
      when: { purposes: ['RENTAL_ASSESSMENT'], propertyTypes: ['VACANT_LAND'] },
      severity: 'warning',
      message:
        'Ground rent assessment: confirm the methodology and lease terms with the instructing party.',
    },
    {
      id: 'SEL-003',
      description: 'Family law at desktop scope',
      when: { purposes: ['FAMILY_LAW'], scopes: ['DESKTOP'] },
      severity: 'warning',
      message:
        'Desktop scope is unusual for expert evidence; confirm the instructions and orders permit it.',
      review: 'FAMILY_LAW',
    },
    {
      id: 'SEL-004',
      description: 'Financial reporting at desktop scope',
      when: { purposes: ['FINANCIAL_REPORTING'], scopes: ['DESKTOP'] },
      severity: 'warning',
      message:
        "Confirm desktop scope is consistent with the entity's revaluation policy and inspection cycle.",
      review: 'ACCOUNTING',
    },
    {
      id: 'SEL-005',
      description: 'ACT freehold interest',
      when: {
        jurisdictions: ['ACT'],
        fields: [
          {
            fieldId: 'instruction.interestValued',
            in: ['fee_simple_vacant_possession', 'fee_simple_subject_to_lease'],
          },
        ],
      },
      severity: 'warning',
      message: 'Land in the ACT is generally held under Crown lease: confirm the interest valued.',
      review: 'LEGAL',
    },
    {
      id: 'SEL-006',
      description: 'Family law in Western Australia',
      when: { purposes: ['FAMILY_LAW'], jurisdictions: ['WA'] },
      severity: 'warning',
      message:
        'Family-law proceedings in Western Australia are generally heard by the Family Court of Western Australia: confirm the court and applicable expert rules.',
      review: 'FAMILY_LAW',
    },
    {
      id: 'SEL-007',
      description: 'Retrospective valuation with a current inspection',
      when: { retrospective: true, scopes: ['FULL', 'KERBSIDE', 'RESTRICTED'] },
      severity: 'warning',
      message:
        'The inspection records present condition: document known differences between the inspection date and the valuation date.',
    },
    {
      id: 'SEL-008',
      description: 'Specialised asset at desktop scope',
      when: { propertyTypes: ['SPECIALISED_MIXED_USE'], scopes: ['DESKTOP'] },
      severity: 'warning',
      message:
        'Specialised assets generally require inspection; record why desktop scope is suitable.',
    },
    {
      id: 'SEL-010',
      description: 'Insurance assessment for a unit',
      when: { purposes: ['INSURANCE_REPLACEMENT'], propertyTypes: ['RESIDENTIAL_UNIT'] },
      severity: 'warning',
      message:
        'Strata buildings are usually insured by the owners corporation or body corporate. Confirm whether the instruction covers the whole scheme or only the lot owner’s improvements.',
      review: 'QUANTITY_SURVEYOR',
    },
    {
      id: 'SEL-009',
      description: 'Insurance assessment at desktop scope',
      when: { purposes: ['INSURANCE_REPLACEMENT'], scopes: ['DESKTOP'] },
      severity: 'warning',
      message:
        'Desktop replacement cost relies on supplied areas and construction details; disclose this limitation.',
    },
  ],
};

/**
 * Picks the rule set effective on `date`. Only approved versions qualify unless `allowDraft`
 * (non-production environments) is set; among candidates the latest `effectiveFrom` wins.
 */
export function selectRuleSet(
  versions: readonly RuleSetVersion[],
  date: LocalDate,
  options: { allowDraft?: boolean } = {},
): RuleSetVersion | undefined {
  const eligible = versions.filter(
    (v) =>
      (v.status === 'approved' ||
        (options.allowDraft === true && (v.status === 'draft' || v.status === 'in_review'))) &&
      compareDates(v.effectiveFrom, date) <= 0 &&
      (v.effectiveTo === undefined || compareDates(date, v.effectiveTo) <= 0),
  );
  return eligible.sort((a, b) => compareDates(b.effectiveFrom, a.effectiveFrom))[0];
}
