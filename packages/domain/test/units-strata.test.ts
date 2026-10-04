import { describe, expect, it } from 'vitest';
import {
  AU_CORE_RULE_SET,
  INPUT_TABS,
  createSamplePropertyDataProvider,
  inputTabForField,
  resolveRequirements,
  saleFromProvider,
  suggestFieldsFromAttributes,
  type FieldValues,
  type JobSelection,
} from '../src/index.js';
import { NOW } from './fixtures.js';

const unit: JobSelection = {
  jurisdiction: 'VIC',
  purpose: 'MARKET_VALUE',
  propertyType: 'RESIDENTIAL_UNIT',
  scope: 'FULL',
  mode: 'SINGLE',
};
const withTitle = (titleType: string): FieldValues => ({
  job: {},
  assets: { a1: { 'strata.titleType': titleType } },
});
const ids = (sel: JobSelection, values?: FieldValues, level = 'required') =>
  resolveRequirements(sel, AU_CORE_RULE_SET, values, ['a1'])
    .fields.filter((f) => f.level === level)
    .map((f) => f.fieldId);

describe('units and strata units', () => {
  it('asks unit questions on internal area, not land or the house fields', () => {
    const f = ids(unit);
    expect(f).toEqual(
      expect.arrayContaining([
        'strata.titleType',
        'unit.unitType',
        'unit.internalArea',
        'improvements.parking',
      ]),
    );
    expect(f).not.toContain('land.area');
    expect(f).not.toContain('improvements.buildingArea');
    expect(f).not.toContain('improvements.dwellingType');
    expect(f).not.toContain('strata.planNumber');
  });

  it('adds the owners corporation questions for strata, community and stratum title', () => {
    for (const t of ['strata_title', 'community_title', 'stratum_title']) {
      const r = resolveRequirements(unit, AU_CORE_RULE_SET, withTitle(t), ['a1']);
      const f = r.fields.filter((x) => x.level === 'required').map((x) => x.fieldId);
      expect(f).toEqual(
        expect.arrayContaining([
          'strata.planNumber',
          'strata.lotNumber',
          'strata.unitEntitlement',
          'strata.adminLevy',
          'strata.capitalWorksLevy',
          'strata.buildingDefects',
        ]),
      );
      expect(r.sections).toContain('strata');
      expect(r.warnings.map((w) => w.code)).toContain('W-STRATA-RECORDS');
    }
    expect(ids(unit, withTitle('torrens_title'))).not.toContain('strata.planNumber');
    expect(ids(unit, withTitle('company_title'))).toContain('strata.companyTitleDetails');
  });

  it('lets strata offices and factory units answer the same strata questions', () => {
    for (const propertyType of ['COMMERCIAL_OFFICE', 'INDUSTRIAL'] as const) {
      const sel = { ...unit, propertyType };
      expect(ids(sel, undefined, 'recommended')).toContain('strata.titleType');
      expect(ids(sel, withTitle('strata_title'))).toContain('strata.ownersCorporation');
    }
  });

  it('warns that strata buildings are usually insured by the owners corporation', () => {
    const r = resolveRequirements({ ...unit, purpose: 'INSURANCE_REPLACEMENT' }, AU_CORE_RULE_SET);
    expect(r.selectionIssues.map((i) => i.ruleId)).toContain('SEL-010');
  });

  it('puts strata questions on the Property tab and unit details on Inspection', () => {
    expect(inputTabForField('strata.planNumber')).toBe('property');
    expect(inputTabForField('unit.internalArea')).toBe('inspection');
    expect(INPUT_TABS.find((t) => t.id === 'property')?.sections).toContain('strata');
  });

  it('suggests unit and strata values from property data and analyses unit sales on internal area', async () => {
    const provider = createSamplePropertyDataProvider('2026-10-02');
    const [m] = await provider.matchAddress('harbour view');
    const attrs = await provider.attributes(m!.propertyId);
    const ctx = { assetId: 'a1', source: provider.source, retrievedAt: NOW, capturedBy: 'valuer1' };
    const fields = suggestFieldsFromAttributes(attrs, ctx).map((s) => s.fieldId);
    expect(fields).toEqual(
      expect.arrayContaining([
        'unit.unitType',
        'unit.internalArea',
        'strata.titleType',
        'strata.planNumber',
      ]),
    );
    expect(fields).not.toContain('land.area');
    const sales = await provider.comparableSales({
      propertyId: m!.propertyId,
      latitude: m!.latitude!,
      longitude: m!.longitude!,
      radiusKm: 2,
      months: 12,
      toDate: '2026-10-02',
      propertyType: 'RESIDENTIAL_UNIT',
      limit: 10,
    });
    expect(sales.length).toBeGreaterThan(0);
    expect(sales.every((s) => s.landAreaM2 === undefined && s.floorAreaM2 !== undefined)).toBe(
      true,
    );
    expect(
      saleFromProvider(sales[0]!, { ...ctx, propertyType: 'RESIDENTIAL_UNIT' }).analysisBasis,
    ).toBe('building_rate');
  });
});
