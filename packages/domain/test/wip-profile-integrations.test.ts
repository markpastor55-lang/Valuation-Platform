import { describe, expect, it } from 'vitest';
import {
  CORELOGIC_SOURCE,
  SAMPLE_PROPERTY_SOURCE,
  STATE_MAP_SERVICES,
  JURISDICTIONS,
  buildWip,
  createSamplePropertyDataProvider,
  distanceKm,
  dueState,
  matchesJobSearch,
  runValidation,
  saleFromProvider,
  signCertification,
  signingProblems,
  suggestFieldsFromAttributes,
  valuerIdentityFor,
  wipStage,
  type ValuerProfile,
  type WipJob,
} from '../src/index.js';
import { NOW, cleanContext, valuer } from './fixtures.js';

const TODAY = '2026-10-02';
const job = (over: Partial<WipJob>): WipJob => ({
  id: 'j',
  reference: 'VAL-1',
  status: 'active',
  selection: {
    jurisdiction: 'VIC',
    purpose: 'MARKET_VALUE',
    propertyType: 'RESIDENTIAL',
    scope: 'FULL',
    mode: 'SINGLE',
  },
  clientName: 'Example Lending',
  addresses: ['10 Sample Road, Exampleton VIC 3000'],
  ...over,
});

describe('work in progress', () => {
  it('derives the stage from status and the inspection date', () => {
    expect(wipStage({ status: 'draft' }, TODAY)).toBe('new');
    expect(wipStage({ status: 'active' }, TODAY)).toBe('to_inspect');
    expect(wipStage({ status: 'active', inspectionDate: '2026-10-05' }, TODAY)).toBe('to_inspect');
    expect(wipStage({ status: 'active', inspectionDate: '2026-10-02' }, TODAY)).toBe('in_progress');
    expect(wipStage({ status: 'in_review' }, TODAY)).toBe('with_qa');
    expect(wipStage({ status: 'approved' }, TODAY)).toBe('to_issue');
  });

  it('flags due dates', () => {
    expect(dueState({ status: 'active', dueDate: '2026-10-01' }, TODAY)).toBe('overdue');
    expect(dueState({ status: 'active', dueDate: '2026-10-02' }, TODAY)).toBe('due_today');
    expect(dueState({ status: 'active', dueDate: '2026-10-04' }, TODAY)).toBe('due_soon');
    expect(dueState({ status: 'active', dueDate: '2026-10-20' }, TODAY)).toBe('on_track');
    expect(dueState({ status: 'issued', dueDate: '2026-09-01' }, TODAY)).toBe('done');
  });

  it('searches every word across reference, client, address, purpose and stage', () => {
    const j = job({
      reference: 'VAL-2026-0142',
      selection: { ...job({}).selection, purpose: 'CGT' },
    });
    expect(matchesJobSearch(j, 'sample road', TODAY)).toBe(true);
    expect(matchesJobSearch(j, 'capital gains exampleton', TODAY)).toBe(true);
    expect(matchesJobSearch(j, '0142 to inspect', TODAY)).toBe(true);
    expect(matchesJobSearch(j, 'family', TODAY)).toBe(false);
  });

  it('builds the board most urgent first with counts per stage', () => {
    const board = buildWip(
      [
        job({ id: 'a', reference: 'A', dueDate: '2026-10-20' }),
        job({ id: 'b', reference: 'B', dueDate: '2026-09-30' }),
        job({ id: 'c', reference: 'C', status: 'submitted' }),
      ],
      TODAY,
    );
    expect(board.rows.map((r) => r.job.reference)).toEqual(['B', 'A', 'C']);
    expect(board.counts.to_inspect).toBe(2);
    expect(board.counts.with_qa).toBe(1);
    expect(board.overdue).toBe(1);
    expect(
      buildWip(
        board.rows.map((r) => r.job),
        TODAY,
        { stage: 'with_qa' },
      ).rows,
    ).toHaveLength(1);
  });
});

describe('valuer profile and state registration', () => {
  const profile: ValuerProfile = {
    userId: 'valuer1',
    fullName: 'Alex Valuer',
    credentials: ['AAPI', 'CPV'],
    apiMemberNumber: '12345',
    registrations: [{ jurisdiction: 'QLD', number: 'QV-1234', expiresOn: '2027-06-30' }],
    signature: { kind: 'typed', value: 'Alex Valuer', updatedAt: NOW },
  };

  it('requires a Queensland registration or WA licence only for those states', () => {
    const { signature: _signature, ...unsigned } = profile;
    expect(signingProblems(profile, 'VIC', TODAY)).toEqual([]);
    expect(signingProblems(profile, 'QLD', TODAY)).toEqual([]);
    expect(signingProblems(profile, 'WA', TODAY).join()).toMatch(
      /Western Australian licensed valuer/,
    );
    expect(signingProblems(profile, 'QLD', '2027-07-01').join()).toMatch(/expired/);
    expect(signingProblems(unsigned, 'VIC', TODAY).join()).toMatch(/signature/);
  });

  it('prints the API number and registration on the certification identity', () => {
    const qld = valuerIdentityFor(profile, 'QLD');
    expect(qld).toMatchObject({
      apiMemberNumber: '12345',
      registration: { jurisdiction: 'QLD', number: 'QV-1234' },
    });
    expect(qld.signatureSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(valuerIdentityFor(profile, 'VIC').registration).toBeUndefined();
  });

  it('blocks a Queensland job certified without the registration (VAL-CERT-003)', () => {
    const base = cleanContext();
    const qld = { ...base.selection, jurisdiction: 'QLD' as const };
    const sign = (identity: ReturnType<typeof valuerIdentityFor>) =>
      signCertification(
        {
          jobId: 'j1',
          valuer: identity,
          role: 'responsible_valuer',
          inspectionScope: 'FULL',
          inspectionScopeStatement: 'Full inspection',
          valuationDate: '2026-09-30',
          basisOfValue: 'Market value',
          amount: { value: 1_150_000, currency: 'AUD', kind: 'value' },
          independenceStatement: 'Independent',
          conflictsStatement: 'None',
          assumptions: [],
          specialAssumptions: [],
          limitations: ['None'],
          standardsReliedOn: ['Firm methodology'],
          clauseVersionIds: ['certification-core@1'],
        },
        {
          id: 'c1',
          actor: valuer,
          responsibleValuerId: 'valuer1',
          snapshotHash: 'a'.repeat(64),
          at: NOW,
          attestationText: 'I certify this valuation is my independent opinion.',
        },
      );
    const without = runValidation({
      ...base,
      selection: qld,
      certification: sign(valuerIdentityFor(profile, 'VIC')),
    });
    expect(without.findings.map((f) => f.code)).toContain('VAL-CERT-003');
    const withReg = runValidation({
      ...base,
      selection: qld,
      certification: sign(valuerIdentityFor(profile, 'QLD')),
    });
    expect(withReg.findings.map((f) => f.code)).not.toContain('VAL-CERT-003');
  });
});

describe('property data and state maps', () => {
  const provider = createSamplePropertyDataProvider(TODAY);

  it('matches sample addresses and suggests unverified field values with provenance', async () => {
    const [m] = await provider.matchAddress('10 sample road');
    expect(m?.propertyId).toBe('S-VIC-0001');
    const attrs = await provider.attributes(m!.propertyId);
    const suggestions = suggestFieldsFromAttributes(attrs, {
      assetId: 'a1',
      source: provider.source,
      retrievedAt: NOW,
      capturedBy: 'valuer1',
    });
    expect(suggestions.map((s) => s.fieldId)).toEqual(
      expect.arrayContaining([
        'land.area',
        'location.titleReference',
        'improvements.accommodation',
      ]),
    );
    expect(suggestions.map((s) => s.fieldId)).not.toContain('improvements.condition');
    for (const s of suggestions)
      expect(s.provenance).toMatchObject({
        origin: 'external_source',
        sourceId: SAMPLE_PROPERTY_SOURCE.id,
        verification: 'unverified',
      });
  });

  it('finds comparable sales inside the radius, newest first, as unverified evidence', async () => {
    const sales = await provider.comparableSales({
      propertyId: 'S-VIC-0001',
      latitude: -37.81,
      longitude: 144.96,
      radiusKm: 2,
      months: 12,
      toDate: TODAY,
      propertyType: 'RESIDENTIAL',
      limit: 10,
    });
    expect(sales.length).toBeGreaterThan(3);
    expect(sales.every((s) => (s.distanceKm ?? 99) <= 2)).toBe(true);
    expect([...sales].sort((a, b) => b.contractDate.localeCompare(a.contractDate))).toEqual(sales);
    const evidence = saleFromProvider(sales[0]!, {
      assetId: 'a1',
      source: provider.source,
      retrievedAt: NOW,
      capturedBy: 'valuer1',
      propertyType: 'RESIDENTIAL',
    });
    expect(evidence.provenance.verification).toBe('unverified');
  });

  it('keeps sample data and automated estimates out of reports by licence', async () => {
    expect(SAMPLE_PROPERTY_SOURCE.licence.permitsReportReproduction).toBe(false);
    expect(provider.avmSource.licence.permitsReportReproduction).toBe(false);
    expect(CORELOGIC_SOURCE.licence.reference).toMatch(/REVIEW: DATA_LICENSING/);
    const avm = await provider.automatedEstimate('S-VIC-0001');
    expect(avm && avm.low < avm.estimate && avm.estimate < avm.high).toBe(true);
  });

  it('has a government map viewer for every state and territory', () => {
    for (const j of JURISDICTIONS) expect(STATE_MAP_SERVICES[j].viewer.url).toMatch(/^https:\/\//);
    expect(distanceKm({ lat: -37.81, lng: 144.96 }, { lat: -33.87, lng: 151.21 })).toBeCloseTo(
      713,
      -1,
    );
  });
});
