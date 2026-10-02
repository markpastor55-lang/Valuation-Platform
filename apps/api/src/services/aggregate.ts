import {
  DEFAULT_CONVENTIONS,
  DEFAULT_VALIDATION_CONFIG,
  JURISDICTION_TIME_ZONES,
  computeAreaSchedule,
  hashCanonical,
  localDateOf,
  resolveRequirements,
  runValidation,
  type AcceptedFact,
  type AiSuggestion,
  type AreaSchedule,
  type CalculationRecord,
  type Certification,
  type DataSource,
  type FieldValues,
  type JobSelection,
  type MarketCommentary,
  type MeasurementApproval,
  type PhotoRecord,
  type Principal,
  type Provenance,
  type QaReview,
  type RentalComparable,
  type ReportData,
  type ResolvedRequirements,
  type RiskFlag,
  type RuleSetVersion,
  type SaleAnalysis,
  type SaleComparable,
  type SketchVersion,
  type TemplateVersion,
  type ValidationAcknowledgement,
  type ValidationContext,
  type ValidationResult,
  type ValidationStage,
  type WorkflowContext,
} from '@vp/domain';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { getJob, selectionOf, type JobRow } from '../repo/jobs.js';

export interface AssetRow {
  readonly id: string;
  readonly label: string;
  readonly address: Record<string, unknown>;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly risk_level: string;
  readonly version: number;
}

export interface FieldRow {
  readonly field_id: string;
  readonly asset_id: string | null;
  readonly value: unknown;
  readonly provenance: Provenance;
  readonly version: number;
}

/** Everything known about a job, loaded consistently for validation, workflow and reporting. */
export interface JobAggregate {
  readonly job: JobRow;
  readonly selection: JobSelection;
  readonly ruleSet: RuleSetVersion;
  readonly template?: TemplateVersion;
  readonly clientName: string;
  readonly assets: readonly AssetRow[];
  readonly fields: readonly FieldRow[];
  readonly values: FieldValues;
  readonly sales: readonly SaleComparable[];
  readonly rentals: readonly RentalComparable[];
  readonly calculations: readonly CalculationRecord[];
  readonly saleAnalyses: readonly SaleAnalysis[];
  readonly commentary: readonly MarketCommentary[];
  readonly riskFlags: readonly RiskFlag[];
  readonly photos: readonly PhotoRecord[];
  readonly aiSuggestions: readonly AiSuggestion[];
  readonly facts: readonly AcceptedFact[];
  readonly sketches: readonly SketchVersion[];
  /** The sketch version used for reporting, per asset (latest version of the referenced sketch). */
  readonly reportingSketches: readonly SketchVersion[];
  readonly schedules: readonly AreaSchedule[];
  readonly approvals: readonly MeasurementApproval[];
  readonly acknowledgements: readonly ValidationAcknowledgement[];
  readonly certification?: Certification;
  readonly qaReview?: QaReview;
  readonly dataSources: readonly DataSource[];
  readonly userNames: Readonly<Record<string, string>>;
}

const data = <T>(rows: readonly { data: unknown }[]): T[] => rows.map((r) => r.data as T);

export async function loadAggregate(db: Db, jobId: string, job?: JobRow): Promise<JobAggregate> {
  const j = job ?? (await getJob(db, jobId));
  const q = <T>(sql: string) => db.query<T>(sql, [j.id]);
  const [
    ruleSet,
    template,
    client,
    assets,
    fields,
    sales,
    rentals,
    calcs,
    commentary,
    risks,
    photos,
    ai,
    facts,
    sketches,
    approvals,
    acks,
    cert,
    qa,
    sources,
    users,
  ] = await Promise.all([
    db.query<{ content: RuleSetVersion; status: RuleSetVersion['status'] }>(
      'SELECT content, status FROM rule_set_version WHERE id = $1',
      [j.rule_set_version_id],
    ),
    j.template_version_id
      ? db.query<{ content: TemplateVersion; status: TemplateVersion['status'] }>(
          'SELECT content, status FROM template_version WHERE id = $1',
          [j.template_version_id],
        )
      : Promise.resolve({
          rows: [] as { content: TemplateVersion; status: TemplateVersion['status'] }[],
        }),
    db.query<{ name: string }>('SELECT name FROM client WHERE id = $1', [j.client_id]),
    q<AssetRow>(
      'SELECT id, label, address, latitude, longitude, risk_level, version FROM asset WHERE job_id = $1 AND NOT deleted ORDER BY created_at, id',
    ),
    q<FieldRow>(
      'SELECT field_id, asset_id, value, provenance, version FROM field_value WHERE job_id = $1 ORDER BY field_id, asset_id',
    ),
    q<{ data: unknown }>(
      'SELECT data FROM sale_comparable WHERE job_id = $1 ORDER BY created_at, id',
    ),
    q<{ data: unknown }>(
      'SELECT data FROM rental_comparable WHERE job_id = $1 ORDER BY created_at, id',
    ),
    q<{ record: CalculationRecord; sale_id: string | null }>(
      'SELECT record, sale_id FROM calculation WHERE job_id = $1 ORDER BY created_at, id',
    ),
    q<{ data: unknown }>(
      'SELECT data FROM market_commentary WHERE job_id = $1 ORDER BY as_at_date, id',
    ),
    q<{ data: unknown }>('SELECT data FROM risk_flag WHERE job_id = $1 ORDER BY id'),
    q<{ data: unknown }>(
      'SELECT data FROM photo WHERE job_id = $1 AND NOT deleted ORDER BY created_at, id',
    ),
    q<{ data: unknown }>('SELECT data FROM ai_suggestion WHERE job_id = $1 ORDER BY id'),
    q<{ data: unknown }>('SELECT data FROM accepted_fact WHERE job_id = $1 ORDER BY id'),
    q<{ data: unknown }>(
      'SELECT data FROM sketch_version WHERE job_id = $1 ORDER BY sketch_id, version',
    ),
    q<{
      id: string;
      sketch_version_id: string;
      schedule_hash: string;
      schedule: AreaSchedule;
      approved_by: string;
      approved_at: Date | string;
    }>(
      'SELECT id, sketch_version_id, schedule_hash, schedule, approved_by, approved_at FROM measurement_approval WHERE job_id = $1 ORDER BY approved_at, id',
    ),
    q<{ code: string; path: string; reason: string; ack_by: string; ack_at: Date | string }>(
      'SELECT code, path, reason, ack_by, ack_at FROM validation_acknowledgement WHERE job_id = $1 ORDER BY code, path',
    ),
    q<{ data: Certification }>(
      'SELECT data FROM certification WHERE job_id = $1 ORDER BY signed_at DESC, id DESC LIMIT 1',
    ),
    q<{ data: QaReview }>(
      'SELECT data FROM qa_review WHERE job_id = $1 ORDER BY started_at DESC, id DESC LIMIT 1',
    ),
    db.query<{
      id: string;
      name: string;
      provider: string;
      kind: DataSource['kind'];
      jurisdictions: DataSource['jurisdictions'];
      licence: DataSource['licence'];
      freshness_days: number | null;
      status: DataSource['status'];
    }>(
      'SELECT id, name, provider, kind, jurisdictions, licence, freshness_days, status FROM data_source WHERE org_id = $1 ORDER BY id',
      [j.org_id],
    ),
    db.query<{ id: string; display_name: string }>(
      'SELECT id, display_name FROM app_user WHERE org_id = $1',
      [j.org_id],
    ),
  ]);
  const ruleSetRow = ruleSet.rows[0];
  if (!ruleSetRow) throw new Error(`rule set ${j.rule_set_version_id} missing`);
  const values: { job: Record<string, unknown>; assets: Record<string, Record<string, unknown>> } =
    { job: {}, assets: {} };
  for (const a of assets.rows) values.assets[a.id] = {};
  for (const f of fields.rows) {
    if (f.asset_id === null) values.job[f.field_id] = f.value;
    else (values.assets[f.asset_id] ??= {})[f.field_id] = f.value;
  }

  const calculations = calcs.rows.map((c) => c.record);
  const saleList = data<SaleComparable>(sales.rows);
  const saleAnalyses: SaleAnalysis[] = saleList.map((s) => {
    const find = (suffix: string) => calculations.find((c) => c.id === `${s.id}:${suffix}`);
    const landRate = find('land_rate');
    const buildingRate = find('building_rate');
    const adjusted = find('adjusted');
    return {
      saleId: s.id,
      ...(landRate ? { landRate } : {}),
      ...(buildingRate ? { buildingRate } : {}),
      ...(adjusted ? { adjusted } : {}),
    };
  });

  const sketchList = data<SketchVersion>(sketches.rows);
  const reportingSketches: SketchVersion[] = [];
  for (const a of assets.rows) {
    const sketchId = values.assets[a.id]?.['improvements.areaSchedule'];
    if (typeof sketchId !== 'string') continue;
    const latest = sketchList
      .filter((s) => s.sketchId === sketchId && s.assetId === a.id)
      .sort((x, y) => y.version - x.version)[0];
    if (latest) reportingSketches.push(latest);
  }
  const schedules = reportingSketches.map((v) => {
    const convention = DEFAULT_CONVENTIONS.find((c) => c.id === v.conventionId);
    if (!convention) throw new Error(`unknown measurement convention ${v.conventionId}`);
    return computeAreaSchedule(v, convention);
  });

  const iso = (d: Date | string) =>
    d instanceof Date ? d.toISOString() : new Date(d).toISOString();

  return {
    job: j,
    selection: selectionOf(j),
    ruleSet: { ...ruleSetRow.content, status: ruleSetRow.status },
    ...(template.rows[0]
      ? { template: { ...template.rows[0].content, status: template.rows[0].status } }
      : {}),
    clientName: client.rows[0]?.name ?? '',
    assets: assets.rows,
    fields: fields.rows,
    values,
    sales: saleList,
    rentals: data<RentalComparable>(rentals.rows),
    calculations,
    saleAnalyses,
    commentary: data<MarketCommentary>(commentary.rows),
    riskFlags: data<RiskFlag>(risks.rows),
    photos: data<PhotoRecord>(photos.rows),
    aiSuggestions: data<AiSuggestion>(ai.rows),
    facts: data<AcceptedFact>(facts.rows),
    sketches: sketchList,
    reportingSketches,
    schedules,
    approvals: approvals.rows.map((a) => ({
      id: a.id,
      sketchVersionId: a.sketch_version_id,
      scheduleHash: a.schedule_hash,
      basis: a.schedule.basis,
      totalIncludedM2: a.schedule.totalIncludedM2,
      approvedBy: a.approved_by,
      approvedAt: iso(a.approved_at),
    })),
    acknowledgements: acks.rows.map((a) => ({
      code: a.code,
      path: a.path,
      reason: a.reason,
      by: a.ack_by,
      at: iso(a.ack_at),
    })),
    ...(cert.rows[0] ? { certification: cert.rows[0].data } : {}),
    ...(qa.rows[0] ? { qaReview: qa.rows[0].data } : {}),
    dataSources: sources.rows.map((s) => ({
      id: s.id,
      name: s.name,
      provider: s.provider,
      kind: s.kind,
      ...(s.jurisdictions?.length ? { jurisdictions: s.jurisdictions } : {}),
      licence: s.licence,
      ...(s.freshness_days !== null ? { freshnessDays: s.freshness_days } : {}),
      status: s.status,
    })),
    userNames: Object.fromEntries(users.rows.map((u) => [u.id, u.display_name])),
  };
}

export const assetIdsOf = (agg: JobAggregate): string[] => agg.assets.map((a) => a.id);

export const requirementsOf = (agg: JobAggregate): ResolvedRequirements =>
  resolveRequirements(agg.selection, agg.ruleSet, agg.values, assetIdsOf(agg));

/**
 * The content that is certified, reviewed and issued. Workflow metadata (status, certification,
 * QA) is excluded so the hash only changes when substantive content changes.
 */
export function contentSnapshot(agg: JobAggregate): Record<string, unknown> {
  const j = agg.job;
  return {
    job: {
      id: j.id,
      reference: j.reference,
      clientId: j.client_id,
      portfolioId: j.portfolio_id,
      selection: agg.selection,
      ruleSet: `${agg.ruleSet.id}@${agg.ruleSet.version}`,
      templateVersionId: j.template_version_id,
      responsibleValuerId: j.responsible_valuer_id,
      reviewerId: j.reviewer_id,
      feeCents: j.fee_cents,
    },
    assets: agg.assets.map((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      latitude: a.latitude,
      longitude: a.longitude,
    })),
    fields: agg.fields.map((f) => ({
      fieldId: f.field_id,
      assetId: f.asset_id,
      value: f.value,
      provenance: f.provenance,
    })),
    sales: agg.sales,
    rentals: agg.rentals,
    calculations: agg.calculations,
    commentary: agg.commentary,
    riskFlags: agg.riskFlags,
    photos: agg.photos,
    aiSuggestions: agg.aiSuggestions,
    facts: agg.facts,
    sketches: agg.reportingSketches.map((s) => ({ ...s, status: undefined })),
    approvals: agg.approvals.map((a) => ({
      sketchVersionId: a.sketchVersionId,
      scheduleHash: a.scheduleHash,
      approvedBy: a.approvedBy,
    })),
    acknowledgements: agg.acknowledgements.map((a) => ({
      code: a.code,
      path: a.path,
      reason: a.reason,
      by: a.by,
    })),
  };
}

export const snapshotHashOf = (agg: JobAggregate): string => hashCanonical(contentSnapshot(agg));

export function validationContextOf(
  agg: JobAggregate,
  stage: ValidationStage,
  ctx: AppContext,
): ValidationContext {
  return {
    stage,
    now: ctx.clock.now(),
    timeZone: JURISDICTION_TIME_ZONES[agg.selection.jurisdiction],
    selection: agg.selection,
    requirements: requirementsOf(agg),
    values: agg.values,
    assetIds: assetIdsOf(agg),
    provenance: agg.fields
      .filter(
        (f) =>
          f.provenance.origin === 'external_source' || f.provenance.origin === 'client_supplied',
      )
      .map((f) => ({ fieldId: f.field_id, assetId: f.asset_id, provenance: f.provenance })),
    dataSources: agg.dataSources,
    sales: agg.sales,
    saleAnalyses: agg.saleAnalyses,
    rentals: agg.rentals,
    calculations: agg.calculations,
    commentary: agg.commentary,
    areaSchedules: agg.schedules,
    measurementApprovals: agg.approvals,
    photos: agg.photos,
    aiSuggestions: agg.aiSuggestions,
    riskFlags: agg.riskFlags,
    ...(agg.certification ? { certification: agg.certification } : {}),
    ...(agg.qaReview ? { qaReview: agg.qaReview } : {}),
    ruleSetStatus: agg.ruleSet.status,
    ...(agg.template ? { templateStatus: agg.template.status } : {}),
    acknowledgements: agg.acknowledgements,
    config: {
      ...DEFAULT_VALIDATION_CONFIG,
      requireApprovedRuleSet: ctx.config.requireApprovedConfigForIssue,
      requireApprovedTemplate: ctx.config.requireApprovedConfigForIssue,
    },
  };
}

export const validate = (
  agg: JobAggregate,
  stage: ValidationStage,
  ctx: AppContext,
): ValidationResult => runValidation(validationContextOf(agg, stage, ctx));

export async function engagementDocumentCount(db: Db, agg: JobAggregate): Promise<number> {
  const v = agg.values.job['instruction.engagementDocuments'];
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM document WHERE job_id = $1 AND kind = 'engagement'",
    [agg.job.id],
  );
  return (Array.isArray(v) ? v.length : 0) + (rows[0]?.n ?? 0);
}

export function workflowContextOf(
  agg: JobAggregate,
  principal: Principal,
  extras: { validation?: ValidationResult; engagementDocumentCount?: number; reason?: string },
): WorkflowContext {
  return {
    job: {
      id: agg.job.id,
      status: agg.job.status,
      responsibleValuerId: agg.job.responsible_valuer_id,
      conflictCheck:
        typeof agg.values.job['instruction.conflictCheck'] === 'string'
          ? agg.values.job['instruction.conflictCheck']
          : null,
      engagementDocumentCount: extras.engagementDocumentCount ?? 0,
    },
    actor: principal,
    currentSnapshotHash: snapshotHashOf(agg),
    ...(extras.validation
      ? {
          validation: {
            blockingCount: extras.validation.blockingCount,
            unacknowledgedWarningCount: extras.validation.unacknowledgedWarningCount,
          },
        }
      : {}),
    ...(agg.certification ? { certification: agg.certification } : {}),
    ...(agg.qaReview ? { qaReview: agg.qaReview } : {}),
    ...(agg.job.approved_snapshot_hash
      ? { approvedSnapshotHash: agg.job.approved_snapshot_hash }
      : {}),
    ...(extras.reason ? { reason: extras.reason } : {}),
  };
}

/** Report data for drafts and issue. Only report-eligible photos are included. */
export function reportDataOf(
  agg: JobAggregate,
  report: { id: string; version: number; status: 'draft' | 'final'; issueDate?: string },
  firmName: string,
  snapshotHash?: string,
): ReportData {
  const photos = agg.photos
    .filter(
      (p) =>
        p.includeInReport &&
        (p.privacyStatus === 'clear' ||
          p.privacyStatus === 'consent_recorded' ||
          (p.privacyStatus === 'redacted' && p.redactedPhotoId)),
    )
    .filter(
      (p) =>
        !(
          p.quality &&
          (p.quality.isBlurry || p.quality.isLowLight) &&
          !p.qualityOverrideReason?.trim()
        ),
    )
    .map((p) => ({
      id: p.id,
      renderId: p.privacyStatus === 'redacted' && p.redactedPhotoId ? p.redactedPhotoId : p.id,
      assetId: p.assetId,
      caption: p.caption ?? p.roomOrArea ?? 'Photograph',
      sequence: p.sequence,
    }));
  return {
    report: {
      id: report.id,
      version: report.version,
      status: report.status,
      ...(report.issueDate ? { issueDate: report.issueDate } : {}),
    },
    firmName,
    job: {
      id: agg.job.id,
      reference: agg.job.reference,
      selection: agg.selection,
      clientName: agg.clientName,
    },
    valuerName: agg.job.responsible_valuer_id
      ? (agg.userNames[agg.job.responsible_valuer_id] ?? '')
      : '',
    requirements: requirementsOf(agg),
    values: agg.values,
    assets: agg.assets.map((a) => ({ id: a.id, label: a.label })),
    sales: agg.sales,
    saleAnalyses: agg.saleAnalyses,
    rentals: agg.rentals,
    calculations: agg.calculations,
    areaSchedules: agg.schedules,
    sketches: agg.reportingSketches.map((s) => ({
      assetId: s.assetId,
      sketchId: s.sketchId,
      sketchVersionId: s.id,
      version: s.version,
      includeInClientReport: s.includeInClientReport,
      ...(s.northBearingDeg !== undefined ? { northBearingDeg: s.northBearingDeg } : {}),
    })),
    photos,
    ...(agg.certification ? { certification: agg.certification } : {}),
    userNames: agg.userNames,
    ...(snapshotHash ? { snapshotHash } : {}),
  };
}

/** Today's calendar date in the property's jurisdiction. */
export const jurisdictionToday = (agg: JobAggregate, now: string): string =>
  localDateOf(now, JURISDICTION_TIME_ZONES[agg.selection.jurisdiction]);
