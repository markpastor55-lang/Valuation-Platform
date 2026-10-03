import type { SectionId } from './sections.js';
import type { PropertyType, SpecialistReviewer } from './codes.js';

export type FieldType =
  | 'text'
  | 'longtext'
  | 'date'
  | 'number'
  | 'integer'
  | 'money'
  | 'area'
  | 'length'
  | 'ratio'
  | 'enum'
  | 'multi_enum'
  | 'boolean'
  | 'user_ref'
  | 'document_refs'
  | 'datasource_refs'
  | 'address'
  | 'coordinates'
  | 'list'
  | 'evidence_list'
  | 'calculation_ref'
  | 'area_schedule_ref';

export interface FieldDef {
  readonly id: string;
  readonly label: string;
  readonly section: SectionId;
  /** `job` fields are captured once per job; `asset` fields once per asset in the job. */
  readonly level: 'job' | 'asset';
  readonly type: FieldType;
  readonly options?: readonly string[];
  readonly unit?: string;
  /** Personal information under the Privacy Act — masked in logs and restricted in exports. */
  readonly personal?: boolean;
  readonly help?: string;
  /** Specialist review needed before the field's wording or options are relied upon. */
  readonly review?: SpecialistReviewer;
  /**
   * `system`: filled by the platform (assignments, job dates, geocoding), shown read-only and never
   * typed by the valuer.
   */
  readonly entry?: 'system';
}

type Extra = Omit<FieldDef, 'id' | 'label' | 'section' | 'level' | 'type'>;

const job = (
  id: string,
  label: string,
  section: SectionId,
  type: FieldType,
  extra: Extra = {},
): FieldDef => ({
  id,
  label,
  section,
  level: 'job',
  type,
  ...extra,
});

const asset = (
  id: string,
  label: string,
  section: SectionId,
  type: FieldType,
  extra: Extra = {},
): FieldDef => ({
  id,
  label,
  section,
  level: 'asset',
  type,
  ...extra,
});

export const BASIS_OF_VALUE_OPTIONS = [
  'market_value',
  'market_rent',
  'fair_value',
  'replacement_cost',
  'reinstatement_cost',
  'other',
] as const;

export const INTEREST_VALUED_OPTIONS = [
  'fee_simple_vacant_possession',
  'fee_simple_subject_to_lease',
  'strata_lot',
  'crown_leasehold',
  'leasehold',
  'other',
] as const;

export const CONFLICT_CHECK_OPTIONS = [
  'no_conflict',
  'conflict_disclosed_managed',
  'conflict_declined',
] as const;

export const ESCALATION_OPTIONS = [
  'not_required',
  'escalated_to_full_inspection',
  'proceed_with_justification',
] as const;

export const OCCUPANCY_OPTIONS = ['owner_occupied', 'vacant', 'leased', 'part_leased'] as const;

export const APPROACH_OPTIONS = [
  'direct_comparison',
  'capitalisation',
  'discounted_cash_flow',
  'summation',
  'hypothetical_development',
  'replacement_cost',
  'profits',
] as const;

export const COURT_OPTIONS = [
  'FCFCOA_DIVISION_1',
  'FCFCOA_DIVISION_2',
  'FAMILY_COURT_OF_WA',
  'OTHER',
] as const;

/** How a unit or lot is held. Strata, community and stratum titles bring the owners corporation questions. */
export const TITLE_TYPE_OPTIONS = [
  'strata_title',
  'community_title',
  'stratum_title',
  'company_title',
  'torrens_title',
] as const;

export const UNIT_TYPE_OPTIONS = [
  'apartment',
  'townhouse',
  'villa_unit',
  'duplex',
  'studio_apartment',
] as const;

export const UNIT_AREA_SOURCE_OPTIONS = [
  'strata_plan',
  'measured_on_site',
  'plans_supplied',
  'marketing_material',
] as const;

export const MEASUREMENT_BASIS_OPTIONS = [
  'GFA',
  'GBA',
  'GLA',
  'NLA',
  'BUILDING_AREA',
  'SITE_COVERAGE',
  'OTHER',
] as const;

/**
 * Field catalogue v1. Field ids are persisted: never rename, only deprecate and add.
 * Wording of labels for legally sensitive fields carries a review tag.
 */
export const FIELD_CATALOGUE: readonly FieldDef[] = [
  // ── Instruction and engagement ────────────────────────────────────────────────
  job('instruction.clientEntity', 'Client', 'instructions', 'text', {
    help: 'Who instructs and pays, e.g. the lender, the owner or their tax agent',
  }),
  job('instruction.instructingParty', 'Instructing party', 'instructions', 'text', {
    personal: true,
  }),
  job('instruction.intendedUsers', 'Intended users', 'instructions', 'list'),
  job('instruction.intendedUse', 'Intended use', 'instructions', 'longtext'),
  job('instruction.basisOfValue', 'Basis of value', 'basis', 'enum', {
    options: BASIS_OF_VALUE_OPTIONS,
  }),
  job('instruction.interestValued', 'Interest valued', 'basis', 'enum', {
    options: INTEREST_VALUED_OPTIONS,
  }),
  asset('instruction.ownership', 'Registered proprietor(s)', 'location', 'text', {
    personal: true,
  }),
  job('instruction.feeBasis', 'Fee basis', 'instructions', 'text'),
  job('instruction.conflictCheck', 'Conflict of interest check', 'instructions', 'enum', {
    options: CONFLICT_CHECK_OPTIONS,
  }),
  job(
    'instruction.conflictDisclosure',
    'Conflict disclosure and management',
    'instructions',
    'longtext',
  ),
  job('instruction.responsibleValuer', 'Responsible valuer', 'instructions', 'user_ref', {
    entry: 'system',
  }),
  job('instruction.reviewer', 'QA reviewer', 'instructions', 'user_ref', { entry: 'system' }),
  job('instruction.dueDate', 'Due date', 'instructions', 'date', { entry: 'system' }),
  job('instruction.engagementDocuments', 'Engagement documents', 'instructions', 'document_refs'),
  job('instruction.reliance', 'Reliance and third-party limitation', 'assumptions', 'longtext', {
    review: 'LEGAL',
  }),
  job('instruction.confidentiality', 'Confidentiality', 'assumptions', 'longtext', {
    review: 'LEGAL',
  }),

  // ── Key dates ────────────────────────────────────────────────────────────────
  job('dates.instruction', 'Date of instruction', 'basis', 'date', { entry: 'system' }),
  job('dates.inspection', 'Date of inspection', 'basis', 'date'),
  job('dates.valuation', 'Date of valuation', 'basis', 'date'),
  job('dates.researchCutOff', 'Research cut-off date', 'basis', 'date'),
  job('dates.review', 'Date of review', 'basis', 'date'),
  job('dates.issue', 'Date of issue', 'basis', 'date'),
  job('dates.retrospectiveDataCutOff', 'Information cut-off date', 'retrospective', 'date', {
    help: 'Only information known or reasonably foreseeable at this date may be relied on.',
  }),

  // ── Scope ────────────────────────────────────────────────────────────────────
  asset('scope.areasInspected', 'Areas inspected', 'scope', 'longtext'),
  asset('scope.areasNotInspected', 'Areas not inspected', 'restricted_access', 'longtext'),
  asset('scope.accessAttempts', 'Access attempts', 'restricted_access', 'longtext'),
  asset(
    'scope.obstructionNotes',
    'Obstruction and visibility notes',
    'restricted_access',
    'longtext',
  ),
  asset(
    'scope.internalConditionAssumption',
    'Assumption about internal condition',
    'restricted_access',
    'longtext',
  ),
  asset('scope.escalationDecision', 'Escalation decision', 'scope', 'enum', {
    options: ESCALATION_OPTIONS,
  }),
  asset(
    'scope.escalationJustification',
    'Justification for proceeding without escalation',
    'scope',
    'longtext',
  ),
  asset(
    'desktop.dataSourceRegister',
    'Data-source register',
    'desktop_data_register',
    'datasource_refs',
  ),
  asset('desktop.imageryDates', 'Imagery dates relied on', 'desktop_data_register', 'list'),
  asset('desktop.informationGaps', 'Information gaps', 'desktop_data_register', 'longtext'),
  asset(
    'desktop.confidenceStatement',
    'Confidence and limitation statement',
    'desktop_data_register',
    'longtext',
  ),

  // ── Location and title ───────────────────────────────────────────────────────
  asset('location.address', 'Address', 'location', 'address'),
  asset('location.titleReference', 'Title reference (lot/plan)', 'location', 'text'),
  asset('location.lga', 'Council', 'location', 'text'),
  asset('location.coordinates', 'Latitude / longitude', 'location', 'coordinates', {
    entry: 'system',
  }),
  asset('location.geocodeConfidence', 'Geocode confidence', 'location', 'ratio'),

  // ── Planning ─────────────────────────────────────────────────────────────────
  asset('planning.zone', 'Zone', 'planning', 'text'),
  asset('planning.overlays', 'Overlays', 'planning', 'list'),
  asset('planning.instrument', 'Planning scheme / instrument', 'planning', 'text'),
  asset('planning.permissibleUses', 'Permissible uses', 'planning', 'list'),
  asset('planning.prohibitedUses', 'Prohibited uses', 'planning', 'list'),
  asset('planning.source', 'Planning data source', 'planning', 'datasource_refs'),
  asset(
    'planning.reportDocument',
    'Planning certificate / property report',
    'planning',
    'document_refs',
  ),
  asset('planning.useCompliance', 'Zoning / use compliance commentary', 'planning', 'longtext'),

  // ── Land ─────────────────────────────────────────────────────────────────────
  asset('land.area', 'Site area', 'land', 'area', { unit: 'm2' }),
  asset('land.areaSource', 'Site area source', 'land', 'text'),
  asset('land.dimensions', 'Dimensions', 'land', 'text'),
  asset('land.frontage', 'Frontage', 'land', 'length', { unit: 'm' }),
  asset('land.shape', 'Shape', 'land', 'text'),
  asset('land.topography', 'Topography', 'land', 'text'),
  asset('land.access', 'Access', 'land', 'text'),
  asset('land.services', 'Services', 'land', 'list'),
  asset('land.easements', 'Easements and encumbrances', 'land', 'longtext'),
  asset(
    'land.environmental',
    'Environmental constraints (flood, bushfire, contamination)',
    'land',
    'longtext',
  ),
  asset('land.developmentPotential', 'Development potential', 'land', 'longtext'),

  // ── Improvements ─────────────────────────────────────────────────────────────
  // ── Units, apartments and townhouses ─────────────────────────────────────────
  asset('unit.unitType', 'Unit type', 'improvements', 'enum', { options: UNIT_TYPE_OPTIONS }),
  asset('unit.level', 'Floor level', 'improvements', 'integer', { help: '0 for ground level' }),
  asset('unit.internalArea', 'Internal living area', 'improvements', 'area', {
    unit: 'm2',
    help: 'Usually from the strata plan; excludes balconies, courtyards and car spaces',
  }),
  asset('unit.internalAreaSource', 'Internal area source', 'improvements', 'enum', {
    options: UNIT_AREA_SOURCE_OPTIONS,
  }),
  asset('unit.outdoorArea', 'Balcony or courtyard area', 'improvements', 'area', { unit: 'm2' }),
  asset('unit.storage', 'Storage', 'improvements', 'text', { help: 'e.g. storage cage on title' }),
  asset('unit.unitsInComplex', 'Units in the building or complex', 'improvements', 'integer'),
  asset('unit.buildingAmenities', 'Building amenities', 'improvements', 'text', {
    help: 'e.g. lift, pool, gym, concierge',
  }),
  asset('unit.aspect', 'Aspect and outlook', 'improvements', 'text'),

  asset('improvements.dwellingType', 'Dwelling type', 'improvements', 'text'),
  asset('improvements.use', 'Use', 'improvements', 'text'),
  asset('improvements.yearBuilt', 'Year built (approx.)', 'improvements', 'integer'),
  asset('improvements.effectiveAge', 'Effective age (years)', 'improvements', 'integer'),
  asset('improvements.construction', 'Construction', 'improvements', 'longtext'),
  asset('improvements.accommodation', 'Accommodation', 'improvements', 'longtext'),
  asset('improvements.buildingArea', 'Building area', 'improvements', 'area', {
    unit: 'm2',
    help: 'Total building area. The sketch total can be used; the sketch itself is not reported.',
  }),
  asset('improvements.areaSchedule', 'Improvement area schedule', 'areas', 'area_schedule_ref'),
  asset('improvements.measurementBasis', 'Measurement basis', 'areas', 'enum', {
    options: MEASUREMENT_BASIS_OPTIONS,
  }),
  asset('improvements.condition', 'Condition', 'improvements', 'text'),
  asset('improvements.quality', 'Quality', 'improvements', 'text'),
  asset('improvements.renovations', 'Renovations', 'improvements', 'longtext'),
  asset('improvements.fixturesFinishes', 'Fixtures and finishes', 'improvements', 'longtext'),
  asset('improvements.services', 'Building services', 'improvements', 'longtext'),
  asset('improvements.defects', 'Observed defects (visual only)', 'improvements', 'longtext'),
  asset('improvements.functionalUtility', 'Functional utility', 'improvements', 'longtext'),
  asset(
    'improvements.remainingLife',
    'Estimated remaining economic life (years)',
    'improvements',
    'integer',
  ),
  asset('improvements.parking', 'Car parking', 'improvements', 'text'),

  // ── Strata, community, stratum and company title ─────────────────────────────
  asset('strata.titleType', 'Title type', 'strata', 'enum', {
    options: TITLE_TYPE_OPTIONS,
    help: 'Strata, community and stratum titles add the owners corporation questions',
  }),
  asset('strata.planNumber', 'Strata or community plan number', 'strata', 'text', {
    help: 'e.g. SP 12345 (NSW), PS 123456 (VIC), BUP or CTS (QLD)',
  }),
  asset('strata.lotNumber', 'Lot number', 'strata', 'text'),
  asset('strata.unitEntitlement', 'Unit (lot) entitlement', 'strata', 'text', {
    help: 'e.g. 25 of 1,000',
  }),
  asset('strata.ownersCorporation', 'Owners corporation or body corporate', 'strata', 'text'),
  asset('strata.adminLevy', 'Administrative fund levy', 'strata', 'money', {
    unit: 'AUD per year',
  }),
  asset('strata.capitalWorksLevy', 'Capital works or sinking fund levy', 'strata', 'money', {
    unit: 'AUD per year',
  }),
  asset('strata.specialLevies', 'Special levies', 'strata', 'longtext'),
  asset(
    'strata.buildingDefects',
    'Known building defects (incl. combustible cladding)',
    'strata',
    'longtext',
    {
      review: 'API_STANDARDS',
      help: 'From the owners corporation certificate, minutes or your inspection; write "None known" if none',
    },
  ),
  asset('strata.byLaws', 'By-laws affecting value', 'strata', 'longtext', {
    help: 'e.g. pets, short-stay letting, renovations',
  }),
  asset(
    'strata.ownersCorporationCertificate',
    'Owners corporation certificate or strata report',
    'strata',
    'document_refs',
  ),
  asset('strata.companyTitleDetails', 'Company title details', 'strata', 'longtext', {
    review: 'LEGAL',
    help: 'Company, shares held and any restrictions on sale, leasing or lending',
  }),
  asset('improvements.outdoorImprovements', 'Outdoor improvements', 'improvements', 'longtext'),
  asset('improvements.lettableArea', 'Lettable area (NLA/GLA)', 'areas', 'area', { unit: 'm2' }),
  asset('improvements.floorAreas', 'Floor-by-floor areas', 'areas', 'area_schedule_ref'),
  asset('improvements.fitout', 'Fitout', 'improvements', 'longtext'),
  asset('improvements.grade', 'Building grade', 'improvements', 'text', {
    review: 'API_STANDARDS',
  }),
  asset('improvements.warehouseArea', 'Warehouse area', 'areas', 'area', { unit: 'm2' }),
  asset('improvements.officeArea', 'Office area', 'areas', 'area', { unit: 'm2' }),
  asset('improvements.siteCoverage', 'Site coverage', 'areas', 'ratio'),
  asset('improvements.clearance', 'Internal clearance', 'improvements', 'length', { unit: 'm' }),
  asset('improvements.loading', 'Loading and access', 'improvements', 'longtext'),
  asset('improvements.hardstand', 'Hardstand', 'improvements', 'area', { unit: 'm2' }),
  asset('improvements.cranes', 'Cranes', 'improvements', 'text'),
  asset('improvements.power', 'Power supply', 'improvements', 'text'),
  asset('improvements.fireServices', 'Fire services (as observed)', 'improvements', 'text'),
  asset(
    'improvements.functionalObsolescence',
    'Functional obsolescence',
    'improvements',
    'longtext',
  ),

  // ── Specialised / mixed use ──────────────────────────────────────────────────
  asset('specialised.componentSchedule', 'Component schedule', 'specialised', 'list'),
  asset('specialised.allocationMethod', 'Allocation methodology', 'specialised', 'longtext'),
  asset('specialised.licences', 'Specialised licences / operations', 'specialised', 'longtext'),
  asset('specialised.goingConcernBoundary', 'Going-concern boundary', 'specialised', 'longtext', {
    review: 'API_STANDARDS',
  }),
  asset(
    'specialised.specialistReview',
    'Specialist review triggers and outcome',
    'specialised',
    'longtext',
  ),

  // ── Occupancy and tenancy ────────────────────────────────────────────────────
  asset('occupancy.status', 'Occupancy status', 'occupancy', 'enum', {
    options: OCCUPANCY_OPTIONS,
  }),
  asset('occupancy.evidence', 'Occupancy evidence', 'occupancy', 'document_refs', {
    personal: true,
  }),
  asset('occupancy.leaseSummary', 'Lease summary', 'occupancy', 'longtext', { personal: true }),
  asset('tenancy.schedule', 'Tenancy schedule', 'tenancy_schedule', 'list', { personal: true }),
  asset('tenancy.wale', 'WALE', 'tenancy_schedule', 'calculation_ref'),
  asset('tenancy.occupancyRate', 'Occupancy rate', 'tenancy_schedule', 'ratio'),
  asset('tenancy.incentives', 'Incentives', 'tenancy_schedule', 'longtext'),
  asset('tenancy.outgoings', 'Outgoings', 'tenancy_schedule', 'money', { unit: 'AUD/yr' }),
  asset('tenancy.passingIncome', 'Passing income', 'tenancy_schedule', 'money', { unit: 'AUD/yr' }),
  asset('retail.tradeArea', 'Trade area', 'retail_metrics', 'longtext'),
  asset('retail.frontage', 'Retail frontage', 'retail_metrics', 'length', { unit: 'm' }),
  asset('retail.footfall', 'Footfall (where authorised)', 'retail_metrics', 'longtext'),
  asset('retail.centreMetrics', 'Centre metrics (where authorised)', 'retail_metrics', 'longtext'),

  // ── Market commentary and evidence ───────────────────────────────────────────
  job('market.national', 'National market commentary', 'market', 'longtext'),
  job('market.state', 'State market commentary', 'market', 'longtext'),
  asset('market.local', 'Local market commentary', 'market', 'longtext'),
  asset('evidence.sales', 'Sales evidence', 'sales_evidence', 'evidence_list'),
  asset('evidence.rentals', 'Rental / leasing evidence', 'rental_evidence', 'evidence_list'),

  // ── Valuation ────────────────────────────────────────────────────────────────
  asset('valuation.highestAndBestUse', 'Highest and best use', 'hbu', 'longtext'),
  asset('valuation.approaches', 'Approaches applied', 'valuation_approach', 'multi_enum', {
    options: APPROACH_OPTIONS,
  }),
  asset('valuation.primaryApproach', 'Primary approach', 'valuation_approach', 'enum', {
    options: APPROACH_OPTIONS,
  }),
  asset('valuation.crossCheckApproach', 'Cross-check approach', 'valuation_approach', 'enum', {
    options: APPROACH_OPTIONS,
  }),
  asset('valuation.landRate', 'Adopted land rate', 'valuation_approach', 'calculation_ref', {
    unit: 'AUD/m2',
  }),
  asset('valuation.reconciliation', 'Reconciliation', 'reconciliation', 'longtext'),
  asset('valuation.adoptedValue', 'Adopted value', 'reconciliation', 'money', { unit: 'AUD' }),
  asset('valuation.marketability', 'Marketability', 'risk', 'longtext'),
  asset('valuation.riskCommentary', 'Risk commentary', 'risk', 'longtext'),
  asset('income.marketIncome', 'Market income', 'income_approach', 'money', { unit: 'AUD/yr' }),
  asset('income.capRate', 'Capitalisation rate', 'income_approach', 'ratio'),
  asset('income.discountRate', 'Discount rate', 'income_approach', 'ratio'),
  asset('income.terminalYield', 'Terminal yield', 'income_approach', 'ratio'),
  job(
    'portfolio.aggregationBasis',
    'Portfolio aggregation basis',
    'portfolio_summary',
    'longtext',
    {
      review: 'API_STANDARDS',
    },
  ),
  job('portfolio.summarySchedule', 'Portfolio summary schedule', 'portfolio_summary', 'list'),

  // ── Assumptions and limitations ──────────────────────────────────────────────
  job('assumptions.general', 'Assumptions', 'assumptions', 'list'),
  job('assumptions.special', 'Special assumptions', 'assumptions', 'list'),
  job('assumptions.limitations', 'Limitations', 'assumptions', 'list'),
  job(
    'assumptions.materialUncertainty',
    'Material valuation uncertainty statement',
    'assumptions',
    'longtext',
    {
      review: 'API_STANDARDS',
    },
  ),

  // ── Capital gains tax ─────────────────────────────────────────────────────────
  // The client instructs; there is no separate tax-agent field.
  job('cgt.taxEvent', 'Reason for the valuation (CGT event)', 'tax_context', 'text', {
    review: 'TAX',
    help: 'As advised by the client, e.g. property becoming income-producing',
  }),

  // ── Retrospective valuations (any purpose; derived from the dates) ────────────
  job(
    'retro.evidenceBasis',
    'How the property and market at the valuation date were established',
    'retrospective',
    'longtext',
    { review: 'API_STANDARDS' },
  ),
  job('retro.chronology', 'Key events since the valuation date', 'retrospective', 'list', {
    help: 'e.g. renovations, subdivision, change of use',
  }),
  job('retro.sourceArchive', 'Archived sources relied on', 'retrospective', 'document_refs'),

  // ── Family law ───────────────────────────────────────────────────────────────
  job('fl.court', 'Court', 'expert_compliance', 'enum', {
    options: COURT_OPTIONS,
    review: 'FAMILY_LAW',
  }),
  job('fl.proceedingNumber', 'Proceeding / file number', 'expert_compliance', 'text', {
    personal: true,
  }),
  job('fl.parties', 'Parties', 'expert_compliance', 'list', { personal: true }),
  job('fl.ordersOrQuestions', 'Orders / questions to be answered', 'expert_compliance', 'longtext'),
  job('fl.singleExpert', 'Single expert status', 'expert_compliance', 'boolean', {
    review: 'FAMILY_LAW',
  }),
  job(
    'fl.expertCodeAcknowledged',
    'Expert code / practice direction acknowledged',
    'expert_compliance',
    'boolean',
    {
      review: 'FAMILY_LAW',
    },
  ),
  job(
    'fl.instructionsReceived',
    'Letter of instruction and documents received',
    'expert_compliance',
    'document_refs',
  ),
  job('fl.documentsReliedOn', 'Documents relied on', 'expert_compliance', 'list'),
  job('fl.independenceDeclaration', 'Independence declaration', 'expert_compliance', 'longtext', {
    review: 'FAMILY_LAW',
  }),
  job('fl.reasons', 'Reasons for opinion', 'expert_compliance', 'longtext'),
  job('fl.declaration', 'Expert declaration', 'expert_compliance', 'longtext', {
    review: 'FAMILY_LAW',
  }),
  job(
    'fl.conferenceOrJointStatement',
    'Expert conference / joint statement (if ordered)',
    'expert_compliance',
    'longtext',
  ),

  // ── Financial reporting (AASB 13) ────────────────────────────────────────────
  job('fr.accountingStandard', 'Applicable accounting standard', 'fair_value', 'text', {
    help: 'Default "AASB 13 Fair Value Measurement"; configurable.',
    review: 'ACCOUNTING',
  }),
  job('fr.reportingEntity', 'Reporting entity', 'fair_value', 'text'),
  job('fr.reportingDate', 'Reporting date', 'fair_value', 'date'),
  asset('fr.unitOfAccount', 'Unit of account', 'fair_value', 'text', { review: 'ACCOUNTING' }),
  asset('fr.principalMarket', 'Principal (or most advantageous) market', 'fair_value', 'text', {
    review: 'ACCOUNTING',
  }),
  asset(
    'fr.marketParticipantAssumptions',
    'Market-participant assumptions',
    'fair_value',
    'longtext',
  ),
  asset('fr.valuationPremise', 'Valuation premise', 'fair_value', 'text', { review: 'ACCOUNTING' }),
  asset('fr.valuationTechnique', 'Valuation technique(s)', 'fair_value', 'text'),
  asset('fr.significantInputs', 'Significant inputs and observability', 'fair_value', 'list'),
  asset('fr.fairValueHierarchyLevel', 'Fair-value hierarchy level', 'fair_value', 'enum', {
    options: ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'],
    review: 'ACCOUNTING',
  }),
  asset('fr.sensitivityAnalysis', 'Sensitivity analysis', 'fair_value', 'calculation_ref'),
  job('fr.disclosureSchedule', 'Disclosure-support schedule', 'fair_value', 'list', {
    review: 'ACCOUNTING',
  }),

  // ── Rental assessment ────────────────────────────────────────────────────────
  asset('rent.basis', 'Rent basis', 'rental_determination', 'enum', {
    options: ['gross', 'semi_gross', 'net'],
  }),
  asset('rent.reviewDate', 'Rent review date', 'rental_determination', 'date'),
  asset('rent.reviewMechanism', 'Review mechanism', 'rental_determination', 'text', {
    review: 'LEGAL',
  }),
  asset('rent.leaseArea', 'Lease area', 'rental_determination', 'area', { unit: 'm2' }),
  asset('rent.permittedUse', 'Permitted use', 'rental_determination', 'text'),
  asset('rent.incentives', 'Incentives', 'rental_determination', 'longtext'),
  asset('rent.outgoings', 'Outgoings', 'rental_determination', 'money', { unit: 'AUD/yr' }),
  asset('rent.termAndOptions', 'Term and options', 'rental_determination', 'text'),
  asset('rent.vacancy', 'Vacancy allowance / commentary', 'rental_determination', 'longtext'),
  asset('rent.faceRent', 'Face rent', 'rental_determination', 'money', { unit: 'AUD/yr' }),
  asset('rent.effectiveRent', 'Effective rent', 'rental_determination', 'calculation_ref', {
    unit: 'AUD/yr',
  }),
  asset('rent.ratePerM2', 'Rate per m²', 'rental_determination', 'calculation_ref', {
    unit: 'AUD/m2/yr',
  }),
  asset('rent.adoptedMarketRent', 'Adopted market rent', 'rental_determination', 'money', {
    unit: 'AUD/yr',
  }),

  // ── Insurance / replacement cost ─────────────────────────────────────────────
  asset('ins.basis', 'Replacement or reinstatement basis', 'insurance', 'enum', {
    options: ['replacement', 'reinstatement'],
    review: 'QUANTITY_SURVEYOR',
  }),
  asset('ins.constructionType', 'Construction type', 'insurance', 'text'),
  asset('ins.quality', 'Quality of finish', 'insurance', 'text'),
  asset('ins.services', 'Services', 'insurance', 'longtext'),
  asset(
    'ins.costDataSource',
    'Cost data source (edition, locality, date)',
    'insurance',
    'datasource_refs',
    {
      review: 'DATA_LICENSING',
    },
  ),
  asset('ins.demolitionDebris', 'Demolition and debris removal', 'insurance', 'money', {
    unit: 'AUD',
  }),
  asset('ins.professionalFees', 'Professional fees', 'insurance', 'ratio'),
  asset('ins.escalation', 'Escalation', 'insurance', 'ratio'),
  asset('ins.leadTimeMonths', 'Lead time and rebuild period (months)', 'insurance', 'integer'),
  asset('ins.codeUpgradeAllowance', 'Code-upgrade allowance', 'insurance', 'money', {
    unit: 'AUD',
  }),
  asset('ins.locationFactor', 'Regional / location factor', 'insurance', 'number'),
  asset('ins.gstTreatment', 'GST treatment', 'insurance', 'enum', {
    options: ['inclusive', 'exclusive'],
    review: 'TAX',
  }),
  asset('ins.exclusions', 'Exclusions', 'insurance', 'longtext'),
  asset('ins.sumInsured', 'Recommended sum insured', 'insurance', 'calculation_ref', {
    unit: 'AUD',
  }),
];

export const FIELD_BY_ID: ReadonlyMap<string, FieldDef> = new Map(
  FIELD_CATALOGUE.map((f) => [f.id, f]),
);

export function getField(id: string): FieldDef {
  const field = FIELD_BY_ID.get(id);
  if (!field) throw new Error(`unknown field id ${id}`);
  return field;
}

/** True when a captured value satisfies a requirement (non-empty). */
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * Sections holding the valuer's professional judgement (evidence selection, approaches, rates,
 * reconciliation, conclusions). Writing these fields requires `valuation.edit`, which only valuers
 * hold; inspectors capture descriptive facts only.
 */
export const VALUER_JUDGEMENT_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>([
  'market',
  'hbu',
  'sales_evidence',
  'rental_evidence',
  'valuation_approach',
  'income_approach',
  'cost_approach',
  'rental_determination',
  'insurance',
  'fair_value',
  'reconciliation',
  'portfolio_summary',
  'risk',
  'specialised',
]);

/** The area field a sketch total can fill: internal area for units, building area otherwise. */
export const sketchAreaFieldFor = (propertyType: PropertyType): string =>
  propertyType === 'RESIDENTIAL_UNIT' ? 'unit.internalArea' : 'improvements.buildingArea';

export const isValuerJudgementField = (def: FieldDef): boolean =>
  VALUER_JUDGEMENT_SECTIONS.has(def.section);

const isLocalDateString = (v: unknown): boolean =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Type-checks a captured value against its field definition. Returns a problem or undefined. */
export function fieldValueProblem(def: FieldDef, value: unknown): string | undefined {
  if (value === null) return undefined; // clearing a value is always allowed
  const finite = typeof value === 'number' && Number.isFinite(value);
  switch (def.type) {
    case 'text':
    case 'longtext':
    case 'user_ref':
    case 'calculation_ref':
    case 'area_schedule_ref':
      return typeof value === 'string' ? undefined : 'expected text';
    case 'date':
      return isLocalDateString(value) ? undefined : 'expected a date (YYYY-MM-DD)';
    case 'integer':
      return finite && Number.isInteger(value) ? undefined : 'expected a whole number';
    case 'number':
      return finite ? undefined : 'expected a number';
    case 'money':
    case 'area':
    case 'length':
      return finite && value >= 0 ? undefined : 'expected a non-negative number';
    case 'ratio':
      return finite && value >= 0 && value <= 1 ? undefined : 'expected a ratio between 0 and 1';
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'expected true or false';
    case 'enum':
      return typeof value === 'string' && (def.options ?? []).includes(value)
        ? undefined
        : `expected one of ${(def.options ?? []).join(', ')}`;
    case 'multi_enum':
      return Array.isArray(value) &&
        value.every((v) => typeof v === 'string' && (def.options ?? []).includes(v))
        ? undefined
        : `expected a list drawn from ${(def.options ?? []).join(', ')}`;
    case 'list':
    case 'document_refs':
    case 'datasource_refs':
    case 'evidence_list':
      return Array.isArray(value) ? undefined : 'expected a list';
    case 'address':
      return typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>)['formatted'] === 'string'
        ? undefined
        : 'expected an address with a formatted line';
    case 'coordinates': {
      const c = value as { lat?: unknown; lng?: unknown };
      return typeof c === 'object' &&
        typeof c.lat === 'number' &&
        typeof c.lng === 'number' &&
        Math.abs(c.lat) <= 90 &&
        Math.abs(c.lng) <= 180
        ? undefined
        : 'expected { lat, lng }';
    }
  }
}
