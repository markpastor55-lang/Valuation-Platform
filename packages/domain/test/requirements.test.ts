import { describe, expect, it } from 'vitest';
import {
  AU_CORE_RULE_SET,
  INSPECTION_SCOPES,
  JURISDICTIONS,
  PROPERTY_TYPES,
  REPORT_PURPOSES,
  diffRequirements,
  findMissingFields,
  lintRuleSet,
  resolveRequirements,
  retrospectiveStatus,
  selectRuleSet,
  type FieldValues,
  type JobSelection,
  type RuleSetVersion,
} from '../src/index.js';

const base: JobSelection = {
  jurisdiction: 'VIC',
  purpose: 'MARKET_VALUE',
  propertyType: 'RESIDENTIAL',
  scope: 'FULL',
  mode: 'SINGLE',
};

const required = (s: JobSelection, values?: FieldValues) =>
  resolveRequirements(s, AU_CORE_RULE_SET, values)
    .fields.filter((f) => f.level === 'required')
    .map((f) => f.fieldId);

describe('rule set integrity', () => {
  it('references only catalogued fields and has unique rule ids', () => {
    expect(lintRuleSet(AU_CORE_RULE_SET)).toEqual([]);
  });

  it('resolves every purpose × property type × scope × jurisdiction combination', () => {
    let combos = 0;
    for (const jurisdiction of JURISDICTIONS)
      for (const purpose of REPORT_PURPOSES)
        for (const propertyType of PROPERTY_TYPES)
          for (const scope of INSPECTION_SCOPES) {
            const r = resolveRequirements(
              { jurisdiction, purpose, propertyType, scope, mode: 'SINGLE' },
              AU_CORE_RULE_SET,
            );
            expect(r.sections).toContain('certification');
            expect(r.fields.length).toBeGreaterThan(10);
            combos++;
          }
    expect(combos).toBe(8 * 6 * 6 * 4);
  });
});

describe('purpose drives requirements', () => {
  it('market value requires HBU, approaches, sales evidence and reconciliation', () => {
    const f = required(base);
    expect(f).toEqual(
      expect.arrayContaining([
        'instruction.basisOfValue',
        'dates.valuation',
        'instruction.interestValued',
        'valuation.highestAndBestUse',
        'valuation.approaches',
        'evidence.sales',
        'valuation.reconciliation',
        'valuation.marketability',
      ]),
    );
  });

  it('CGT adds the CGT event; the client instructs, so there is no tax-agent field', () => {
    const current: FieldValues = {
      job: { 'dates.inspection': '2026-09-30', 'dates.valuation': '2026-09-30' },
      assets: {},
    };
    const r = resolveRequirements({ ...base, purpose: 'CGT' }, AU_CORE_RULE_SET, current);
    const f = r.fields.filter((x) => x.level === 'required').map((x) => x.fieldId);
    expect(f).toContain('cgt.taxEvent');
    expect(f).toContain('instruction.clientEntity');
    expect(r.fields.map((x) => x.fieldId).some((id) => id.startsWith('retro.'))).toBe(false);
    expect(r.retrospective).toBe(false);
    expect(r.specialistReviews).toContain('TAX');
    expect(r.sections).toContain('tax_context');
    expect(r.sections).not.toContain('retrospective');
  });

  it('derives a retrospective valuation from the dates, for any purpose', () => {
    const dated = (valuation: string, inspection?: string): FieldValues => ({
      job: {
        'dates.valuation': valuation,
        'dates.instruction': '2026-09-25',
        ...(inspection ? { 'dates.inspection': inspection } : {}),
      },
      assets: {},
    });
    for (const purpose of ['CGT', 'FAMILY_LAW', 'MARKET_VALUE'] as const) {
      const r = resolveRequirements(
        { ...base, purpose },
        AU_CORE_RULE_SET,
        dated('2020-07-01', '2026-09-30'),
      );
      expect(r.retrospective).toBe(true);
      expect(r.fields.find((x) => x.fieldId === 'retro.evidenceBasis')?.level).toBe('required');
      expect(r.sections).toContain('retrospective');
      expect(r.warnings.map((w) => w.code)).toContain('W-RETRO-HINDSIGHT');
    }
    // Same-day valuation is current; desktop jobs compare with the instruction date
    expect(retrospectiveStatus(dated('2026-09-30', '2026-09-30')).retrospective).toBe(false);
    expect(retrospectiveStatus(dated('2026-09-01')).comparedWith?.fieldId).toBe(
      'dates.instruction',
    );
    expect(retrospectiveStatus(dated('2026-09-01')).retrospective).toBe(true);
    expect(retrospectiveStatus({ job: {}, assets: {} }).retrospective).toBe(false);
  });

  it('family law requires expert matters and flags legal review', () => {
    const r = resolveRequirements({ ...base, purpose: 'FAMILY_LAW' }, AU_CORE_RULE_SET);
    const f = r.fields.filter((x) => x.level === 'required').map((x) => x.fieldId);
    expect(f).toEqual(
      expect.arrayContaining([
        'fl.court',
        'fl.expertCodeAcknowledged',
        'fl.singleExpert',
        'fl.declaration',
      ]),
    );
    expect(r.specialistReviews).toContain('FAMILY_LAW');
    expect(r.warnings.map((w) => w.code)).toContain('W-FL-LEGAL-REVIEW');
  });

  it('financial reporting requires AASB 13 inputs including hierarchy level and sensitivity', () => {
    const f = required({
      ...base,
      purpose: 'FINANCIAL_REPORTING',
      propertyType: 'COMMERCIAL_OFFICE',
    });
    expect(f).toEqual(
      expect.arrayContaining([
        'fr.accountingStandard',
        'fr.unitOfAccount',
        'fr.principalMarket',
        'fr.fairValueHierarchyLevel',
        'fr.sensitivityAnalysis',
        'tenancy.wale',
        'income.capRate',
      ]),
    );
  });

  it('insurance requires cost build-up fields but not income analytics', () => {
    const f = required({
      ...base,
      purpose: 'INSURANCE_REPLACEMENT',
      propertyType: 'COMMERCIAL_OFFICE',
    });
    expect(f).toEqual(
      expect.arrayContaining(['ins.sumInsured', 'ins.costDataSource', 'ins.gstTreatment']),
    );
    expect(f).not.toContain('tenancy.wale');
    expect(f).not.toContain('evidence.sales');
  });

  it('rental assessment requires face/effective rent and rental evidence', () => {
    const f = required({
      ...base,
      purpose: 'RENTAL_ASSESSMENT',
      propertyType: 'COMMERCIAL_RETAIL',
    });
    expect(f).toEqual(
      expect.arrayContaining([
        'rent.faceRent',
        'rent.effectiveRent',
        'rent.adoptedMarketRent',
        'evidence.rentals',
      ]),
    );
  });
});

describe('scope drives requirements', () => {
  it('desktop scope drops inspection date and requires the data-source register', () => {
    const f = required({ ...base, scope: 'DESKTOP' });
    expect(f).not.toContain('dates.inspection');
    expect(f).toEqual(
      expect.arrayContaining(['desktop.dataSourceRegister', 'desktop.confidenceStatement']),
    );
  });

  it('kerbside scope requires areas not inspected and an internal-condition assumption', () => {
    const r = resolveRequirements({ ...base, scope: 'KERBSIDE' }, AU_CORE_RULE_SET);
    expect(r.fields.map((f) => f.fieldId)).toEqual(
      expect.arrayContaining(['scope.areasNotInspected', 'scope.internalConditionAssumption']),
    );
    expect(r.sections).toContain('restricted_access');
  });
});

describe('selection rules', () => {
  it('blocks insurance replacement cost for vacant land', () => {
    const r = resolveRequirements(
      { ...base, purpose: 'INSURANCE_REPLACEMENT', propertyType: 'VACANT_LAND' },
      AU_CORE_RULE_SET,
    );
    expect(r.selectionIssues).toContainEqual(
      expect.objectContaining({ ruleId: 'SEL-001', severity: 'blocking' }),
    );
  });

  it('warns about the Family Court of WA for WA family-law jobs', () => {
    const r = resolveRequirements(
      { ...base, jurisdiction: 'WA', purpose: 'FAMILY_LAW' },
      AU_CORE_RULE_SET,
    );
    expect(r.selectionIssues.map((i) => i.ruleId)).toContain('SEL-006');
  });

  it('warns about Crown leasehold only when a fee simple interest is selected in the ACT', () => {
    const s = { ...base, jurisdiction: 'ACT' as const };
    expect(
      resolveRequirements(s, AU_CORE_RULE_SET).selectionIssues.map((i) => i.ruleId),
    ).not.toContain('SEL-005');
    const values: FieldValues = {
      job: { 'instruction.interestValued': 'fee_simple_vacant_possession' },
      assets: {},
    };
    expect(
      resolveRequirements(s, AU_CORE_RULE_SET, values).selectionIssues.map((i) => i.ruleId),
    ).toContain('SEL-005');
  });
});

describe('conditional requirements', () => {
  it('requires lease facts only for leased assets', () => {
    const values: FieldValues = {
      job: {},
      assets: {
        a1: { 'occupancy.status': 'leased' },
        a2: { 'occupancy.status': 'owner_occupied' },
      },
    };
    const r = resolveRequirements(base, AU_CORE_RULE_SET, values);
    const lease = r.fields.find((f) => f.fieldId === 'occupancy.leaseSummary');
    expect(lease).toMatchObject({ level: 'required', assetIds: ['a1'] });
    const missing = findMissingFields(r, values).filter(
      (m) => m.fieldId === 'occupancy.leaseSummary',
    );
    expect(missing.map((m) => m.assetId)).toEqual(['a1']);
  });

  it('requires a conflict disclosure when a conflict is disclosed and managed', () => {
    const values: FieldValues = {
      job: { 'instruction.conflictCheck': 'conflict_disclosed_managed' },
      assets: {},
    };
    expect(required(base, values)).toContain('instruction.conflictDisclosure');
    expect(required(base)).not.toContain('instruction.conflictDisclosure');
  });

  it('requires DCF inputs when DCF is selected as an approach', () => {
    const values: FieldValues = {
      job: {},
      assets: { a1: { 'valuation.approaches': ['direct_comparison', 'discounted_cash_flow'] } },
    };
    expect(required(base, values)).toEqual(
      expect.arrayContaining(['income.discountRate', 'income.terminalYield']),
    );
  });

  it('a required rule upgrades a recommendation', () => {
    const r = resolveRequirements({ ...base, purpose: 'FINANCIAL_REPORTING' }, AU_CORE_RULE_SET);
    // evidence.sales is only recommended for FR residential
    expect(r.fields.find((f) => f.fieldId === 'evidence.sales')?.level).toBe('recommended');
    const mv = resolveRequirements(base, AU_CORE_RULE_SET);
    expect(mv.fields.find((f) => f.fieldId === 'evidence.sales')).toMatchObject({
      level: 'required',
      ruleIds: ['REQ-PUR-MV-001'],
    });
  });
});

describe('completeness and change of selection', () => {
  const values: FieldValues = {
    job: {
      'instruction.clientEntity': 'Example Pty Ltd',
      'cgt.taxEvent': 'CGT event A1',
      'retro.chronology': ['2001 acquisition'],
      'assumptions.general': [],
    },
    assets: { a1: { 'land.area': 650, 'improvements.dwellingType': '  ' } },
  };

  it('treats empty strings, whitespace and empty lists as missing', () => {
    const r = resolveRequirements(base, AU_CORE_RULE_SET, values);
    const missing = findMissingFields(r, values);
    const ids = missing.map((m) => `${m.assetId ?? 'job'}:${m.fieldId}`);
    expect(ids).toContain('job:assumptions.general');
    expect(ids).toContain('a1:improvements.dwellingType');
    expect(ids).not.toContain('job:instruction.clientEntity');
    expect(ids).not.toContain('a1:land.area');
  });

  it('changing purpose updates requirements and sections without losing captured data', () => {
    const cgt = resolveRequirements({ ...base, purpose: 'CGT' }, AU_CORE_RULE_SET, values);
    const mv = resolveRequirements(base, AU_CORE_RULE_SET, values);
    const diff = diffRequirements(cgt, mv, values);
    expect(diff.noLongerRequired).toEqual(expect.arrayContaining(['cgt.taxEvent']));
    expect(diff.newlyRequired).toEqual(expect.arrayContaining(['valuation.marketability']));
    expect(diff.sectionsRemoved).toContain('tax_context');
    expect(diff.sectionsAdded).toContain('risk');
    expect(diff.retainedValues).toEqual(
      expect.arrayContaining([
        { fieldId: 'cgt.taxEvent', assetId: null },
        { fieldId: 'retro.chronology', assetId: null },
      ]),
    );
    // values object is untouched
    expect(values.job['cgt.taxEvent']).toBe('CGT event A1');
    const back = diffRequirements(mv, cgt, values);
    expect(back.newlyRequired).toContain('cgt.taxEvent');
  });

  it('is deterministic', () => {
    const a = resolveRequirements(base, AU_CORE_RULE_SET, values);
    const b = resolveRequirements(base, AU_CORE_RULE_SET, values);
    expect(a).toEqual(b);
  });
});

describe('rule set versioning', () => {
  const approved: RuleSetVersion = { ...AU_CORE_RULE_SET, version: '2026.1', status: 'approved' };
  const next: RuleSetVersion = {
    ...AU_CORE_RULE_SET,
    version: '2026.2',
    status: 'approved',
    effectiveFrom: '2026-07-01',
  };

  it('selects the approved version effective on the date', () => {
    expect(selectRuleSet([approved, next], '2026-03-01')?.version).toBe('2026.1');
    expect(selectRuleSet([approved, next], '2026-07-01')?.version).toBe('2026.2');
  });

  it('ignores drafts unless explicitly allowed', () => {
    expect(selectRuleSet([AU_CORE_RULE_SET], '2026-03-01')).toBeUndefined();
    expect(selectRuleSet([AU_CORE_RULE_SET], '2026-03-01', { allowDraft: true })?.version).toBe(
      '2026.1',
    );
  });

  it('respects effectiveTo', () => {
    const ended: RuleSetVersion = { ...approved, effectiveTo: '2026-06-30' };
    expect(selectRuleSet([ended], '2026-07-01')).toBeUndefined();
  });
});

describe('field value type checks', () => {
  it('validates values against field definitions', async () => {
    const { getField, fieldValueProblem } = await import('../src/index.js');
    expect(fieldValueProblem(getField('dates.valuation'), '2026-09-30')).toBeUndefined();
    expect(fieldValueProblem(getField('dates.valuation'), '30/09/2026')).toMatch(/date/);
    expect(fieldValueProblem(getField('instruction.basisOfValue'), 'market_value')).toBeUndefined();
    expect(fieldValueProblem(getField('instruction.basisOfValue'), 'vibes')).toMatch(/one of/);
    expect(
      fieldValueProblem(getField('valuation.approaches'), ['direct_comparison', 'summation']),
    ).toBeUndefined();
    expect(fieldValueProblem(getField('valuation.approaches'), ['astrology'])).toMatch(/list/);
    expect(fieldValueProblem(getField('income.capRate'), 5.5)).toMatch(/ratio/);
    expect(fieldValueProblem(getField('land.area'), -1)).toMatch(/non-negative/);
    expect(
      fieldValueProblem(getField('location.coordinates'), { lat: -37.8, lng: 144.9 }),
    ).toBeUndefined();
    expect(
      fieldValueProblem(getField('location.address'), { formatted: '1 Main St' }),
    ).toBeUndefined();
    expect(fieldValueProblem(getField('fl.singleExpert'), 'yes')).toMatch(/true or false/);
    expect(fieldValueProblem(getField('land.area'), null)).toBeUndefined();
  });
});
