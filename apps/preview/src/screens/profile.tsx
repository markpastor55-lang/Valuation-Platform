import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  JURISDICTIONS,
  VALUER_REGISTRATION_RULES,
  profileProblems,
  signingProblems,
  type Jurisdiction,
  type ValuerProfile,
  type ValuerRegistration,
} from '@vp/domain';
import { Segmented } from '../ui.js';

const DESIGNATIONS = ['AAPI', 'FAPI', 'CPV', 'RPV', 'CPP'] as const;
const REG_STATES = ['QLD', 'WA'] as const;

/** Signature pad: draw with a finger, stylus or mouse. Produces a PNG data URL. */
function SignaturePad(props: { onChange: (dataUrl: string | null) => void }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#14243a';
  }, []);

  const pos = (e: PointerEvent) => {
    const c = ref.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };
  return (
    <div class="stack">
      <canvas
        ref={ref}
        class="signature-pad"
        width={600}
        height={180}
        aria-label="Draw your signature"
        onPointerDown={(e) => {
          const ctx = ref.current?.getContext('2d');
          if (!ctx) return;
          drawing.current = true;
          ref.current?.setPointerCapture(e.pointerId);
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current?.getContext('2d');
          if (!ctx) return;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          setEmpty(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (!empty) props.onChange(ref.current?.toDataURL('image/png') ?? null);
        }}
      />
      <div class="row">
        <button
          type="button"
          class="link"
          onClick={() => {
            const c = ref.current;
            c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
            setEmpty(true);
            props.onChange(null);
          }}
        >
          Clear
        </button>
        <span class="muted small">Sign inside the box with your finger, stylus or mouse.</span>
      </div>
    </div>
  );
}

export function SignatureView(props: { profile: ValuerProfile }): JSX.Element | null {
  const s = props.profile.signature;
  if (!s) return null;
  return s.kind === 'drawn' ? (
    <img class="signature-img" src={s.value} alt={`Signature of ${props.profile.fullName}`} />
  ) : (
    <span class="signature-typed">{s.value}</span>
  );
}

export function ProfileScreen(props: {
  profile: ValuerProfile;
  onSave: (p: ValuerProfile) => boolean;
  onBack: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<ValuerProfile>(props.profile);
  const [mode, setMode] = useState<'keep' | 'drawn' | 'typed'>(
    props.profile.signature ? 'keep' : 'drawn',
  );
  const [drawn, setDrawn] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const reg = (j: (typeof REG_STATES)[number]): ValuerRegistration | undefined =>
    draft.registrations.find((r) => r.jurisdiction === j);
  const setReg = (j: Jurisdiction, patch: Partial<ValuerRegistration>) => {
    const others = draft.registrations.filter((r) => r.jurisdiction !== j);
    const current = draft.registrations.find((r) => r.jurisdiction === j) ?? {
      jurisdiction: j,
      number: '',
    };
    const next = { ...current, ...patch };
    setDraft({
      ...draft,
      registrations: next.number.trim() || next.expiresOn ? [...others, next] : others,
    });
  };
  const signature =
    mode === 'drawn'
      ? drawn
        ? { kind: 'drawn' as const, value: drawn, updatedAt: new Date().toISOString() }
        : undefined
      : mode === 'typed'
        ? { kind: 'typed' as const, value: draft.fullName, updatedAt: new Date().toISOString() }
        : draft.signature;
  const { signature: _old, ...rest } = draft;
  const candidate: ValuerProfile = { ...rest, ...(signature ? { signature } : {}) };
  const problems = profileProblems(candidate);
  return (
    <>
      <div class="tab-intro">
        <h2>Your profile</h2>
        <p class="muted">Used when you sign a report. Only you can change it.</p>
      </div>
      <section class="card" aria-labelledby="who">
        <h3 id="who">Name and membership</h3>
        <label class="field-label">
          Full name (as it appears on reports)
          <input
            id="profile-name"
            type="text"
            value={draft.fullName}
            onInput={(e) => {
              setDraft({ ...draft, fullName: e.currentTarget.value });
            }}
          />
        </label>
        <div class="stack">
          <span class="field-label">Designations</span>
          <div class="toggle-chips" role="group" aria-label="Designations">
            {DESIGNATIONS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={draft.credentials.includes(d)}
                onClick={() => {
                  setDraft({
                    ...draft,
                    credentials: draft.credentials.includes(d)
                      ? draft.credentials.filter((x) => x !== d)
                      : [...draft.credentials, d],
                  });
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <label class="field-label">
          API member number
          <input
            id="profile-api"
            type="text"
            inputMode="numeric"
            value={draft.apiMemberNumber ?? ''}
            onInput={(e) => {
              const v = e.currentTarget.value;
              const { apiMemberNumber: _a, ...withoutApi } = draft;
              setDraft(v ? { ...withoutApi, apiMemberNumber: v } : withoutApi);
            }}
          />
        </label>
      </section>
      <section class="card" aria-labelledby="regs">
        <h3 id="regs">State registration and licences</h3>
        <p class="muted small">
          Queensland jobs need your registered valuer number; Western Australian jobs need your
          licensed valuer number. Other states use your API membership.
        </p>
        {REG_STATES.map((j) => {
          const r = reg(j);
          return (
            <div key={j} class="reg-row">
              <label class="field-label">
                {VALUER_REGISTRATION_RULES[j]?.label}
                <input
                  id={`reg-${j}`}
                  type="text"
                  value={r?.number ?? ''}
                  placeholder="Not held"
                  onInput={(e) => {
                    setReg(j, { number: e.currentTarget.value });
                  }}
                />
              </label>
              <label class="field-label">
                Expires
                <input
                  id={`reg-${j}-exp`}
                  type="date"
                  value={r?.expiresOn ?? ''}
                  onInput={(e) => {
                    const v = e.currentTarget.value;
                    setReg(j, v ? { expiresOn: v } : {});
                  }}
                />
              </label>
            </div>
          );
        })}
      </section>
      <section class="card" aria-labelledby="sig">
        <h3 id="sig">Sign-off signature</h3>
        <Segmented
          label="Signature"
          value={mode}
          options={[
            ...(props.profile.signature ? ([['keep', 'Current']] as const) : []),
            ['drawn', 'Draw'],
            ['typed', 'Type'],
          ]}
          onChange={setMode}
        />
        {mode === 'keep' && <SignatureView profile={props.profile} />}
        {mode === 'drawn' && <SignaturePad onChange={setDrawn} />}
        {mode === 'typed' && <span class="signature-typed">{draft.fullName}</span>}
        <p class="muted small">
          Your signature appears on reports you certify. Signing still needs your multi-factor
          sign-in in the real app.
        </p>
      </section>
      <section class="card" aria-labelledby="where">
        <h3 id="where">Where you can sign</h3>
        <ul class="plain where-list">
          {JURISDICTIONS.map((j) => {
            const issues = signingProblems(candidate, j, today);
            return (
              <li key={j} class={issues.length ? 'todo' : 'done'}>
                {issues.length ? '✕' : '✓'} {j}
                {issues.length > 0 && (
                  <span class="muted small"> · {issues[issues.length - 1]}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {problems.length > 0 && (
        <ul class="plain">
          {problems.map((p) => (
            <li key={p} class="notice blocking">
              {p}
            </li>
          ))}
        </ul>
      )}
      <div class="next-row">
        <button type="button" class="link" onClick={props.onBack}>
          Cancel
        </button>
        <button
          type="button"
          class="btn primary"
          disabled={problems.length > 0}
          onClick={() => {
            if (props.onSave(candidate)) props.onBack();
          }}
        >
          Save profile
        </button>
      </div>
    </>
  );
}
