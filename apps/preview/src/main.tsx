import { render, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { INPUT_TABS } from '@vp/domain';
import {
  JOB,
  apply,
  derive,
  describeError,
  initialState,
  qaVisible,
  statusLabel,
  type PreviewState,
} from './model.js';
import { QaScreen } from './screens/qa.js';
import { ReportScreen } from './screens/report.js';
import { ReviewScreen } from './screens/review.js';
import { InputTabScreen, JobScreen } from './screens/tabs.js';
import { Pill, STATUS_TONE, TAB_TITLES, type Dispatch, type Navigate, type Tab } from './ui.js';

const STORE_KEY = 'vp-preview-state';

function load(): PreviewState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { schema?: unknown };
      if (parsed.schema === 2) return parsed as PreviewState;
    }
  } catch {
    // storage unavailable or unreadable: start fresh
  }
  return initialState();
}

function save(state: PreviewState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable: the preview still works for this visit
  }
}

function App(): JSX.Element {
  const [state, setState] = useState<PreviewState>(load);
  const stateRef = useRef(state);
  const [tab, setTab] = useState<Tab>('job');
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean; n: number } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const d = useMemo(() => derive(state), [state]);
  const showQa = qaVisible(state);
  const tabs: readonly Tab[] = [
    ...INPUT_TABS.map((t) => t.id),
    ...(showQa ? (['qa'] as const) : []),
    'report',
  ];
  const current: Tab = tabs.includes(tab) ? tab : 'job';

  useEffect(() => {
    document
      .getElementById(`tab-${current}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [current]);

  const showToast = (text: string, error: boolean) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, error, n: Date.now() });
    toastTimer.current = window.setTimeout(
      () => {
        setToast(null);
      },
      error ? 7000 : 3500,
    );
  };

  const dispatch: Dispatch = (action, success) => {
    try {
      const next = apply(stateRef.current, action);
      stateRef.current = next;
      setState(next);
      save(next);
      if (success) showToast(success, false);
      return true;
    } catch (e) {
      showToast(describeError(e), true);
      return false;
    }
  };

  const navigate: Navigate = (t, id) => {
    setTab(t);
    setFocus(id ? { id, n: Date.now() } : null);
    if (!id) window.scrollTo({ top: 0 });
  };

  const badge = (t: Tab): JSX.Element | null => {
    if (t === 'qa')
      return state.status === 'submitted' || state.status === 'in_review' ? (
        <span class="badge" aria-label="needs review">
          !
        </span>
      ) : null;
    if (t === 'report') return null;
    const n = d.missingByTab[t] ?? 0;
    return n > 0 ? (
      <span class="badge" aria-label={`${n} to do`}>
        {n}
      </span>
    ) : null;
  };

  const screen = { state, d, dispatch, navigate, focus };

  return (
    <div class="shell">
      <div class="preview-strip">
        <span>Preview with made-up data. Changes stay in this browser only.</span>
        <button
          type="button"
          onClick={() => {
            if (dispatch({ type: 'reset' }, 'Started again')) navigate('job');
          }}
        >
          Start again
        </button>
      </div>
      <header class="appbar">
        <div class="appbar-top">
          <div>
            <div class="ref">{JOB.reference}</div>
            <div class="addr">{JOB.address}</div>
          </div>
          <Pill tone={STATUS_TONE[state.status]}>{statusLabel(state.status)}</Pill>
        </div>
        <nav class="tabstrip" aria-label="Sections">
          {tabs.map((t) => (
            <button
              key={t}
              id={`tab-${t}`}
              type="button"
              class={`tabstrip-tab ${t === 'qa' ? 'qa' : ''}`}
              aria-current={current === t ? 'page' : undefined}
              onClick={() => {
                navigate(t);
              }}
            >
              {TAB_TITLES[t]}
              {badge(t)}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {current === 'job' && <JobScreen {...screen} />}
        {(current === 'property' ||
          current === 'inspection' ||
          current === 'evidence' ||
          current === 'valuation') && <InputTabScreen {...screen} tab={current} />}
        {current === 'review' && <ReviewScreen {...screen} />}
        {current === 'qa' && <QaScreen {...screen} />}
        {current === 'report' && <ReportScreen d={d} />}
      </main>
      {toast && (
        <div
          class={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
          key={toast.n}
        >
          <span>{toast.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setToast(null);
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
