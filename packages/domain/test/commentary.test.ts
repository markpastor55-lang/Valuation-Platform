import { describe, expect, it } from 'vitest';
import {
  AU_CORE_RULE_SET,
  COMMENTARY_MIN_CHARS,
  DEFAULT_TEMPLATE,
  SAMPLE_COMMENTARY_LIBRARY,
  commentaryLocalities,
  commentaryModuleProblems,
  commentaryRecord,
  composeReport,
  currentCommentary,
  localCommentaryDate,
  resolveRequirements,
  runValidation,
  selectCommentary,
  type CommentaryModule,
  type CommentaryQuery,
  type JobSelection,
  type MarketCommentary,
  type ReportData,
} from '../src/index.js';
import { NOW, cleanContext, marketValueValues, selection } from './fixtures.js';

const query = (over: Partial<CommentaryQuery> = {}): CommentaryQuery => ({
  propertyType: 'RESIDENTIAL',
  jurisdiction: 'VIC',
  localities: ['Exampleton', 'Example City Council'],
  valuationDate: '2026-10-01',
  ...over,
});

const ids = (q: CommentaryQuery, library = SAMPLE_COMMENTARY_LIBRARY) =>
  selectCommentary(library, q).map((s) => s.modules.map((m) => `${m.moduleId}@${m.version}`));

const codes = (ctx: ReturnType<typeof cleanContext>) =>
  runValidation(ctx).findings.map((f) => f.code);

describe('market commentary library', () => {
  it('matches national, state and local paragraphs to the property type and suburb', () => {
    const unit = selectCommentary(
      SAMPLE_COMMENTARY_LIBRARY,
      query({ propertyType: 'RESIDENTIAL_UNIT' }),
    );
    expect(unit.map((s) => s.modules.map((m) => m.moduleId))).toEqual([
      ['au-overview', 'au-units'],
      ['vic-overview', 'vic-units'],
      ['local-exampleton', 'local-exampleton-units'],
    ]);
    expect(unit.map((s) => s.heading)).toEqual([
      'National market',
      'State market — Victoria',
      'Local market — Exampleton',
    ]);
    expect(unit.map((s) => s.fieldId)).toEqual(['market.national', 'market.state', 'market.local']);
    expect(unit[0]?.topics).toContain('Investor lending, rents and new apartment supply');
    expect(unit.every((s) => s.coversPropertyType && !s.stale && s.notes.length === 0)).toBe(true);
    // overview first, then the property-type paragraph
    expect(unit[0]?.text.startsWith('Australian property markets')).toBe(true);
    expect(unit[0]?.text).toContain('\n\nApartments and units have generally');

    expect(ids(query())).toEqual([
      ['au-overview@2', 'au-houses@2'],
      ['vic-overview@1', 'vic-houses@1'],
      ['local-exampleton@1'],
    ]);
  });

  it('gives a retrospective valuation the commentary of its day, never later', () => {
    const q = query({
      jurisdiction: 'NSW',
      localities: commentaryLocalities('3 Example Street, Sampleville NSW 2000'),
      valuationDate: '2019-06-30',
    });
    expect(ids(q)).toEqual([
      ['au-overview@1', 'au-houses@1'],
      ['nsw-overview@1'],
      ['local-sampleville@1'],
    ]);
    const [, state] = selectCommentary(SAMPLE_COMMENTARY_LIBRARY, q);
    expect(state?.coversPropertyType).toBe(false);
    expect(state?.notes[0]).toMatch(/No state paragraph is written for residential house/);
    for (const s of selectCommentary(SAMPLE_COMMENTARY_LIBRARY, q))
      for (const m of s.modules) expect(m.asAtDate <= '2019-06-30').toBe(true);
  });

  it('flags commentary that is dated for the valuation date', () => {
    const [national, , local] = selectCommentary(
      SAMPLE_COMMENTARY_LIBRARY,
      query({ jurisdiction: 'NSW', localities: ['Sampleville'], valuationDate: '2023-06-30' }),
    );
    expect(national).toMatchObject({ asAtDate: '2019-06-30', ageMonths: 48, stale: true });
    expect(national?.notes[0]).toMatch(/48 months before the valuation date/);
    expect(local?.stale).toBe(true);
  });

  it('reports gaps instead of guessing when nothing fits', () => {
    const [national, state, local] = selectCommentary(
      SAMPLE_COMMENTARY_LIBRARY,
      query({
        propertyType: 'COMMERCIAL_OFFICE',
        jurisdiction: 'SA',
        localities: ['Nowhere Flat'],
      }),
    );
    expect(national?.modules.map((m) => m.moduleId)).toEqual(['au-overview', 'au-office']);
    expect(state?.modules.map((m) => m.moduleId)).toEqual(['sa-overview']);
    expect(state?.notes[0]).toMatch(/No state paragraph is written for commercial — office/);
    expect(local).toMatchObject({ modules: [], text: '', stale: false });
    expect(local?.notes[0]).toMatch(/no approved local commentary/);
    expect(local?.topics).toContain('Competing office space, vacancy and effective rents');
  });

  it('offers only approved paragraphs', () => {
    const base = SAMPLE_COMMENTARY_LIBRARY.find(
      (m) => m.moduleId === 'au-overview' && m.version === 2,
    ) as CommentaryModule;
    const library = [
      ...SAMPLE_COMMENTARY_LIBRARY,
      { ...base, version: 3, asAtDate: '2026-09-30', status: 'draft' as const },
      { ...base, version: 4, asAtDate: '2026-09-30', status: 'retired' as const },
    ];
    expect(ids(query(), library)[0]).toEqual(['au-overview@2', 'au-houses@2']);
  });

  it('keeps the demonstration library valid and full enough for every demo suburb', () => {
    for (const m of SAMPLE_COMMENTARY_LIBRARY)
      expect(commentaryModuleProblems(m), `${m.moduleId}@${m.version}`).toEqual([]);
    const demo: [
      CommentaryQuery['jurisdiction'],
      string,
      CommentaryQuery['propertyType'],
      string,
    ][] = [
      ['VIC', '10 Sample Road, Exampleton VIC 3000', 'RESIDENTIAL', '2026-10-01'],
      [
        'VIC',
        'Unit 5, 18 Harbour View Lane, Exampleton VIC 3000',
        'RESIDENTIAL_UNIT',
        '2026-10-01',
      ],
      ['VIC', '7 Placeholder Parade, Mockbury VIC 3011', 'RESIDENTIAL', '2026-10-01'],
      ['NSW', '3 Example Street, Sampleville NSW 2000', 'RESIDENTIAL', '2019-06-30'],
      ['QLD', '15 Test Crescent, Demo Heights QLD 4000', 'RESIDENTIAL', '2026-10-01'],
      ['WA', '41 Trial Way, Testford WA 6000', 'RESIDENTIAL', '2026-10-01'],
    ];
    for (const [jurisdiction, address, propertyType, valuationDate] of demo)
      for (const s of selectCommentary(SAMPLE_COMMENTARY_LIBRARY, {
        jurisdiction,
        propertyType,
        valuationDate,
        localities: commentaryLocalities(address),
      }))
        expect(s.text.length, `${address} ${s.level}`).toBeGreaterThanOrEqual(COMMENTARY_MIN_CHARS);
  });

  it('finds the suburb and council for an address', () => {
    expect(
      commentaryLocalities(
        'Unit 5, 18 Harbour View Lane, Exampleton VIC 3000',
        'Example City Council',
      ),
    ).toEqual(['Exampleton', 'Example City Council']);
    expect(commentaryLocalities('41 Trial Way, Testford WA 6000')).toEqual(['Testford']);
    expect(
      commentaryModuleProblems({
        ...SAMPLE_COMMENTARY_LIBRARY[0]!,
        level: 'local',
        sources: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        'local commentary needs a state or territory',
        'local commentary needs at least one suburb, town or council',
        'name at least one source',
      ]),
    );
  });
});

describe('market commentary requirements and checks', () => {
  const sel = (purpose: JobSelection['purpose']): JobSelection => ({ ...selection, purpose });
  const levelOf = (purpose: JobSelection['purpose'], fieldId: string) =>
    resolveRequirements(sel(purpose), AU_CORE_RULE_SET, marketValueValues()).fields.find(
      (f) => f.fieldId === fieldId,
    )?.level;

  it('requires national, state and local commentary for every value or rent report', () => {
    const purposes = [
      'MARKET_VALUE',
      'CGT',
      'FAMILY_LAW',
      'FINANCIAL_REPORTING',
      'RENTAL_ASSESSMENT',
    ] as const;
    for (const purpose of purposes)
      for (const f of ['market.national', 'market.state', 'market.local'])
        expect(levelOf(purpose, f), `${purpose} ${f}`).toBe('required');
    // a replacement cost estimate is not a market value: commentary is offered, not required
    expect(levelOf('INSURANCE_REPLACEMENT', 'market.local')).toBe('recommended');
  });

  it('asks for brief commentary to be expanded, naming the topics for the property type', () => {
    const values = marketValueValues();
    const ctx = cleanContext({
      values: { ...values, job: { ...values.job, 'market.state': 'Steady market.' } },
    });
    const finding = runValidation(ctx).findings.find((f) => f.code === 'VAL-MKT-001');
    expect(finding).toMatchObject({ severity: 'warning', path: 'job/field:market.state' });
    expect(finding?.message).toMatch(/state commentary is brief \(14 characters\)/);
    expect(finding?.message).toContain('House prices in the capital city and regions');
  });

  const record = (id: string, asAtDate: string, authoredAt = NOW): MarketCommentary => ({
    id,
    level: 'national',
    asAtDate,
    text: 'x',
    authoredBy: 'valuer1',
    authoredAt,
    sources: [],
  });

  it('expects monthly national and state commentary and ignores superseded records', () => {
    // valuation date 30 September 2026: August's edition is current, July's is dated
    expect(codes(cleanContext({ commentary: [record('c1', '2026-08-31')] }))).not.toContain(
      'VAL-STALE-003',
    );
    expect(codes(cleanContext({ commentary: [record('c1', '2026-07-31')] }))).toContain(
      'VAL-STALE-003',
    );
    // a later record replaces the dated one
    expect(
      codes(
        cleanContext({
          commentary: [
            record('c1', '2025-12-31', '2026-09-01T00:00:00Z'),
            record('c2', '2026-08-31', '2026-09-02T00:00:00Z'),
          ],
        }),
      ),
    ).not.toContain('VAL-STALE-003');
    // records made in the same instant: the later as-at date is the current one, whatever the ids
    for (const ids of [
      ['a', 'b'],
      ['b', 'a'],
    ] as const)
      expect(
        currentCommentary([record(ids[0], '2026-09-30'), record(ids[1], '2026-08-31')]).map(
          (c) => c.asAtDate,
        ),
      ).toEqual(['2026-09-30']);
  });
});

describe('market commentary in the report', () => {
  function data(over: Partial<ReportData> = {}): ReportData {
    const ctx = cleanContext();
    const values = marketValueValues();
    return {
      report: { id: 'r1', version: 1, status: 'draft' },
      firmName: 'Example Valuers Pty Ltd',
      job: { id: 'j1', reference: 'VAL-2026-0001', selection, clientName: 'Example Lending' },
      valuerName: 'Alex Valuer',
      requirements: resolveRequirements(selection, AU_CORE_RULE_SET, values),
      values,
      assets: [{ id: 'a1', label: '10 Sample Road, Exampleton VIC 3000' }],
      sales: ctx.sales,
      saleAnalyses: ctx.saleAnalyses,
      rentals: [],
      calculations: [],
      areaSchedules: [],
      sketches: [],
      photos: [],
      ...over,
    };
  }
  const market = (d: ReportData) =>
    composeReport(d, DEFAULT_TEMPLATE).sections.find((s) => s.sectionId === 'market');

  it('prints each level under its own heading with the as-at date and sources', () => {
    const [national, state, local] = selectCommentary(SAMPLE_COMMENTARY_LIBRARY, query());
    const values = marketValueValues();
    const d = data({
      values: {
        job: { ...values.job, 'market.national': national?.text, 'market.state': state?.text },
        assets: { a1: { ...values.assets['a1'], 'market.local': local?.text } },
      },
      commentary: [
        commentaryRecord(national!, { id: 'c1', by: 'valuer1', at: NOW }),
        commentaryRecord(local!, { id: 'c3', assetId: 'a1', by: 'valuer1', at: NOW }),
      ],
    });
    const blocks = market(d)?.blocks ?? [];
    expect(blocks.flatMap((b) => (b.kind === 'heading' ? [b.text] : []))).toEqual([
      'National market',
      'State market — Victoria',
      'Local market — Exampleton',
    ]);
    // national: overview and houses paragraphs, then the dated note
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', style: 'normal' });
    expect(blocks[2]).toMatchObject({ kind: 'paragraph', style: 'normal' });
    expect(blocks[3]).toMatchObject({
      kind: 'paragraph',
      style: 'note',
      text: expect.stringMatching(
        /^Commentary as at 31 August 2026\. Sources: Quarterly market review, August 2026 \(demonstration content\); National Housing Accord/,
      ),
    });
    // the state commentary was typed by the valuer: no library note
    const stateAt = blocks.findIndex((b) => b.kind === 'heading' && b.text.startsWith('State'));
    expect(blocks.slice(stateAt + 1).findIndex((b) => b.kind === 'heading')).toBeGreaterThan(0);
    expect(
      blocks
        .slice(stateAt + 1, stateAt + 4)
        .some((b) => b.kind === 'paragraph' && b.style === 'note'),
    ).toBe(false);
  });

  it('marks missing required commentary and blocks a final report', () => {
    const values = marketValueValues();
    const { ['market.state']: _omit, ...job } = values.job;
    const d = data({ values: { ...values, job } });
    const blocks = market(d)?.blocks ?? [];
    expect(blocks).toContainEqual({
      kind: 'paragraph',
      text: '[Not provided]',
      style: 'placeholder',
    });
    const final = composeReport(
      { ...d, report: { id: 'r1', version: 1, status: 'final', issueDate: '2026-10-02' } },
      DEFAULT_TEMPLATE,
    );
    expect(final.problems.map((p) => p.message)).toContain(
      'State market — Victoria commentary is required',
    );
  });
});

describe('local commentary is current when the report is prepared', () => {
  const local = (asAtDate: string, library = [{ moduleId: 'local-exampleton', version: 1 }]) =>
    ({
      id: 'l1',
      level: 'local',
      assetId: 'a1',
      asAtDate,
      text: 'x',
      authoredBy: 'valuer1',
      authoredAt: NOW,
      sources: [],
      library,
    }) satisfies MarketCommentary;
  const exampleton = SAMPLE_COMMENTARY_LIBRARY.find((m) => m.moduleId === 'local-exampleton')!;
  const updated: CommentaryModule = { ...exampleton, version: 2, asAtDate: '2026-10-01' };
  const findings = (ctx: ReturnType<typeof cleanContext>) =>
    runValidation(ctx).findings.filter((f) => f.code === 'VAL-MKT-002');

  it('dates local commentary to today for a current valuation, the valuation date otherwise', () => {
    expect(localCommentaryDate('2026-09-30', false, '2026-10-02')).toBe('2026-10-02');
    expect(localCommentaryDate('2026-09-30', true, '2026-10-02')).toBe('2026-09-30');
    // a valuation dated ahead of today is never given commentary from before it is due
    expect(localCommentaryDate('2026-10-09', false, '2026-10-02')).toBe('2026-10-09');
  });

  it('offers the newest local paragraph up to today, but national and state only to the valuation date', () => {
    const library = [...SAMPLE_COMMENTARY_LIBRARY, updated];
    const [national, , suburb] = selectCommentary(
      library,
      query({ valuationDate: '2026-09-30', localAsAt: '2026-10-02' }),
    );
    expect(suburb?.modules.map((m) => `${m.moduleId}@${m.version}`)).toEqual([
      'local-exampleton@2',
    ]);
    expect(suburb?.dueAsAt).toBe('2026-10-02');
    expect(national?.dueAsAt).toBe('2026-09-30');
    expect(national?.modules.every((m) => m.asAtDate <= '2026-09-30')).toBe(true);
  });

  it('asks for newer approved local commentary before the job goes to QA, never at issue', () => {
    const library = [...SAMPLE_COMMENTARY_LIBRARY, updated];
    const ctx = cleanContext({ commentary: [local('2026-08-31')], commentaryLibrary: library });
    expect(findings(ctx).map((f) => f.message)).toEqual([
      'newer local commentary has been approved (Exampleton (demonstration suburb), as at 2026-10-01); use it before the report goes out',
    ]);
    expect(findings({ ...ctx, stage: 'issue' })).toEqual([]);
    // the up-to-date paragraph clears it
    expect(
      findings(cleanContext({ commentary: [local('2026-10-01')], commentaryLibrary: library })),
    ).toEqual([]);
  });

  it('flags local commentary more than a month old at the time the report is prepared', () => {
    const ctx = cleanContext({ commentary: [local('2026-07-15')] });
    expect(findings(ctx)[0]?.message).toMatch(/2 months before today \(limit 1\)/);
    // the valuation-date rule leaves current local commentary to VAL-MKT-002
    expect(codes(ctx)).not.toContain('VAL-STALE-003');
  });

  it('judges local commentary in a retrospective valuation against the valuation date', () => {
    const values = marketValueValues();
    const retro = {
      ...values,
      job: { ...values.job, 'dates.valuation': '2026-06-30', 'retro.evidenceBasis': 'Sales' },
    };
    const ctx = cleanContext({ values: retro, commentary: [local('2026-03-31')] });
    expect(findings(ctx)).toEqual([]);
    expect(codes(ctx)).toContain('VAL-STALE-003');
  });
});
