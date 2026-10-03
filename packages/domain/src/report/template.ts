import type { Actor } from '../core/actor.js';
import type { Instant, LocalDate } from '../core/dates.js';
import { compareDates } from '../core/dates.js';
import { DomainError } from '../core/errors.js';
import type {
  InspectionScope,
  JobSelection,
  Jurisdiction,
  PropertyType,
  ReportPurpose,
  SpecialistReviewer,
} from '../config/codes.js';
import { FIELD_BY_ID, FIELD_CATALOGUE } from '../config/fields.js';
import type { SectionId } from '../config/sections.js';
import { REPORT_SECTIONS } from '../config/sections.js';

/** Building blocks of a report template (docs/spec/09-pdf-template-schema.md). */
export type TemplateBlock =
  | { readonly type: 'heading'; readonly text: string; readonly level?: 1 | 2 | 3 }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'clause'; readonly clauseId: string }
  | {
      readonly type: 'field_table';
      readonly fields: readonly string[];
      readonly omitEmpty?: boolean;
    }
  | { readonly type: 'sales_table' }
  | { readonly type: 'rental_table' }
  | { readonly type: 'calculation_trace'; readonly formulaIds?: readonly string[] }
  | { readonly type: 'area_schedule' }
  | { readonly type: 'sketch' }
  | { readonly type: 'photo_grid'; readonly columns?: 2 | 3 }
  | { readonly type: 'map' }
  | { readonly type: 'certification' }
  | { readonly type: 'audit_metadata' }
  | { readonly type: 'page_break' };

export interface TemplateSection {
  readonly sectionId: SectionId;
  readonly title?: string;
  /** `when_required`: rendered only if the requirement resolver switched the section on. */
  readonly include: 'when_required' | 'always';
  /** `internal` sections are retained in the audit record but excluded from the client PDF. */
  readonly audience: 'client' | 'internal';
  readonly blocks: readonly TemplateBlock[];
}

export type ClauseStatus = 'placeholder' | 'draft' | 'approved' | 'retired';

export interface ClauseVersion {
  readonly clauseId: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly status: ClauseStatus;
  readonly review: readonly SpecialistReviewer[];
  readonly appliesTo?: {
    readonly purposes?: readonly ReportPurpose[];
    readonly jurisdictions?: readonly Jurisdiction[];
  };
  readonly approvedBy?: string;
  readonly approvedAt?: Instant;
}

export interface SpecialistReview {
  readonly reviewer: SpecialistReviewer;
  readonly userId: string;
  readonly at: Instant;
  readonly outcome: 'approved' | 'changes_requested';
  readonly notes: string;
}

export type TemplateStatus = 'draft' | 'in_review' | 'approved' | 'retired';

export interface TemplateVersion {
  readonly templateId: string;
  readonly version: number;
  readonly name: string;
  readonly status: TemplateStatus;
  readonly appliesTo: {
    readonly purposes?: readonly ReportPurpose[];
    readonly propertyTypes?: readonly PropertyType[];
    readonly jurisdictions?: readonly Jurisdiction[];
    readonly scopes?: readonly InspectionScope[];
    readonly clientIds?: readonly string[];
  };
  readonly effectiveFrom: LocalDate;
  readonly effectiveTo?: LocalDate;
  readonly branding: {
    readonly firmName: string;
    readonly primaryColour: string;
    readonly footerText: string;
    readonly logoAssetId?: string;
  };
  readonly watermarks: { readonly draft: string; readonly final: string };
  readonly sections: readonly TemplateSection[];
  readonly clauses: readonly ClauseVersion[];
  readonly requiredReviews: readonly SpecialistReviewer[];
  readonly reviews: readonly SpecialistReview[];
  readonly authoredBy: string;
  readonly createdAt: Instant;
  readonly approvedBy?: string;
  readonly approvedAt?: Instant;
}

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
const SECTION_IDS = new Set<string>(REPORT_SECTIONS.map((s) => s.id));

/** Paths a paragraph placeholder may reference: no expressions, no code. */
export function isAllowedPlaceholder(path: string): boolean {
  if (path.startsWith('field.')) return FIELD_BY_ID.has(path.slice('field.'.length));
  return [
    'job.reference',
    'job.purpose',
    'job.propertyType',
    'job.jurisdiction',
    'job.scope',
    'report.version',
    'report.issueDate',
    'firm.name',
    'valuer.name',
  ].includes(path);
}

export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1] as string);
}

/** Structural problems that prevent a template version being approved. */
export function lintTemplate(t: TemplateVersion): string[] {
  const problems: string[] = [];
  const clauseIds = new Set(t.clauses.map((c) => c.clauseId));
  const seen = new Set<string>();
  if (!/^#[0-9a-fA-F]{6}$/.test(t.branding.primaryColour))
    problems.push('branding colour must be #RRGGBB');
  for (const s of t.sections) {
    if (!SECTION_IDS.has(s.sectionId)) problems.push(`unknown section ${s.sectionId}`);
    if (seen.has(s.sectionId)) problems.push(`duplicate section ${s.sectionId}`);
    seen.add(s.sectionId);
    for (const b of s.blocks) {
      if (b.type === 'clause' && !clauseIds.has(b.clauseId))
        problems.push(`${s.sectionId}: clause ${b.clauseId} is not pinned`);
      if (b.type === 'field_table') {
        for (const f of b.fields)
          if (!FIELD_BY_ID.has(f)) problems.push(`${s.sectionId}: unknown field ${f}`);
      }
      if (b.type === 'paragraph' || b.type === 'heading') {
        for (const p of placeholdersIn(b.text))
          if (!isAllowedPlaceholder(p))
            problems.push(`${s.sectionId}: placeholder {{${p}}} not allowed`);
      }
    }
  }
  if (!t.sections.some((s) => s.sectionId === 'certification'))
    problems.push('a certification section is required');
  return problems;
}

/** Everything still needed before a template version can be approved for issued reports. */
export function templateApprovalBlockers(t: TemplateVersion): string[] {
  const blockers = lintTemplate(t);
  for (const c of t.clauses) {
    if (c.status !== 'approved') blockers.push(`clause ${c.clauseId}@${c.version} is ${c.status}`);
  }
  for (const reviewer of t.requiredReviews) {
    const latest = t.reviews.filter((r) => r.reviewer === reviewer).at(-1);
    if (latest?.outcome !== 'approved')
      blockers.push(`${reviewer} review not recorded as approved`);
  }
  return blockers;
}

/** Records approval by the standards owner. Authors cannot approve their own versions. */
export function approveTemplateVersion(
  t: TemplateVersion,
  actor: Actor,
  at: Instant,
): TemplateVersion {
  if (actor.kind !== 'human')
    throw new DomainError('HUMAN_ACTOR_REQUIRED', 'templates are approved by a person');
  if (actor.userId === t.authoredBy)
    throw new DomainError('SEPARATION_OF_DUTIES', 'the author cannot approve this version');
  if (t.status === 'approved' || t.status === 'retired')
    throw new DomainError('IMMUTABLE_RECORD', `template is ${t.status}`);
  const blockers = templateApprovalBlockers(t);
  if (blockers.length)
    throw new DomainError('TEMPLATE_NOT_APPROVED', 'template cannot be approved', { blockers });
  return { ...t, status: 'approved', approvedBy: actor.userId, approvedAt: at };
}

/** Records a clause approval (by the standards owner after the named specialist reviews). */
export function approveClause(c: ClauseVersion, actor: Actor, at: Instant): ClauseVersion {
  if (actor.kind !== 'human')
    throw new DomainError('HUMAN_ACTOR_REQUIRED', 'clauses are approved by a person');
  if (c.status === 'approved')
    throw new DomainError('IMMUTABLE_RECORD', 'clause version already approved');
  if (c.text.includes('PLACEHOLDER'))
    throw new DomainError('GUARD_FAILED', 'placeholder wording cannot be approved');
  return { ...c, status: 'approved', approvedBy: actor.userId, approvedAt: at };
}

function matches<T>(list: readonly T[] | undefined, v: T): boolean {
  return list === undefined || list.includes(v);
}

function specificity(t: TemplateVersion): number {
  const a = t.appliesTo;
  return (
    (a.clientIds ? 16 : 0) +
    (a.jurisdictions ? 8 : 0) +
    (a.purposes ? 4 : 0) +
    (a.propertyTypes ? 2 : 0) +
    (a.scopes ? 1 : 0)
  );
}

/** Picks the most specific approved template effective on `date` (client > jurisdiction > purpose > type > scope). */
export function selectTemplate(
  templates: readonly TemplateVersion[],
  params: { selection: JobSelection; clientId?: string; date: LocalDate; allowDraft?: boolean },
): TemplateVersion | undefined {
  const { selection: s } = params;
  return templates
    .filter(
      (t) =>
        (t.status === 'approved' || (params.allowDraft === true && t.status !== 'retired')) &&
        compareDates(t.effectiveFrom, params.date) <= 0 &&
        (t.effectiveTo === undefined || compareDates(params.date, t.effectiveTo) <= 0) &&
        matches(t.appliesTo.purposes, s.purpose) &&
        matches(t.appliesTo.propertyTypes, s.propertyType) &&
        matches(t.appliesTo.jurisdictions, s.jurisdiction) &&
        matches(t.appliesTo.scopes, s.scope) &&
        (t.appliesTo.clientIds === undefined ||
          (params.clientId !== undefined && t.appliesTo.clientIds.includes(params.clientId))),
    )
    .sort(
      (a, b) =>
        specificity(b) - specificity(a) ||
        compareDates(b.effectiveFrom, a.effectiveFrom) ||
        b.version - a.version,
    )[0];
}

/** Catalogue fields for a section in catalogue order (used by the default template). */
export const fieldsForSection = (sectionId: SectionId): string[] =>
  FIELD_CATALOGUE.filter((f) => f.section === sectionId).map((f) => f.id);
