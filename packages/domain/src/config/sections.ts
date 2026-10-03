/**
 * Report sections in presentation order. Requirement rules switch sections on; templates
 * decide how each section renders.
 */
export const REPORT_SECTIONS = [
  { id: 'instructions', title: 'Instructions and engagement' },
  { id: 'scope', title: 'Scope of work and inspection' },
  { id: 'restricted_access', title: 'Inspection limitations' },
  { id: 'desktop_data_register', title: 'Desktop data register' },
  { id: 'basis', title: 'Basis of value, interest valued and key dates' },
  { id: 'expert_compliance', title: 'Expert witness matters' },
  { id: 'tax_context', title: 'Taxation context and chronology' },
  { id: 'location', title: 'Location and title' },
  { id: 'planning', title: 'Planning controls' },
  { id: 'land', title: 'Site description' },
  { id: 'improvements', title: 'Improvements' },
  { id: 'areas', title: 'Areas and measurement' },
  { id: 'occupancy', title: 'Occupancy' },
  { id: 'tenancy_schedule', title: 'Tenancy schedule and income' },
  { id: 'retail_metrics', title: 'Retail trading context' },
  { id: 'specialised', title: 'Specialised components' },
  { id: 'market', title: 'Market commentary' },
  { id: 'hbu', title: 'Highest and best use' },
  { id: 'sales_evidence', title: 'Sales evidence' },
  { id: 'rental_evidence', title: 'Rental evidence' },
  { id: 'valuation_approach', title: 'Valuation approach' },
  { id: 'income_approach', title: 'Income approach' },
  { id: 'cost_approach', title: 'Replacement cost assessment' },
  { id: 'rental_determination', title: 'Market rent determination' },
  { id: 'insurance', title: 'Insurance assessment' },
  { id: 'fair_value', title: 'Fair value measurement disclosures' },
  { id: 'reconciliation', title: 'Reconciliation and valuation' },
  { id: 'portfolio_summary', title: 'Portfolio summary' },
  { id: 'risk', title: 'Risk and marketability' },
  { id: 'assumptions', title: 'Assumptions, special assumptions and limitations' },
  { id: 'certification', title: 'Certification' },
  { id: 'photos', title: 'Photographs' },
  { id: 'appendices', title: 'Appendices' },
  { id: 'audit_metadata', title: 'Report metadata' },
] as const;

export type SectionId = (typeof REPORT_SECTIONS)[number]['id'];

export const SECTION_ORDER: ReadonlyMap<SectionId, number> = new Map(
  REPORT_SECTIONS.map((s, i) => [s.id, i]),
);

export function sortSections(ids: Iterable<SectionId>): SectionId[] {
  return [...new Set(ids)].sort(
    (a, b) => (SECTION_ORDER.get(a) ?? 0) - (SECTION_ORDER.get(b) ?? 0),
  );
}

export function sectionTitle(id: SectionId): string {
  return REPORT_SECTIONS.find((s) => s.id === id)?.title ?? id;
}
