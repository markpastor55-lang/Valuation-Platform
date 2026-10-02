import { render, type JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import {
  JOB,
  PEOPLE,
  apply,
  derive,
  describeError,
  initialState,
  statusLabel,
  type PreviewState,
} from './model.js';
import { ChecksScreen } from './screens/checks.js';
import { FieldsScreen } from './screens/fields.js';
import { JobScreen } from './screens/job.js';
import { ReportScreen } from './screens/report.js';
import { SketchScreen } from './screens/sketch.js';
import {
  Icon,
  Pill,
  ROLE_OPTIONS,
  STATUS_TONE,
  Segmented,
  type Dispatch,
  type Navigate,
  type Tab,
} from './ui.js';

const STORE_KEY = 'vp-preview-state';

function load(): PreviewState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { schema?: unknown };
      if (parsed.schema === 1) return parsed as PreviewState;
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

const TABS: readonly (readonly [Tab, string])[] = [
  ['job', 'Job'],
  ['fields', 'Fields'],
  ['sketch', 'Sketch'],
  ['checks', 'Checks'],
  ['report', 'Report'],
];

function App(): JSX.Element {
  const [state, setState] = useState<PreviewState>(load);
  const stateRef = useRef(state);
  const [tab, setTab] = useState<Tab>('job');
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean; n: number } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const d = useMemo(() => derive(state), [state]);

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

  const missing = d.missing.filter((m) => m.level === 'required').length;
  const stage = state.status === 'approved' || state.status === 'issued' ? 'issue' : 'submit';
  const blocking = d.validation[stage].blockingCount;
  const badges: Partial<Record<Tab, number>> = { fields: missing, checks: blocking };
  const screenProps = { state, d, dispatch, navigate };

  return (
    <div class="shell">
      <div class="preview-strip">
        <span>Preview with synthetic data. Changes stay in this browser only.</span>
        <button
          type="button"
          onClick={() => {
            if (dispatch({ type: 'reset' }, 'Demo reset to the start')) navigate('job');
          }}
        >
          Reset demo
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
        <div class="role-row">
          <span class="eyebrow">Viewing as</span>
          <Segmented
            full
            label="Viewing as"
            value={state.role}
            options={ROLE_OPTIONS}
            onChange={(role) =>
              dispatch({ type: 'setRole', role }, `Now viewing as ${PEOPLE[role].displayName}`)
            }
          />
        </div>
      </header>
      <main>
        {tab === 'job' && <JobScreen {...screenProps} />}
        {tab === 'fields' && <FieldsScreen {...screenProps} focus={focus} />}
        {tab === 'sketch' && <SketchScreen state={state} d={d} dispatch={dispatch} />}
        {tab === 'checks' && <ChecksScreen {...screenProps} />}
        {tab === 'report' && <ReportScreen state={state} d={d} />}
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
      <nav class="tabbar" aria-label="Sections">
        <div class="tabbar-inner">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              type="button"
              class="tab"
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => {
                navigate(t);
              }}
            >
              <Icon name={t} />
              {label}
              {badges[t] ? <span class="badge">{badges[t]}</span> : null}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

const root = document.getElementById('app');
if (root) render(<App />, root);
