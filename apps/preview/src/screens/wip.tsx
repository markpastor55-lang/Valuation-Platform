import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  PROPERTY_TYPE_LABELS,
  REPORT_PURPOSE_LABELS,
  WIP_STAGES,
  buildWip,
  formatAustralianDate,
  type DueState,
  type WipStage,
} from '@vp/domain';
import { wipJobs, type AppState } from '../app-state.js';
import { Pill } from '../ui.js';

const DUE_TEXT: Readonly<Record<DueState, string>> = {
  overdue: 'Overdue',
  due_today: 'Due today',
  due_soon: 'Due soon',
  on_track: 'Due',
  done: 'Done',
  none: 'No due date',
};
const DUE_TONE: Readonly<Record<DueState, string>> = {
  overdue: 'blocking',
  due_today: 'warning',
  due_soon: 'warning',
  on_track: 'plain',
  done: 'ok',
  none: 'plain',
};
const STAGE_TONE: Readonly<Record<WipStage, string>> = {
  new: '',
  to_inspect: '',
  in_progress: '',
  returned: 'blocking',
  with_qa: 'warning',
  to_issue: 'ok',
  issued: 'ok',
  cancelled: 'plain',
};

export function WipScreen(props: {
  app: AppState;
  onOpen: (jobId: string) => void;
  onNew: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<WipStage | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const jobs = useMemo(() => wipJobs(props.app), [props.app]);
  const board = buildWip(jobs, today, { query, ...(stage ? { stage } : {}) });
  const total = Object.values(board.counts).reduce((a, b) => a + b, 0);
  return (
    <>
      <div class="tab-intro">
        <h2>Work in progress</h2>
        <p class="muted">
          {jobs.length} jobs
          {board.overdue > 0 && (
            <>
              {' · '}
              <strong class="todo">{board.overdue} overdue</strong>
            </>
          )}
        </p>
      </div>
      <div class="search-row">
        <input
          id="job-search"
          type="search"
          placeholder="Search jobs: address, reference, client, purpose…"
          aria-label="Search jobs"
          value={query}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
          }}
        />
        <button type="button" class="btn primary" onClick={props.onNew}>
          + New job
        </button>
      </div>
      <div class="chips stage-chips" role="group" aria-label="Filter by stage">
        <button
          type="button"
          class="chip-btn"
          aria-pressed={stage === null}
          onClick={() => {
            setStage(null);
          }}
        >
          All <span class="num">{total}</span>
        </button>
        {WIP_STAGES.filter((s) => s.id !== 'cancelled' || board.counts.cancelled > 0).map((s) => (
          <button
            key={s.id}
            type="button"
            class="chip-btn"
            aria-pressed={stage === s.id}
            disabled={board.counts[s.id] === 0 && stage !== s.id}
            title={s.description}
            onClick={() => {
              setStage(stage === s.id ? null : s.id);
            }}
          >
            {s.title} <span class="num">{board.counts[s.id]}</span>
          </button>
        ))}
      </div>
      {board.rows.length === 0 ? (
        <div class="notice">{query ? `No jobs match “${query}”.` : 'No jobs in this stage.'}</div>
      ) : (
        <ul class="plain job-list">
          {board.rows.map(({ job, stage: st, due }) => {
            const stageInfo = WIP_STAGES.find((s) => s.id === st);
            return (
              <li key={job.id}>
                <button
                  type="button"
                  class="job-card"
                  onClick={() => {
                    props.onOpen(job.id);
                  }}
                >
                  <div class="row" style={{ justifyContent: 'space-between' }}>
                    <span class="mono muted">{job.reference}</span>
                    <Pill tone={STAGE_TONE[st]}>{stageInfo?.title}</Pill>
                  </div>
                  <strong class="job-address">{job.addresses[0]}</strong>
                  <span class="muted small">
                    {REPORT_PURPOSE_LABELS[job.selection.purpose]} ·{' '}
                    {PROPERTY_TYPE_LABELS[job.selection.propertyType]} · {job.clientName}
                  </span>
                  <div class="row small">
                    {job.dueDate && due !== 'done' && (
                      <Pill tone={DUE_TONE[due]}>
                        {DUE_TEXT[due]} {formatAustralianDate(job.dueDate)}
                      </Pill>
                    )}
                    {st === 'to_inspect' && job.inspectionDate && (
                      <span class="muted">
                        Inspection {formatAustralianDate(job.inspectionDate)}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
