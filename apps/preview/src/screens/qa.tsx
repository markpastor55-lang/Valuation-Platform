import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { qaApprovalBlockers } from '@vp/domain';
import { REVIEWER, VALUER, transitionCheck } from '../model.js';
import { Pill, Segmented, humanise, when } from '../ui.js';
import type { ScreenProps } from './tabs.js';

/** The QA reviewer's side. It exists only once the valuer has sent the job to QA. */
export function QaScreen(props: ScreenProps): JSX.Element {
  const { state, d, dispatch, navigate } = props;
  const [reason, setReason] = useState('');
  const review = state.qaReview;
  const open = state.status === 'in_review';
  const approveCheck = transitionCheck(state, d, 'approve');
  const answered = review ? review.checklist.filter((c) => c.response !== null).length : 0;
  return (
    <>
      <div class="tab-intro">
        <h2>QA review</h2>
        <p class="muted">
          You are now seeing {REVIEWER.displayName}’s side. In the real app the reviewer uses their
          own login and can’t be the valuer who signed.
        </p>
      </div>
      {state.status === 'submitted' && (
        <section class="card">
          <h3>Waiting to start</h3>
          <p>
            {VALUER.displayName} signed and sent this for review. Starting locks the version you are
            reviewing.
          </p>
          <div class="row">
            <button
              type="button"
              class="btn primary"
              onClick={() =>
                dispatch({ type: 'transition', action: 'startReview' }, 'Review started')
              }
            >
              Start review
            </button>
          </div>
        </section>
      )}
      {review && (
        <section class="card" aria-labelledby="checklist">
          <div class="card-head">
            <h3 id="checklist">Checklist</h3>
            <Pill
              tone={review.outcome === 'approved' ? 'ok' : review.outcome ? 'blocking' : 'warning'}
            >
              {review.outcome
                ? `${humanise(review.outcome)}${review.completedAt ? ` ${when(review.completedAt)}` : ''}`
                : `${answered}/${review.checklist.length} answered`}
            </Pill>
          </div>
          <div class="checklist">
            {review.checklist.map((c) => (
              <div key={c.id} class="check-item">
                <span>{c.label}</span>
                <Segmented
                  label={c.label}
                  value={c.response ?? ''}
                  disabled={!open}
                  options={[
                    ['yes', 'Yes'],
                    ['na', 'N/A'],
                  ]}
                  onChange={(v) => {
                    dispatch({
                      type: 'answerChecklist',
                      itemId: c.id,
                      response: v as 'yes' | 'na',
                    });
                  }}
                />
              </div>
            ))}
          </div>
          {open && (
            <>
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
              </div>
              <div class="row">
                <button
                  type="button"
                  class="btn primary"
                  disabled={!approveCheck.allowed}
                  onClick={() => {
                    if (
                      dispatch(
                        { type: 'transition', action: 'approve' },
                        'Approved. The valuer can now issue the report.',
                      )
                    )
                      navigate('review');
                  }}
                >
                  Approve
                </button>
                {qaApprovalBlockers(review).length > 0 && (
                  <span class="muted small">Answer every item to approve.</span>
                )}
              </div>
              <form
                class="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    dispatch(
                      { type: 'transition', action: 'returnToValuer', reason },
                      `Sent back to ${VALUER.displayName}`,
                    )
                  )
                    navigate('review');
                }}
              >
                <label class="field-label" for="qa-return-reason">
                  Or send it back to the valuer
                </label>
                <textarea
                  id="qa-return-reason"
                  rows={2}
                  value={reason}
                  onInput={(e) => {
                    setReason(e.currentTarget.value);
                  }}
                  placeholder="What needs changing, e.g. explain the adjustment to sale 2"
                />
                <div class="row">
                  <button type="submit" class="btn small" disabled={reason.trim().length < 10}>
                    Send back
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
}
