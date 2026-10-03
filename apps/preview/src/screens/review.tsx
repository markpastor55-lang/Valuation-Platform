import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import {
  INPUT_TABS,
  MIN_ACKNOWLEDGEMENT_REASON,
  REPORT_PURPOSE_LABELS,
  formatAustralianDate,
  inputTabForField,
  verifyAuditChain,
  type Finding,
} from '@vp/domain';
import {
  ASSET_ID,
  ATTESTATION,
  REVIEWER,
  USER_NAMES,
  VALUER,
  isLocked,
  transitionCheck,
  type Derived,
  type PreviewState,
} from '../model.js';
import { Pill, aud, humanise, readable, when, type Dispatch, type Navigate } from '../ui.js';
import type { ScreenProps } from './tabs.js';

const fieldOf = (f: Finding): string | undefined => /field:([A-Za-z.]+)/.exec(f.path)?.[1];

function TabChecklist(props: { d: Derived; navigate: Navigate }): JSX.Element {
  return (
    <ul class="plain tab-checklist">
      {INPUT_TABS.filter((t) => t.id !== 'review').map((t) => {
        const missing = props.d.missingByTab[t.id] ?? 0;
        return (
          <li key={t.id}>
            <button
              type="button"
              class="tab-check"
              onClick={() => {
                props.navigate(t.id);
              }}
            >
              <span class={`dot ${missing ? 'todo' : 'done'}`} aria-hidden="true">
                {missing ? missing : '✓'}
              </span>
              <span>{t.title}</span>
              <span class="muted small">{missing ? `${missing} to do` : 'Done'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function OtherFinding(props: {
  f: Finding;
  state: PreviewState;
  dispatch: Dispatch;
  navigate: Navigate;
}): JSX.Element {
  const { f, state, dispatch } = props;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const field = fieldOf(f);
  const tab = field ? inputTabForField(field) : undefined;
  return (
    <li class={`finding ${f.acknowledgement ? 'acknowledged' : f.severity}`}>
      <span class="finding-title">{f.title}</span>
      <span>{readable(f.message)}</span>
      {f.acknowledgement && (
        <span class="muted small">
          Noted by {USER_NAMES[f.acknowledgement.by] ?? f.acknowledgement.by}: “
          {f.acknowledgement.reason}”
        </span>
      )}
      <div class="row">
        {tab && field && (
          <button
            type="button"
            class="btn small"
            onClick={() => {
              props.navigate(tab, field);
            }}
          >
            Fix it
          </button>
        )}
        {f.severity === 'warning' && !f.acknowledgement && !open && !isLocked(state) && (
          <button
            type="button"
            class="btn small"
            onClick={() => {
              setOpen(true);
            }}
          >
            It’s fine, explain why…
          </button>
        )}
      </div>
      {open && (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (dispatch({ type: 'acknowledge', code: f.code, path: f.path, reason }, 'Noted'))
              setOpen(false);
          }}
        >
          <textarea
            id={`ack-${f.code}-${f.path}`}
            rows={2}
            value={reason}
            aria-label="Reason"
            placeholder="Why this is acceptable (kept in the job history)"
            onInput={(e) => {
              setReason(e.currentTarget.value);
            }}
          />
          <div class="row">
            <button
              type="submit"
              class="btn primary small"
              disabled={reason.trim().length < MIN_ACKNOWLEDGEMENT_REASON}
            >
              Save
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

function SendToQaCard(props: ScreenProps): JSX.Element {
  const { state, d, dispatch, navigate } = props;
  const [certify, setCertify] = useState(false);
  const result = d.validation.submit;
  const others = result.findings.filter(
    (f) => f.code !== 'VAL-REQ-001' && f.code !== 'VAL-REQ-002',
  );
  const missingRequired = d.missing.filter((m) => m.level === 'required').length;
  const ready = result.blockingCount === 0 && result.unacknowledgedWarningCount === 0;
  const asset = state.values.assets[ASSET_ID] ?? {};
  const adopted = asset['valuation.adoptedValue'];
  const date = state.values.job['dates.valuation'];
  const basis = state.values.job['instruction.basisOfValue'];
  const returned =
    state.status === 'returned'
      ? state.audit.findLast((e) => e.action === 'qa.returned')
      : undefined;
  return (
    <>
      {returned && (
        <div class="notice blocking">
          <strong>QA sent this back.</strong> {REVIEWER.displayName}: “{returned.reason}”. Make the
          changes, then sign and send it again.
        </div>
      )}
      <section class="card" aria-labelledby="progress">
        <div class="card-head">
          <h2 id="progress">Before you send to QA</h2>
          <span class="muted small num">
            {d.requiredCaptured}/{d.requiredCount} answered
          </span>
        </div>
        <TabChecklist d={d} navigate={navigate} />
        {missingRequired === 0 && others.length === 0 && (
          <div class="notice ok">Everything is complete and all checks pass.</div>
        )}
        {others.length > 0 && (
          <ul class="plain">
            {others.map((f) => (
              <OtherFinding
                key={f.code + f.path}
                f={f}
                state={state}
                dispatch={dispatch}
                navigate={navigate}
              />
            ))}
          </ul>
        )}
      </section>
      <section class="card" aria-labelledby="sign">
        <h2 id="sign">Sign and send to QA</h2>
        <dl class="kv">
          <dt>Purpose</dt>
          <dd>{REPORT_PURPOSE_LABELS[state.selection.purpose]}</dd>
          <dt>Value</dt>
          <dd>{typeof adopted === 'number' ? aud(adopted) : '—'}</dd>
          <dt>Valuation date</dt>
          <dd>
            {typeof date === 'string' ? formatAustralianDate(date) : '—'}
            {d.retrospective.retrospective && <Pill tone="warning">retrospective</Pill>}
          </dd>
          <dt>Basis</dt>
          <dd>{typeof basis === 'string' ? humanise(basis) : '—'}</dd>
          <dt>Valuer</dt>
          <dd>
            {VALUER.displayName} ({VALUER.credentials.join(', ')})
          </dd>
        </dl>
        <label class="certify">
          <input
            id="certify"
            type="checkbox"
            checked={certify}
            disabled={!ready}
            onChange={(e) => {
              setCertify(e.currentTarget.checked);
            }}
          />
          <span>{ATTESTATION}</span>
        </label>
        <button
          type="button"
          class="btn primary"
          disabled={!ready || !certify}
          onClick={() => {
            if (
              dispatch(
                { type: 'sendToQa' },
                `Signed and sent to QA. ${REVIEWER.displayName} can now review it.`,
              )
            )
              setCertify(false);
          }}
        >
          Sign and send to QA
        </button>
        {!ready && (
          <p class="muted small">
            Finish the items above first. Only you can sign; QA starts once you send it.
          </p>
        )}
      </section>
    </>
  );
}

function WithQaCard(props: ScreenProps): JSX.Element {
  const { state, navigate } = props;
  const sent = state.audit.findLast((e) => e.action === 'job.submitted');
  return (
    <section class="card" aria-labelledby="withqa">
      <h2 id="withqa">With QA</h2>
      <p>
        You sent this to {REVIEWER.displayName}
        {sent ? ` on ${when(sent.at)}` : ''}. It’s read-only while QA reviews it.
      </p>
      <div class="row">
        <button
          type="button"
          class="btn primary"
          onClick={() => {
            navigate('qa');
          }}
        >
          Open the QA tab
        </button>
      </div>
      <p class="muted small">
        In the real app {REVIEWER.displayName} reviews from their own login. The QA tab lets you try
        their side here.
      </p>
    </section>
  );
}

function IssueCard(props: ScreenProps): JSX.Element {
  const { state, d, dispatch, navigate } = props;
  const check = transitionCheck(state, d, 'issue');
  if (state.status === 'issued')
    return (
      <section class="card" aria-labelledby="issued">
        <h2 id="issued">Report issued</h2>
        <p>
          Final version 1 was issued {state.issuedAt ? when(state.issuedAt) : ''}. The content is
          now frozen; changes need an amendment and a new version.
        </p>
        <div class="row">
          <button
            type="button"
            class="btn primary"
            onClick={() => {
              navigate('report');
            }}
          >
            View the report
          </button>
        </div>
      </section>
    );
  return (
    <section class="card" aria-labelledby="issue">
      <h2 id="issue">QA approved: ready to issue</h2>
      <p>
        {REVIEWER.displayName} approved the report. Issuing sends the final report and tax invoice.
      </p>
      {!check.allowed && (
        <ul class="failures">
          {check.failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <div class="row">
        <button
          type="button"
          class="btn primary"
          disabled={!check.allowed}
          onClick={() => {
            if (dispatch({ type: 'transition', action: 'issue' }, 'Report issued'))
              navigate('report');
          }}
        >
          Issue report
        </button>
      </div>
    </section>
  );
}

function History(props: { state: PreviewState }): JSX.Element {
  const events = props.state.audit;
  const verification = verifyAuditChain(events);
  return (
    <details class="card history">
      <summary>
        <h3>Job history</h3>
        <Pill tone={verification.valid ? 'ok' : 'blocking'}>
          {verification.valid ? `${events.length} entries · tamper-evident` : 'Tampered'}
        </Pill>
      </summary>
      <p class="muted small">
        Every change is recorded. Each entry includes a fingerprint of the one before, so editing or
        deleting an old entry would show up.
      </p>
      <ul class="plain audit">
        {[...events].reverse().map((e) => (
          <li key={e.id}>
            <span class="seq">#{e.seq}</span>
            <span>
              <strong>{humanise(e.action.replace('.', ' '))}</strong> ·{' '}
              {USER_NAMES[e.actor.userId] ?? e.actor.userId} · {when(e.at)}
              {e.reason && <span class="muted"> · “{e.reason}”</span>}
            </span>
            <span class="hash">{e.hash}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ReviewScreen(props: ScreenProps): JSX.Element {
  const { state } = props;
  return (
    <>
      <div class="tab-intro">
        <h2>Review</h2>
        <p class="muted">Check everything is complete, then sign and send it to QA.</p>
      </div>
      {(state.status === 'active' || state.status === 'returned') && <SendToQaCard {...props} />}
      {(state.status === 'submitted' || state.status === 'in_review') && <WithQaCard {...props} />}
      {(state.status === 'approved' || state.status === 'issued') && <IssueCard {...props} />}
      <History state={state} />
    </>
  );
}
