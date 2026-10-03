import type { JSX } from 'preact';
import {
  INPUT_TABS,
  INSPECTION_SCOPES,
  INSPECTION_SCOPE_LABELS,
  JURISDICTIONS,
  JURISDICTION_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  REPORT_PURPOSES,
  REPORT_PURPOSE_LABELS,
  formatAustralianDate,
  type InputTabId,
  type JobSelection,
} from '@vp/domain';
import {
  REVIEWER,
  VALUER,
  isLocked,
  statusLabel,
  type Derived,
  type PreviewState,
} from '../model.js';
import { NextButton, fieldLabel, sectionLabel, type Dispatch, type Navigate } from '../ui.js';
import { InputFields } from './fields.js';
import { SketchNotes } from './sketch.js';

export interface ScreenProps {
  readonly state: PreviewState;
  readonly d: Derived;
  readonly dispatch: Dispatch;
  readonly navigate: Navigate;
  readonly focus: { id: string; n: number } | null;
}

function LockNotice(props: { state: PreviewState; navigate: Navigate }): JSX.Element | null {
  if (!isLocked(props.state)) return null;
  return (
    <div class="notice">
      {props.state.status === 'issued'
        ? 'The report has been issued, so these details are final.'
        : `The job is ${statusLabel(props.state.status)}, so it is read-only until QA finishes.`}{' '}
      <button
        type="button"
        class="link"
        onClick={() => {
          props.navigate('review');
        }}
      >
        See where it’s up to
      </button>
    </div>
  );
}

function SelectionCard(props: { state: PreviewState; dispatch: Dispatch }): JSX.Element {
  const { state, dispatch } = props;
  const s = state.selection;
  const locked = isLocked(state);
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
          dispatch({ type: 'setSelection', selection: { ...s, [key]: e.currentTarget.value } });
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
      <h2 id="what">What’s being valued</h2>
      <p class="muted">These choices decide which questions the app asks you.</p>
      <div class="select-grid">
        {picker('purpose', 'Purpose', REPORT_PURPOSES, REPORT_PURPOSE_LABELS)}
        {picker('propertyType', 'Property type', PROPERTY_TYPES, PROPERTY_TYPE_LABELS)}
        {picker('scope', 'Inspection', INSPECTION_SCOPES, INSPECTION_SCOPE_LABELS)}
        {picker('jurisdiction', 'State or territory', JURISDICTIONS, JURISDICTION_LABELS)}
      </div>
    </section>
  );
}

function DatesCard(props: { d: Derived }): JSX.Element | null {
  const r = props.d.retrospective;
  if (!r.valuationDate || !r.comparedWith) return null;
  const compared = r.comparedWith.fieldId === 'dates.inspection' ? 'inspection' : 'instruction';
  return r.retrospective ? (
    <div class="notice warning" role="status">
      <strong>Retrospective valuation.</strong> The valuation date (
      {formatAustralianDate(r.valuationDate)}) is before the {compared} date (
      {formatAustralianDate(r.comparedWith.date)}), so the app has added the retrospective questions
      below. Use only what was known at the valuation date.
    </div>
  ) : (
    <div class="notice ok" role="status">
      <strong>Current valuation.</strong> The valuation date is the {compared} date or later. Set an
      earlier valuation date and the app treats it as retrospective automatically.
    </div>
  );
}

function ChangeCard(props: { state: PreviewState; dispatch: Dispatch }): JSX.Element | null {
  const { state, dispatch } = props;
  const change = state.lastChange;
  if (!change) return null;
  const { diff, from } = change;
  const selectionChanged = (Object.keys(from) as (keyof JobSelection)[]).some(
    (k) => from[k] !== state.selection[k],
  );
  const added = diff.newlyRequired.length + diff.sectionsAdded.length;
  const removed = diff.noLongerRequired.length + diff.sectionsRemoved.length;
  return (
    <section class="card change" aria-labelledby="change">
      <div class="card-head">
        <h3 id="change">What changed</h3>
        <div class="row">
          {selectionChanged && (
            <button
              type="button"
              class="btn small"
              onClick={() => dispatch({ type: 'setSelection', selection: from }, 'Changed back')}
            >
              Change back
            </button>
          )}
          <button type="button" class="link" onClick={() => dispatch({ type: 'dismissChange' })}>
            Dismiss
          </button>
        </div>
      </div>
      {added + removed === 0 ? (
        <p class="muted">The questions stay the same.</p>
      ) : (
        <ul class="plain change-list">
          {diff.newlyRequired.map((f) => (
            <li key={f} class="added">
              + {fieldLabel(f)}
            </li>
          ))}
          {diff.noLongerRequired.map((f) => (
            <li key={f} class="removed">
              − {fieldLabel(f)}
            </li>
          ))}
          {diff.sectionsAdded.map((s) => (
            <li key={s} class="added">
              + Report section: {sectionLabel(s)}
            </li>
          ))}
          {diff.sectionsRemoved.map((s) => (
            <li key={s} class="removed">
              − Report section: {sectionLabel(s)}
            </li>
          ))}
        </ul>
      )}
      {diff.retainedValues.length > 0 && (
        <p class="muted" style={{ fontSize: '0.86rem' }}>
          Anything you already typed is kept, and stays out of the report unless it’s needed again.
        </p>
      )}
    </section>
  );
}

function AssignedCard(props: { state: PreviewState }): JSX.Element {
  const job = props.state.values.job;
  const date = (v: unknown) => (typeof v === 'string' ? formatAustralianDate(v) : '—');
  return (
    <section class="card" aria-labelledby="assigned">
      <h3 id="assigned">Filled in for you</h3>
      <dl class="kv">
        <dt>Valuer</dt>
        <dd>
          {VALUER.displayName} ({VALUER.credentials.join(', ')})
        </dd>
        <dt>QA reviewer</dt>
        <dd>{REVIEWER.displayName}</dd>
        <dt>Instructed</dt>
        <dd>{date(job['dates.instruction'])}</dd>
        <dt>Due</dt>
        <dd>{date(job['instruction.dueDate'])}</dd>
        <dt>Engagement letter</dt>
        <dd>Attached</dd>
      </dl>
    </section>
  );
}

const NEXT: Readonly<Record<InputTabId, InputTabId | null>> = {
  job: 'property',
  property: 'inspection',
  inspection: 'evidence',
  evidence: 'valuation',
  valuation: 'review',
  review: null,
};

function TabIntro(props: { tab: InputTabId; d: Derived }): JSX.Element {
  const t = INPUT_TABS.find((x) => x.id === props.tab);
  const missing = props.d.missingByTab[props.tab] ?? 0;
  return (
    <div class="tab-intro">
      <h2>{t?.title}</h2>
      <p class="muted">
        {t?.description}.{' '}
        {missing > 0 ? (
          <strong class="todo">
            {missing} thing{missing === 1 ? '' : 's'} to do
          </strong>
        ) : (
          <span class="done">All done here</span>
        )}
      </p>
    </div>
  );
}

export function JobScreen(props: ScreenProps): JSX.Element {
  return (
    <>
      <TabIntro tab="job" d={props.d} />
      <LockNotice state={props.state} navigate={props.navigate} />
      <SelectionCard state={props.state} dispatch={props.dispatch} />
      <ChangeCard state={props.state} dispatch={props.dispatch} />
      <InputFields tab="job" {...props} only={['instructions', 'basis']} />
      <DatesCard d={props.d} />
      <InputFields
        tab="job"
        {...props}
        only={['tax_context', 'retrospective', 'expert_compliance']}
      />
      <AssignedCard state={props.state} />
      <NextButton to="property" navigate={props.navigate} />
    </>
  );
}

export function InputTabScreen(props: ScreenProps & { tab: InputTabId }): JSX.Element {
  const next = NEXT[props.tab];
  return (
    <>
      <TabIntro tab={props.tab} d={props.d} />
      <LockNotice state={props.state} navigate={props.navigate} />
      <InputFields {...props} />
      {props.tab === 'inspection' && (
        <SketchNotes state={props.state} d={props.d} dispatch={props.dispatch} />
      )}
      {next && <NextButton to={next} navigate={props.navigate} />}
    </>
  );
}
