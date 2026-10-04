import { describe, expect, it } from 'vitest';
import {
  AU_CORE_RULE_SET,
  DEFAULT_TEMPLATE,
  approveClause,
  approveTemplateVersion,
  composeReport,
  lintTemplate,
  resolveRequirements,
  selectTemplate,
  signCertification,
  templateApprovalBlockers,
  type Actor,
  type ReportData,
  type TemplateVersion,
} from '../src/index.js';
import { NOW, cleanContext, marketValueValues, selection, valuer } from './fixtures.js';

const standardsOwner: Actor = {
  kind: 'human',
  userId: 'so1',
  orgId: 'org1',
  roles: ['STANDARDS_OWNER'],
  mfaVerified: true,
};

function approvedTemplate(): TemplateVersion {
  const clauses = DEFAULT_TEMPLATE.clauses.map((c) =>
    approveClause(
      {
        ...c,
        text: `${c.title}: firm-approved wording for {{job.purpose}} reports.`,
        status: 'draft',
      },
      standardsOwner,
      NOW,
    ),
  );
  const t: TemplateVersion = {
    ...DEFAULT_TEMPLATE,
    clauses,
    reviews: [
      {
        reviewer: 'API_STANDARDS',
        userId: 'so1',
        at: NOW,
        outcome: 'approved',
        notes: 'Mapped to current standards',
      },
      {
        reviewer: 'LEGAL',
        userId: 'legal1',
        at: NOW,
        outcome: 'approved',
        notes: 'Reliance wording reviewed',
      },
    ],
  };
  return approveTemplateVersion(t, standardsOwner, NOW);
}

function reportData(status: 'draft' | 'final', withCert = true): ReportData {
  const ctx = cleanContext();
  const values = marketValueValues();
  return {
    report: {
      id: 'r1',
      version: 1,
      status,
      ...(status === 'final' ? { issueDate: '2026-10-02' } : {}),
    },
    firmName: 'Example Valuers Pty Ltd',
    job: { id: 'j1', reference: 'VAL-2026-0001', selection, clientName: 'Example Lending Pty Ltd' },
    valuerName: 'Alex Valuer',
    requirements: resolveRequirements(selection, AU_CORE_RULE_SET, values),
    values,
    assets: [{ id: 'a1', label: '10 Sample Road, Exampleton VIC 3000' }],
    sales: ctx.sales,
    saleAnalyses: ctx.saleAnalyses,
    rentals: [],
    calculations: ctx.saleAnalyses.flatMap((a) => [a.landRate!, a.adjusted!]),
    areaSchedules: ctx.areaSchedules,
    sketches: [{ assetId: 'a1', sketchVersionId: 'sv1', version: 1, includeInClientReport: true }],
    photos: [{ id: 'p1', renderId: 'p1', assetId: 'a1', caption: 'Front elevation', sequence: 1 }],
    ...(withCert
      ? {
          certification: signCertification(
            {
              jobId: 'j1',
              valuer: { userId: 'valuer1', fullName: 'Alex Valuer', credentials: ['AAPI', 'CPV'] },
              role: 'responsible_valuer',
              inspectionScope: 'FULL',
              inspectionScopeStatement: 'Full inspection on 30 September 2026',
              valuationDate: '2026-09-30',
              basisOfValue: 'Market value',
              amount: { value: 1_150_000, currency: 'AUD', kind: 'value' },
              independenceStatement: 'Independent',
              conflictsStatement: 'None',
              assumptions: [],
              specialAssumptions: [],
              limitations: ['No structural survey'],
              standardsReliedOn: ['Firm methodology v1'],
              clauseVersionIds: ['certification-core@1'],
            },
            {
              id: 'c1',
              actor: valuer,
              responsibleValuerId: 'valuer1',
              snapshotHash: 'h',
              at: NOW,
              attestationText: 'I certify this is my independent opinion.',
            },
          ),
        }
      : {}),
    userNames: { valuer1: 'Alex Valuer' },
    snapshotHash: status === 'final' ? 'a'.repeat(64) : undefined,
  } as ReportData;
}

describe('template governance', () => {
  it('the seed template is structurally valid but not approvable (placeholder clauses, no reviews)', () => {
    expect(lintTemplate(DEFAULT_TEMPLATE)).toEqual([]);
    const blockers = templateApprovalBlockers(DEFAULT_TEMPLATE);
    expect(blockers.some((b) => b.includes('placeholder'))).toBe(true);
    expect(blockers).toContain('API_STANDARDS review not recorded as approved');
    expect(() => approveTemplateVersion(DEFAULT_TEMPLATE, standardsOwner, NOW)).toThrow(
      /cannot be approved/,
    );
  });

  it('placeholder clause wording cannot be approved', () => {
    expect(() => approveClause(DEFAULT_TEMPLATE.clauses[0]!, standardsOwner, NOW)).toThrow(
      /placeholder/,
    );
  });

  it('authors cannot approve their own template', () => {
    const t = approvedTemplate();
    expect(t.status).toBe('approved');
    expect(() =>
      approveTemplateVersion({ ...t, status: 'draft', authoredBy: 'so1' }, standardsOwner, NOW),
    ).toThrow(/author/);
  });

  it('rejects unknown placeholders and fields', () => {
    const bad: TemplateVersion = {
      ...DEFAULT_TEMPLATE,
      sections: [
        ...DEFAULT_TEMPLATE.sections,
        {
          sectionId: 'appendices',
          include: 'always',
          audience: 'client',
          blocks: [
            { type: 'paragraph', text: '{{process.env.SECRET}}' },
            { type: 'field_table', fields: ['nope.field'] },
          ],
        },
      ],
    };
    const problems = lintTemplate(bad);
    expect(problems).toContain('appendices: placeholder {{process.env.SECRET}} not allowed');
    expect(problems).toContain('appendices: unknown field nope.field');
    expect(problems).toContain('duplicate section appendices');
  });

  it('selects the most specific approved template', () => {
    const generic = approvedTemplate();
    const vic = { ...generic, templateId: 'vic', appliesTo: { jurisdictions: ['VIC' as const] } };
    const client = { ...generic, templateId: 'client', appliesTo: { clientIds: ['c1'] } };
    expect(
      selectTemplate([generic, vic, client], { selection, date: '2026-10-02' })?.templateId,
    ).toBe('vic');
    expect(
      selectTemplate([generic, vic, client], { selection, clientId: 'c1', date: '2026-10-02' })
        ?.templateId,
    ).toBe('client');
    expect(selectTemplate([DEFAULT_TEMPLATE], { selection, date: '2026-10-02' })).toBeUndefined();
    expect(
      selectTemplate([DEFAULT_TEMPLATE], { selection, date: '2026-10-02', allowDraft: true })
        ?.templateId,
    ).toBe('au-generic');
  });
});

describe('report composition', () => {
  it('renders required sections in order with field tables, evidence and certification', () => {
    const model = composeReport(reportData('final'), approvedTemplate());
    expect(model.problems).toEqual([]);
    const ids = model.sections.map((s) => s.sectionId);
    expect(ids.slice(0, 3)).toEqual(['instructions', 'scope', 'basis']);
    expect(ids).toEqual(
      expect.arrayContaining([
        'sales_evidence',
        'improvements',
        'reconciliation',
        'certification',
        'photos',
        'audit_metadata',
      ]),
    );
    expect(ids).not.toContain('tax_context');
    const basis = model.sections.find((s) => s.sectionId === 'basis')!;
    expect(basis.blocks[0]).toMatchObject({
      kind: 'key_value',
      rows: expect.arrayContaining([['Date of valuation', '30 September 2026']]),
    });
    // Residential reports state the building area; the sketch is working notes and is not reported
    expect(ids).not.toContain('areas');
    const improvements = model.sections.find((s) => s.sectionId === 'improvements')!;
    expect(improvements.blocks[0]).toMatchObject({
      rows: expect.arrayContaining([['Building area', '216 m²']]),
    });
    expect(
      model.sections
        .flatMap((s) => s.blocks)
        .some((b) => b.kind === 'image' && b.ref.type === 'sketch'),
    ).toBe(false);
    expect(model.meta.watermark).toBe('FINAL v1 — issued 2 October 2026');
    expect(model.meta.footer).toContain('aaaaaaaaaaaa');
  });

  it('reports measured areas but never the sketch drawing where the rules need a schedule', () => {
    const ins = { ...selection, purpose: 'INSURANCE_REPLACEMENT' as const };
    const data = reportData('draft');
    const model = composeReport(
      {
        ...data,
        job: { ...data.job, selection: ins },
        requirements: resolveRequirements(ins, AU_CORE_RULE_SET, data.values),
      },
      approvedTemplate(),
    );
    const areas = model.sections.find((s) => s.sectionId === 'areas')!;
    expect(areas.blocks.find((b) => b.kind === 'table')).toMatchObject({
      rows: expect.arrayContaining([expect.arrayContaining(['Total improvement area', '216 m²'])]),
    });
    expect(areas.blocks.some((b) => b.kind === 'image')).toBe(false);
  });

  it('never renders data retained from a previous selection', () => {
    const data = reportData('draft');
    const values = {
      ...data.values,
      job: { ...data.values.job, 'cgt.taxEvent': 'Leftover from CGT selection' },
    };
    const model = composeReport({ ...data, values }, approvedTemplate());
    expect(JSON.stringify(model)).not.toContain('Leftover from CGT selection');
  });

  it('lists problems for a final report on a draft template, placeholder clauses or no certification', () => {
    const model = composeReport(reportData('final', false), DEFAULT_TEMPLATE);
    const problemCodes = new Set(model.problems.map((p) => p.code));
    expect(problemCodes).toEqual(
      new Set(['TPL-TEMPLATE-NOT-APPROVED', 'TPL-UNAPPROVED-CLAUSE', 'TPL-NO-CERTIFICATION']),
    );
  });

  it('drafts carry the draft watermark and no problems list', () => {
    const model = composeReport(reportData('draft', false), DEFAULT_TEMPLATE);
    expect(model.meta.watermark).toBe('DRAFT — NOT FOR RELIANCE');
    expect(model.problems).toEqual([]);
  });

  it('marks missing required fields in final reports', () => {
    const data = reportData('final');
    const values = {
      ...data.values,
      assets: { a1: { ...data.values.assets['a1'], 'valuation.marketability': '' } },
    };
    const model = composeReport({ ...data, values }, approvedTemplate());
    expect(model.problems).toContainEqual({
      code: 'TPL-MISSING-REQUIRED',
      message: 'Marketability is required',
    });
  });

  it('is deterministic', () => {
    expect(JSON.stringify(composeReport(reportData('final'), approvedTemplate()))).toBe(
      JSON.stringify(composeReport(reportData('final'), approvedTemplate())),
    );
  });
});
