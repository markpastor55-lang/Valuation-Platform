import type { LocalDate } from '../core/dates.js';
import { daysBetween, isLocalDate } from '../core/dates.js';
import type { JobSelection } from '../config/codes.js';
import {
  INSPECTION_SCOPE_LABELS,
  JURISDICTION_LABELS,
  PROPERTY_TYPE_LABELS,
  REPORT_PURPOSE_LABELS,
} from '../config/codes.js';
import type { JobStatus } from './job-workflow.js';

/**
 * Work in progress: the job-management view that sits in front of inspection and valuation. Each
 * job is in exactly one stage, derived from its workflow status and dates (never set by hand).
 */
export const WIP_STAGES = [
  {
    id: 'new',
    title: 'New instructions',
    description: 'Received and not yet accepted by the valuer',
  },
  { id: 'to_inspect', title: 'To inspect', description: 'Accepted; inspection not done yet' },
  { id: 'in_progress', title: 'In progress', description: 'Inspected and being valued' },
  { id: 'returned', title: 'Returned by QA', description: 'QA sent it back to the valuer' },
  { id: 'with_qa', title: 'With QA', description: 'Signed and waiting for or in QA review' },
  { id: 'to_issue', title: 'Ready to issue', description: 'QA approved; the valuer can issue' },
  { id: 'issued', title: 'Issued', description: 'Final report issued' },
  { id: 'cancelled', title: 'Cancelled', description: 'Cancelled with a recorded reason' },
] as const;

export type WipStage = (typeof WIP_STAGES)[number]['id'];

/** The fields WIP and job search need about a job (from the job row and its captured values). */
export interface WipJob {
  readonly id: string;
  readonly reference: string;
  readonly status: JobStatus;
  readonly selection: JobSelection;
  readonly clientName: string;
  /** Formatted addresses of the job's properties. */
  readonly addresses: readonly string[];
  readonly valuerName?: string;
  readonly dueDate?: LocalDate;
  /** Booked or completed inspection date (`dates.inspection`). */
  readonly inspectionDate?: LocalDate;
}

/** Derives the WIP stage from the workflow status and, while active, the inspection date. */
export function wipStage(
  job: Pick<WipJob, 'status' | 'inspectionDate'>,
  today: LocalDate,
): WipStage {
  switch (job.status) {
    case 'draft':
      return 'new';
    case 'active':
      return job.inspectionDate && isLocalDate(job.inspectionDate) && job.inspectionDate <= today
        ? 'in_progress'
        : 'to_inspect';
    case 'returned':
      return 'returned';
    case 'submitted':
    case 'in_review':
      return 'with_qa';
    case 'approved':
      return 'to_issue';
    case 'issued':
      return 'issued';
    case 'cancelled':
      return 'cancelled';
  }
}

export type DueState = 'overdue' | 'due_today' | 'due_soon' | 'on_track' | 'done' | 'none';

/** How the due date stands today. Issued and cancelled jobs are `done`. */
export function dueState(
  job: Pick<WipJob, 'status' | 'dueDate'>,
  today: LocalDate,
  soonDays = 2,
): DueState {
  if (job.status === 'issued' || job.status === 'cancelled') return 'done';
  if (!job.dueDate || !isLocalDate(job.dueDate)) return 'none';
  const days = daysBetween(today, job.dueDate);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due_today';
  return days <= soonDays ? 'due_soon' : 'on_track';
}

/** Text a job can be found by: reference, client, addresses, valuer, purpose, type, state, stage. */
export function jobSearchText(job: WipJob, today: LocalDate): string {
  const s = job.selection;
  const stage = WIP_STAGES.find((x) => x.id === wipStage(job, today));
  return [
    job.reference,
    job.clientName,
    ...job.addresses,
    job.valuerName ?? '',
    REPORT_PURPOSE_LABELS[s.purpose],
    s.purpose,
    PROPERTY_TYPE_LABELS[s.propertyType],
    INSPECTION_SCOPE_LABELS[s.scope],
    s.jurisdiction,
    JURISDICTION_LABELS[s.jurisdiction],
    stage?.title ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

/** True when every word of the query appears somewhere in the job's search text. */
export function matchesJobSearch(job: WipJob, query: string, today: LocalDate): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = jobSearchText(job, today);
  return words.every((w) => text.includes(w));
}

const DUE_ORDER: Readonly<Record<DueState, number>> = {
  overdue: 0,
  due_today: 1,
  due_soon: 2,
  on_track: 3,
  none: 4,
  done: 5,
};

export interface WipRow {
  readonly job: WipJob;
  readonly stage: WipStage;
  readonly due: DueState;
}

export interface WipBoard {
  readonly rows: readonly WipRow[];
  readonly counts: Readonly<Record<WipStage, number>>;
  readonly overdue: number;
}

/**
 * Builds the WIP list: optional search and stage filter, most urgent first (overdue, then by due
 * date, then reference). Counts are for the searched jobs before the stage filter, so the stage
 * chips always show what each would contain.
 */
export function buildWip(
  jobs: readonly WipJob[],
  today: LocalDate,
  filter: { readonly query?: string; readonly stage?: WipStage } = {},
): WipBoard {
  const searched = jobs
    .filter((j) => matchesJobSearch(j, filter.query ?? '', today))
    .map((job) => ({ job, stage: wipStage(job, today), due: dueState(job, today) }));
  const counts = Object.fromEntries(WIP_STAGES.map((s) => [s.id, 0])) as Record<WipStage, number>;
  for (const r of searched) counts[r.stage] += 1;
  const rows = searched
    .filter((r) => !filter.stage || r.stage === filter.stage)
    .sort(
      (a, b) =>
        DUE_ORDER[a.due] - DUE_ORDER[b.due] ||
        (a.job.dueDate ?? '9999').localeCompare(b.job.dueDate ?? '9999') ||
        a.job.reference.localeCompare(b.job.reference),
    );
  return { rows, counts, overdue: searched.filter((r) => r.due === 'overdue').length };
}
