import { describe, expect, it } from 'vitest';
import {
  AU_CORE_RULE_SET,
  DEFAULT_TEMPLATE,
  FIRM_CLAUSES,
  FIRM_DETAILS,
  FIRM_TEMPLATE,
  approveClause,
  composeReport,
  lintTemplate,
  resolveRequirements,
  templateApprovalBlockers,
  type Actor,
  type JobSelection,
  type ReportData,
  type TemplateVersion,
} from '../src/index.js';
import { NOW, cleanContext, marketValueValues, selection } from './fixtures.js';

const standardsOwner: Actor = {
  kind: 'human',
  userId: 'so1',
  orgId: 'org1',
  roles: ['STANDARDS_OWNER'],
  mfaVerified: true,
};

function reportData(sel: JobSelection = selection): ReportData {
  const ctx = cleanContext();
  const values = marketValueValues();
  return {
    report: { id: 'r1', version: 1, status: 'draft' },
    firmName: FIRM_DETAILS.name,
    job: { id: 'j1', reference: 'VAL-2026-0001', selection: sel, clientName: 'Example Lending' },
    valuerName: 'Alex Valuer',
    requirements: resolveRequirements(sel, AU_CORE_RULE_SET, values),
    values,
    assets: [{ id: 'a1', label: '10 Sample Road, Exampleton VIC 3000' }],
    sales: ctx.sales,
    saleAnalyses: ctx.saleAnalyses,
    rentals: [],
    calculations: [],
    areaSchedules: [],
    sketches: [],
    photos: [],
  };
}

describe('Fair Market Valuations template', () => {
  it('is a valid draft with wording for every clause the layout uses', () => {
    expect(lintTemplate(FIRM_TEMPLATE)).toEqual([]);
    expect(FIRM_TEMPLATE.status).toBe('draft');
    expect(FIRM_CLAUSES.map((c) => c.clauseId).sort()).toEqual(
      DEFAULT_TEMPLATE.clauses.map((c) => c.clauseId).sort(),
    );
    // drafts: a report cannot be issued on them until the standards owner approves each one
    expect(templateApprovalBlockers(FIRM_TEMPLATE)).toEqual(
      expect.arrayContaining(['clause certification-core@1 is draft']),
    );
  });

  it('can be approved clause by clause (no placeholder wording)', () => {
    for (const c of FIRM_CLAUSES)
      expect(approveClause(c, standardsOwner, NOW).status).toBe('approved');
  });

  it('never claims compliance or limits liability under a scheme it may not belong to', () => {
    for (const c of FIRM_CLAUSES) {
      expect(c.text, c.clauseId).not.toMatch(/complian|complies|AASB 113|PLACEHOLDER/i);
      expect(c.text, c.clauseId).not.toMatch(/Professional Standards Legislation/i);
      expect(c.review.length, c.clauseId).toBeGreaterThan(0);
    }
  });

  it('prints the firm details and every clause paragraph with its placeholders filled', () => {
    const template: TemplateVersion = {
      ...FIRM_TEMPLATE,
      clauses: FIRM_CLAUSES.map((c) => approveClause(c, standardsOwner, NOW)),
    };
    const report = composeReport(reportData(), template);
    expect(report.meta.firmName).toBe('Fair Market Valuations');
    expect(report.meta.firmContact).toBe(
      'fairmarketvaluations.com.au · info@fairmarketvaluations.com.au',
    );
    const assumptions = report.sections.find((s) => s.sectionId === 'assumptions');
    const paragraphs = (assumptions?.blocks ?? []).flatMap((b) =>
      b.kind === 'paragraph' ? [b.text] : [],
    );
    // limitations (7 paragraphs), reliance (3) and software (1)
    expect(paragraphs.filter((t) => t.startsWith('Date of valuation'))).toEqual([
      expect.stringContaining('as at the date of valuation, 30 September 2026.'),
    ]);
    expect(paragraphs.some((t) => t.includes('prepared for Example Lending Pty Ltd'))).toBe(true);
    expect(paragraphs.some((t) => t.startsWith('Fair Market Valuations uses software'))).toBe(true);
    const all = report.sections.flatMap((s) => s.blocks);
    expect(JSON.stringify(all)).not.toMatch(/\[unknown\]|\[not applicable\]|\{\{/);
  });

  it('refuses a logo that is not a PNG or JPEG data URL, and bad clause placeholders', () => {
    expect(
      lintTemplate({
        ...FIRM_TEMPLATE,
        branding: { ...FIRM_TEMPLATE.branding, logoDataUrl: 'https://example.com/logo.png' },
        clauses: [
          { ...FIRM_CLAUSES[0]!, text: 'Signed by {{valuer.password}}' },
          ...FIRM_CLAUSES.slice(1),
        ],
      }),
    ).toEqual([
      'the logo must be a PNG or JPEG data URL',
      'clause certification-core: placeholder {{valuer.password}} not allowed',
    ]);
  });
});
