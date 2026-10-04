import { describe, expect, it } from 'vitest';
import { analyseSale, enteredSale, saleEntryProblems, type SaleEntry } from '../src/index.js';
import { NOW } from './fixtures.js';

const entry: SaleEntry = {
  address: '14 Sample Road, Exampleton VIC 3000',
  contractDate: '2026-09-12',
  price: 1_120_000,
  landAreaM2: 640,
  buildingAreaM2: 210,
  source: 'Selling agent (confirmed by phone)',
  comparability: 'comparable',
};
const ctx = { id: 's-typed', assetId: 'a1', by: 'valuer1', at: NOW } as const;

describe('sales the valuer types in', () => {
  it('checks the entry before it is added', () => {
    expect(saleEntryProblems(entry, '2026-10-02')).toEqual([]);
    expect(
      saleEntryProblems(
        { ...entry, address: ' ', contractDate: '2026-11-01', price: 0, landAreaM2: 0, source: '' },
        '2026-10-02',
      ),
    ).toEqual([
      'Enter the sale address',
      'The contract date is in the future',
      'Enter the sale price',
      'Land area must be above 0',
      'Say where the sale came from',
    ]);
  });

  it('records it as the valuer’s own unchecked entry, naming the source', () => {
    const sale = enteredSale(entry, { ...ctx, propertyType: 'RESIDENTIAL' });
    expect(sale).toMatchObject({
      id: 's-typed',
      assetId: 'a1',
      propertyType: 'RESIDENTIAL',
      analysisBasis: 'land_rate',
      provenance: {
        origin: 'manual_entry',
        sourceRef: 'Selling agent (confirmed by phone)',
        effectiveDate: '2026-09-12',
        verification: 'unverified',
        capturedBy: 'valuer1',
      },
    });
    // the usual analysis runs on it: $1,120,000 / 640 m² = $1,750/m²
    expect(
      analyseSale(sale, { computedBy: 'valuer1', computedAt: NOW }).landRate?.output.value,
    ).toBe(1750);
  });

  it('analyses units on internal area, and falls back to price without areas', () => {
    expect(enteredSale(entry, { ...ctx, propertyType: 'RESIDENTIAL_UNIT' }).analysisBasis).toBe(
      'building_rate',
    );
    const bare = { ...entry, landAreaM2: undefined, buildingAreaM2: undefined };
    const { landAreaM2: _l, buildingAreaM2: _b, ...noAreas } = bare;
    expect(enteredSale(noAreas, { ...ctx, propertyType: 'RESIDENTIAL' }).analysisBasis).toBe(
      'price',
    );
  });
});
