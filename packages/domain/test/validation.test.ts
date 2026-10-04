import { describe, expect, it } from 'vitest';
import {
  AU_CORE_RULE_SET,
  VALIDATION_RULES,
  acknowledgeFinding,
  analyseSale,
  createAiSuggestion,
  overrideCalculation,
  resolveRequirements,
  runCalculation,
  runValidation,
  isRetrospective,
  validationCatalogue,
  type FieldValues,
  type ValidationContext,
} from '../src/index.js';
import { NOW, cleanContext, marketValueValues, sale, selection } from './fixtures.js';

const codes = (ctx: ValidationContext) => runValidation(ctx).findings.map((f) => f.code);

function withValues(
  mutate: (v: FieldValues) => void,
  over: Partial<ValidationContext> = {},
): ValidationContext {
  const values = marketValueValues();
  mutate(values);
  return cleanContext({ values, ...over });
}

describe('validation catalogue', () => {
  it('has unique, well-formed codes', () => {
    const all = VALIDATION_RULES.map((r) => r.code);
    expect(new Set(all).size).toBe(all.length);
    for (const c of all) expect(c).toMatch(/^VAL-[A-Z]+-\d{3}$/);
    expect(validationCatalogue().length).toBe(all.length);
  });

  it('never makes blocking rules acknowledgeable', () => {
    for (const r of VALIDATION_RULES)
      if (r.severity === 'blocking') expect(r.acknowledgeable).toBe(false);
  });
});

describe('clean job', () => {
  it('has no findings at submit stage', () => {
    const r = runValidation(cleanContext());
    expect(r.findings).toEqual([]);
    expect(r.blockingCount).toBe(0);
  });

  it('flags certification and QA only at issue stage', () => {
    expect(codes(cleanContext({ stage: 'issue' })).sort()).toEqual(['VAL-CERT-001', 'VAL-QA-001']);
  });
});

describe('completeness', () => {
  it('blocks on missing mandatory fields and warns on recommended ones', () => {
    const ctx = withValues((v) => {
      delete (v.assets['a1'] as Record<string, unknown>)['valuation.highestAndBestUse'];
      delete (v.assets['a1'] as Record<string, unknown>)['location.lga'];
    });
    const r = runValidation(ctx);
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        code: 'VAL-REQ-001',
        path: 'asset:a1/field:valuation.highestAndBestUse',
      }),
    );
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        code: 'VAL-REQ-002',
        path: 'asset:a1/field:location.lga',
        severity: 'warning',
      }),
    );
  });

  it('blocks incompatible selections', () => {
    const sel = {
      ...selection,
      purpose: 'INSURANCE_REPLACEMENT' as const,
      propertyType: 'VACANT_LAND' as const,
    };
    const ctx = cleanContext({
      selection: sel,
      requirements: resolveRequirements(sel, AU_CORE_RULE_SET, marketValueValues()),
    });
    expect(codes(ctx)).toContain('VAL-SEL-001');
  });
});

describe('date logic', () => {
  it('requires a special assumption for a future valuation date', () => {
    expect(
      codes(
        withValues(
          (v) => void ((v.job as Record<string, unknown>)['dates.valuation'] = '2026-12-01'),
        ),
      ),
    ).toContain('VAL-DATE-001');
    expect(
      codes(
        withValues((v) => {
          (v.job as Record<string, unknown>)['dates.valuation'] = '2026-12-01';
          (v.job as Record<string, unknown>)['assumptions.special'] = ['As if complete'];
        }),
      ),
    ).not.toContain('VAL-DATE-001');
  });

  it('uses the jurisdiction calendar date for "today"', () => {
    // 2026-10-02T15:00Z is 3 October in Sydney but 2 October in Perth
    const ctx = (tz: string) =>
      withValues(
        (v) => void ((v.job as Record<string, unknown>)['dates.valuation'] = '2026-10-03'),
        { now: '2026-10-02T15:00:00Z', timeZone: tz },
      );
    expect(codes(ctx('Australia/Sydney'))).not.toContain('VAL-DATE-001');
    expect(codes(ctx('Australia/Perth'))).toContain('VAL-DATE-001');
  });

  it('blocks future inspections and research cut-off after issue', () => {
    const c = codes(
      withValues((v) => {
        (v.job as Record<string, unknown>)['dates.inspection'] = '2026-10-10';
        (v.job as Record<string, unknown>)['dates.researchCutOff'] = '2026-10-09';
      }),
    );
    expect(c).toContain('VAL-DATE-002');
    expect(c).toContain('VAL-DATE-003');
  });

  describe('retrospective (derived from the dates)', () => {
    const cgt = { ...selection, purpose: 'CGT' as const };
    const cgtCtx = (
      mutate: (v: FieldValues) => void = () => undefined,
      over: Partial<ValidationContext> = {},
    ) => {
      const values = marketValueValues();
      Object.assign(values.job as Record<string, unknown>, {
        'dates.valuation': '2019-06-30',
        'dates.retrospectiveDataCutOff': '2019-06-30',
        'cgt.taxEvent': 'Property became income-producing',
        'retro.chronology': ['2021 kitchen renovation'],
        'retro.evidenceBasis': 'Contemporaneous sales 2018–2019 and the owner’s 2019 photographs',
      });
      mutate(values);
      const sales = [
        sale('s1', 900_000, 640, '2019-01-10'),
        sale('s2', 950_000, 660, '2019-03-15'),
        sale('s3', 920_000, 655, '2019-05-20'),
      ];
      return cleanContext({
        selection: cgt,
        values,
        requirements: resolveRequirements(cgt, AU_CORE_RULE_SET, values),
        sales,
        saleAnalyses: sales.map((s) => analyseSale(s, { computedBy: 'valuer1', computedAt: NOW })),
        ...over,
      });
    };

    it('passes with contemporaneous evidence', () => {
      expect(codes(cgtCtx()).filter((c) => c.startsWith('VAL-DATE'))).toEqual([]);
    });

    it('treats a CGT valuation dated at inspection as current', () => {
      const ctx = cgtCtx((v) => {
        (v.job as Record<string, unknown>)['dates.valuation'] = '2026-09-30';
        delete (v.job as Record<string, unknown>)['dates.retrospectiveDataCutOff'];
      });
      expect(isRetrospective(ctx)).toBe(false);
      expect(ctx.requirements.retrospective).toBe(false);
    });

    it('treats a family law valuation dated before inspection as retrospective', () => {
      const fl = { ...selection, purpose: 'FAMILY_LAW' as const };
      const values = marketValueValues();
      (values.job as Record<string, unknown>)['dates.valuation'] = '2019-06-30';
      const ctx = cleanContext({
        selection: fl,
        values,
        requirements: resolveRequirements(fl, AU_CORE_RULE_SET, values),
      });
      expect(isRetrospective(ctx)).toBe(true);
      // the 2026 sales post-date the valuation date and have no check-only reason
      expect(codes(ctx)).toContain('VAL-DATE-005');
    });

    it('blocks commentary dated after the cut-off', () => {
      const ctx = cgtCtx(undefined, {
        commentary: [
          {
            id: 'm1',
            level: 'local',
            asAtDate: '2020-03-01',
            text: 'Post-COVID market',
            authoredBy: 'valuer1',
            authoredAt: NOW,
            sources: [],
          },
        ],
      });
      expect(codes(ctx)).toContain('VAL-DATE-004');
    });

    it('blocks hindsight sales unless used as a stated check', () => {
      const late = sale('s4', 1_000_000, 650, '2019-09-01');
      const base = cgtCtx();
      const withLate = {
        ...base,
        sales: [...base.sales, late],
        saleAnalyses: [
          ...base.saleAnalyses,
          analyseSale(late, { computedBy: 'v', computedAt: NOW }),
        ],
      };
      expect(codes(withLate)).toContain('VAL-DATE-005');
      const asCheck = { ...late, postValuationDateUse: { reason: 'Check only; not relied on' } };
      const c = codes({ ...withLate, sales: [...base.sales, asCheck] });
      expect(c).not.toContain('VAL-DATE-005');
      expect(c).toContain('VAL-DATE-006');
    });

    it('blocks a cut-off later than the valuation date', () => {
      expect(
        codes(
          cgtCtx(
            (v) =>
              void ((v.job as Record<string, unknown>)['dates.retrospectiveDataCutOff'] =
                '2019-07-31'),
          ),
        ),
      ).toContain('VAL-DATE-007');
    });
  });
});

describe('staleness and provenance', () => {
  it('warns on dated sales', () => {
    const base = cleanContext();
    const old = sale('s0', 1_000_000, 650, '2025-01-15');
    expect(codes({ ...base, sales: [...base.sales, old] })).toContain('VAL-STALE-001');
  });

  it('blocks incomplete provenance and warns on unverified evidence', () => {
    const base = cleanContext();
    const bad = sale('s9', 1_120_000, 650, '2026-08-01', {
      provenance: {
        origin: 'external_source',
        verification: 'unverified',
        capturedBy: 'v',
        capturedAt: NOW,
      },
    });
    const c = codes({ ...base, sales: [...base.sales, bad] });
    expect(c).toContain('VAL-PROV-001');
    expect(c).toContain('VAL-PROV-002');
  });

  it('blocks data whose licence does not permit reproduction', () => {
    const base = cleanContext();
    const viewOnly = {
      ...base.dataSources[1]!,
      licence: { ...base.dataSources[1]!.licence, permitsReportReproduction: false },
    };
    expect(codes({ ...base, dataSources: [base.dataSources[0]!, viewOnly] })).toContain(
      'VAL-PROV-003',
    );
  });

  it('warns on stale external data', () => {
    const base = cleanContext({ now: '2027-03-01T00:00:00Z' });
    expect(codes(base)).toContain('VAL-STALE-002');
  });
});

describe('evidence and calculations', () => {
  it('warns on too few comparables and outlier rates', () => {
    const base = cleanContext();
    expect(codes({ ...base, sales: base.sales.slice(0, 2) })).toContain('VAL-EVID-001');
    const extra = [
      sale('s4', 1_160_000, 650, '2026-08-01'),
      sale('s5', 2_900_000, 650, '2026-08-02'),
    ];
    const sales = [...base.sales, ...extra];
    expect(
      codes({
        ...base,
        sales,
        saleAnalyses: sales.map((s) => analyseSale(s, { computedBy: 'v', computedAt: NOW })),
      }),
    ).toContain('VAL-CALC-001');
  });

  it('warns when the adopted value is outside adjusted price indications', () => {
    const sales = [1_000_000, 1_050_000, 1_020_000].map((p, i) =>
      sale(`p${i}`, p, 650, '2026-08-01', { analysisBasis: 'price' }),
    );
    const ctx = withValues(
      (v) =>
        void ((v.assets['a1'] as Record<string, unknown>)['valuation.adoptedValue'] = 1_400_000),
      {
        sales,
        saleAnalyses: sales.map((s) => analyseSale(s, { computedBy: 'v', computedAt: NOW })),
      },
    );
    expect(codes(ctx)).toContain('VAL-CALC-002');
  });

  it('blocks tampered calculations and overrides without reasons', () => {
    const calc = runCalculation({
      id: 'c1',
      formulaId: 'land.rate_per_m2',
      inputs: [
        { name: 'price', value: 1_000_000, unit: 'AUD' },
        { name: 'landArea', value: 500, unit: 'm2' },
      ],
      computedBy: 'v',
      computedAt: NOW,
    });
    const tampered = { ...calc, id: 'c2', output: { ...calc.output, value: 1 } };
    const badOverride = {
      ...overrideCalculation(calc, {
        value: 1,
        reason: 'a valid long reason here',
        by: 'v',
        at: NOW,
      }),
      id: 'c3',
      override: { value: 1, reason: 'x', by: 'v', at: NOW },
    };
    const c = codes(cleanContext({ calculations: [calc, tampered, badOverride] }));
    expect(c.filter((x) => x === 'VAL-CALC-003')).toHaveLength(1);
    expect(c).toContain('VAL-CALC-004');
  });
});

describe('areas', () => {
  it('requires an approved schedule matching the current hash', () => {
    expect(codes(cleanContext({ measurementApprovals: [] }))).toContain('VAL-AREA-002');
    const base = cleanContext();
    const changed = { ...base.areaSchedules[0]!, scheduleHash: 'different' };
    expect(codes({ ...base, areaSchedules: [changed] })).toContain('VAL-AREA-002');
  });

  it('blocks non-reportable schedules and implausible site coverage', () => {
    const base = cleanContext();
    expect(
      codes({ ...base, areaSchedules: [{ ...base.areaSchedules[0]!, reportable: false }] }),
    ).toContain('VAL-AREA-001');
    expect(
      codes(
        withValues((v) => void ((v.assets['a1'] as Record<string, unknown>)['land.area'] = 150)),
      ),
    ).toContain('VAL-AREA-004');
  });
});

describe('AI, photos, risk and scope', () => {
  it('blocks submission with undecided AI suggestions', () => {
    const s = createAiSuggestion({
      id: 'ai1',
      assetId: 'a1',
      kind: 'visible_attribute',
      photoId: 'p1',
      label: 'oven',
      confidence: 0.99,
      model: { provider: 'x', model: 'y', version: '1' },
      createdAt: NOW,
    });
    expect(codes(cleanContext({ aiSuggestions: [s] }))).toContain('VAL-AI-001');
    expect(codes(cleanContext({ stage: 'draft', aiSuggestions: [s] }))).not.toContain('VAL-AI-001');
  });

  it('blocks unredacted sensitive photos selected for the report', () => {
    const photo = {
      id: 'p1',
      assetId: 'a1',
      sha256: 'x',
      sequence: 1,
      capturedAt: NOW,
      capturedBy: 'v',
      privacyFlags: ['number_plate' as const],
      privacyStatus: 'requires_action' as const,
      includeInReport: true,
    };
    expect(codes(cleanContext({ photos: [photo] }))).toContain('VAL-PHOTO-001');
    expect(codes(cleanContext({ photos: [{ ...photo, includeInReport: false }] }))).toEqual([]);
  });

  it('blocks open escalations and unsuitable limited scope', () => {
    const flag = {
      id: 'r1',
      assetId: 'a1',
      category: 'environmental' as const,
      description: 'Possible flood affectation',
      severity: 'high' as const,
      requiresEscalation: true,
      status: 'open' as const,
    };
    expect(codes(cleanContext({ riskFlags: [flag] }))).toContain('VAL-RISK-001');
    const desktop = { ...selection, scope: 'DESKTOP' as const };
    const ctx = withValues(
      (v) =>
        void ((v.assets['a1'] as Record<string, unknown>)['scope.escalationDecision'] =
          'not_required'),
      {
        selection: desktop,
        riskFlags: [{ ...flag, requiresEscalation: false }],
      },
    );
    expect(codes(ctx)).toContain('VAL-SCOPE-001');
  });

  it('blocks when the conflict check declines the engagement', () => {
    expect(
      codes(
        withValues(
          (v) =>
            void ((v.job as Record<string, unknown>)['instruction.conflictCheck'] =
              'conflict_declined'),
        ),
      ),
    ).toContain('VAL-INDEP-001');
  });
});

describe('acknowledgements', () => {
  it('lets a valuer acknowledge warnings with a reason, never blocking findings', () => {
    const base = cleanContext();
    const ctx = { ...base, sales: base.sales.slice(0, 2) };
    const first = runValidation(ctx);
    const warning = first.findings.find((f) => f.code === 'VAL-EVID-001')!;
    expect(first.unacknowledgedWarningCount).toBe(1);
    expect(() => acknowledgeFinding(warning, 'valuer1', NOW, 'ok')).toThrow(/reason/);
    const ack = acknowledgeFinding(
      warning,
      'valuer1',
      NOW,
      'Thin market; two directly comparable sales only',
    );
    const second = runValidation({ ...ctx, acknowledgements: [ack] });
    expect(second.unacknowledgedWarningCount).toBe(0);
    const blocking = runValidation(cleanContext({ measurementApprovals: [] })).findings[0]!;
    expect(() => acknowledgeFinding(blocking, 'valuer1', NOW, 'Please let me through')).toThrow(
      /must be resolved/,
    );
  });
});

describe('issue gates', () => {
  it('blocks draft rule sets and templates at issue when configured', () => {
    const c = codes(
      cleanContext({ stage: 'issue', ruleSetStatus: 'draft', templateStatus: 'draft' }),
    );
    expect(c).toEqual(expect.arrayContaining(['VAL-TPL-001', 'VAL-TPL-002']));
  });
});

describe('certification consistency', () => {
  const cert = (over: Record<string, unknown> = {}) =>
    ({
      id: 'c1',
      jobId: 'j1',
      valuer: { userId: 'valuer1', fullName: 'V', credentials: ['CPV'] },
      role: 'responsible_valuer',
      inspectionScope: 'FULL',
      inspectionScopeStatement: 'Full',
      valuationDate: '2026-09-30',
      basisOfValue: 'Market value',
      amount: { value: 1_150_000, currency: 'AUD', kind: 'value' },
      independenceStatement: 'x',
      conflictsStatement: 'x',
      assumptions: [],
      specialAssumptions: [],
      limitations: ['x'],
      standardsReliedOn: ['x'],
      clauseVersionIds: ['c@1'],
      signedAt: NOW,
      snapshotHash: 'h',
      signature: { method: 'typed_attestation', attestationText: 'x', attestationHash: 'h' },
      ...over,
    }) as never;

  it('passes when the certificate matches the report', () => {
    expect(codes(cleanContext({ certification: cert() }))).not.toContain('VAL-CERT-002');
  });

  it('blocks a certified amount, date or basis that differs from the report', () => {
    const r = runValidation(
      cleanContext({
        certification: cert({
          amount: { value: 2_000_000, currency: 'AUD', kind: 'value' },
          valuationDate: '2026-09-29',
          basisOfValue: 'Fair value',
        }),
      }),
    ).findings.filter((f) => f.code === 'VAL-CERT-002');
    expect(r).toHaveLength(3);
    expect(r[0]!.severity).toBe('blocking');
  });
});
