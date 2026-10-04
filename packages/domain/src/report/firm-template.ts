import type { SpecialistReviewer } from '../config/codes.js';
import type { ClauseVersion, TemplateVersion } from './template.js';
import { DEFAULT_TEMPLATE_SECTIONS } from './default-template.js';

/**
 * Fair Market Valuations' report template. The firm has no registered name yet; this is the
 * working name and contact details supplied by the owner (go-live checklist, 4 October 2026).
 */
export const FIRM_DETAILS = {
  name: 'Fair Market Valuations',
  website: 'fairmarketvaluations.com.au',
  email: 'info@fairmarketvaluations.com.au',
} as const;

const draft = (
  clauseId: string,
  title: string,
  review: SpecialistReviewer[],
  paragraphs: readonly string[],
): ClauseVersion => ({
  clauseId,
  version: 1,
  title,
  text: paragraphs.join('\n\n'),
  status: 'draft',
  review,
});

/**
 * Draft wording for the clauses most Australian valuation reports carry, written for the firm in
 * plain English. It does not reproduce any professional body's template and makes no claim of
 * compliance with any standard. Every clause stays a draft until the standards owner approves it
 * after the named specialist reviews (and the firm's professional indemnity insurer has seen it).
 * A "liability limited by a scheme approved under Professional Standards Legislation" statement is
 * deliberately absent: it may only be used by members of an approved scheme. [REVIEW: LEGAL]
 */
export const FIRM_CLAUSES: readonly ClauseVersion[] = [
  draft(
    'certification-core',
    'Valuer’s certification',
    ['API_STANDARDS', 'LEGAL'],
    [
      '{{valuer.name}} certifies that the opinion of value in this report is the valuer’s own independent professional opinion, formed on the basis, assumptions and limitations set out in this report.',
      'The valuer inspected the property on the inspection date stated in this report, unless the report states that the inspection was restricted, kerbside or desktop. Neither the valuer nor {{firm.name}} has a pecuniary interest in the property or in the parties that could reasonably be regarded as capable of affecting this valuation, and any conflict of interest is disclosed in this report.',
      'The valuer holds the qualifications and experience to value property of this type in this location, and any registration or licence the state or territory requires. The fee for this report does not depend on the value reported.',
    ],
  ),
  draft(
    'reliance-core',
    'Reliance and third parties',
    ['LEGAL'],
    [
      'This report has been prepared for {{field.instruction.clientEntity}} for the purpose stated in this report ({{job.purpose}}). Only the client and the intended users named in this report may rely on it, and only for that purpose. {{firm.name}} accepts no responsibility to any other person, or for any other use, unless we have agreed to it in writing.',
      'Neither the whole nor any part of this report, nor any reference to it, may be published in any document, statement or medium without our written approval of the form and context in which it appears.',
      'This report must be read as a whole. Individual sections, figures or extracts should not be relied on in isolation.',
    ],
  ),
  draft(
    'limitations-core',
    'General assumptions and limitations',
    ['API_STANDARDS', 'LEGAL', 'TAX'],
    [
      'Date of valuation and market movement. The value is our opinion as at the date of valuation, {{field.dates.valuation}}. Values change over time and with market conditions. We recommend that this valuation not be relied on more than three months after the date of valuation, or sooner if the reader becomes aware of anything that may affect the value. We accept no responsibility for changes in value after the date of valuation.',
      'Title. Unless this report says otherwise, we have not searched the title. The valuation assumes the property is held in fee simple, with a clear title free of encumbrances, easements, covenants, caveats, leases or other interests that would affect its value, other than those noted in this report.',
      'Planning and approvals. Zoning and planning information comes from the sources named in this report. Unless this report says otherwise, we have assumed the property’s current use and improvements are lawful and that all required approvals and certificates have been obtained. Formal planning and building certificates should be obtained if this matters to the reader.',
      'Structure, services and pests. We are not building surveyors, engineers or pest inspectors. Our inspection was visual and limited to the parts of the property that were readily accessible. We have not tested services or inspected roof spaces, sub-floors or areas that were covered, unexposed or inaccessible, and we cannot comment on matters that only such inspections would reveal. Unless this report says otherwise, we have assumed the improvements are free of structural defects, rot, and termite or other pest infestation, and that services are connected and in working order.',
      'Contamination and environmental risk. We are not experts in identifying contamination or environmental hazards. Unless this report says otherwise, we have assumed the land is not contaminated, that the improvements contain no hazardous materials (including asbestos or combustible cladding) that would affect value, and that the property is not affected by flood, bushfire, landslip or similar risks beyond those noted in this report. If any of these assumptions is wrong, the value may be affected.',
      'Information supplied by others. We have relied on information supplied by the client and by third parties, including sales, title and planning information. We have assumed it is accurate and complete, and we accept no responsibility if it is not, except where our own checks should reasonably have revealed the error.',
      'Goods and services tax (GST). Unless this report says otherwise, values of residential property include any GST that may apply, and values of commercial and industrial property exclude GST.',
    ],
  ),
  draft(
    'restricted-limitation',
    'Restricted or kerbside inspection',
    ['API_STANDARDS'],
    [
      'The inspection of this property was limited ({{job.scope}}). The valuer did not inspect the interior of the improvements, or inspected only part of the property, as described in this report. We have assumed that the parts not inspected are of a standard, condition and layout consistent with those that were inspected and with the information supplied, and that there are no defects or other features that would affect the value. If this assumption is wrong, the value may differ materially, and we reserve the right to review this valuation after a full inspection.',
    ],
  ),
  draft(
    'desktop-limitation',
    'Desktop assessment',
    ['API_STANDARDS'],
    [
      'This is a desktop assessment: the valuer has not inspected the property. It relies on the records and data sources listed in this report, which we have not been able to verify on site. We have assumed the property is in a condition consistent with its age and the information available, with no defects, unapproved works or other features that would affect its value. A desktop assessment carries more risk than a valuation with a full inspection, and the reader should take this into account.',
    ],
  ),
  draft(
    'retrospective-cutoff',
    'Retrospective valuation',
    ['TAX', 'API_STANDARDS'],
    [
      'This is a retrospective valuation. The value is our opinion as at {{field.dates.valuation}}, which is earlier than the date of our inspection or of this report. We have had regard only to information that was known, or could reasonably have been known, at the date of valuation, including sales agreed by that date. Where later information is mentioned, it is used only as a check and is identified as such.',
      'The condition of the property at the date of valuation has been assessed from our inspection, the information supplied and historical records, and may differ from its condition when we inspected it.',
    ],
  ),
  draft(
    'expert-declaration',
    'Expert’s declaration',
    ['FAMILY_LAW'],
    [
      '{{valuer.name}} declares that they understand their overriding duty is to assist the Court impartially on matters within their expertise, and that this duty prevails over any obligation to the party who instructed or pays them.',
      'The opinions in this report are the valuer’s own and are based on their specialised knowledge, training and experience. The facts, matters and assumptions on which each opinion is based are stated in this report. The valuer has made the enquiries they believe are desirable and appropriate, and, to their knowledge, no matters of significance that they regard as relevant have been withheld. Any question that falls outside their expertise is identified as such.',
    ],
  ),
  draft(
    'fair-value-disclosure',
    'Fair value basis',
    ['ACCOUNTING'],
    [
      'This valuation is of fair value for financial reporting, which Australian Accounting Standard AASB 13 Fair Value Measurement describes as the price that would be received to sell an asset in an orderly transaction between market participants at the measurement date. The valuation adopts the highest and best use of the asset from the perspective of market participants and considers the principal market for the asset (or, if there is none, the most advantageous market).',
      'The valuation techniques, the significant inputs and the level of the fair value hierarchy are set out in this report. The unit of account, the classification of the asset and the accounting treatment of this valuation are matters for the reporting entity and its auditors.',
    ],
  ),
  draft(
    'insurance-cost-data',
    'Replacement cost estimate',
    ['QUANTITY_SURVEYOR'],
    [
      'The amount stated is an estimate of the cost to reinstate or replace the improvements, for insurance purposes, at the date of the estimate. It is not a market value and not a quantity surveyor’s cost plan. It is based on construction cost data, the areas stated in this report and the allowances listed, including demolition and removal of debris, professional fees and cost escalation.',
      'Actual costs at the time of any rebuilding may differ, for example because of changes in building regulations, the availability of trades and materials, or the extent of the damage. The sum insured should be reviewed regularly. This report does not interpret the terms of any insurance policy.',
    ],
  ),
  draft(
    'area-disclaimer',
    'Areas and measurements',
    ['API_STANDARDS'],
    [
      'Areas are approximate. They are calculated from measurements taken on site or from the plans and records named in this report, on the measurement basis stated. They are not a survey and should not be relied on as one. If accurate areas are important, a survey by a registered surveyor should be obtained. A material difference in area may affect the value.',
    ],
  ),
  draft(
    'ai-assistance',
    'Use of software tools',
    ['API_STANDARDS', 'PRIVACY'],
    [
      '{{firm.name}} uses software to capture inspection notes and photographs, check areas and calculations, and assemble this report. Any software suggestion, including automated classification of photographs, is reviewed by the valuer, who accepts, edits or rejects it. The opinions, the value and the certification in this report are the valuer’s, not those of any software.',
    ],
  ),
];

/** The firm's standard report: the generic section layout with the firm's branding and clauses. */
export const FIRM_TEMPLATE: TemplateVersion = {
  templateId: 'fmv-standard',
  version: 1,
  name: `${FIRM_DETAILS.name} standard report`,
  status: 'draft',
  appliesTo: {},
  effectiveFrom: '2026-10-01',
  branding: {
    firmName: FIRM_DETAILS.name,
    primaryColour: '#1F3A5F',
    footerText: 'Confidential — prepared for the intended users only',
    website: FIRM_DETAILS.website,
    email: FIRM_DETAILS.email,
  },
  watermarks: {
    draft: 'DRAFT — NOT FOR RELIANCE',
    final: 'FINAL v{{report.version}} — issued {{report.issueDate}}',
  },
  sections: DEFAULT_TEMPLATE_SECTIONS,
  clauses: FIRM_CLAUSES,
  requiredReviews: ['API_STANDARDS', 'LEGAL'],
  reviews: [],
  authoredBy: 'system-seed',
  createdAt: '2026-10-04T00:00:00Z',
};
