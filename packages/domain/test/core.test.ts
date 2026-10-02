import { describe, expect, it } from 'vitest';
import {
  addMonths,
  canonicalJson,
  checkDataSourceUsage,
  checkProvenance,
  compareDates,
  daysBetween,
  formatAustralianDate,
  hashCanonical,
  isLocalDate,
  localDateOf,
  monthsBetween,
  sha256Hex,
  type DataSource,
  type Provenance,
} from '../src/index.js';

describe('LocalDate', () => {
  it('validates calendar dates including leap years', () => {
    expect(isLocalDate('2024-02-29')).toBe(true);
    expect(isLocalDate('2023-02-29')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2026-1-01')).toBe(false);
    expect(isLocalDate(20260101)).toBe(false);
  });

  it('compares and measures', () => {
    expect(compareDates('2026-06-30', '2026-07-01')).toBeLessThan(0);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('adds months clamping to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-15', -12)).toBe('2025-03-15');
  });

  it('counts whole months', () => {
    expect(monthsBetween('2025-06-30', '2026-06-30')).toBe(12);
    expect(monthsBetween('2025-07-01', '2026-06-30')).toBe(11);
    expect(monthsBetween('2026-01-31', '2026-02-28')).toBe(1);
    expect(monthsBetween('2026-06-30', '2025-06-30')).toBe(-12);
  });

  it('derives the calendar date in the jurisdiction time zone', () => {
    // 2026-06-30T15:30Z is 1 July in Sydney (AEST +10) but still 30 June in Perth (+8).
    expect(localDateOf('2026-06-30T15:30:00Z', 'Australia/Sydney')).toBe('2026-07-01');
    expect(localDateOf('2026-06-30T15:30:00Z', 'Australia/Perth')).toBe('2026-06-30');
  });

  it('formats Australian long dates', () => {
    expect(formatAustralianDate('2026-10-02')).toBe('2 October 2026');
  });
});

describe('canonical JSON and hashing', () => {
  it('sorts keys recursively and omits undefined properties', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: true, y: null }], c: 'x' }, u: undefined })).toBe(
      '{"a":{"c":"x","d":[1,{"y":null,"z":true}]},"b":1}',
    );
  });

  it('is independent of key insertion order', () => {
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
  });

  it('rejects values that JSON would silently coerce', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson([undefined])).toThrow(/undefined array item/);
    expect(() => canonicalJson({ a: 1n })).toThrow(/unsupported bigint/);
  });

  it('computes standard SHA-256', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('provenance', () => {
  const base: Provenance = {
    origin: 'external_source',
    sourceId: 'ds-vicplan',
    retrievedAt: '2026-09-01T00:00:00Z',
    effectiveDate: '2026-09-01',
    licenceBasis: 'open_licence',
    verification: 'unverified',
    capturedBy: 'u1',
    capturedAt: '2026-09-01T00:00:00Z',
  };

  it('accepts complete external provenance', () => {
    expect(checkProvenance(base)).toEqual([]);
  });

  it('requires source, retrieval time, effective date and licence for external data', () => {
    const issues = checkProvenance({
      origin: 'external_source',
      verification: 'unverified',
      capturedBy: 'u1',
      capturedAt: '2026-09-01T00:00:00Z',
    });
    expect(issues.map((i) => i.field).sort()).toEqual([
      'effectiveDate',
      'licenceBasis',
      'retrievedAt',
      'sourceId',
    ]);
  });

  it('requires verifier identity when verified', () => {
    expect(checkProvenance({ ...base, verification: 'verified' }).map((i) => i.field)).toContain(
      'verifiedBy',
    );
  });
});

describe('data-source licence checks', () => {
  const source: DataSource = {
    id: 'ds1',
    name: 'Example planning portal',
    provider: 'State government',
    kind: 'planning',
    licence: {
      basis: 'public_view_only',
      permitsStorage: true,
      permitsReportReproduction: false,
      permitsBulkUse: false,
      expiresOn: '2027-06-30',
    },
    freshnessDays: 90,
    status: 'active',
  };

  it('flags reproduction prohibited and staleness', () => {
    const r = checkDataSourceUsage(source, '2026-01-01T00:00:00Z', '2026-10-02T00:00:00Z');
    expect(r.reproducibleInReport).toBe(false);
    expect(r.stale).toBe(true);
    expect(r.licenceExpired).toBe(false);
  });

  it('treats expired licences as unusable', () => {
    const r = checkDataSourceUsage(
      { ...source, licence: { ...source.licence, permitsReportReproduction: true } },
      '2027-07-01T00:00:00Z',
      '2027-07-02T00:00:00Z',
    );
    expect(r.licenceExpired).toBe(true);
    expect(r.storable).toBe(false);
    expect(r.reproducibleInReport).toBe(false);
  });
});
