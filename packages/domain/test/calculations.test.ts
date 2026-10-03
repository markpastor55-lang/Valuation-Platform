import { describe, expect, it } from 'vitest';
import {
  FORMULAS,
  analyseSale,
  capitalisationSensitivity,
  deriveFairValueLevel,
  detectOutliers,
  effectiveValue,
  overrideCalculation,
  runCalculation,
  summariseRates,
  verifyCalculation,
  withinRange,
  type SaleComparable,
} from '../src/index.js';

const ctx = { computedBy: 'valuer1', computedAt: '2026-10-02T00:00:00Z' };

describe('formula registry', () => {
  it('has unique id@version pairs and declared outputs', () => {
    const keys = FORMULAS.map((f) => `${f.id}@${f.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('runCalculation', () => {
  it('computes a land rate and records a full trace', () => {
    const r = runCalculation({
      id: 'c1',
      formulaId: 'land.rate_per_m2',
      inputs: [
        { name: 'price', value: 850_000, unit: 'AUD', sourceRef: 'sale:s1.price' },
        { name: 'landArea', value: 650, unit: 'm2', sourceRef: 'sale:s1.landAreaM2' },
      ],
      ...ctx,
    });
    expect(r.output).toEqual({ value: 1307.69, unit: 'AUD/m2', unrounded: 850_000 / 650 });
    expect(r.formulaVersion).toBe(1);
    expect(r.expression).toBe('price ÷ land area');
    expect(r.inputs.map((i) => i.sourceRef)).toEqual(['sale:s1.landAreaM2', 'sale:s1.price']);
    expect(r.traceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCalculation(r)).toBe(true);
  });

  it('converts input units and preserves the raw input', () => {
    const r = runCalculation({
      id: 'c2',
      formulaId: 'land.rate_per_m2',
      inputs: [
        { name: 'price', value: 1_000_000, unit: 'AUD' },
        { name: 'landArea', value: 1, unit: 'acre' },
      ],
      ...ctx,
    });
    const area = r.inputs.find((i) => i.name === 'landArea')!;
    expect(area.value).toBe(1);
    expect(area.unit).toBe('acre');
    expect(area.normalisedValue).toBeCloseTo(4046.8564224, 8);
    expect(r.output.value).toBe(247.11);
  });

  it('rejects invalid inputs', () => {
    const run = (inputs: Parameters<typeof runCalculation>[0]['inputs']) =>
      runCalculation({ id: 'x', formulaId: 'land.rate_per_m2', inputs, ...ctx });
    expect(() => run([{ name: 'price', value: 1, unit: 'AUD' }])).toThrow(/missing input landArea/);
    expect(() =>
      run([
        { name: 'price', value: 1, unit: 'AUD' },
        { name: 'landArea', value: 0, unit: 'm2' },
      ]),
    ).toThrow(/landArea must be > 0/);
    expect(() =>
      run([
        { name: 'price', value: 1, unit: 'AUD' },
        { name: 'landArea', value: 10, unit: 'm' },
      ]),
    ).toThrow(/cannot be used as m2/);
    expect(() => runCalculation({ id: 'x', formulaId: 'nope', inputs: [], ...ctx })).toThrow(
      /unknown formula/,
    );
  });

  it('computes yields, capitalised values and effective rents', () => {
    const y = runCalculation({
      id: 'y',
      formulaId: 'income.initial_yield',
      inputs: [
        { name: 'netIncome', value: 412_500, unit: 'AUD/yr' },
        { name: 'price', value: 7_500_000, unit: 'AUD' },
      ],
      ...ctx,
    });
    expect(y.output.value).toBe(0.055);

    const cap = runCalculation({
      id: 'cap',
      formulaId: 'income.capitalised_value',
      inputs: [
        { name: 'netIncome', value: 412_500, unit: 'AUD/yr' },
        { name: 'capRate', value: 0.0575, unit: 'ratio' },
        { name: 'capitalAdjustment[0]', value: -150_000, unit: 'AUD' },
      ],
      ...ctx,
    });
    expect(cap.output.value).toBe(Math.round(412_500 / 0.0575 - 150_000));
    expect(cap.breakdown).toMatchObject({ adjustments: -150_000 });

    const eff = runCalculation({
      id: 'eff',
      formulaId: 'income.effective_rent_rent_free',
      inputs: [
        { name: 'faceRent', value: 120_000, unit: 'AUD/yr' },
        { name: 'termMonths', value: 60, unit: 'months' },
        { name: 'rentFreeMonths', value: 6, unit: 'months' },
      ],
      ...ctx,
    });
    expect(eff.output.value).toBe(108_000);
  });

  it('computes WALE by income', () => {
    const r = runCalculation({
      id: 'w',
      formulaId: 'income.wale',
      inputs: [
        { name: 'income[0]', value: 300_000, unit: 'AUD/yr' },
        { name: 'income[1]', value: 100_000, unit: 'AUD/yr' },
        { name: 'remainingTerm[0]', value: 5, unit: 'years' },
        { name: 'remainingTerm[1]', value: 1, unit: 'years' },
      ],
      ...ctx,
    });
    expect(r.output.value).toBe(4);
    expect(() =>
      runCalculation({
        id: 'w2',
        formulaId: 'income.wale',
        inputs: [{ name: 'income[0]', value: 1, unit: 'AUD/yr' }],
        ...ctx,
      }),
    ).toThrow(/missing series remainingTerm/);
  });

  it('builds up replacement cost with defaults recorded in the trace', () => {
    const r = runCalculation({
      id: 'rc',
      formulaId: 'cost.replacement',
      inputs: [
        { name: 'area[0]', value: 200, unit: 'm2' },
        { name: 'rate[0]', value: 2500, unit: 'AUD/m2' },
        { name: 'area[1]', value: 40, unit: 'm2' },
        { name: 'rate[1]', value: 1000, unit: 'AUD/m2' },
        { name: 'locationFactor', value: 1.1, unit: 'ratio' },
        { name: 'professionalFees', value: 0.1, unit: 'ratio' },
        { name: 'escalation', value: 0.05, unit: 'ratio' },
        { name: 'demolition', value: 25_000, unit: 'AUD' },
      ],
      ...ctx,
    });
    // construction = (500,000 + 40,000) × 1.1 = 594,000; fees 59,400; escalation 32,670;
    // subtotal = 594,000 + 59,400 + 32,670 + 25,000 = 711,070; GST 71,107 → 782,177
    expect(r.breakdown).toMatchObject({
      construction: 594_000,
      fees: 59_400,
      escalation: 32_670,
      gst: 71_107,
    });
    expect(r.output.value).toBe(782_177);
    expect(r.inputs.filter((i) => i.defaulted).map((i) => i.name)).toEqual([
      'codeUpgrade',
      'gstInclusive',
      'gstRate',
    ]);
    expect(verifyCalculation(r)).toBe(true);
  });
});

describe('overrides', () => {
  const base = runCalculation({
    id: 'c',
    formulaId: 'land.rate_per_m2',
    inputs: [
      { name: 'price', value: 500_000, unit: 'AUD' },
      { name: 'landArea', value: 500, unit: 'm2' },
    ],
    ...ctx,
  });

  it('requires a substantive reason and keeps the computed output', () => {
    expect(() =>
      overrideCalculation(base, { value: 950, reason: 'adjusted', by: 'v1', at: ctx.computedAt }),
    ).toThrow(/reason/);
    const o = overrideCalculation(base, {
      value: 950,
      reason: 'Sale included $25k of chattels; rate adjusted accordingly',
      by: 'v1',
      at: ctx.computedAt,
    });
    expect(effectiveValue(o)).toBe(950);
    expect(o.output.value).toBe(1000);
    expect(o.traceHash).toBe(base.traceHash);
  });

  it('detects tampering with a stored output', () => {
    expect(verifyCalculation({ ...base, output: { ...base.output, value: 999 } })).toBe(false);
  });
});

describe('comparable analysis', () => {
  const sale: SaleComparable = {
    id: 's1',
    assetId: 'a1',
    address: '1 Example St, Exampleville VIC',
    contractDate: '2026-05-01',
    price: 900_000,
    interest: 'fee_simple_vacant_possession',
    propertyType: 'RESIDENTIAL',
    landAreaM2: 600,
    buildingAreaM2: 180,
    provenance: {
      origin: 'external_source',
      sourceId: 'ds-sales',
      retrievedAt: '2026-09-01T00:00:00Z',
      effectiveDate: '2026-05-01',
      licenceBasis: 'licensed',
      verification: 'verified',
      verifiedBy: 'v1',
      verifiedAt: '2026-09-02T00:00:00Z',
      capturedBy: 'v1',
      capturedAt: '2026-09-01T00:00:00Z',
    },
    comparability: 'superior',
    analysisBasis: 'land_rate',
    adjustments: [
      { factor: 'location', kind: 'percent', value: -0.05, rationale: 'Superior street' },
      { factor: 'land_size', kind: 'absolute', value: 20, rationale: 'Smaller site' },
    ],
  };

  it('produces traced land, building and adjusted rates', () => {
    const a = analyseSale(sale, ctx);
    expect(a.landRate?.output.value).toBe(1500);
    expect(a.buildingRate?.output.value).toBe(5000);
    expect(a.adjusted?.output.value).toBe(1500 * 0.95 + 20);
    expect(a.adjusted?.inputs.find((i) => i.name === 'rate')?.sourceRef).toBe('calc:s1:land_rate');
  });

  it('flags outlier rates with Tukey fences', () => {
    const items = [1450, 1500, 1520, 1480, 1510, 2600].map((value, i) => ({ id: `s${i}`, value }));
    const r = detectOutliers(items);
    expect(r.outlierIds).toEqual(['s5']);
    expect(detectOutliers(items.slice(0, 3)).insufficientData).toBe(true);
  });

  it('summarises rates and checks the adopted figure against indications', () => {
    const s = summariseRates([1, 2, 3, 4]);
    expect(s.median).toBe(2.5);
    expect(s.q1).toBe(1.75);
    expect(withinRange(1500, [1450, 1520])).toBe(true);
    expect(withinRange(1600, [1450, 1520])).toBe(false);
    expect(withinRange(1550, [1450, 1520], 0.05)).toBe(true);
  });
});

describe('fair value (AASB 13, configurable)', () => {
  it('categorises at the lowest level of any significant input', () => {
    const r = deriveFairValueLevel([
      { name: 'market rent', significant: true, level: 2 },
      { name: 'capitalisation rate', significant: true, level: 3 },
      { name: 'minor outgoings', significant: false, level: 3 },
    ]);
    expect(r).toEqual({
      level: 3,
      drivingInputs: ['capitalisation rate'],
      standard: 'AASB 13 Fair Value Measurement',
    });
    expect(deriveFairValueLevel([{ name: 'rate', significant: true, level: 2 }]).level).toBe(2);
    expect(() => deriveFairValueLevel([{ name: 'x', significant: false, level: 1 }])).toThrow();
  });

  it('builds a capitalisation sensitivity table', () => {
    const rows = capitalisationSensitivity({
      idPrefix: 'sens',
      netIncome: 500_000,
      baseCapRate: 0.06,
      deltas: [-0.0025, 0.0025],
      ...ctx,
    });
    expect(rows.map((r) => r.capRate)).toEqual([0.0575, 0.06, 0.0625]);
    expect(rows[1]!.changeFromBase).toBe(0);
    expect(rows[0]!.changeFromBase).toBeGreaterThan(0);
    expect(rows[2]!.calculation.output.value).toBe(8_000_000);
  });
});
