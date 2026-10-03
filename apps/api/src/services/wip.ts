import {
  authorize,
  localDateOf,
  type LocalDate,
  type Principal,
  type WipJob,
  type WipRow,
} from '@vp/domain';
import type { AppContext } from '../context.js';
import { jobResource, selectionOf, type JobRow } from '../repo/jobs.js';

/**
 * WIP is a cross-job view, so "today" uses one time zone. There is no per-organisation time zone
 * setting yet; Australia/Sydney is the default (01 D14).
 */
export const WIP_TIME_ZONE = 'Australia/Sydney';

export const wipToday = (ctx: AppContext): LocalDate => localDateOf(ctx.clock.now(), WIP_TIME_ZONE);

interface WipJobRow extends JobRow {
  readonly client_name: string | null;
  readonly valuer_name: string | null;
  readonly due_date: unknown;
  readonly inspection_date: unknown;
  readonly addresses: readonly (string | null)[] | null;
}

export interface VisibleJob {
  readonly row: JobRow;
  readonly wip: WipJob;
}

const dateValue = (v: unknown): string | undefined =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;

/**
 * Jobs of the caller's organisation that the caller may read (restricted portfolios and client
 * scoping apply), with the fields WIP and job search need. Newest 500 first.
 */
export async function loadVisibleJobs(
  ctx: AppContext,
  principal: Principal,
  filter: { readonly status?: string; readonly valuerId?: string } = {},
): Promise<VisibleJob[]> {
  const params: unknown[] = [principal.orgId];
  const where = ['j.org_id = $1'];
  if (filter.status) {
    params.push(filter.status);
    where.push(`j.status = $${params.length}`);
  }
  if (filter.valuerId) {
    params.push(filter.valuerId);
    where.push(`j.responsible_valuer_id = $${params.length}`);
  }
  const { rows } = await ctx.db.query<WipJobRow>(
    `SELECT j.*, c.name AS client_name, u.display_name AS valuer_name,
            (SELECT f.value FROM field_value f WHERE f.job_id = j.id AND f.asset_id IS NULL AND f.field_id = 'instruction.dueDate') AS due_date,
            (SELECT f.value FROM field_value f WHERE f.job_id = j.id AND f.asset_id IS NULL AND f.field_id = 'dates.inspection') AS inspection_date,
            (SELECT array_agg(coalesce(a.address->>'formatted', a.label) ORDER BY a.created_at, a.id)
               FROM asset a WHERE a.job_id = j.id AND NOT a.deleted) AS addresses
       FROM job j
       LEFT JOIN client c ON c.id = j.client_id
       LEFT JOIN app_user u ON u.id = j.responsible_valuer_id
      WHERE ${where.join(' AND ')}
      ORDER BY j.created_at DESC
      LIMIT 500`,
    params,
  );
  const visible: VisibleJob[] = [];
  for (const row of rows) {
    if (!authorize(principal, 'job.read', await jobResource(ctx.db, row)).allowed) continue;
    const dueDate = dateValue(row.due_date);
    const inspectionDate = dateValue(row.inspection_date);
    visible.push({
      row,
      wip: {
        id: row.id,
        reference: row.reference,
        status: row.status,
        selection: selectionOf(row),
        clientName: row.client_name ?? '',
        addresses: (row.addresses ?? []).filter((a): a is string => typeof a === 'string'),
        ...(row.valuer_name ? { valuerName: row.valuer_name } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(inspectionDate ? { inspectionDate } : {}),
      },
    });
  }
  return visible;
}

/** One job as listed on the WIP board and in search results (keeps the original list fields). */
export function wipJobView(row: JobRow, r: WipRow) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    selection: selectionOf(row),
    responsibleValuerId: row.responsible_valuer_id,
    stage: r.stage,
    due: r.due,
    clientName: r.job.clientName,
    addresses: r.job.addresses,
    valuerName: r.job.valuerName ?? null,
    dueDate: r.job.dueDate ?? null,
    inspectionDate: r.job.inspectionDate ?? null,
  };
}
