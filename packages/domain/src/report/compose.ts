import type { LocalDate } from '../core/dates.js';
import { formatAustralianDate, isLocalDate } from '../core/dates.js';
import type { JobSelection } from '../config/codes.js';
import {
  INSPECTION_SCOPE_LABELS,
  JURISDICTION_LABELS,
  PROPERTY_TYPE_LABELS,
  REPORT_PURPOSE_LABELS,
} from '../config/codes.js';
import type { FieldDef } from '../config/fields.js';
import { FIELD_BY_ID, hasValue } from '../config/fields.js';
import type { SectionId } from '../config/sections.js';
import { sectionTitle } from '../config/sections.js';
import type { CalculationRecord } from '../calc/calculation.js';
import { effectiveValue } from '../calc/calculation.js';
import type { RentalComparable, SaleAnalysis, SaleComparable } from '../evidence/comparables.js';
import type { AreaSchedule } from '../geometry/area-schedule.js';
import type { FieldValues, ResolvedRequirements } from '../requirements/resolve.js';
import { formatArea, formatAud, formatNumber, formatPercent } from '../units/units.js';
import type { Certification } from '../workflow/certification.js';
import type { TemplateBlock, TemplateVersion } from './template.js';
import { VALUER_REGISTRATION_RULES } from '../workflow/valuer-profile.js';
import type { MarketCommentary } from '../evidence/market.js';
import { currentCommentary } from '../evidence/market.js';
import {
  COMMENTARY_FIELDS,
  COMMENTARY_LEVELS,
  commentaryHeading,
  commentaryLocalities,
  commentaryNote,
} from '../evidence/commentary-library.js';

/** Everything a report is rendered from. Issued reports render from an immutable snapshot of this. */
export interface ReportData {
  readonly report: {
    readonly id: string;
    readonly version: number;
    readonly status: 'draft' | 'final';
    readonly issueDate?: LocalDate;
  };
  readonly firmName: string;
  readonly job: {
    readonly id: string;
    readonly reference: string;
    readonly selection: JobSelection;
    readonly clientName: string;
  };
  readonly valuerName: string;
  readonly requirements: ResolvedRequirements;
  readonly values: FieldValues;
  readonly assets: readonly { readonly id: string; readonly label: string }[];
  readonly sales: readonly SaleComparable[];
  readonly saleAnalyses: readonly SaleAnalysis[];
  readonly rentals: readonly RentalComparable[];
  /** Dated commentary records (as-at dates and sources for the market section). */
  readonly commentary?: readonly MarketCommentary[];
  readonly calculations: readonly CalculationRecord[];
  readonly areaSchedules: readonly AreaSchedule[];
  readonly sketches: readonly {
    readonly assetId: string;
    /** Stable id across versions (the value of `improvements.areaSchedule`). */
    readonly sketchId?: string;
    readonly sketchVersionId: string;
    readonly version: number;
    readonly includeInClientReport: boolean;
    readonly northBearingDeg?: number;
  }[];
  /** Report-eligible photos only (privacy and quality checks already applied). */
  readonly photos: readonly {
    readonly id: string;
    readonly renderId: string;
    readonly assetId: string;
    readonly caption: string;
    readonly sequence: number;
  }[];
  readonly certification?: Certification;
  readonly userNames?: Readonly<Record<string, string>>;
  readonly snapshotHash?: string;
}

export type RenderBlock =
  | { readonly kind: 'heading'; readonly text: string; readonly level: 1 | 2 | 3 }
  | {
      readonly kind: 'paragraph';
      readonly text: string;
      readonly style: 'normal' | 'note' | 'placeholder';
    }
  | {
      readonly kind: 'key_value';
      readonly title?: string;
      readonly rows: readonly (readonly [string, string])[];
    }
  | {
      readonly kind: 'table';
      readonly title?: string;
      readonly columns: readonly string[];
      readonly rows: readonly (readonly string[])[];
      readonly note?: string;
    }
  | {
      readonly kind: 'image';
      readonly ref: {
        readonly type: 'photo' | 'sketch' | 'map' | 'signature';
        readonly id: string;
      };
      readonly caption: string;
    }
  | { readonly kind: 'page_break' };

export interface RenderedSection {
  readonly sectionId: SectionId;
  readonly title: string;
  readonly blocks: readonly RenderBlock[];
}

export type ComposeProblemCode =
  | 'TPL-TEMPLATE-NOT-APPROVED'
  | 'TPL-UNAPPROVED-CLAUSE'
  | 'TPL-MISSING-REQUIRED'
  | 'TPL-AREA-NOT-REPORTABLE'
  | 'TPL-NO-CERTIFICATION';

export interface ComposeProblem {
  readonly code: ComposeProblemCode;
  readonly message: string;
}

export interface ReportModel {
  readonly meta: {
    readonly reportId: string;
    readonly version: number;
    readonly title: string;
    readonly subtitle: string;
    readonly watermark: string;
    readonly footer: string;
    readonly firmName: string;
    readonly primaryColour: string;
    readonly templateId: string;
    readonly templateVersion: number;
    readonly ruleSet: string;
    readonly snapshotHash?: string;
    readonly status: 'draft' | 'final';
  };
  readonly sections: readonly RenderedSection[];
  /** Must be empty before a final report can be issued. */
  readonly problems: readonly ComposeProblem[];
}

const registrationLabel = (jurisdiction: string): string =>
  (VALUER_REGISTRATION_RULES as Readonly<Record<string, { label: string } | undefined>>)[
    jurisdiction
  ]?.label ?? `${jurisdiction} registration number`;

const humanise = (v: string): string => {
  const s = v.replaceAll('_', ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function formatValue(def: FieldDef | undefined, value: unknown, data: ReportData): string {
  if (!hasValue(value)) return '';
  const type = def?.type;
  if (type === 'money' && typeof value === 'number') return formatAud(value);
  if (type === 'area' && typeof value === 'number') return formatArea(value);
  if (type === 'ratio' && typeof value === 'number') return formatPercent(value);
  if (type === 'length' && typeof value === 'number') return `${formatNumber(value)} m`;
  // whole numbers such as years and ages are shown without thousands separators
  if (type === 'integer' && typeof value === 'number') return String(value);
  if (type === 'area_schedule_ref' && typeof value === 'string') {
    const sketch = data.sketches.find((s) => s.sketchId === value || s.sketchVersionId === value);
    const schedule =
      sketch && data.areaSchedules.find((a) => a.sketchVersionId === sketch.sketchVersionId);
    return sketch && schedule
      ? `Sketch v${sketch.version}: ${formatArea(schedule.totalIncludedM2)} total (${schedule.basis.replaceAll('_', ' ').toLowerCase()})`
      : 'See area schedule';
  }
  if (type === 'date' && isLocalDate(value)) return formatAustralianDate(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (type === 'user_ref' && typeof value === 'string') return data.userNames?.[value] ?? value;
  if ((type === 'enum' || type === 'multi_enum') && typeof value === 'string')
    return humanise(value);
  if (type === 'calculation_ref' && typeof value === 'string') {
    const calc = data.calculations.find((c) => c.id === value);
    return calc ? formatCalcOutput(calc) : value;
  }
  if (type === 'document_refs' || type === 'datasource_refs') {
    const n = Array.isArray(value) ? value.length : 1;
    return `${n} ${type === 'document_refs' ? 'document' : 'source'}${n === 1 ? '' : 's'} on file`;
  }
  if (type === 'coordinates' && typeof value === 'object' && value !== null) {
    const c = value as { lat?: number; lng?: number };
    return `${c.lat?.toFixed(6) ?? ''}, ${c.lng?.toFixed(6) ?? ''}`;
  }
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        typeof v === 'string' ? (type === 'multi_enum' ? humanise(v) : v) : JSON.stringify(v),
      )
      .join('; ');
  }
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    if (typeof o['formatted'] === 'string') return o['formatted'];
    return Object.values(o)
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .join(', ');
  }
  if (typeof value === 'number') return formatNumber(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const formatCalcOutput = (c: CalculationRecord): string =>
  formatUnitValue(effectiveValue(c), c.output.unit);

function formatUnitValue(v: number, unit: string): string {
  switch (unit) {
    case 'AUD':
      return formatAud(v);
    case 'AUD/m2':
      return `${formatAud(v, true)}/m²`;
    case 'AUD/ha':
      return `${formatAud(v)}/ha`;
    case 'AUD/yr':
      return `${formatAud(v)} p.a.`;
    case 'AUD/m2/yr':
      return `${formatAud(v, true)}/m² p.a.`;
    case 'ratio':
      return formatPercent(v);
    case 'years':
      return `${formatNumber(v)} years`;
    default:
      return formatNumber(v);
  }
}

function resolvePlaceholders(text: string, data: ReportData): string {
  const s = data.job.selection;
  const fixed: Record<string, string> = {
    'job.reference': data.job.reference,
    'job.purpose': REPORT_PURPOSE_LABELS[s.purpose],
    'job.propertyType': PROPERTY_TYPE_LABELS[s.propertyType],
    'job.jurisdiction': JURISDICTION_LABELS[s.jurisdiction],
    'job.scope': INSPECTION_SCOPE_LABELS[s.scope],
    'report.version': String(data.report.version),
    'report.issueDate': data.report.issueDate
      ? formatAustralianDate(data.report.issueDate)
      : '[not issued]',
    'firm.name': data.firmName,
    'valuer.name': data.valuerName,
  };
  return text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, path: string) => {
    if (path in fixed) return fixed[path] as string;
    if (path.startsWith('field.')) {
      const id = path.slice(6);
      // Only fields switched on by the current requirements may appear (retained data never leaks).
      if (!data.requirements.fields.some((f) => f.fieldId === id)) return '[not applicable]';
      const v = data.values.job[id];
      return hasValue(v) ? formatValue(FIELD_BY_ID.get(id), v, data) : '[not provided]';
    }
    return '[unknown]';
  });
}

/**
 * Turns report data and a template into a renderer-neutral model (used for the PDF and for
 * on-device previews). Only fields switched on by the current requirements are rendered, so
 * data retained from an earlier selection never leaks into a report for a different purpose.
 */
export function composeReport(
  data: ReportData,
  template: TemplateVersion,
  options: { audience: 'client' | 'internal' } = { audience: 'client' },
): ReportModel {
  const final = data.report.status === 'final';
  const problems: ComposeProblem[] = [];
  const problem = (code: ComposeProblemCode, message: string) => {
    if (final && !problems.some((p) => p.code === code && p.message === message))
      problems.push({ code, message });
  };
  if (template.status !== 'approved')
    problem(
      'TPL-TEMPLATE-NOT-APPROVED',
      `template ${template.templateId} v${template.version} is ${template.status}`,
    );

  const requirementByField = new Map(data.requirements.fields.map((f) => [f.fieldId, f]));
  const requiredSections = new Set(data.requirements.sections);
  const multiAsset = data.assets.length > 1;
  const calcById = new Map(data.calculations.map((c) => [c.id, c]));

  const renderFieldTable = (fields: readonly string[]): RenderBlock[] => {
    const rows: [string, string][] = [];
    for (const fieldId of fields) {
      const req = requirementByField.get(fieldId);
      if (!req) continue;
      const def = FIELD_BY_ID.get(fieldId);
      const targets =
        def?.level === 'asset' ? (req.assetIds ?? data.assets.map((a) => a.id)) : [null];
      for (const assetId of targets) {
        const value =
          assetId === null ? data.values.job[fieldId] : data.values.assets[assetId]?.[fieldId];
        const label =
          assetId !== null && multiAsset
            ? `${data.assets.find((a) => a.id === assetId)?.label ?? assetId} — ${def?.label ?? fieldId}`
            : (def?.label ?? fieldId);
        if (hasValue(value)) rows.push([label, formatValue(def, value, data)]);
        else if (req.level === 'required') {
          rows.push([label, '[Not provided]']);
          problem('TPL-MISSING-REQUIRED', `${label} is required`);
        }
      }
    }
    return rows.length ? [{ kind: 'key_value', rows }] : [];
  };

  const renderBlock = (b: TemplateBlock): RenderBlock[] => {
    switch (b.type) {
      case 'heading':
        return [{ kind: 'heading', text: resolvePlaceholders(b.text, data), level: b.level ?? 2 }];
      case 'paragraph':
        return [{ kind: 'paragraph', text: resolvePlaceholders(b.text, data), style: 'normal' }];
      case 'page_break':
        return [{ kind: 'page_break' }];
      case 'field_table':
        return renderFieldTable(b.fields);
      case 'clause': {
        const c = template.clauses.find((x) => x.clauseId === b.clauseId);
        if (!c) return [];
        if (c.appliesTo?.purposes && !c.appliesTo.purposes.includes(data.job.selection.purpose))
          return [];
        if (
          c.appliesTo?.jurisdictions &&
          !c.appliesTo.jurisdictions.includes(data.job.selection.jurisdiction)
        )
          return [];
        if (c.status !== 'approved')
          problem('TPL-UNAPPROVED-CLAUSE', `clause ${c.clauseId}@${c.version} is ${c.status}`);
        return [
          {
            kind: 'paragraph',
            text: resolvePlaceholders(c.text, data),
            style: c.status === 'approved' ? 'normal' : 'placeholder',
          },
        ];
      }
      case 'sales_table': {
        if (!data.sales.length)
          return [{ kind: 'paragraph', text: 'No sales evidence recorded.', style: 'note' }];
        // Most recent evidence first; ties broken by id so the order is deterministic.
        const sales = [...data.sales].sort(
          (a, b) => b.contractDate.localeCompare(a.contractDate) || a.id.localeCompare(b.id),
        );
        const rows = sales.map((s) => {
          const a = data.saleAnalyses.find((x) => x.saleId === s.id);
          return [
            s.address,
            formatAustralianDate(s.contractDate),
            formatAud(s.price),
            s.landAreaM2 !== undefined ? formatArea(s.landAreaM2) : '—',
            s.buildingAreaM2 !== undefined ? formatArea(s.buildingAreaM2) : '—',
            a?.landRate ? formatCalcOutput(a.landRate) : '—',
            a?.buildingRate ? formatCalcOutput(a.buildingRate) : '—',
            a?.adjusted ? formatCalcOutput(a.adjusted) : '—',
            humanise(s.comparability),
            s.provenance.verification === 'verified' ? 'Verified' : 'Unverified',
          ];
        });
        return [
          {
            kind: 'table',
            columns: [
              'Address',
              'Contract date',
              'Price',
              'Land',
              'Building',
              'Land rate',
              'Building rate',
              'Adjusted',
              'Comparability',
              'Status',
            ],
            rows,
            note: 'Rates are traced to their inputs, units and formula versions (see the calculation trace).',
          },
        ];
      }
      case 'rental_table': {
        if (!data.rentals.length)
          return [{ kind: 'paragraph', text: 'No rental evidence recorded.', style: 'note' }];
        return [
          {
            kind: 'table',
            columns: [
              'Address',
              'Lease start',
              'Face rent p.a.',
              'Basis',
              'Area',
              'Rate',
              'Incentive',
              'Comparability',
            ],
            rows: [...data.rentals]
              .sort(
                (a, b) =>
                  b.leaseStartDate.localeCompare(a.leaseStartDate) || a.id.localeCompare(b.id),
              )
              .map((r) => [
                r.address,
                formatAustralianDate(r.leaseStartDate),
                formatAud(r.faceRentPa),
                humanise(r.rentBasis),
                formatArea(r.leaseAreaM2),
                `${formatAud(r.faceRentPa / r.leaseAreaM2, true)}/m²`,
                r.incentiveRatio !== undefined ? formatPercent(r.incentiveRatio) : '—',
                humanise(r.comparability),
              ]),
          },
        ];
      }
      case 'market_commentary': {
        const out: RenderBlock[] = [];
        const records = currentCommentary(data.commentary ?? []);
        for (const level of COMMENTARY_LEVELS) {
          const fieldId = COMMENTARY_FIELDS[level];
          const req = requirementByField.get(fieldId);
          if (!req) continue;
          const targets =
            level === 'local' ? (req.assetIds ?? data.assets.map((a) => a.id)) : [null];
          for (const assetId of targets) {
            const value =
              assetId === null ? data.values.job[fieldId] : data.values.assets[assetId]?.[fieldId];
            const address =
              assetId === null ? undefined : data.values.assets[assetId]?.['location.address'];
            const formatted =
              typeof address === 'object' && address !== null
                ? (address as { formatted?: unknown }).formatted
                : address;
            const locality =
              level === 'local' && multiAsset
                ? data.assets.find((a) => a.id === assetId)?.label
                : typeof formatted === 'string'
                  ? commentaryLocalities(formatted)[0]
                  : undefined;
            const heading = commentaryHeading(level, data.job.selection.jurisdiction, locality);
            if (typeof value !== 'string' || !value.trim()) {
              if (req.level !== 'required') continue;
              out.push({ kind: 'heading', text: heading, level: 3 });
              out.push({ kind: 'paragraph', text: '[Not provided]', style: 'placeholder' });
              problem('TPL-MISSING-REQUIRED', `${heading} commentary is required`);
              continue;
            }
            out.push({ kind: 'heading', text: heading, level: 3 });
            for (const para of value.split(/\n\s*\n/)) {
              const text = para.trim();
              if (text) out.push({ kind: 'paragraph', text, style: 'normal' });
            }
            const record = records.find(
              (c) => c.level === level && (c.assetId ?? null) === assetId,
            );
            if (record)
              out.push({ kind: 'paragraph', text: commentaryNote(record), style: 'note' });
          }
        }
        return out;
      }
      case 'calculation_trace': {
        const calcs = data.calculations.filter(
          (c) => !b.formulaIds || b.formulaIds.includes(c.formulaId),
        );
        if (!calcs.length) return [];
        return [
          {
            kind: 'table',
            title: 'Calculation trace',
            columns: ['Formula', 'Inputs', 'Result', 'Override'],
            rows: calcs.map((c) => [
              `${c.formulaId}@${c.formulaVersion}: ${c.expression}`,
              c.inputs
                .map(
                  (i) =>
                    `${i.name} = ${formatNumber(i.value)} ${i.unit}${i.defaulted ? ' (default)' : ''}`,
                )
                .join('; '),
              formatUnitValue(c.output.value, c.output.unit),
              c.override ? `${formatCalcOutput(c)} — ${c.override.reason}` : '—',
            ]),
          },
        ];
      }
      case 'area_schedule': {
        const out: RenderBlock[] = [];
        for (const s of data.areaSchedules) {
          if (!s.reportable)
            problem('TPL-AREA-NOT-REPORTABLE', `area schedule for ${s.assetId} is not reportable`);
          const asset = data.assets.find((a) => a.id === s.assetId);
          out.push({
            kind: 'table',
            title: `Improvement areas${multiAsset && asset ? ` — ${asset.label}` : ''} (${s.basis})`,
            columns: [
              'Level',
              'Component',
              'Use',
              'Gross',
              'Deductions',
              'Net',
              'Source',
              'Confidence',
              'Measured by',
              'Date',
            ],
            rows: [
              ...s.rows.map((r) => [
                r.level,
                r.label,
                humanise(r.componentType) + (r.includedInTotal ? '' : ' (excluded)'),
                formatArea(r.grossAreaM2),
                formatArea(r.deductionsM2),
                formatArea(r.netAreaM2),
                humanise(r.dimensionSource),
                humanise(r.confidence),
                data.userNames?.[r.measuredBy] ?? r.measuredBy,
                formatAustralianDate(r.measuredAt.slice(0, 10)),
              ]),
              ...s.levelTotals.map((l) => [
                l.level,
                'Level total',
                '',
                formatArea(l.grossM2),
                formatArea(l.deductionsM2),
                formatArea(l.netM2),
                '',
                '',
                '',
                '',
              ]),
              [
                '',
                'Total improvement area',
                '',
                '',
                '',
                formatArea(s.totalIncludedM2),
                '',
                '',
                '',
                '',
              ],
            ],
            note: `Scale: ${humanise(s.scaleStatus)}. Schedule ${s.scheduleHash.slice(0, 12)}.`,
          });
        }
        return out;
      }
      case 'sketch':
        return data.sketches
          .filter((s) => s.includeInClientReport || options.audience === 'internal')
          .map((s) => ({
            kind: 'image',
            ref: { type: 'sketch', id: s.sketchVersionId },
            caption: `Sketch v${s.version}${s.northBearingDeg !== undefined ? ` — north ${s.northBearingDeg}°` : ' — north point not recorded'} (not to scale; not a survey)`,
          }));
      case 'photo_grid':
        return [...data.photos]
          .sort((a, b) => a.sequence - b.sequence)
          .map((p) => ({
            kind: 'image',
            ref: { type: 'photo', id: p.renderId },
            caption: p.caption,
          }));
      case 'map':
        return data.assets.length
          ? [
              {
                kind: 'image',
                ref: { type: 'map', id: data.job.id },
                caption: 'Location (map data attributed per provider terms)',
              },
            ]
          : [];
      case 'certification': {
        const c = data.certification;
        if (!c) {
          problem('TPL-NO-CERTIFICATION', 'the certification has not been signed');
          return [
            { kind: 'paragraph', text: '[Certification not yet signed]', style: 'placeholder' },
          ];
        }
        return [
          {
            kind: 'key_value',
            rows: [
              ['Valuer', c.valuer.fullName],
              ['Credentials', c.valuer.credentials.join(', ')],
              ...(c.valuer.apiMemberNumber
                ? [['API member number', c.valuer.apiMemberNumber] as [string, string]]
                : []),
              ...(c.valuer.registration
                ? [
                    [
                      registrationLabel(c.valuer.registration.jurisdiction),
                      c.valuer.registration.number,
                    ] as [string, string],
                  ]
                : []),
              ['Role', humanise(c.role)],
              ['Inspection scope', c.inspectionScopeStatement],
              ['Date of valuation', formatAustralianDate(c.valuationDate)],
              ['Basis of value', c.basisOfValue],
              [
                c.amount.kind === 'market_rent'
                  ? 'Market rent'
                  : c.amount.kind === 'sum_insured'
                    ? 'Sum insured'
                    : 'Value',
                formatAud(c.amount.value),
              ],
              ['Independence', c.independenceStatement],
              ['Conflicts', c.conflictsStatement],
              ['Assumptions', c.assumptions.join('; ') || 'None'],
              ['Special assumptions', c.specialAssumptions.join('; ') || 'None'],
              ['Limitations', c.limitations.join('; ')],
              ['Standards relied on', c.standardsReliedOn.join('; ')],
              [
                'Signed',
                `${c.valuer.fullName} (${humanise(c.signature.method)}) on ${formatAustralianDate(c.signedAt.slice(0, 10))}`,
              ],
            ],
          },
          ...(c.valuer.signatureSha256
            ? [
                {
                  kind: 'image',
                  ref: { type: 'signature', id: c.valuer.signatureSha256 },
                  caption: `Signature of ${c.valuer.fullName}`,
                } as RenderBlock,
              ]
            : []),
        ];
      }
      case 'audit_metadata':
        return [
          {
            kind: 'key_value',
            rows: [
              ['Report', `${data.report.id} v${data.report.version} (${data.report.status})`],
              ['Job reference', data.job.reference],
              ['Template', `${template.templateId} v${template.version}`],
              ['Rule set', `${data.requirements.ruleSetId} ${data.requirements.ruleSetVersion}`],
              ['Snapshot hash', data.snapshotHash ?? '[draft — not snapshotted]'],
            ],
          },
        ];
    }
  };

  const sections: RenderedSection[] = [];
  for (const s of template.sections) {
    if (s.audience === 'internal' && options.audience === 'client') continue;
    if (s.include === 'when_required' && !requiredSections.has(s.sectionId)) continue;
    const blocks = s.blocks.flatMap(renderBlock);
    if (!blocks.length) continue;
    sections.push({ sectionId: s.sectionId, title: s.title ?? sectionTitle(s.sectionId), blocks });
  }

  // calculations referenced by fields must exist (trace integrity)
  for (const [fieldId, req] of requirementByField) {
    if (FIELD_BY_ID.get(fieldId)?.type !== 'calculation_ref' || req.level !== 'required') continue;
    const values = [
      data.values.job[fieldId],
      ...Object.values(data.values.assets).map((a) => a[fieldId]),
    ];
    for (const v of values)
      if (typeof v === 'string' && !calcById.has(v))
        problem('TPL-MISSING-REQUIRED', `calculation ${v} referenced by ${fieldId} is missing`);
  }

  const sel = data.job.selection;
  const watermark = final
    ? resolvePlaceholders(template.watermarks.final, data)
    : template.watermarks.draft;
  return {
    meta: {
      reportId: data.report.id,
      version: data.report.version,
      title: `${REPORT_PURPOSE_LABELS[sel.purpose]} report`,
      subtitle: `${data.assets.map((a) => a.label).join('; ')} — ${PROPERTY_TYPE_LABELS[sel.propertyType]}, ${JURISDICTION_LABELS[sel.jurisdiction]}`,
      watermark,
      footer: `${template.branding.footerText} · ${data.job.reference} · ${data.report.id} v${data.report.version}${data.snapshotHash ? ` · ${data.snapshotHash.slice(0, 12)}` : ''}`,
      firmName: template.branding.firmName,
      primaryColour: template.branding.primaryColour,
      templateId: template.templateId,
      templateVersion: template.version,
      ruleSet: `${data.requirements.ruleSetId}@${data.requirements.ruleSetVersion}`,
      ...(data.snapshotHash ? { snapshotHash: data.snapshotHash } : {}),
      status: data.report.status,
    },
    sections,
    problems,
  };
}
