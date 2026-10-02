import type { SpecialistReviewer } from '../config/codes.js';
import type { SectionId } from '../config/sections.js';
import { REPORT_SECTIONS } from '../config/sections.js';
import type { ClauseVersion, TemplateBlock, TemplateSection, TemplateVersion } from './template.js';
import { fieldsForSection } from './template.js';

const placeholder = (
  clauseId: string,
  title: string,
  review: SpecialistReviewer[],
): ClauseVersion => ({
  clauseId,
  version: 1,
  title,
  text: `PLACEHOLDER — ${title}: wording to be authored by the firm and approved by the standards owner after ${review.join(', ')} review. Not for issue.`,
  status: 'placeholder',
  review,
});

/**
 * Clause library seed. Every clause is a placeholder: the platform does not ship proprietary
 * professional-body templates or legal wording. Firms author their own wording, which is
 * versioned and approved before it can appear in an issued report.
 */
export const SEED_CLAUSES: readonly ClauseVersion[] = [
  placeholder('certification-core', 'Valuer certification', ['API_STANDARDS', 'LEGAL']),
  placeholder('reliance-core', 'Reliance and third parties', ['LEGAL']),
  placeholder('limitations-core', 'General limitations', ['API_STANDARDS', 'LEGAL']),
  placeholder('restricted-limitation', 'Restricted / kerbside inspection limitation', [
    'API_STANDARDS',
  ]),
  placeholder('desktop-limitation', 'Desktop assessment limitation', ['API_STANDARDS']),
  placeholder('retrospective-cutoff', 'Retrospective information cut-off', [
    'TAX',
    'API_STANDARDS',
  ]),
  placeholder('expert-declaration', 'Expert witness declaration', ['FAMILY_LAW']),
  placeholder('fair-value-disclosure', 'Fair value measurement basis', ['ACCOUNTING']),
  placeholder('insurance-cost-data', 'Construction cost data and estimate limitations', [
    'QUANTITY_SURVEYOR',
  ]),
  placeholder('area-disclaimer', 'Area measurement and sketch disclaimer', ['API_STANDARDS']),
  placeholder('ai-assistance', 'Use of software-assisted classification', [
    'API_STANDARDS',
    'PRIVACY',
  ]),
];

const ft = (sectionId: SectionId): TemplateBlock => ({
  type: 'field_table',
  fields: fieldsForSection(sectionId),
  omitEmpty: true,
});
const clause = (clauseId: string): TemplateBlock => ({ type: 'clause', clauseId });

const EXTRA_BLOCKS: Partial<Record<SectionId, TemplateBlock[]>> = {
  instructions: [ft('instructions')],
  restricted_access: [ft('restricted_access'), clause('restricted-limitation')],
  desktop_data_register: [ft('desktop_data_register'), clause('desktop-limitation')],
  expert_compliance: [ft('expert_compliance'), clause('expert-declaration')],
  tax_context: [ft('tax_context'), clause('retrospective-cutoff')],
  location: [ft('location'), { type: 'map' }],
  areas: [ft('areas'), { type: 'area_schedule' }, { type: 'sketch' }, clause('area-disclaimer')],
  sales_evidence: [{ type: 'sales_table' }],
  rental_evidence: [{ type: 'rental_table' }],
  valuation_approach: [
    ft('valuation_approach'),
    {
      type: 'calculation_trace',
      formulaIds: [
        'land.rate_per_m2',
        'improvements.rate_per_m2',
        'comparison.adjusted_rate',
        'comparison.adjusted_price',
      ],
    },
  ],
  income_approach: [
    ft('income_approach'),
    {
      type: 'calculation_trace',
      formulaIds: ['income.initial_yield', 'income.capitalised_value', 'income.wale'],
    },
  ],
  cost_approach: [{ type: 'calculation_trace', formulaIds: ['cost.replacement'] }],
  insurance: [ft('insurance'), clause('insurance-cost-data')],
  fair_value: [ft('fair_value'), clause('fair-value-disclosure')],
  assumptions: [
    ft('assumptions'),
    clause('limitations-core'),
    clause('reliance-core'),
    clause('ai-assistance'),
  ],
  certification: [{ type: 'certification' }, clause('certification-core')],
  photos: [{ type: 'photo_grid', columns: 2 }],
  appendices: [],
  audit_metadata: [{ type: 'audit_metadata' }],
};

const ALWAYS: ReadonlySet<SectionId> = new Set(['certification', 'audit_metadata']);

export const DEFAULT_TEMPLATE_SECTIONS: readonly TemplateSection[] = REPORT_SECTIONS.map((s) => ({
  sectionId: s.id,
  include: ALWAYS.has(s.id) ? 'always' : 'when_required',
  audience: 'client',
  blocks: EXTRA_BLOCKS[s.id] ?? [ft(s.id)],
}));

/** Generic Australian template seed (draft). Requires review and approval before issue. */
export const DEFAULT_TEMPLATE: TemplateVersion = {
  templateId: 'au-generic',
  version: 1,
  name: 'Generic Australian valuation report (seed)',
  status: 'draft',
  appliesTo: {},
  effectiveFrom: '2026-01-01',
  branding: {
    firmName: 'Example Valuers Pty Ltd',
    primaryColour: '#1F3A5F',
    footerText: 'Confidential — prepared for the intended users only',
  },
  watermarks: {
    draft: 'DRAFT — NOT FOR RELIANCE',
    final: 'FINAL v{{report.version}} — issued {{report.issueDate}}',
  },
  sections: DEFAULT_TEMPLATE_SECTIONS,
  clauses: SEED_CLAUSES,
  requiredReviews: ['API_STANDARDS', 'LEGAL'],
  reviews: [],
  authoredBy: 'system-seed',
  createdAt: '2026-01-01T00:00:00Z',
};
