import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  MIN_ACKNOWLEDGEMENT_REASON,
  formatAustralianDate,
  isEditable,
  qaApprovalBlockers,
  verifyAuditChain,
  type Finding,
  type ValidationStage,
} from '@vp/domain';
import { ATTESTATION, PEOPLE, USER_NAMES, can, type Derived, type PreviewState } from '../model.js';
import { NextStepCard } from './job.js';
import {
  Pill,
  Segmented,
  aud,
  humanise,
  readable,
  shortHash,
  when,
  type Dispatch,
  type Navigate,
} from '../ui.js';

function target(f: Finding): { tab: 'fields' | 'sketch' | 'checks'; focus?: string } | undefined {
  const field = /field:([A-Za-z.]+)/.exec(f.path)?.[1];
  if (field) return { tab: 'fields', focus: field };
  if (f.path.includes('/sketch:')) return { tab: 'sketch' };
  return undefined;
}

function FindingCard(props: {
  f: Finding;
  state: PreviewState;
  dispatch: Dispatch;
  navigate: Navigate;
}): JSX.Element {
  const { f, state, dispatch } = props;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const go = target(f);
  const canAck =
    can(state.role, 'validation.acknowledge') && isEditable(state.status) && f.acknowledgeable;
  const tone = f.acknowledgement ? 'acknowledged' : f.severity;
  return (
    <li class={`finding ${tone}`}>
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <span class="code">{f.code}</span>
        <Pill tone={f.acknowledgement ? 'ok' : f.severity}>
          {f.acknowledgement ? 'Acknowledged' : f.severity === 'blocking' ? 'Must fix' : 'Warning'}
        </Pill>
      </div>
      <span class="finding-title">{f.title}</span>
      <span>{readable(f.message)}</span>
      {f.acknowledgement && (
        <span class="muted" style={{ fontSize: '0.86rem' }}>
          {USER_NAMES[f.acknowledgement.by] ?? f.acknowledgement.by}, {when(f.acknowledgement.at)}:
          “{f.acknowledgement.reason}”
        </span>
      )}
      <div class="row">
        {go && (
          <button
            type="button"
            class="btn small"
            onClick={() => {
              props.navigate(go.tab, go.focus);
            }}
          >
            {go.tab === 'fields' ? 'Go to field' : 'Open sketch'}
          </button>
        )}
        {f.severity === 'warning' && !f.acknowledgement && !open && (
          <button
            type="button"
            class="btn small"
            disabled={!canAck}
            title={canAck ? undefined : 'Only the valuer acknowledges warnings'}
            onClick={() => {
              setOpen(true);
            }}
          >
            Acknowledge…
          </button>
        )}
      </div>
      {open && (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              dispatch(
                { type: 'acknowledge', code: f.code, path: f.path, reason },
                'Warning acknowledged',
              )
            )
              setOpen(false);
          }}
        >
          <label class="field-label">
            Why is this acceptable? (recorded in the audit trail)
            <textarea
              id={`ack-${f.code}-${f.path}`}
              rows={2}
              value={reason}
              onInput={(e) => {
                setReason(e.currentTarget.value);
              }}
              placeholder="e.g. Permit plans pre-date the 2021 alfresco enclosure"
            />
          </label>
          <div class="row">
            <button
              type="submit"
              class="btn primary small"
              disabled={reason.trim().length < MIN_ACKNOWLEDGEMENT_REASON}
            >
              Record acknowledgement
            </button>
            <button
              type="button"
              class="link"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function CertificationCard(props: {
  state: PreviewState;
  d: Derived;
  dispatch: Dispatch;
}): JSX.Element {
  const { state, d, dispatch } = props;
  const cert = state.certification;
  const canSign = can(state.role, 'certification.sign') && isEditable(state.status);
  const adopted = state.values.assets['a1']?.['valuation.adoptedValue'];
  const date = state.values.job['dates.valuation'];
  const basis = state.values.job['instruction.basisOfValue'];
  return (
    <section class="card" aria-labelledby="cert">
      <div class="card-head">
        <h2 id="cert">Certification</h2>
        {cert ? (
          <Pill tone={d.certificationCurrent ? 'ok' : 'warning'}>
            {d.certificationCurrent ? 'Signed' : 'Out of date'}
          </Pill>
        ) : (
          <Pill tone="plain">Not signed</Pill>
        )}
      </div>
      {cert && (
        <div class={`notice ${d.certificationCurrent ? 'ok' : 'warning'}`}>
          Signed by {cert.valuer.fullName} ({cert.valuer.credentials.join(', ')}) on{' '}
          {when(cert.signedAt)}, bound to content{' '}
          <span class="mono">{shortHash(cert.snapshotHash)}</span>.
          {!d.certificationCurrent &&
            ' The content has changed since, so the signature no longer applies. Sign again before submitting.'}
        </div>
      )}
      <dl class="kv">
        <dt>Amount</dt>
        <dd>{typeof adopted === 'number' ? aud(adopted) : '—'}</dd>
        <dt>Valuation date</dt>
        <dd>{typeof date === 'string' ? formatAustralianDate(date) : '—'}</dd>
        <dt>Basis</dt>
        <dd>{typeof basis === 'string' ? humanise(basis) : '—'}</dd>
        <dt>Signature</dt>
        <dd>Typed attestation by the responsible valuer, after multi-factor sign-in</dd>
      </dl>
      <blockquote class="notice" style={{ margin: 0 }}>
        {ATTESTATION}
      </blockquote>
      {(!cert || !d.certificationCurrent) && (
        <div class="row">
          <button
            type="button"
            class="btn primary"
            disabled={!canSign}
            onClick={() => dispatch({ type: 'sign' }, 'Certification signed')}
          >
            Sign as {PEOPLE.valuer.displayName}
          </button>
          {!can(state.role, 'certification.sign') && (
            <span class="muted">
              Only the responsible valuer can sign. Software and AI never sign.
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function QaCard(props: { state: PreviewState; dispatch: Dispatch }): JSX.Element | null {
  const { state, dispatch } = props;
  const [reason, setReason] = useState('');
  const review = state.qaReview;
  if (!review) return null;
  const isReviewer = state.role === 'reviewer' && review.reviewerId === PEOPLE.reviewer.userId;
  const open = !review.outcome;
  const answered = review.checklist.filter((c) => c.response !== null).length;
  const blockers = qaApprovalBlockers(review);
  return (
    <section class="card" aria-labelledby="qa">
      <div class="card-head">
        <h2 id="qa">QA review</h2>
        <Pill
          tone={
            review.outcome === 'approved'
              ? 'ok'
              : review.outcome === 'returned'
                ? 'blocking'
                : 'warning'
          }
        >
          {review.outcome
            ? humanise(review.outcome)
            : `${answered}/${review.checklist.length} answered`}
        </Pill>
      </div>
      <p class="muted">
        {PEOPLE.reviewer.displayName} reviews the submitted snapshot{' '}
        <span class="mono">{shortHash(review.reviewedSnapshotHash)}</span>. The reviewer can’t be
        the valuer, and any change to the content stops approval.
      </p>
      {open && !isReviewer && (
        <div class="notice">Switch to the QA reviewer to answer the checklist.</div>
      )}
      <div class="checklist">
        {review.checklist.map((c) => (
          <div key={c.id} class="check-item">
            <span>
              <span class="mono muted">{c.id}</span> {c.label}
            </span>
            <Segmented
              label={c.id}
              value={c.response ?? ''}
              options={[
                ['yes', 'Yes'],
                ['na', 'N/A'],
              ]}
              onChange={(v) => {
                if (isReviewer && open)
                  dispatch({ type: 'answerChecklist', itemId: c.id, response: v as 'yes' | 'na' });
              }}
            />
          </div>
        ))}
      </div>
      {isReviewer && open && (
        <div class="row">
          <button
            type="button"
            class="btn small"
            onClick={() => {
              for (const c of review.checklist)
                if (c.response === null)
                  dispatch({ type: 'answerChecklist', itemId: c.id, response: 'yes' });
            }}
          >
            Answer the rest “Yes”
          </button>
          {blockers.length > 0 && <span class="muted">{blockers.join('; ')}</span>}
        </div>
      )}
      {isReviewer && open && (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            dispatch(
              { type: 'transition', action: 'returnToValuer', reason },
              'Returned to the valuer',
            );
          }}
        >
          <label class="field-label">
            Or return it to the valuer with a reason
            <textarea
              id="qa-return-reason"
              rows={2}
              value={reason}
              onInput={(e) => {
                setReason(e.currentTarget.value);
              }}
              placeholder="e.g. Explain the adjustment to sale 2"
            />
          </label>
          <div class="row">
            <button type="submit" class="btn small" disabled={reason.trim().length < 10}>
              Return to valuer
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function AuditCard(props: { state: PreviewState }): JSX.Element {
  const events = props.state.audit;
  const verification = verifyAuditChain(events);
  const [all, setAll] = useState(false);
  const shown = [...events].reverse().slice(0, all ? undefined : 6);
  return (
    <section class="card" aria-labelledby="audit">
      <div class="card-head">
        <h2 id="audit">Audit trail</h2>
        <Pill tone={verification.valid ? 'ok' : 'blocking'}>
          {verification.valid
            ? `${verification.count} event${verification.count === 1 ? '' : 's'} · chain verified`
            : 'Chain broken'}
        </Pill>
      </div>
      <p class="muted" style={{ fontSize: '0.86rem' }}>
        Each event includes the hash of the one before it, so editing or deleting any past event
        breaks the chain.
      </p>
      <ul class="plain audit">
        {shown.map((e) => (
          <li key={e.id}>
            <span class="seq">#{e.seq}</span>
            <span>
              <strong>{e.action}</strong> · {USER_NAMES[e.actor.userId] ?? e.actor.userId} ·{' '}
              {when(e.at)}
              {e.reason && <span class="muted"> · “{e.reason}”</span>}
            </span>
            <span class="hash">{e.hash}</span>
          </li>
        ))}
      </ul>
      {events.length > 6 && (
        <button
          type="button"
          class="link"
          onClick={() => {
            setAll(!all);
          }}
        >
          {all ? 'Show fewer' : `Show all ${events.length}`}
        </button>
      )}
    </section>
  );
}

export function ChecksScreen(props: {
  state: PreviewState;
  d: Derived;
  dispatch: Dispatch;
  navigate: Navigate;
}): JSX.Element {
  const { state, d } = props;
  const [stage, setStage] = useState<ValidationStage>(
    state.status === 'approved' || state.status === 'issued' ? 'issue' : 'submit',
  );
  const result = d.validation[stage];
  const sorted = [...result.findings].sort(
    (a, b) =>
      Number(Boolean(a.acknowledgement)) - Number(Boolean(b.acknowledgement)) ||
      (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1),
  );
  return (
    <>
      <NextStepCard {...props} />
      <section class="card" aria-labelledby="checks">
        <div class="card-head">
          <h2 id="checks">Checks</h2>
          <Segmented
            label="Stage"
            value={stage}
            options={[
              ['submit', 'Before QA'],
              ['issue', 'Before issue'],
            ]}
            onChange={setStage}
          />
        </div>
        <div class="summary-tiles">
          <div class={`tile ${result.blockingCount ? 'blocking' : 'ok'}`}>
            <span class="big-number">{result.blockingCount}</span>
            <span class="muted">must fix</span>
          </div>
          <div class={`tile ${result.unacknowledgedWarningCount ? 'warning' : 'ok'}`}>
            <span class="big-number">{result.unacknowledgedWarningCount}</span>
            <span class="muted">to acknowledge</span>
          </div>
          <div class="tile">
            <span class="big-number">{result.rulesEvaluated.length}</span>
            <span class="muted">rules run</span>
          </div>
        </div>
        {sorted.length === 0 ? (
          <div class="notice ok">All {result.rulesEvaluated.length} rules pass at this stage.</div>
        ) : (
          <ul class="plain">
            {sorted.map((f) => (
              <FindingCard
                key={f.code + f.path}
                f={f}
                state={state}
                dispatch={props.dispatch}
                navigate={props.navigate}
              />
            ))}
          </ul>
        )}
      </section>
      <CertificationCard state={state} d={d} dispatch={props.dispatch} />
      <QaCard state={state} dispatch={props.dispatch} />
      <AuditCard state={state} />
    </>
  );
}
