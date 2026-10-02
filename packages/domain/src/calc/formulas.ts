import type { SpecialistReviewer } from '../config/codes.js';
import type { Unit } from '../units/units.js';

export interface FormulaInputDef {
  readonly name: string;
  readonly unit: Unit;
  readonly description: string;
  /** Series input supplied as `name[0]`, `name[1]`, … */
  readonly repeated?: boolean;
  readonly optional?: boolean;
  /** Default used when an optional input is omitted (recorded in the trace). */
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: number;
}

export interface FormulaInputs {
  get(name: string): number;
  series(name: string): number[];
}

export type FormulaResult =
  number | { readonly value: number; readonly breakdown: Readonly<Record<string, number>> };

export interface FormulaDef {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  /** Human-readable expression printed in the calculation trace. */
  readonly expression: string;
  readonly inputs: readonly FormulaInputDef[];
  readonly output: { readonly unit: Unit; readonly dp: number };
  readonly review?: SpecialistReviewer;
  compute(inputs: FormulaInputs): FormulaResult;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Formula registry. A formula version is immutable once used in an issued report: fix a
 * formula by adding a new version, never by editing an existing one.
 */
export const FORMULAS: readonly FormulaDef[] = [
  {
    id: 'land.rate_per_m2',
    version: 1,
    title: 'Land rate per m²',
    expression: 'price ÷ land area',
    inputs: [
      {
        name: 'price',
        unit: 'AUD',
        description: 'Sale price (or land value component)',
        exclusiveMin: 0,
      },
      { name: 'landArea', unit: 'm2', description: 'Site area', exclusiveMin: 0 },
    ],
    output: { unit: 'AUD/m2', dp: 2 },
    compute: (i) => i.get('price') / i.get('landArea'),
  },
  {
    id: 'land.rate_per_ha',
    version: 1,
    title: 'Land rate per hectare',
    expression: 'price ÷ land area (ha)',
    inputs: [
      { name: 'price', unit: 'AUD', description: 'Sale price', exclusiveMin: 0 },
      { name: 'landArea', unit: 'ha', description: 'Site area', exclusiveMin: 0 },
    ],
    output: { unit: 'AUD/ha', dp: 0 },
    compute: (i) => i.get('price') / i.get('landArea'),
  },
  {
    id: 'improvements.rate_per_m2',
    version: 1,
    title: 'Rate per m² of building area (improved basis)',
    expression: 'price ÷ building area',
    inputs: [
      { name: 'price', unit: 'AUD', description: 'Sale price', exclusiveMin: 0 },
      {
        name: 'buildingArea',
        unit: 'm2',
        description: 'Building area on the stated measurement basis',
        exclusiveMin: 0,
      },
    ],
    output: { unit: 'AUD/m2', dp: 2 },
    compute: (i) => i.get('price') / i.get('buildingArea'),
  },
  {
    id: 'improvements.added_value_rate',
    version: 1,
    title: 'Added value of improvements per m²',
    expression: '(price − land value) ÷ building area',
    inputs: [
      { name: 'price', unit: 'AUD', description: 'Sale price', exclusiveMin: 0 },
      { name: 'landValue', unit: 'AUD', description: 'Assessed land value component', min: 0 },
      { name: 'buildingArea', unit: 'm2', description: 'Building area', exclusiveMin: 0 },
    ],
    output: { unit: 'AUD/m2', dp: 2 },
    compute: (i) => (i.get('price') - i.get('landValue')) / i.get('buildingArea'),
  },
  {
    id: 'income.initial_yield',
    version: 1,
    title: 'Initial (passing) yield',
    expression: 'net income ÷ price',
    inputs: [
      { name: 'netIncome', unit: 'AUD/yr', description: 'Net passing income per annum' },
      { name: 'price', unit: 'AUD', description: 'Sale price or value', exclusiveMin: 0 },
    ],
    output: { unit: 'ratio', dp: 4 },
    compute: (i) => i.get('netIncome') / i.get('price'),
  },
  {
    id: 'income.capitalised_value',
    version: 1,
    title: 'Capitalised value',
    expression: 'net income ÷ capitalisation rate + capital adjustments',
    inputs: [
      {
        name: 'netIncome',
        unit: 'AUD/yr',
        description: 'Net market (or passing) income per annum',
        min: 0,
      },
      {
        name: 'capRate',
        unit: 'ratio',
        description: 'Capitalisation rate',
        exclusiveMin: 0,
        max: 1,
      },
      {
        name: 'capitalAdjustment',
        unit: 'AUD',
        description: 'Capital adjustments (e.g. letting-up allowances, capex) — negative to deduct',
        repeated: true,
        optional: true,
      },
    ],
    output: { unit: 'AUD', dp: 0 },
    compute: (i) => {
      const core = i.get('netIncome') / i.get('capRate');
      const adjustments = sum(i.series('capitalAdjustment'));
      return { value: core + adjustments, breakdown: { capitalisedIncome: core, adjustments } };
    },
  },
  {
    id: 'income.effective_rent',
    version: 1,
    title: 'Effective rent (incentive as a share of face rent)',
    expression: 'face rent × (1 − incentive ratio)',
    inputs: [
      { name: 'faceRent', unit: 'AUD/yr', description: 'Face rent per annum', exclusiveMin: 0 },
      {
        name: 'incentiveRatio',
        unit: 'ratio',
        description: 'Incentive as a proportion of total face rent over term',
        min: 0,
        max: 1,
      },
    ],
    output: { unit: 'AUD/yr', dp: 0 },
    compute: (i) => i.get('faceRent') * (1 - i.get('incentiveRatio')),
  },
  {
    id: 'income.effective_rent_rent_free',
    version: 1,
    title: 'Effective rent (rent-free period, straight-line)',
    expression: 'face rent × (term − rent-free months) ÷ term',
    inputs: [
      { name: 'faceRent', unit: 'AUD/yr', description: 'Face rent per annum', exclusiveMin: 0 },
      { name: 'termMonths', unit: 'months', description: 'Lease term', exclusiveMin: 0 },
      { name: 'rentFreeMonths', unit: 'months', description: 'Rent-free period', min: 0 },
    ],
    output: { unit: 'AUD/yr', dp: 0 },
    compute: (i) =>
      (i.get('faceRent') * (i.get('termMonths') - i.get('rentFreeMonths'))) / i.get('termMonths'),
  },
  {
    id: 'income.rent_rate_per_m2',
    version: 1,
    title: 'Rent per m² per annum',
    expression: 'rent ÷ lease area',
    inputs: [
      {
        name: 'rent',
        unit: 'AUD/yr',
        description: 'Rent per annum on the stated basis',
        exclusiveMin: 0,
      },
      { name: 'leaseArea', unit: 'm2', description: 'Lease area', exclusiveMin: 0 },
    ],
    output: { unit: 'AUD/m2/yr', dp: 2 },
    compute: (i) => i.get('rent') / i.get('leaseArea'),
  },
  {
    id: 'income.wale',
    version: 1,
    title: 'Weighted average lease expiry (by income)',
    expression: 'Σ(income × remaining term) ÷ Σ income',
    inputs: [
      {
        name: 'income',
        unit: 'AUD/yr',
        description: 'Tenant income per annum',
        repeated: true,
        min: 0,
      },
      {
        name: 'remainingTerm',
        unit: 'years',
        description: 'Remaining lease term',
        repeated: true,
        min: 0,
      },
    ],
    output: { unit: 'years', dp: 2 },
    compute: (i) => {
      const income = i.series('income');
      const term = i.series('remainingTerm');
      if (income.length !== term.length || income.length === 0) {
        throw new RangeError(
          'income and remainingTerm series must be non-empty and the same length',
        );
      }
      const total = sum(income);
      if (total <= 0) throw new RangeError('total income must be positive');
      return sum(income.map((inc, k) => inc * (term[k] ?? 0))) / total;
    },
  },
  {
    id: 'comparison.adjusted_rate',
    version: 1,
    title: 'Adjusted comparable rate',
    expression: 'rate × (1 + Σ percentage adjustments) + Σ absolute adjustments',
    inputs: [
      { name: 'rate', unit: 'AUD/m2', description: 'Analysed comparable rate', exclusiveMin: 0 },
      {
        name: 'percentAdjustment',
        unit: 'ratio',
        description: 'Percentage adjustment',
        repeated: true,
        optional: true,
      },
      {
        name: 'absoluteAdjustment',
        unit: 'AUD/m2',
        description: 'Absolute adjustment',
        repeated: true,
        optional: true,
      },
    ],
    output: { unit: 'AUD/m2', dp: 2 },
    compute: (i) => {
      const pct = sum(i.series('percentAdjustment'));
      const abs = sum(i.series('absoluteAdjustment'));
      return {
        value: i.get('rate') * (1 + pct) + abs,
        breakdown: { totalPercent: pct, totalAbsolute: abs },
      };
    },
  },
  {
    id: 'comparison.adjusted_price',
    version: 1,
    title: 'Adjusted comparable price',
    expression: 'price × (1 + Σ percentage adjustments) + Σ absolute adjustments',
    inputs: [
      { name: 'price', unit: 'AUD', description: 'Comparable price', exclusiveMin: 0 },
      {
        name: 'percentAdjustment',
        unit: 'ratio',
        description: 'Percentage adjustment',
        repeated: true,
        optional: true,
      },
      {
        name: 'absoluteAdjustment',
        unit: 'AUD',
        description: 'Absolute adjustment',
        repeated: true,
        optional: true,
      },
    ],
    output: { unit: 'AUD', dp: 0 },
    compute: (i) => {
      const pct = sum(i.series('percentAdjustment'));
      const abs = sum(i.series('absoluteAdjustment'));
      return {
        value: i.get('price') * (1 + pct) + abs,
        breakdown: { totalPercent: pct, totalAbsolute: abs },
      };
    },
  },
  {
    id: 'comparison.time_adjusted_price',
    version: 1,
    title: 'Time-adjusted price (market index)',
    expression: 'price × index at valuation date ÷ index at sale date',
    inputs: [
      { name: 'price', unit: 'AUD', description: 'Comparable price', exclusiveMin: 0 },
      {
        name: 'indexAtSale',
        unit: 'count',
        description: 'Market index at contract date',
        exclusiveMin: 0,
      },
      {
        name: 'indexAtValuation',
        unit: 'count',
        description: 'Market index at valuation date',
        exclusiveMin: 0,
      },
    ],
    output: { unit: 'AUD', dp: 0 },
    compute: (i) => (i.get('price') * i.get('indexAtValuation')) / i.get('indexAtSale'),
  },
  {
    id: 'cost.replacement',
    version: 1,
    title: 'Replacement / reinstatement cost build-up',
    expression:
      'construction = Σ(area × rate) × location factor; fees = (construction + code upgrade) × fee ratio; escalation = (construction + code upgrade + fees) × escalation ratio; total = construction + code upgrade + fees + escalation + demolition, plus GST if inclusive',
    review: 'QUANTITY_SURVEYOR',
    inputs: [
      { name: 'area', unit: 'm2', description: 'Component area', repeated: true, exclusiveMin: 0 },
      {
        name: 'rate',
        unit: 'AUD/m2',
        description: 'Component construction rate',
        repeated: true,
        exclusiveMin: 0,
      },
      {
        name: 'locationFactor',
        unit: 'ratio',
        description: 'Regional / location factor',
        optional: true,
        default: 1,
        exclusiveMin: 0,
      },
      {
        name: 'codeUpgrade',
        unit: 'AUD',
        description: 'Code-upgrade allowance',
        optional: true,
        default: 0,
        min: 0,
      },
      {
        name: 'professionalFees',
        unit: 'ratio',
        description: 'Professional fees',
        optional: true,
        default: 0,
        min: 0,
        max: 1,
      },
      {
        name: 'escalation',
        unit: 'ratio',
        description: 'Escalation over lead time and rebuild',
        optional: true,
        default: 0,
        min: 0,
        max: 1,
      },
      {
        name: 'demolition',
        unit: 'AUD',
        description: 'Demolition and debris removal',
        optional: true,
        default: 0,
        min: 0,
      },
      {
        name: 'gstInclusive',
        unit: 'count',
        description: '1 = add GST, 0 = exclude GST',
        optional: true,
        default: 1,
        min: 0,
        max: 1,
      },
      {
        name: 'gstRate',
        unit: 'ratio',
        description: 'GST rate',
        optional: true,
        default: 0.1,
        min: 0,
        max: 1,
      },
    ],
    output: { unit: 'AUD', dp: 0 },
    compute: (i) => {
      const areas = i.series('area');
      const rates = i.series('rate');
      if (areas.length !== rates.length || areas.length === 0) {
        throw new RangeError('area and rate series must be non-empty and the same length');
      }
      const construction = sum(areas.map((a, k) => a * (rates[k] ?? 0))) * i.get('locationFactor');
      const codeUpgrade = i.get('codeUpgrade');
      const fees = (construction + codeUpgrade) * i.get('professionalFees');
      const escalation = (construction + codeUpgrade + fees) * i.get('escalation');
      const demolition = i.get('demolition');
      const subtotal = construction + codeUpgrade + fees + escalation + demolition;
      const gst = i.get('gstInclusive') >= 1 ? subtotal * i.get('gstRate') : 0;
      return {
        value: subtotal + gst,
        breakdown: {
          construction,
          codeUpgrade,
          fees,
          escalation,
          demolition,
          subtotalExGst: subtotal,
          gst,
        },
      };
    },
  },
];

export function findFormula(id: string, version?: number): FormulaDef | undefined {
  const candidates = FORMULAS.filter(
    (f) => f.id === id && (version === undefined || f.version === version),
  );
  return candidates.sort((a, b) => b.version - a.version)[0];
}
