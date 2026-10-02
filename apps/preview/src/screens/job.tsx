import type { JSX } from 'preact';
import {
  AU_CORE_RULE_SET,
  INSPECTION_SCOPES,
  INSPECTION_SCOPE_LABELS,
  JURISDICTIONS,
  JURISDICTION_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  REPORT_PURPOSES,
  REPORT_PURPOSE_LABELS,
  formatAustralianDate,
  isEditable,
  type JobSelection,
} from '@vp/domain';
import {
  DEMO_TEMPLATE,
  JOB,
  PEOPLE,
  can,
  nextStep,
  statusLabel,
  type Derived,
  type PreviewState,
} from '../model.js';
import { Pill, fieldLabel, sectionLabel, type Dispatch, type Navigate } from '../ui.js';

const STEPS = [
  ['active', 'Working'],
  ['submitted', 'Submitted'],
  ['in_review', 'In QA'],
  ['approved', 'Approved'],
  ['issued', 'Issued'],
] as const;
const ORDER: Record<string, number> = {
  draft: 0,
  active: 0,
  returned: 0,
  submitted: 1,
  in_review: 2,
  approved: 3,
  issued: 4,
};

export function NextStepCard(props: {
  state: PreviewState;
  d: Derived;
  dispatch: Dispatch;
  navigate: Navigate;
}): JSX.Element {
  const { state, d, dispatch } = props;
  const step = nextStep(state, d);
  const current = ORDER[state.status] ?? 0;
  const actor = step ? PEOPLE[step.role] : undefined;
  const isMe = step?.role === state.role;
  return (
    <section class="card" aria-labelledby="next-step">
      <ol class="steps" aria-label="Workflow">
        {STEPS.map(([s, label], i) => (
          <li
            key={s}
            class={
              i < current || state.status === 'issued' ? 'done' : i === current ? 'current' : ''
            }
          >
            {label}
          </li>
        ))}
      </ol>
      {state.status === 'returned' && (
        <div class="notice blocking">
          QA returned the report to the valuer. Fix the findings, then sign and submit again.
        </div>
      )}
      {step && actor ? (
        <div class="stack">
          <div class="card-head">
            <h2 id="next-step">Next: {step.label}</h2>
            <span class="muted">
              by {actor.displayName} ({actor.roleLabel.toLowerCase()})
            </span>
          </div>
          {step.check.allowed ? (
            <p class="muted">All checks for this step pass.</p>
          ) : (
            <>
              <p class="muted">This step is blocked until:</p>
              <ul class="failures">
                {step.check.failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          )}
          <div class="row">
            {isMe ? (
              <button
                type="button"
                class="btn primary"
                disabled={!step.check.allowed}
                onClick={() =>
                  dispatch(
                    { type: 'transition', action: step.action },
                    `${step.label}: done. Job is now ${statusLabel(step.check.to)}.`,
                  )
                }
              >
                {step.label}
              </button>
            ) : (
              <button
                type="button"
                class="btn"
                onClick={() => dispatch({ type: 'setRole', role: step.role })}
              >
                Switch to {actor.displayName}
              </button>
            )}
            {!step.check.allowed && (
              <button
                type="button"
                class="link"
                onClick={() => {
                  props.navigate('checks');
                }}
              >
                See checks
              </button>
            )}
          </div>
        </div>
      ) : (
        <div class="stack">
          <h2 id="next-step">Report issued</h2>
          <p class="muted">
            Final v1 issued{' '}
            {state.issuedAt ? formatAustralianDate(state.issuedAt.slice(0, 10)) : ''}. The content,
            areas and certification are frozen. Changes now need an amendment and a new version.
          </p>
          <div class="row">
            <button
              type="button"
              class="btn primary"
              onClick={() => {
                props.navigate('report');
              }}
            >
              View the issued report
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SelectionCard(props: { state: PreviewState; dispatch: Dispatch }): JSX.Element {
  const { state, dispatch } = props;
  const s = state.selection;
  const locked = !isEditable(state.status) || !can(state.role, 'job.update');
  const set = (patch: Partial<JobSelection>) =>
    dispatch({ type: 'setSelection', selection: { ...s, ...patch } });
  const picker = <K extends keyof JobSelection>(
    key: K,
    label: string,
    values: readonly JobSelection[K][],
    labels: Readonly<Record<JobSelection[K], string>>,
  ) => (
    <label class="field-label">
      {label}
      <select
        id={`sel-${key}`}
        value={s[key]}
        disabled={locked}
        onChange={(e) => {
          set({ [key]: e.currentTarget.value });
        }}
      >
        {values.map((v) => (
          <option key={v} value={v}>
            {labels[v]}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section class="card" aria-labelledby="what">
      <div class="card-head">
        <h2 id="what">What’s being valued</h2>
        {locked && (
          <span class="muted">
            {isEditable(state.status)
              ? `${PEOPLE[state.role].roleLabel}s can’t change this`
              : 'Locked'}
          </span>
        )}
      </div>
      <p class="muted">
        These four choices decide which fields, report sections, checks and specialist reviews
        apply. Try changing the purpose.
      </p>
      <div class="select-grid">
        {picker('purpose', 'Report purpose', REPORT_PURPOSES, REPORT_PURPOSE_LABELS)}
        {picker('propertyType', 'Property type', PROPERTY_TYPES, PROPERTY_TYPE_LABELS)}
        {picker('scope', 'Inspection', INSPECTION_SCOPES, INSPECTION_SCOPE_LABELS)}
        {picker('jurisdiction', 'State or territory', JURISDICTIONS, JURISDICTION_LABELS)}
      </div>
    </section>
  );
}

function ChangeCard(props: { state: PreviewState; dispatch: Dispatch }): JSX.Element | null {
  const { state, dispatch } = props;
  const change = state.lastChange;
  if (!change) return null;
  const { diff, from } = change;
  const changed = (Object.keys(from) as (keyof JobSelection)[]).filter(
    (k) => from[k] !== state.selection[k],
  );
  const nothing =
    diff.newlyRequired.length === 0 &&
    diff.noLongerRequired.length === 0 &&
    diff.sectionsAdded.length === 0 &&
    diff.sectionsRemoved.length === 0;
  return (
    <section class="card" aria-labelledby="change" style={{ borderColor: 'var(--accent)' }}>
      <div class="card-head">
        <h3 id="change">What changed</h3>
        <div class="row">
          <button
            type="button"
            class="btn small"
            onClick={() => dispatch({ type: 'setSelection', selection: from }, 'Changed back')}
          >
            Change back
          </button>
          <button type="button" class="link" onClick={() => dispatch({ type: 'dismissChange' })}>
            Dismiss
          </button>
        </div>
      </div>
      {changed.length === 0 || nothing ? (
        <p class="muted">No change to the required fields or report sections.</p>
      ) : (
        <div class="stack">
          {diff.newlyRequired.length > 0 && (
            <div class="stack">
              <span class="eyebrow">Now required ({diff.newlyRequired.length})</span>
              <div class="chips">
                {diff.newlyRequired.map((f) => (
                  <span key={f} class="chip added">
                    {fieldLabel(f)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {diff.noLongerRequired.length > 0 && (
            <div class="stack">
              <span class="eyebrow">No longer required ({diff.noLongerRequired.length})</span>
              <div class="chips">
                {diff.noLongerRequired.map((f) => (
                  <span key={f} class="chip removed">
                    {fieldLabel(f)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(diff.sectionsAdded.length > 0 || diff.sectionsRemoved.length > 0) && (
            <div class="stack">
              <span class="eyebrow">Report sections</span>
              <div class="chips">
                {diff.sectionsAdded.map((s) => (
                  <span key={s} class="chip added">
                    + {sectionLabel(s)}
                  </span>
                ))}
                {diff.sectionsRemoved.map((s) => (
                  <span key={s} class="chip removed">
                    {sectionLabel(s)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {diff.retainedValues.length > 0 && (
        <p class="notice">
          {diff.retainedValues.length} captured value
          {diff.retainedValues.length === 1 ? ' is' : 's are'} no longer needed. They are kept, not
          deleted, and stay out of the report unless you change back.
        </p>
      )}
    </section>
  );
}

function RequirementsCard(props: { d: Derived; navigate: Navigate }): JSX.Element {
  const { d } = props;
  const r = d.requirements;
  const recommended = r.fields.filter((f) => f.level === 'recommended').length;
  const pct = d.requiredCount ? Math.round((d.requiredCaptured / d.requiredCount) * 100) : 100;
  const missingRequired = d.missing.filter((m) => m.level === 'required').length;
  return (
    <section class="card" aria-labelledby="reqs">
      <div class="card-head">
        <h2 id="reqs">Requirements</h2>
        <span class="mono muted">
          {r.ruleSetId}@{r.ruleSetVersion}
        </span>
      </div>
      <div class="stack">
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <span>
            <strong class="num">{d.requiredCaptured}</strong> of{' '}
            <strong class="num">{d.requiredCount}</strong> required fields captured
            {recommended > 0 && <span class="muted"> · {recommended} recommended</span>}
          </span>
          {missingRequired > 0 && (
            <button
              type="button"
              class="link"
              onClick={() => {
                props.navigate('fields');
              }}
            >
              {missingRequired} missing
            </button>
          )}
        </div>
        <div
          class="progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      {r.selectionIssues.map((i) => (
        <div key={i.ruleId} class={`notice ${i.severity}`}>
          {i.message}
          {i.review && <span class="mono"> [REVIEW: {i.review}]</span>}
        </div>
      ))}
      {r.warnings.map((w) => (
        <div key={w.ruleId + w.message} class="notice warning">
          {w.message}
        </div>
      ))}
      {r.specialistReviews.length > 0 && (
        <div class="stack">
          <span class="eyebrow">Specialist review before reliance</span>
          <div class="chips">
            {r.specialistReviews.map((s) => (
              <span key={s} class="chip mono">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
      <div class="stack">
        <span class="eyebrow">Report sections ({r.sections.length})</span>
        <div class="chips">
          {r.sections.map((s) => (
            <span key={s} class="chip">
              {sectionLabel(s)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function DetailsCard(props: { state: PreviewState }): JSX.Element {
  const due = props.state.values.job['instruction.dueDate'];
  return (
    <section class="card" aria-labelledby="details">
      <h2 id="details">Job details</h2>
      <dl class="kv">
        <dt>Client</dt>
        <dd>{JOB.clientName}</dd>
        <dt>Responsible valuer</dt>
        <dd>
          {PEOPLE.valuer.displayName} ({PEOPLE.valuer.credentials.join(', ')})
        </dd>
        <dt>Field inspector</dt>
        <dd>{PEOPLE.inspector.displayName}</dd>
        <dt>QA reviewer</dt>
        <dd>{PEOPLE.reviewer.displayName}</dd>
        <dt>Due</dt>
        <dd>{typeof due === 'string' ? formatAustralianDate(due) : '—'}</dd>
        <dt>Rule set</dt>
        <dd>
          <span class="mono">
            {AU_CORE_RULE_SET.id}@{AU_CORE_RULE_SET.version}
          </span>{' '}
          <Pill tone="plain">approved for demo</Pill>
        </dd>
        <dt>Report template</dt>
        <dd>
          <span class="mono">
            {DEMO_TEMPLATE.templateId} v{DEMO_TEMPLATE.version}
          </span>{' '}
          <Pill tone="plain">stand-in clauses</Pill>
        </dd>
      </dl>
      <p class="muted" style={{ fontSize: '0.84rem' }}>
        In the real app a standards owner approves each rule set and template version after
        specialist review. The preview treats them as approved so the full workflow can run.
      </p>
    </section>
  );
}

export function JobScreen(props: {
  state: PreviewState;
  d: Derived;
  dispatch: Dispatch;
  navigate: Navigate;
}): JSX.Element {
  return (
    <>
      <NextStepCard {...props} />
      <SelectionCard state={props.state} dispatch={props.dispatch} />
      <ChangeCard state={props.state} dispatch={props.dispatch} />
      <RequirementsCard d={props.d} navigate={props.navigate} />
      <DetailsCard state={props.state} />
    </>
  );
}
