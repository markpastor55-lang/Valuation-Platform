import { FIELD_BY_ID } from './fields.js';
import type { SectionId } from './sections.js';

/**
 * The input tabs a valuer works through, in order. Every report section belongs to exactly one tab,
 * so the fields a job needs (from the requirements) fall into these tabs automatically. Mobile and
 * web use the same grouping. QA is not an input tab: it opens when the valuer sends the job to QA.
 */
export const INPUT_TABS = [
  {
    id: 'job',
    title: 'Job',
    description: 'Client, purpose, key dates and instructions',
    sections: ['instructions', 'basis', 'expert_compliance', 'tax_context', 'retrospective'],
  },
  {
    id: 'property',
    title: 'Property',
    description: 'Address, title, site, planning and occupancy',
    sections: [
      'location',
      'strata',
      'planning',
      'land',
      'occupancy',
      'tenancy_schedule',
      'retail_metrics',
      'desktop_data_register',
    ],
  },
  {
    id: 'inspection',
    title: 'Inspection',
    description: 'What you saw on site, building area and sketch notes',
    sections: ['scope', 'restricted_access', 'improvements', 'areas', 'specialised', 'photos'],
  },
  {
    id: 'evidence',
    title: 'Sales & market',
    description: 'Comparable sales, rental evidence and market commentary',
    sections: ['sales_evidence', 'rental_evidence', 'market'],
  },
  {
    id: 'valuation',
    title: 'Valuation',
    description: 'Approach, adopted value, risk and assumptions',
    sections: [
      'hbu',
      'valuation_approach',
      'income_approach',
      'cost_approach',
      'rental_determination',
      'insurance',
      'fair_value',
      'reconciliation',
      'portfolio_summary',
      'risk',
      'assumptions',
    ],
  },
  {
    id: 'review',
    title: 'Review',
    description: 'Checks, certification and sending to QA',
    sections: ['certification', 'appendices', 'audit_metadata'],
  },
] as const satisfies readonly {
  id: string;
  title: string;
  description: string;
  sections: readonly SectionId[];
}[];

export type InputTabId = (typeof INPUT_TABS)[number]['id'];

const TAB_BY_SECTION: ReadonlyMap<SectionId, InputTabId> = new Map(
  INPUT_TABS.flatMap((t) => t.sections.map((s): [SectionId, InputTabId] => [s, t.id])),
);

export function inputTabForSection(section: SectionId): InputTabId {
  return TAB_BY_SECTION.get(section) ?? 'review';
}

/** The tab a field is captured on, or undefined for an unknown field. */
export function inputTabForField(fieldId: string): InputTabId | undefined {
  const def = FIELD_BY_ID.get(fieldId);
  return def ? inputTabForSection(def.section) : undefined;
}
