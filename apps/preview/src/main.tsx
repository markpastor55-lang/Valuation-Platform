import { render, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { INPUT_TABS } from '@vp/domain';
import { applyToJob, createJob, seedApp, updateProfile, type AppState } from './app-state.js';
import { derive, describeError, qaVisible, statusLabel, type PreviewAction } from './model.js';
import { NewJobScreen } from './screens/new-job.js';
import { ProfileScreen } from './screens/profile.js';
import { QaScreen } from './screens/qa.js';
import { ReportScreen } from './screens/report.js';
import { ReviewScreen } from './screens/review.js';
import { InputTabScreen, JobScreen } from './screens/tabs.js';
import { WipScreen } from './screens/wip.js';
import { Pill, STATUS_TONE, TAB_TITLES, type Dispatch, type Navigate, type Tab } from './ui.js';

const STORE_KEY = 'vp-preview-app';

function load(): AppState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { schema?: unknown };
      if (parsed.schema === 3) return parsed as AppState;
    }
  } catch {
    // storage unavailable or unreadable: start fresh
  }
  return null;
}

function save(app: AppState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(app));
  } catch {
    // storage unavailable: the preview still works for this visit
  }
}

type Screen =
  { kind: 'wip' } | { kind: 'new' } | { kind: 'profile' } | { kind: 'job'; jobId: string };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

function App(): JSX.Element {
  const [app, setApp] = useState<AppState | null>(load);
  const appRef = useRef(app);
  const [screen, setScreen] = useState<Screen>({ kind: 'wip' });
  const [tab, setTab] = useState<Tab>('job');
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean; n: number } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const commit = (next: AppState) => {
    appRef.current = next;
    setApp(next);
    save(next);
  };

  useEffect(() => {
    if (app) return;
    void seedApp().then(commit);
  }, [app]);

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

  const attempt = (fn: (a: AppState) => AppState, success?: string): boolean => {
    const current = appRef.current;
    if (!current) return false;
    try {
      commit(fn(current));
      if (success) showToast(success, false);
      return true;
    } catch (e) {
      showToast(describeError(e), true);
      return false;
    }
  };

  const go = (s: Screen) => {
    setScreen(s);
    setFocus(null);
    window.scrollTo({ top: 0 });
  };

  const jobId = screen.kind === 'job' ? screen.jobId : null;
  const job = jobId && app ? app.jobs[jobId] : undefined;
  const d = useMemo(() => (job ? derive(job) : null), [job]);
  const showQa = job ? qaVisible(job) : false;
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

  if (!app)
    return (
      <div class="shell">
        <main>
          <p class="muted">Setting up the demo jobs…</p>
        </main>
      </div>
    );

  const dispatch: Dispatch = (action: PreviewAction, success?: string) =>
    jobId ? attempt((a) => applyToJob(a, jobId, action, new Date().toISOString()), success) : false;

  const navigate: Navigate = (t, id) => {
    setTab(t);
    setFocus(id ? { id, n: Date.now() } : null);
    if (!id) window.scrollTo({ top: 0 });
  };

  const openJob = (id: string) => {
    setTab('job');
    go({ kind: 'job', jobId: id });
  };

  const badge = (t: Tab): JSX.Element | null => {
    if (!job || !d) return null;
    if (t === 'qa')
      return job.status === 'submitted' || job.status === 'in_review' ? (
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

  return (
    <div class="shell">
      <div class="preview-strip">
        <span>Preview with made-up data. Changes stay on this device only.</span>
        <button
          type="button"
          onClick={() => {
            void seedApp().then((fresh) => {
              commit(fresh);
              go({ kind: 'wip' });
              showToast('Started again with the demo jobs', false);
            });
          }}
        >
          Start again
        </button>
      </div>
      <header class="appbar">
        {job ? (
          <div class="appbar-top">
            <div>
              <button
                type="button"
                class="link back"
                onClick={() => {
                  go({ kind: 'wip' });
                }}
              >
                ‹ Work in progress
              </button>
              <div class="ref">{job.job.reference}</div>
              <div class="addr">{job.job.address}</div>
            </div>
            <Pill tone={STATUS_TONE[job.status]}>{statusLabel(job.status)}</Pill>
          </div>
        ) : (
          <div class="appbar-top">
            <div>
              <div class="ref">Example Valuers Pty Ltd</div>
              <div class="addr">Valuation workspace</div>
            </div>
            <button
              type="button"
              class="avatar"
              aria-label="Your profile"
              title="Your profile"
              onClick={() => {
                go({ kind: 'profile' });
              }}
            >
              {initials(app.profile.fullName)}
            </button>
          </div>
        )}
        {job && (
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
        )}
      </header>
      <main>
        {screen.kind === 'wip' && (
          <WipScreen
            app={app}
            onOpen={openJob}
            onNew={() => {
              go({ kind: 'new' });
            }}
          />
        )}
        {screen.kind === 'new' && (
          <NewJobScreen
            app={app}
            onOpen={openJob}
            onCancel={() => {
              go({ kind: 'wip' });
            }}
            onCreate={(input) => {
              const current = appRef.current;
              if (!current) return false;
              try {
                const r = createJob(current, input, new Date().toISOString());
                commit(r.app);
                showToast('Job created. Accept it when you are ready.', false);
                openJob(r.jobId);
                return true;
              } catch (e) {
                showToast(describeError(e), true);
                return false;
              }
            }}
          />
        )}
        {screen.kind === 'profile' && (
          <ProfileScreen
            profile={app.profile}
            onBack={() => {
              go(job ? { kind: 'job', jobId: job.job.id } : { kind: 'wip' });
            }}
            onSave={(p) => attempt((a) => updateProfile(a, p), 'Profile saved')}
          />
        )}
        {job && d && (
          <>
            {(() => {
              const props = {
                state: job,
                d,
                dispatch,
                navigate,
                focus,
                profile: app.profile,
                openProfile: () => {
                  go({ kind: 'profile' });
                },
              };
              switch (current) {
                case 'job':
                  return <JobScreen {...props} />;
                case 'property':
                case 'inspection':
                case 'evidence':
                case 'valuation':
                  return <InputTabScreen {...props} tab={current} />;
                case 'review':
                  return <ReviewScreen {...props} />;
                case 'qa':
                  return <QaScreen {...props} />;
                case 'report':
                  return <ReportScreen d={d} profile={app.profile} />;
              }
            })()}
          </>
        )}
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
