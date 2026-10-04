import type { JSX } from 'preact';
import {
  JURISDICTION_LABELS,
  PROPERTY_TYPE_LABELS,
  formatAustralianDate,
  type CommentarySuggestion,
} from '@vp/domain';
import {
  ASSET_ID,
  commentaryFor,
  fieldValue,
  isLocked,
  type Derived,
  type PreviewState,
} from '../model.js';
import { Pill, type Dispatch } from '../ui.js';

const LEVEL_NAMES: Readonly<Record<CommentarySuggestion['level'], string>> = {
  national: 'National',
  state: 'State',
  local: 'Local',
};

/**
 * Offers the firm's approved national, state and local commentary for the property type and
 * suburb, as at the valuation date. The valuer uses it, then tailors it in the fields below.
 */
export function CommentaryCard(props: {
  state: PreviewState;
  d: Derived;
  dispatch: Dispatch;
}): JSX.Element | null {
  const { state, d, dispatch } = props;
  const levels = commentaryFor(state, new Date().toISOString()).filter((s) =>
    d.requirements.fields.some((f) => f.fieldId === s.fieldId),
  );
  if (!levels.length) return null;
  const locked = isLocked(state);
  const current = (s: CommentarySuggestion): unknown =>
    fieldValue(state, s.fieldId, s.level === 'local' ? ASSET_ID : null);
  const inUse = (s: CommentarySuggestion) => s.modules.length > 0 && current(s) === s.text;
  const unused = levels.filter((s) => s.modules.length > 0 && !inUse(s));
  const valuationDate = state.values.job['dates.valuation'];
  const localDue = levels.find((s) => s.level === 'local')?.dueAsAt;
  const use = (picked: readonly CommentarySuggestion[]) =>
    dispatch(
      { type: 'useCommentary', levels: picked.map((s) => s.level) },
      picked.length === 1
        ? `${LEVEL_NAMES[picked[0]?.level ?? 'national']} commentary added. Tailor it below.`
        : 'Firm commentary added. Tailor it below.',
    );

  return (
    <section class="card" aria-labelledby="mc">
      <div class="card-head">
        <h3 id="mc">Market commentary</h3>
        {unused.length > 1 && (
          <button
            type="button"
            class="btn small primary"
            disabled={locked}
            onClick={() => use(unused)}
          >
            Use all
          </button>
        )}
      </div>
      <p class="muted small">
        The firm’s approved commentary for{' '}
        {PROPERTY_TYPE_LABELS[state.selection.propertyType].toLowerCase()} in{' '}
        {JURISDICTION_LABELS[state.selection.jurisdiction]}. National and state: the latest monthly
        edition at the valuation date
        {typeof valuationDate === 'string' ? ` (${formatAustralianDate(valuationDate)})` : ''}.
        Local:{' '}
        {localDue && localDue !== valuationDate
          ? `the latest for the area today (${formatAustralianDate(localDue)}), so the report goes out current`
          : 'as at the valuation date'}
        . Use it, then tailor it to this property in the boxes below.
      </p>
      {levels.map((s) => {
        const typed = typeof current(s) === 'string' && !inUse(s);
        return (
          <div class="commentary-level" key={s.level}>
            <div class="card-head">
              <h4>{s.heading}</h4>
              <div class="row">
                {inUse(s) ? (
                  <Pill tone="ok">Using firm text</Pill>
                ) : s.modules.length ? (
                  <button
                    type="button"
                    class="btn small"
                    id={`mc-use-${s.level}`}
                    disabled={locked}
                    onClick={() => use([s])}
                  >
                    {typed ? 'Replace my text' : 'Use'}
                  </button>
                ) : (
                  <Pill tone="warning">Write your own</Pill>
                )}
              </div>
            </div>
            {s.asAtDate && (
              <p class="muted small">
                {s.modules.map((m) => m.title).join(' + ')} · as at{' '}
                {formatAustralianDate(s.asAtDate)}
              </p>
            )}
            {s.notes.map((n) => (
              <div class="notice warning small" key={n}>
                {n}
              </div>
            ))}
            {s.text && (
              <details class="commentary-preview">
                <summary>Read the firm’s text</summary>
                <p class="commentary-text">{s.text}</p>
              </details>
            )}
            <p class="muted small topics">
              <strong>Cover:</strong> {s.topics.join(' · ')}
            </p>
          </div>
        );
      })}
    </section>
  );
}
