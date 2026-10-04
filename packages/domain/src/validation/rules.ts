import type { LocalDate } from '../core/dates.js';
import { isAfter, isBefore, isLocalDate, localDateOf, monthsBetween } from '../core/dates.js';
import { checkDataSourceUsage } from '../core/data-source.js';
import { checkProvenance } from '../core/provenance.js';
import { hasValue } from '../config/fields.js';
import { verifyCalculation, effectiveValue } from '../calc/calculation.js';
import type { FairValueLevel } from '../calc/fair-value.js';
import { deriveFairValueLevel } from '../calc/fair-value.js';
import { detectOutliers, withinRange } from '../calc/statistics.js';
import { findMissingFields } from '../requirements/resolve.js';
import { retrospectiveStatus } from '../requirements/retrospective.js';
import { VALUER_REGISTRATION_RULES } from '../workflow/valuer-profile.js';
import { currentCommentary } from '../evidence/market.js';
import {
  COMMENTARY_FIELDS,
  COMMENTARY_LEVELS,
  commentaryLocalities,
  commentaryTopics,
  selectCommentary,
} from '../evidence/commentary-library.js';
import type { AreaSchedule } from '../geometry/area-schedule.js';
import { photoReportEligibility } from '../photo/privacy.js';
import type { RawFinding, ValidationContext, ValidationRule } from './types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const jobDate = (ctx: ValidationContext, field: string): LocalDate | undefined => {
  const v = ctx.values.job[field];
  return isLocalDate(v) ? v : undefined;
};
const today = (ctx: ValidationContext): LocalDate => localDateOf(ctx.now, ctx.timeZone);
const required = (ctx: ValidationContext, fieldId: string): boolean =>
  ctx.requirements.fields.some((f) => f.fieldId === fieldId && f.level === 'required');

/** Derived from the dates for any purpose (see `retrospectiveStatus`). */
export const isRetrospective = (ctx: ValidationContext): boolean =>
  retrospectiveStatus(ctx.values).retrospective;

/**
 * Area checks apply only where the report relies on a measured schedule: the rules require one, or
 * the valuer linked the sketch to the report. A sketch kept as working notes is not checked.
 */
function reportedSchedules(ctx: ValidationContext): readonly AreaSchedule[] {
  return ctx.areaSchedules.filter(
    (s) =>
      hasValue(ctx.values.assets[s.assetId]?.['improvements.areaSchedule']) ||
      ctx.requirements.fields.some(
        (f) =>
          f.fieldId === 'improvements.areaSchedule' &&
          (f.assetIds === null || f.assetIds.includes(s.assetId)),
      ),
  );
}

/** Information after this date may not be relied on for retrospective work. */
export function informationCutOff(ctx: ValidationContext): LocalDate | undefined {
  return jobDate(ctx, 'dates.retrospectiveDataCutOff') ?? jobDate(ctx, 'dates.valuation');
}

const isCommercial = (ctx: ValidationContext): boolean =>
  ['COMMERCIAL_OFFICE', 'COMMERCIAL_RETAIL', 'INDUSTRIAL', 'SPECIALISED_MIXED_USE'].includes(
    ctx.selection.propertyType,
  );

const ALL = ['draft', 'submit', 'issue'] as const;
const ISSUE = ['issue'] as const;

const rule = (r: ValidationRule): ValidationRule => r;

/**
 * Validation rules catalogue (docs/spec/08). Codes are stable; retire rather than renumber.
 * The generated catalogue table is produced from this array.
 */
export const VALIDATION_RULES: readonly ValidationRule[] = [
  // ── Selection and completeness ───────────────────────────────────────────
  rule({
    code: 'VAL-SEL-001',
    title: 'Incompatible selection',
    category: 'selection',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'The purpose, property type, scope and jurisdiction combination is not permitted by the rule set.',
    evaluate: (ctx) =>
      ctx.requirements.selectionIssues
        .filter((i) => i.severity === 'blocking')
        .map((i) => ({ path: `job/selection:${i.ruleId}`, message: i.message })),
  }),
  rule({
    code: 'VAL-SEL-002',
    title: 'Selection warning',
    category: 'selection',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description:
      'A selection-level caution from the rule set (e.g. jurisdiction-specific court or tenure).',
    evaluate: (ctx) =>
      ctx.requirements.selectionIssues
        .filter((i) => i.severity === 'warning')
        .map((i) => ({ path: `job/selection:${i.ruleId}`, message: i.message })),
  }),
  rule({
    code: 'VAL-REQ-001',
    title: 'Mandatory field missing',
    category: 'completeness',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'A field required by the selected purpose, property type, scope, jurisdiction or captured values has no value.',
    evaluate: (ctx) =>
      findMissingFields(ctx.requirements, ctx.values, ctx.assetIds)
        .filter((m) => m.level === 'required')
        .map((m) => ({
          path: `${m.assetId ? `asset:${m.assetId}` : 'job'}/field:${m.fieldId}`,
          message: `${m.fieldId} is required (${m.ruleIds.join(', ')})`,
        })),
  }),
  rule({
    code: 'VAL-REQ-002',
    title: 'Recommended field missing',
    category: 'completeness',
    severity: 'warning',
    stages: ['submit', 'issue'],
    acknowledgeable: true,
    description: 'A recommended field is empty; acknowledge with a reason if not applicable.',
    evaluate: (ctx) =>
      findMissingFields(ctx.requirements, ctx.values, ctx.assetIds)
        .filter((m) => m.level === 'recommended')
        .map((m) => ({
          path: `${m.assetId ? `asset:${m.assetId}` : 'job'}/field:${m.fieldId}`,
          message: `${m.fieldId} is recommended`,
        })),
  }),

  // ── Dates ────────────────────────────────────────────────────────────────
  rule({
    code: 'VAL-DATE-001',
    title: 'Prospective valuation date without special assumption',
    category: 'dates',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'A valuation date after today requires a recorded special assumption (e.g. "as if complete").',
    evaluate: (ctx) => {
      const v = jobDate(ctx, 'dates.valuation');
      if (!v || !isAfter(v, today(ctx)) || hasValue(ctx.values.job['assumptions.special']))
        return [];
      return [
        {
          path: 'job/field:dates.valuation',
          message: `valuation date ${v} is in the future and no special assumption is recorded`,
        },
      ];
    },
  }),
  rule({
    code: 'VAL-DATE-002',
    title: 'Inspection date in the future or after issue',
    category: 'dates',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description: 'The inspection cannot post-date today or the issue date.',
    evaluate: (ctx) => {
      const insp = jobDate(ctx, 'dates.inspection');
      if (!insp) return [];
      const issue = jobDate(ctx, 'dates.issue');
      const out: RawFinding[] = [];
      if (isAfter(insp, today(ctx)))
        out.push({
          path: 'job/field:dates.inspection',
          message: `inspection date ${insp} is in the future`,
        });
      if (issue && isAfter(insp, issue))
        out.push({
          path: 'job/field:dates.inspection',
          message: 'inspection date is after the issue date',
        });
      return out;
    },
  }),
  rule({
    code: 'VAL-DATE-003',
    title: 'Research cut-off after issue',
    category: 'dates',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description: 'The research cut-off cannot be after the issue date or today.',
    evaluate: (ctx) => {
      const cut = jobDate(ctx, 'dates.researchCutOff');
      const issue = jobDate(ctx, 'dates.issue') ?? today(ctx);
      return cut && isAfter(cut, issue)
        ? [
            {
              path: 'job/field:dates.researchCutOff',
              message: `research cut-off ${cut} is after ${issue}`,
            },
          ]
        : [];
    },
  }),
  rule({
    code: 'VAL-DATE-004',
    title: 'Commentary dated after a retrospective cut-off',
    category: 'dates',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'Market commentary must not post-date the retrospective valuation date / information cut-off.',
    review: 'TAX',
    evaluate: (ctx) => {
      if (!isRetrospective(ctx)) return [];
      const cut = informationCutOff(ctx);
      if (!cut) return [];
      return currentCommentary(ctx.commentary)
        .filter((c) => isAfter(c.asAtDate, cut))
        .map((c) => ({
          path: `commentary:${c.id}`,
          message: `${c.level} commentary as at ${c.asAtDate} post-dates the cut-off ${cut}`,
        }));
    },
  }),
  rule({
    code: 'VAL-DATE-005',
    title: 'Hindsight evidence relied on',
    category: 'dates',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'Retrospective work: evidence transacted after the cut-off may only be used as a check, with a recorded reason.',
    review: 'TAX',
    evaluate: (ctx) => {
      if (!isRetrospective(ctx)) return [];
      const cut = informationCutOff(ctx);
      if (!cut) return [];
      return [
        ...ctx.sales
          .filter((s) => isAfter(s.contractDate, cut) && !s.postValuationDateUse?.reason.trim())
          .map((s) => ({
            path: `asset:${s.assetId}/sale:${s.id}`,
            message: `sale contracted ${s.contractDate} after cut-off ${cut} without a stated check-only reason`,
          })),
        ...ctx.rentals
          .filter((r) => isAfter(r.leaseStartDate, cut) && !r.postValuationDateUse?.reason.trim())
          .map((r) => ({
            path: `asset:${r.assetId}/rental:${r.id}`,
            message: `lease commenced ${r.leaseStartDate} after cut-off ${cut} without a stated check-only reason`,
          })),
      ];
    },
  }),
  rule({
    code: 'VAL-DATE-006',
    title: 'Post-date evidence used as a check',
    category: 'dates',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description:
      'Retrospective work: post-cut-off evidence is used as a check only — confirm disclosure.',
    review: 'TAX',
    evaluate: (ctx) => {
      if (!isRetrospective(ctx)) return [];
      const cut = informationCutOff(ctx);
      if (!cut) return [];
      return ctx.sales
        .filter((s) => isAfter(s.contractDate, cut) && s.postValuationDateUse?.reason.trim())
        .map((s) => ({
          path: `asset:${s.assetId}/sale:${s.id}`,
          message: `post-date sale used as a check: ${s.postValuationDateUse?.reason ?? ''}`,
        }));
    },
  }),
  rule({
    code: 'VAL-DATE-007',
    title: 'Retrospective cut-off after valuation date',
    category: 'dates',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description: 'The retrospective data cut-off cannot be later than the valuation date.',
    review: 'TAX',
    evaluate: (ctx) => {
      const cut = jobDate(ctx, 'dates.retrospectiveDataCutOff');
      const v = jobDate(ctx, 'dates.valuation');
      return cut && v && isAfter(cut, v)
        ? [
            {
              path: 'job/field:dates.retrospectiveDataCutOff',
              message: `cut-off ${cut} is after the valuation date ${v}`,
            },
          ]
        : [];
    },
  }),
  rule({
    code: 'VAL-DATE-009',
    title: 'Inspection before instruction',
    category: 'dates',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description:
      'The inspection pre-dates the instruction; confirm the inspection relates to this engagement.',
    evaluate: (ctx) => {
      const insp = jobDate(ctx, 'dates.inspection');
      const instr = jobDate(ctx, 'dates.instruction');
      return insp && instr && isBefore(insp, instr)
        ? [
            {
              path: 'job/field:dates.inspection',
              message: 'inspection date is before the instruction date',
            },
          ]
        : [];
    },
  }),

  // ── Staleness and provenance ─────────────────────────────────────────────
  rule({
    code: 'VAL-STALE-001',
    title: 'Dated sales evidence',
    category: 'staleness',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description: 'A comparable sale is older than the configured window before the valuation date.',
    evaluate: (ctx) => {
      const v = jobDate(ctx, 'dates.valuation');
      if (!v) return [];
      const limit = isCommercial(ctx)
        ? ctx.config.commercialSaleStaleMonths
        : ctx.config.saleStaleMonths;
      return ctx.sales
        .filter((s) => monthsBetween(s.contractDate, v) > limit)
        .map((s) => ({
          path: `asset:${s.assetId}/sale:${s.id}`,
          message: `sale is ${monthsBetween(s.contractDate, v)} months before the valuation date (limit ${limit})`,
        }));
    },
  }),
  rule({
    code: 'VAL-STALE-002',
    title: 'Stale external data',
    category: 'staleness',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description: 'External data was retrieved longer ago than its data source freshness period.',
    evaluate: (ctx) =>
      ctx.provenance.flatMap(({ fieldId, assetId, provenance: p }) => {
        const source = ctx.dataSources.find((d) => d.id === p.sourceId);
        if (!source || !p.retrievedAt) return [];
        const usage = checkDataSourceUsage(source, p.retrievedAt, ctx.now, ctx.timeZone);
        return usage.stale
          ? [
              {
                path: `${assetId ? `asset:${assetId}` : 'job'}/field:${fieldId}`,
                message: `${source.name} data is stale`,
              },
            ]
          : [];
      }),
  }),
  rule({
    code: 'VAL-STALE-003',
    title: 'Dated market commentary',
    category: 'staleness',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description:
      'National or state commentary (published monthly), or local commentary in a retrospective valuation, is dated more than the configured number of months before the valuation date. Local commentary in a current valuation is checked against the day the report is prepared (VAL-MKT-002).',
    review: 'API_STANDARDS',
    evaluate: (ctx) => {
      const v = jobDate(ctx, 'dates.valuation');
      if (!v) return [];
      const retrospective = isRetrospective(ctx);
      return currentCommentary(ctx.commentary).flatMap((c) => {
        if (c.level === 'local' && !retrospective) return [];
        const months = monthsBetween(c.asAtDate, v);
        const limit = ctx.config.commentaryStaleMonths[c.level];
        return months > limit
          ? [
              {
                path: `commentary:${c.id}`,
                message: `${c.level} commentary is as at ${c.asAtDate}, ${months} months before the valuation date (limit ${limit})`,
              },
            ]
          : [];
      });
    },
  }),
  rule({
    code: 'VAL-PROV-001',
    title: 'Incomplete provenance',
    category: 'provenance',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'External data must record source, retrieval time, effective date and licence/usage basis.',
    evaluate: (ctx) => [
      ...ctx.provenance.flatMap(({ fieldId, assetId, provenance }) =>
        checkProvenance(provenance).map((i) => ({
          path: `${assetId ? `asset:${assetId}` : 'job'}/field:${fieldId}`,
          message: i.message,
        })),
      ),
      ...ctx.sales.flatMap((s) =>
        checkProvenance(s.provenance).map((i) => ({
          path: `asset:${s.assetId}/sale:${s.id}`,
          message: i.message,
        })),
      ),
      ...ctx.rentals.flatMap((r) =>
        checkProvenance(r.provenance).map((i) => ({
          path: `asset:${r.assetId}/rental:${r.id}`,
          message: i.message,
        })),
      ),
    ],
  }),
  rule({
    code: 'VAL-PROV-002',
    title: 'Unverified evidence',
    category: 'provenance',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description: 'Comparable evidence has not been verified.',
    evaluate: (ctx) => [
      ...ctx.sales
        .filter((s) => s.provenance.verification !== 'verified')
        .map((s) => ({
          path: `asset:${s.assetId}/sale:${s.id}`,
          message: `sale at ${s.address} is ${s.provenance.verification}`,
        })),
      ...ctx.rentals
        .filter((r) => r.provenance.verification !== 'verified')
        .map((r) => ({
          path: `asset:${r.assetId}/rental:${r.id}`,
          message: `rental at ${r.address} is ${r.provenance.verification}`,
        })),
    ],
  }),
  rule({
    code: 'VAL-PROV-003',
    title: 'Licence does not permit reproduction',
    category: 'provenance',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'Data from a source whose licence prohibits reproduction (or has expired) cannot appear in the report.',
    review: 'DATA_LICENSING',
    evaluate: (ctx) => {
      const used = new Set(ctx.requirements.fields.map((f) => f.fieldId));
      const entries = [
        ...ctx.provenance
          .filter((p) => used.has(p.fieldId))
          .map((p) => ({
            path: `${p.assetId ? `asset:${p.assetId}` : 'job'}/field:${p.fieldId}`,
            p: p.provenance,
          })),
        ...ctx.sales.map((s) => ({ path: `asset:${s.assetId}/sale:${s.id}`, p: s.provenance })),
        ...ctx.rentals.map((r) => ({ path: `asset:${r.assetId}/rental:${r.id}`, p: r.provenance })),
      ];
      return entries.flatMap(({ path, p }) => {
        const source = ctx.dataSources.find((d) => d.id === p.sourceId);
        if (!source || !p.retrievedAt) return [];
        const usage = checkDataSourceUsage(source, p.retrievedAt, ctx.now, ctx.timeZone);
        return usage.reproducibleInReport ? [] : [{ path, message: usage.reasons.join('; ') }];
      });
    },
  }),

  // ── Evidence and calculations ────────────────────────────────────────────
  rule({
    code: 'VAL-MKT-001',
    title: 'Brief market commentary',
    category: 'evidence',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description:
      'National, state or local market commentary is shorter than the configured minimum; it should cover the topics for the property type and location.',
    review: 'API_STANDARDS',
    evaluate: (ctx) => {
      const out: RawFinding[] = [];
      for (const level of COMMENTARY_LEVELS) {
        const fieldId = COMMENTARY_FIELDS[level];
        const req = ctx.requirements.fields.find((f) => f.fieldId === fieldId);
        if (!req) continue;
        const targets = level === 'local' ? (req.assetIds ?? ctx.assetIds) : [null];
        for (const assetId of targets) {
          const v =
            assetId === null ? ctx.values.job[fieldId] : ctx.values.assets[assetId]?.[fieldId];
          // missing commentary is reported by the completeness rules
          if (typeof v !== 'string' || !v.trim()) continue;
          const n = v.trim().length;
          if (n < ctx.config.commentaryMinChars)
            out.push({
              path: `${assetId ? `asset:${assetId}` : 'job'}/field:${fieldId}`,
              message: `${level} commentary is brief (${n} characters); cover: ${commentaryTopics(level, ctx.selection.propertyType).join('; ')}`,
            });
        }
      }
      return out;
    },
  }),
  rule({
    code: 'VAL-MKT-002',
    title: 'Local commentary not current',
    category: 'staleness',
    severity: 'warning',
    // Not at issue: an approved report is locked, so a check that changes with the calendar must
    // be settled when the valuer sends the job to QA (and when QA approves it).
    stages: ['draft', 'submit'],
    acknowledgeable: true,
    description:
      'In a current valuation, local commentary must be up to date when the report is prepared: dated within the configured number of months of today, with no newer approved local paragraph for the area in the library.',
    review: 'API_STANDARDS',
    evaluate: (ctx) => {
      if (isRetrospective(ctx)) return [];
      const v = jobDate(ctx, 'dates.valuation');
      const now = today(ctx);
      const limit = ctx.config.commentaryStaleMonths.local;
      return currentCommentary(ctx.commentary)
        .filter((c) => c.level === 'local')
        .flatMap((c) => {
          const path = `commentary:${c.id}`;
          const months = monthsBetween(c.asAtDate, now);
          if (months > limit)
            return [
              {
                path,
                message: `local commentary is as at ${c.asAtDate}, ${months} months before today (limit ${limit}); bring it up to date before the report goes out`,
              },
            ];
          if (!ctx.commentaryLibrary || !v) return [];
          const assetId = c.assetId ?? ctx.assetIds[0];
          const address = assetId ? ctx.values.assets[assetId]?.['location.address'] : undefined;
          const formatted =
            typeof address === 'object' && address !== null
              ? (address as { formatted?: unknown }).formatted
              : address;
          const council = assetId ? ctx.values.assets[assetId]?.['location.lga'] : undefined;
          if (typeof formatted !== 'string') return [];
          const local = selectCommentary(ctx.commentaryLibrary, {
            propertyType: ctx.selection.propertyType,
            jurisdiction: ctx.selection.jurisdiction,
            localities: commentaryLocalities(
              formatted,
              typeof council === 'string' ? council : undefined,
            ),
            valuationDate: v,
            localAsAt: now,
          }).find((s) => s.level === 'local');
          const newer = (local?.modules ?? []).filter((m) => isAfter(m.asAtDate, c.asAtDate));
          return newer.length
            ? [
                {
                  path,
                  message: `newer local commentary has been approved (${newer.map((m) => `${m.title}, as at ${m.asAtDate}`).join('; ')}); use it before the report goes out`,
                },
              ]
            : [];
        });
    },
  }),
  rule({
    code: 'VAL-EVID-001',
    title: 'Inadequate evidence',
    category: 'evidence',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description: 'Fewer comparables than the configured minimum for a required evidence set.',
    evaluate: (ctx) => {
      const out: RawFinding[] = [];
      for (const assetId of ctx.assetIds) {
        if (required(ctx, 'evidence.sales')) {
          const n = ctx.sales.filter((s) => s.assetId === assetId).length;
          if (n < ctx.config.minComparables)
            out.push({
              path: `asset:${assetId}/evidence:sales`,
              message: `${n} sale(s); at least ${ctx.config.minComparables} expected`,
            });
        }
        if (required(ctx, 'evidence.rentals')) {
          const n = ctx.rentals.filter((r) => r.assetId === assetId).length;
          if (n < ctx.config.minComparables)
            out.push({
              path: `asset:${assetId}/evidence:rentals`,
              message: `${n} rental(s); at least ${ctx.config.minComparables} expected`,
            });
        }
      }
      return out;
    },
  }),
  rule({
    code: 'VAL-CALC-001',
    title: 'Outlier analysed rate',
    category: 'calculation',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description: 'An analysed comparable rate lies outside Tukey fences for the evidence set.',
    evaluate: (ctx) => {
      const out: RawFinding[] = [];
      for (const assetId of ctx.assetIds) {
        const sales = ctx.sales.filter((s) => s.assetId === assetId).map((s) => s.id);
        const analyses = ctx.saleAnalyses.filter((a) => sales.includes(a.saleId));
        for (const key of ['landRate', 'buildingRate'] as const) {
          const items = analyses.flatMap((a) =>
            a[key] ? [{ id: a.saleId, value: effectiveValue(a[key]) }] : [],
          );
          for (const id of detectOutliers(items, { k: ctx.config.outlierK }).outlierIds) {
            out.push({
              path: `asset:${assetId}/sale:${id}`,
              message: `${key === 'landRate' ? 'land' : 'building'} rate is an outlier in the evidence set`,
            });
          }
        }
      }
      return out;
    },
  }),
  rule({
    code: 'VAL-CALC-002',
    title: 'Adopted value outside evidence range',
    category: 'calculation',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description:
      'The adopted value (or its implied rate) is outside the range of adjusted indications.',
    evaluate: (ctx) => {
      const out: RawFinding[] = [];
      for (const assetId of ctx.assetIds) {
        const adopted = ctx.values.assets[assetId]?.['valuation.adoptedValue'];
        if (typeof adopted !== 'number') continue;
        const saleIds = new Set(ctx.sales.filter((s) => s.assetId === assetId).map((s) => s.id));
        const adjustedFor = (formulaId: string, basis?: string) =>
          ctx.saleAnalyses.flatMap((a) =>
            saleIds.has(a.saleId) &&
            a.adjusted?.formulaId === formulaId &&
            (basis === undefined ||
              ctx.sales.find((s) => s.id === a.saleId)?.analysisBasis === basis)
              ? [effectiveValue(a.adjusted)]
              : [],
          );
        const priceInd = adjustedFor('comparison.adjusted_price');
        if (priceInd.length && !withinRange(adopted, priceInd, ctx.config.adoptedRangeTolerance)) {
          out.push({
            path: `asset:${assetId}/field:valuation.adoptedValue`,
            message: 'adopted value is outside the adjusted price range',
          });
        }
        const schedule = ctx.areaSchedules.find((s) => s.assetId === assetId);
        const rateInd = adjustedFor('comparison.adjusted_rate', 'building_rate');
        if (schedule && schedule.totalIncludedM2 > 0 && rateInd.length) {
          const implied = adopted / schedule.totalIncludedM2;
          if (!withinRange(implied, rateInd, ctx.config.adoptedRangeTolerance)) {
            out.push({
              path: `asset:${assetId}/field:valuation.adoptedValue`,
              message: `implied rate ${implied.toFixed(2)}/m² is outside the adjusted building-rate range`,
            });
          }
        }
      }
      return out;
    },
  }),
  rule({
    code: 'VAL-CALC-003',
    title: 'Calculation trace does not verify',
    category: 'calculation',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'A stored calculation no longer reproduces from its inputs and formula version (possible tampering).',
    evaluate: (ctx) =>
      ctx.calculations
        .filter((c) => {
          try {
            return !verifyCalculation(c);
          } catch {
            return true;
          }
        })
        .map((c) => ({
          path: `calc:${c.id}`,
          message: `${c.formulaId}@${c.formulaVersion} does not reproduce its stored output`,
        })),
  }),
  rule({
    code: 'VAL-CALC-004',
    title: 'Override without reason',
    category: 'calculation',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description: 'Every override must carry a substantive reason.',
    evaluate: (ctx) =>
      ctx.calculations
        .filter((c) => c.override && c.override.reason.trim().length < 15)
        .map((c) => ({ path: `calc:${c.id}`, message: 'override reason missing or too short' })),
  }),

  // ── Areas ────────────────────────────────────────────────────────────────
  rule({
    code: 'VAL-AREA-001',
    title: 'Area schedule not reportable',
    category: 'area',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'The improvement-area schedule has blocking geometry issues or an unconfirmed scale.',
    evaluate: (ctx) =>
      reportedSchedules(ctx)
        .filter((s) => !s.reportable)
        .map((s) => ({
          path: `asset:${s.assetId}/sketch:${s.sketchVersionId}`,
          message:
            s.issues
              .filter((i) => i.severity === 'blocking')
              .map((i) => `${i.code}: ${i.message}`)
              .join('; ') || `scale ${s.scaleStatus}`,
        })),
  }),
  rule({
    code: 'VAL-AREA-002',
    title: 'Area schedule not approved',
    category: 'area',
    severity: 'blocking',
    stages: ['submit', 'issue'],
    acknowledgeable: false,
    description:
      'Reported areas must trace to a schedule approved by the valuer (matching schedule hash).',
    evaluate: (ctx) =>
      reportedSchedules(ctx)
        .filter(
          (s) =>
            !ctx.measurementApprovals.some(
              (a) => a.sketchVersionId === s.sketchVersionId && a.scheduleHash === s.scheduleHash,
            ),
        )
        .map((s) => ({
          path: `asset:${s.assetId}/sketch:${s.sketchVersionId}`,
          message: 'area schedule has not been approved, or changed after approval',
        })),
  }),
  rule({
    code: 'VAL-AREA-003',
    title: 'Area check warning',
    category: 'area',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description:
      'Geometry warnings: implausible dimensions, deductions outside components, differences from supplied or online areas.',
    evaluate: (ctx) =>
      reportedSchedules(ctx).flatMap((s) =>
        s.issues
          .filter((i) => i.severity === 'warning')
          .map((i) => ({
            path: `asset:${s.assetId}/sketch:${s.sketchVersionId}/${i.code}`,
            message: i.message,
          })),
      ),
  }),
  rule({
    code: 'VAL-AREA-004',
    title: 'Implausible site coverage',
    category: 'area',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description: 'The ground-level building footprint exceeds the site area.',
    evaluate: (ctx) =>
      reportedSchedules(ctx).flatMap((s) => {
        const land = ctx.values.assets[s.assetId]?.['land.area'];
        const ground = s.levelTotals.find((l) => /^(ground|gf|level 0)/i.test(l.level));
        return typeof land === 'number' && land > 0 && ground && ground.grossM2 > land
          ? [
              {
                path: `asset:${s.assetId}/sketch:${s.sketchVersionId}`,
                message: `ground-level area ${ground.grossM2} m² exceeds site area ${land} m²`,
              },
            ]
          : [];
      }),
  }),

  // ── AI, photos, risk, scope, independence ────────────────────────────────
  rule({
    code: 'VAL-AI-001',
    title: 'Undecided AI suggestions',
    category: 'ai',
    severity: 'blocking',
    stages: ['submit', 'issue'],
    acknowledgeable: false,
    description:
      'Every AI suggestion must be accepted, edited or rejected by a person before submission.',
    evaluate: (ctx) =>
      ctx.aiSuggestions
        .filter((s) => s.status === 'pending')
        .map((s) => ({
          path: `asset:${s.assetId}/ai:${s.id}`,
          message: `suggestion "${s.label}" awaits a decision`,
        })),
  }),
  rule({
    code: 'VAL-PHOTO-001',
    title: 'Photo requires redaction or consent',
    category: 'photo',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description: 'A photo selected for the report contains unresolved sensitive content.',
    review: 'PRIVACY',
    evaluate: (ctx) =>
      ctx.photos
        .filter(
          (p) =>
            p.includeInReport &&
            (p.privacyStatus === 'requires_action' ||
              (p.privacyStatus === 'redacted' && !p.redactedPhotoId)),
        )
        .map((p) => ({
          path: `asset:${p.assetId}/photo:${p.id}`,
          message: 'sensitive content must be redacted, consented or the photo excluded',
        })),
  }),
  rule({
    code: 'VAL-PHOTO-002',
    title: 'Poor-quality photo selected',
    category: 'photo',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description:
      'A blurry or low-light photo is selected for the report without an override reason.',
    evaluate: (ctx) =>
      ctx.photos
        .filter(
          (p) =>
            p.includeInReport &&
            p.privacyStatus !== 'requires_action' &&
            !photoReportEligibility(p).eligible,
        )
        .map((p) => ({
          path: `asset:${p.assetId}/photo:${p.id}`,
          message: photoReportEligibility(p).reasons.join('; '),
        })),
  }),
  rule({
    code: 'VAL-RISK-001',
    title: 'Unresolved escalation',
    category: 'risk',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description: 'An open risk flag requires escalation.',
    evaluate: (ctx) =>
      ctx.riskFlags
        .filter((r) => r.status === 'open' && r.requiresEscalation)
        .map((r) => ({
          path: `${r.assetId ? `asset:${r.assetId}` : 'job'}/risk:${r.id}`,
          message: r.description,
        })),
  }),
  rule({
    code: 'VAL-SCOPE-001',
    title: 'Limited scope with escalation triggers',
    category: 'scope',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'Desktop, kerbside or restricted scope with high-severity risk flags requires escalation or a recorded justification.',
    review: 'API_STANDARDS',
    evaluate: (ctx) => {
      if (ctx.selection.scope === 'FULL') return [];
      return ctx.assetIds.flatMap((assetId) => {
        const triggers = ctx.riskFlags.filter(
          (r) =>
            r.status === 'open' &&
            r.severity === 'high' &&
            (r.assetId === assetId || r.assetId === undefined),
        );
        const decision = ctx.values.assets[assetId]?.['scope.escalationDecision'];
        if (
          !triggers.length ||
          decision === 'escalated_to_full_inspection' ||
          decision === 'proceed_with_justification'
        )
          return [];
        return [
          {
            path: `asset:${assetId}/field:scope.escalationDecision`,
            message: `${triggers.length} high-severity risk flag(s) make ${ctx.selection.scope.toLowerCase()} scope unsuitable without escalation`,
          },
        ];
      });
    },
  }),
  rule({
    code: 'VAL-INDEP-001',
    title: 'Conflict declined',
    category: 'independence',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description: 'The conflict check records that the engagement must be declined.',
    evaluate: (ctx) =>
      ctx.values.job['instruction.conflictCheck'] === 'conflict_declined'
        ? [
            {
              path: 'job/field:instruction.conflictCheck',
              message: 'engagement declined because of a conflict of interest',
            },
          ]
        : [],
  }),

  // ── Purpose-specific ─────────────────────────────────────────────────────
  rule({
    code: 'VAL-FR-001',
    title: 'Fair-value level inconsistent with inputs',
    category: 'purpose',
    severity: 'warning',
    stages: ALL,
    acknowledgeable: true,
    description:
      'The recorded hierarchy level differs from the level implied by the significant inputs.',
    review: 'ACCOUNTING',
    evaluate: (ctx) => {
      if (ctx.selection.purpose !== 'FINANCIAL_REPORTING') return [];
      return ctx.assetIds.flatMap((assetId) => {
        const values = ctx.values.assets[assetId] ?? {};
        const inputs = values['fr.significantInputs'];
        const recorded = values['fr.fairValueHierarchyLevel'];
        if (!Array.isArray(inputs) || typeof recorded !== 'string') return [];
        const structured = inputs.filter(
          (i): i is { name: string; significant: boolean; level: FairValueLevel } =>
            typeof i === 'object' &&
            i !== null &&
            'level' in i &&
            'significant' in i &&
            'name' in i,
        );
        if (!structured.some((i) => i.significant)) return [];
        const derived = deriveFairValueLevel(structured);
        return recorded === `LEVEL_${derived.level}`
          ? []
          : [
              {
                path: `asset:${assetId}/field:fr.fairValueHierarchyLevel`,
                message: `inputs imply Level ${derived.level} (${derived.drivingInputs.join(', ')}), recorded ${recorded}`,
              },
            ];
      });
    },
  }),
  rule({
    code: 'VAL-RENT-001',
    title: 'Implausible rental analysis',
    category: 'purpose',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'Incentives must be between 0 and 100% and effective rent cannot exceed face rent.',
    evaluate: (ctx) => [
      ...ctx.rentals
        .filter(
          (r) => r.incentiveRatio !== undefined && (r.incentiveRatio < 0 || r.incentiveRatio >= 1),
        )
        .map((r) => ({
          path: `asset:${r.assetId}/rental:${r.id}`,
          message: 'incentive must be between 0% and 100%',
        })),
      ...ctx.calculations
        .filter((c) => c.formulaId.startsWith('income.effective_rent'))
        .filter(
          (c) =>
            effectiveValue(c) >
            (c.inputs.find((i) => i.name === 'faceRent')?.normalisedValue ?? Infinity),
        )
        .map((c) => ({ path: `calc:${c.id}`, message: 'effective rent exceeds face rent' })),
    ],
  }),
  rule({
    code: 'VAL-INS-001',
    title: 'Cost data source not identified',
    category: 'purpose',
    severity: 'blocking',
    stages: ALL,
    acknowledgeable: false,
    description:
      'Licensed construction-cost data must record edition/reference, locality and date.',
    review: 'QUANTITY_SURVEYOR',
    evaluate: (ctx) => {
      if (ctx.selection.purpose !== 'INSURANCE_REPLACEMENT') return [];
      return ctx.assetIds.flatMap((assetId) => {
        const refs = ctx.values.assets[assetId]?.['ins.costDataSource'];
        if (!Array.isArray(refs)) return [];
        return refs
          .filter((id): id is string => typeof id === 'string')
          .flatMap((id) => {
            const ds = ctx.dataSources.find((d) => d.id === id);
            if (
              ds?.kind === 'construction_cost' &&
              ds.licence.reference &&
              ds.jurisdictions?.length
            )
              return [];
            return [
              {
                path: `asset:${assetId}/field:ins.costDataSource`,
                message: `cost source ${id} lacks construction-cost licence, edition reference or locality`,
              },
            ];
          });
      });
    },
  }),

  // ── Issue gates ──────────────────────────────────────────────────────────
  rule({
    code: 'VAL-TPL-001',
    title: 'Rule set not approved',
    category: 'template',
    severity: 'blocking',
    stages: ISSUE,
    acknowledgeable: false,
    description: 'Issued reports must use an approved rule-set version.',
    review: 'API_STANDARDS',
    evaluate: (ctx) =>
      ctx.config.requireApprovedRuleSet && ctx.ruleSetStatus !== 'approved'
        ? [{ path: 'job/ruleset', message: `rule set is ${ctx.ruleSetStatus}` }]
        : [],
  }),
  rule({
    code: 'VAL-TPL-002',
    title: 'Template not approved',
    category: 'template',
    severity: 'blocking',
    stages: ISSUE,
    acknowledgeable: false,
    description: 'Issued reports must use an approved template version with approved clauses.',
    review: 'API_STANDARDS',
    evaluate: (ctx) =>
      ctx.config.requireApprovedTemplate && ctx.templateStatus !== 'approved'
        ? [{ path: 'job/template', message: `template is ${ctx.templateStatus ?? 'not selected'}` }]
        : [],
  }),
  rule({
    code: 'VAL-CERT-001',
    title: 'Certification missing',
    category: 'certification',
    severity: 'blocking',
    stages: ISSUE,
    acknowledgeable: false,
    description: 'A report cannot be issued without the responsible valuer’s certification.',
    evaluate: (ctx) =>
      ctx.certification
        ? []
        : [{ path: 'job/certification', message: 'certification has not been signed' }],
  }),
  rule({
    code: 'VAL-CERT-002',
    title: 'Certification inconsistent with the report',
    category: 'certification',
    severity: 'blocking',
    stages: ['submit', 'issue'],
    acknowledgeable: false,
    description:
      'The certified amount, basis of value and valuation date must match the adopted figures and dates in the report.',
    evaluate: (ctx) => {
      const c = ctx.certification;
      if (!c) return [];
      const out: RawFinding[] = [];
      const field =
        c.amount.kind === 'market_rent'
          ? 'rent.adoptedMarketRent'
          : c.amount.kind === 'sum_insured'
            ? 'ins.sumInsured'
            : 'valuation.adoptedValue';
      const amounts = ctx.assetIds.flatMap((assetId) => {
        const v = ctx.values.assets[assetId]?.[field];
        if (typeof v === 'number') return [v];
        if (typeof v === 'string') {
          const calc = ctx.calculations.find((x) => x.id === v);
          return calc ? [effectiveValue(calc)] : [];
        }
        return [];
      });
      if (amounts.length) {
        const total = amounts.reduce((a, b) => a + b, 0);
        if (Math.abs(total - c.amount.value) > 0.5) {
          out.push({
            path: 'job/certification',
            message: `certified ${c.amount.kind.replace('_', ' ')} ${c.amount.value} differs from the reported ${field} total ${total}`,
          });
        }
      }
      const valuationDate = jobDate(ctx, 'dates.valuation');
      if (valuationDate && valuationDate !== c.valuationDate) {
        out.push({
          path: 'job/certification',
          message: `certified valuation date ${c.valuationDate} differs from ${valuationDate}`,
        });
      }
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
      const basis = ctx.values.job['instruction.basisOfValue'];
      if (typeof basis === 'string' && norm(basis) !== norm(c.basisOfValue)) {
        out.push({
          path: 'job/certification',
          message: `certified basis "${c.basisOfValue}" differs from the instructed basis ${basis}`,
        });
      }
      return out;
    },
  }),
  rule({
    code: 'VAL-CERT-003',
    title: 'State registration missing from the certification',
    category: 'certification',
    severity: 'blocking',
    stages: ['submit', 'issue'],
    acknowledgeable: false,
    description:
      'In Queensland and Western Australia the certifying valuer must state their state registration or licence number.',
    review: 'API_STANDARDS',
    evaluate: (ctx) => {
      const c = ctx.certification;
      const rule = VALUER_REGISTRATION_RULES[ctx.selection.jurisdiction];
      if (!c || !rule) return [];
      return c.valuer.registration?.jurisdiction === ctx.selection.jurisdiction &&
        c.valuer.registration.number.trim()
        ? []
        : [{ path: 'job/certification', message: `the certification has no ${rule.label}` }];
    },
  }),
  rule({
    code: 'VAL-QA-001',
    title: 'QA incomplete',
    category: 'qa',
    severity: 'blocking',
    stages: ISSUE,
    acknowledgeable: false,
    description: 'A report cannot be issued until an independent QA review is approved.',
    evaluate: (ctx) =>
      ctx.qaReview?.outcome === 'approved'
        ? []
        : [{ path: 'job/qa', message: 'QA review is not approved' }],
  }),
];

/** Sorted catalogue view for documentation and the admin UI. */
export const validationCatalogue = () =>
  [...VALIDATION_RULES]
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
    .map(({ code, title, category, severity, stages, acknowledgeable, description, review }) => ({
      code,
      title,
      category,
      severity,
      stages,
      acknowledgeable,
      description,
      ...(review ? { review } : {}),
    }));
