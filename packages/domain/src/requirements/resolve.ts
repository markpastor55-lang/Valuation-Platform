import type { JobSelection, SpecialistReviewer } from '../config/codes.js';
import { FIELD_BY_ID, hasValue } from '../config/fields.js';
import type {
  FieldCondition,
  RequirementRule,
  RuleCondition,
  RuleSetVersion,
  RuleWarning,
} from '../config/rule-set.js';
import type { SectionId } from '../config/sections.js';
import { sortSections } from '../config/sections.js';
import { retrospectiveStatus } from './retrospective.js';

/** Captured values used to evaluate conditional rules and completeness. */
export interface FieldValues {
  readonly job: Readonly<Record<string, unknown>>;
  readonly assets: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export const EMPTY_VALUES: FieldValues = { job: {}, assets: {} };

export type RequirementLevel = 'required' | 'recommended';

export interface FieldRequirement {
  readonly fieldId: string;
  readonly level: RequirementLevel;
  /** Rules that produced the requirement (traceability). */
  readonly ruleIds: readonly string[];
  /** `null` = applies to the job / every asset; otherwise only the listed assets. */
  readonly assetIds: readonly string[] | null;
}

export interface SelectionIssue {
  readonly ruleId: string;
  readonly severity: 'blocking' | 'warning';
  readonly message: string;
  readonly review?: SpecialistReviewer;
}

export interface ResolvedRequirements {
  readonly ruleSetId: string;
  readonly ruleSetVersion: string;
  readonly selection: JobSelection;
  /** Derived from the dates (see `retrospectiveStatus`); retrospective rules apply when true. */
  readonly retrospective: boolean;
  readonly fields: readonly FieldRequirement[];
  readonly sections: readonly SectionId[];
  readonly warnings: readonly (RuleWarning & { ruleId: string })[];
  readonly selectionIssues: readonly SelectionIssue[];
  readonly specialistReviews: readonly SpecialistReviewer[];
  readonly formulas: readonly string[];
  readonly appliedRuleIds: readonly string[];
}

function matchesList<T>(list: readonly T[] | undefined, value: T): boolean {
  return list === undefined || list.includes(value);
}

function matchesSelection(when: RuleCondition, s: JobSelection, retrospective: boolean): boolean {
  return (
    (when.retrospective === undefined || when.retrospective === retrospective) &&
    matchesList(when.purposes, s.purpose) &&
    matchesList(when.propertyTypes, s.propertyType) &&
    matchesList(when.scopes, s.scope) &&
    matchesList(when.jurisdictions, s.jurisdiction) &&
    matchesList(when.modes, s.mode)
  );
}

function evaluateCondition(c: FieldCondition, value: unknown): boolean {
  if (c.present !== undefined) return hasValue(value) === c.present;
  if (c.equals !== undefined) return value === c.equals;
  if (c.in !== undefined) return typeof value === 'string' && c.in.includes(value);
  if (c.includes !== undefined) return Array.isArray(value) && value.includes(c.includes);
  return hasValue(value);
}

/**
 * Evaluates field conditions. Returns `false` (rule inactive), `null` (active for the job and
 * all assets) or the list of asset ids for which the asset-level conditions hold.
 */
function evaluateFieldConditions(
  conditions: readonly FieldCondition[],
  values: FieldValues,
  assetIds: readonly string[],
): false | null | string[] {
  const jobConds = conditions.filter((c) => FIELD_BY_ID.get(c.fieldId)?.level !== 'asset');
  const assetConds = conditions.filter((c) => FIELD_BY_ID.get(c.fieldId)?.level === 'asset');
  if (!jobConds.every((c) => evaluateCondition(c, values.job[c.fieldId]))) return false;
  if (assetConds.length === 0) return null;
  const matching = assetIds.filter((id) =>
    assetConds.every((c) => evaluateCondition(c, values.assets[id]?.[c.fieldId])),
  );
  return matching.length > 0 ? matching : false;
}

interface Accumulator {
  level: RequirementLevel;
  ruleIds: string[];
  assetIds: Set<string> | null;
}

function mergeRequirement(
  acc: Map<string, Accumulator>,
  fieldId: string,
  level: RequirementLevel,
  ruleId: string,
  assetIds: readonly string[] | null,
): void {
  const existing = acc.get(fieldId);
  if (!existing) {
    acc.set(fieldId, { level, ruleIds: [ruleId], assetIds: assetIds ? new Set(assetIds) : null });
    return;
  }
  // A required rule outranks a recommendation; scope widens to the union.
  if (level === 'required' && existing.level === 'recommended') {
    existing.level = 'required';
    existing.assetIds = assetIds ? new Set(assetIds) : null;
  } else if (level === existing.level && existing.assetIds !== null) {
    if (assetIds === null) existing.assetIds = null;
    else for (const id of assetIds) existing.assetIds.add(id);
  }
  existing.ruleIds.push(ruleId);
}

/**
 * Resolves the fields, sections, warnings and specialist reviews that apply to a job.
 * Pure and deterministic: the same selection, rule set and values always give the same result,
 * so mobile (offline) and server agree.
 */
export function resolveRequirements(
  selection: JobSelection,
  ruleSet: RuleSetVersion,
  values: FieldValues = EMPTY_VALUES,
  assetIds: readonly string[] = Object.keys(values.assets),
): ResolvedRequirements {
  const fields = new Map<string, Accumulator>();
  const sections = new Set<SectionId>();
  const warnings: (RuleWarning & { ruleId: string })[] = [];
  const reviews = new Set<SpecialistReviewer>();
  const formulas = new Set<string>();
  const applied: string[] = [];
  const { retrospective } = retrospectiveStatus(values);

  const apply = (rule: RequirementRule, scope: readonly string[] | null): void => {
    applied.push(rule.id);
    for (const f of rule.require ?? []) mergeRequirement(fields, f, 'required', rule.id, scope);
    for (const f of rule.recommend ?? [])
      mergeRequirement(fields, f, 'recommended', rule.id, scope);
    for (const s of rule.sections ?? []) sections.add(s);
    for (const w of rule.warnings ?? []) warnings.push({ ...w, ruleId: rule.id });
    for (const r of rule.specialistReview ?? []) reviews.add(r);
    for (const f of rule.formulas ?? []) formulas.add(f);
  };

  for (const rule of ruleSet.rules) {
    if (!matchesSelection(rule.when, selection, retrospective)) continue;
    if (!rule.when.fields || rule.when.fields.length === 0) {
      apply(rule, null);
      continue;
    }
    const scope = evaluateFieldConditions(rule.when.fields, values, assetIds);
    if (scope !== false) apply(rule, scope);
  }

  const selectionIssues: SelectionIssue[] = [];
  for (const rule of ruleSet.selectionRules) {
    if (!matchesSelection(rule.when, selection, retrospective)) continue;
    if (rule.when.fields && evaluateFieldConditions(rule.when.fields, values, assetIds) === false)
      continue;
    selectionIssues.push({
      ruleId: rule.id,
      severity: rule.severity,
      message: rule.message,
      ...(rule.review ? { review: rule.review } : {}),
    });
  }

  const fieldList: FieldRequirement[] = [...fields.entries()]
    .map(([fieldId, a]) => ({
      fieldId,
      level: a.level,
      ruleIds: [...new Set(a.ruleIds)],
      assetIds: a.assetIds ? [...a.assetIds].sort() : null,
    }))
    .sort((a, b) => a.fieldId.localeCompare(b.fieldId));

  return {
    ruleSetId: ruleSet.id,
    ruleSetVersion: ruleSet.version,
    selection,
    retrospective,
    fields: fieldList,
    sections: sortSections(sections),
    warnings,
    selectionIssues,
    specialistReviews: [...reviews].sort(),
    formulas: [...formulas].sort(),
    appliedRuleIds: applied,
  };
}

export interface MissingField {
  readonly fieldId: string;
  readonly assetId: string | null;
  readonly level: RequirementLevel;
  readonly ruleIds: readonly string[];
}

/** Lists required/recommended fields with no captured value (per asset for asset fields). */
export function findMissingFields(
  resolved: ResolvedRequirements,
  values: FieldValues,
  assetIds: readonly string[] = Object.keys(values.assets),
): MissingField[] {
  const missing: MissingField[] = [];
  for (const req of resolved.fields) {
    const def = FIELD_BY_ID.get(req.fieldId);
    if (def?.level === 'asset') {
      const targets = req.assetIds ?? assetIds;
      for (const assetId of targets) {
        if (!hasValue(values.assets[assetId]?.[req.fieldId])) {
          missing.push({ fieldId: req.fieldId, assetId, level: req.level, ruleIds: req.ruleIds });
        }
      }
    } else if (!hasValue(values.job[req.fieldId])) {
      missing.push({ fieldId: req.fieldId, assetId: null, level: req.level, ruleIds: req.ruleIds });
    }
  }
  return missing;
}

export interface RequirementDiff {
  readonly newlyRequired: readonly string[];
  readonly noLongerRequired: readonly string[];
  readonly sectionsAdded: readonly SectionId[];
  readonly sectionsRemoved: readonly SectionId[];
  /**
   * Captured values whose field is no longer required or recommended. They are **retained**
   * (never deleted) and re-appear if the selection changes back.
   */
  readonly retainedValues: readonly { fieldId: string; assetId: string | null }[];
}

/** Explains the effect of changing the selection, without discarding any captured data. */
export function diffRequirements(
  previous: ResolvedRequirements,
  next: ResolvedRequirements,
  values: FieldValues,
): RequirementDiff {
  const req = (r: ResolvedRequirements) =>
    new Set(r.fields.filter((f) => f.level === 'required').map((f) => f.fieldId));
  const all = (r: ResolvedRequirements) => new Set(r.fields.map((f) => f.fieldId));
  const prevReq = req(previous);
  const nextReq = req(next);
  const nextAll = all(next);
  const prevSections = new Set(previous.sections);
  const nextSections = new Set(next.sections);

  const retained: { fieldId: string; assetId: string | null }[] = [];
  for (const [fieldId, value] of Object.entries(values.job)) {
    if (hasValue(value) && !nextAll.has(fieldId)) retained.push({ fieldId, assetId: null });
  }
  for (const [assetId, assetValues] of Object.entries(values.assets)) {
    for (const [fieldId, value] of Object.entries(assetValues)) {
      if (hasValue(value) && !nextAll.has(fieldId)) retained.push({ fieldId, assetId });
    }
  }

  return {
    newlyRequired: [...nextReq].filter((f) => !prevReq.has(f)).sort(),
    noLongerRequired: [...prevReq].filter((f) => !nextReq.has(f)).sort(),
    sectionsAdded: next.sections.filter((s) => !prevSections.has(s)),
    sectionsRemoved: previous.sections.filter((s) => !nextSections.has(s)),
    retainedValues: retained.sort((a, b) =>
      `${a.assetId ?? ''}:${a.fieldId}`.localeCompare(`${b.assetId ?? ''}:${b.fieldId}`),
    ),
  };
}

/** Checks that every field referenced by a rule set exists in the catalogue. */
export function lintRuleSet(ruleSet: RuleSetVersion): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const rule of [...ruleSet.rules, ...ruleSet.selectionRules]) {
    if (ids.has(rule.id)) problems.push(`duplicate rule id ${rule.id}`);
    ids.add(rule.id);
    for (const c of rule.when.fields ?? []) {
      if (!FIELD_BY_ID.has(c.fieldId))
        problems.push(`${rule.id}: unknown condition field ${c.fieldId}`);
    }
  }
  for (const rule of ruleSet.rules) {
    for (const f of [...(rule.require ?? []), ...(rule.recommend ?? [])]) {
      if (!FIELD_BY_ID.has(f)) problems.push(`${rule.id}: unknown field ${f}`);
    }
  }
  return problems;
}
