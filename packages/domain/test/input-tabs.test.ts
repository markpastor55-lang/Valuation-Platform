import { describe, expect, it } from 'vitest';
import { FIELD_CATALOGUE, INPUT_TABS, REPORT_SECTIONS, inputTabForField } from '../src/index.js';

describe('input tabs', () => {
  it('places every report section in exactly one tab', () => {
    const placed = INPUT_TABS.flatMap((t) => [...t.sections]);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(REPORT_SECTIONS.map((s) => s.id).sort());
  });

  it('gives every catalogued field a tab', () => {
    for (const f of FIELD_CATALOGUE) expect(inputTabForField(f.id)).toBeDefined();
    expect(inputTabForField('improvements.buildingArea')).toBe('inspection');
    expect(inputTabForField('cgt.taxEvent')).toBe('job');
    expect(inputTabForField('evidence.sales')).toBe('evidence');
    expect(inputTabForField('nope.unknown')).toBeUndefined();
  });
});
