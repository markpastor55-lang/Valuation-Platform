import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import {
  COMPONENT_TYPES,
  DEDUCTION_TYPES,
  DEFAULT_CONVENTIONS,
  centroid,
  edgeLengths,
  isEditable,
  polygonArea,
  snapToGrid,
  type Boundary,
  type Point,
  type SketchVersion,
} from '@vp/domain';
import { PEOPLE, can, makeBoundary, type Derived, type PreviewState } from '../model.js';
import { Pill, Segmented, humanise, m2, shortHash, when, type Dispatch } from '../ui.js';

const GRID = 0.5;
const CLOSE_TOLERANCE = 0.75;

export function fillFor(b: Boundary): string {
  if (b.role === 'deduction') return 'var(--c-deduct)';
  switch (b.componentType) {
    case 'living':
    case 'office':
    case 'retail':
      return 'var(--c-living)';
    case 'garage':
    case 'carport':
    case 'warehouse':
      return 'var(--c-garage)';
    case 'alfresco':
    case 'balcony':
      return 'var(--c-alfresco)';
    case 'verandah':
      return 'var(--c-verandah)';
    default:
      return 'var(--c-other)';
  }
}

interface Frame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function frameFor(boundaries: readonly Boundary[], extra: readonly Point[] = []): Frame {
  const pts = [...boundaries.flatMap((b) => b.points), ...extra];
  let minX = -3;
  let minY = -5;
  let maxX = 24;
  let maxY = 15;
  for (const p of pts) {
    minX = Math.min(minX, p.x - 2);
    minY = Math.min(minY, p.y - 2);
    maxX = Math.max(maxX, p.x + 2);
    maxY = Math.max(maxY, p.y + 2);
  }
  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    w: Math.ceil(maxX - minX),
    h: Math.ceil(maxY - minY),
  };
}

function GridLines(props: { f: Frame }): JSX.Element {
  const { f } = props;
  const lines: JSX.Element[] = [];
  for (let x = Math.ceil(f.x); x <= f.x + f.w; x++)
    lines.push(
      <line
        key={`x${x}`}
        class={x % 5 === 0 ? 'grid-major' : 'grid-minor'}
        x1={x}
        y1={f.y}
        x2={x}
        y2={f.y + f.h}
      />,
    );
  for (let y = Math.ceil(f.y); y <= f.y + f.h; y++)
    lines.push(
      <line
        key={`y${y}`}
        class={y % 5 === 0 ? 'grid-major' : 'grid-minor'}
        x1={f.x}
        y1={y}
        x2={f.x + f.w}
        y2={y}
      />,
    );
  return <g aria-hidden="true">{lines}</g>;
}

const pointsAttr = (pts: readonly Point[]): string => pts.map((p) => `${p.x},${p.y}`).join(' ');

/** Read-only plan drawing (used in the report preview too). */
export function PlanDrawing(props: {
  sketch: SketchVersion;
  included: ReadonlySet<string>;
  title: string;
}): JSX.Element {
  const f = frameFor(props.sketch.boundaries);
  return (
    <svg class="plan" viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`} role="img" aria-label={props.title}>
      <GridLines f={f} />
      {props.sketch.boundaries.map((b) => {
        const c = centroid(b.points);
        return (
          <g key={b.id}>
            <polygon
              class={`shape ${props.included.has(b.id) ? '' : 'excluded'}`}
              points={pointsAttr(b.points)}
              style={{ fill: fillFor(b) }}
            />
            <text class="shape-label" x={c.x} y={c.y - 0.1}>
              {b.label}
            </text>
            <text class="shape-area" x={c.x} y={c.y + 0.75}>
              {polygonArea(b.points).toFixed(1)} m²
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type Drag =
  | { kind: 'vertex'; id: string; index: number }
  | { kind: 'move'; id: string; start: Point; original: readonly Point[] };

export function SketchScreen(props: {
  state: PreviewState;
  d: Derived;
  dispatch: Dispatch;
}): JSX.Element {
  const { state, d, dispatch } = props;
  const sketch = state.sketch;
  const me = PEOPLE[state.role];
  const canEdit = can(state.role, 'sketch.edit') && isEditable(state.status);
  const canApprove = can(state.role, 'measurement.approve') && isEditable(state.status);
  const [mode, setMode] = useState<'select' | 'draw'>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<readonly Boundary[] | null>(null);
  const [drawPts, setDrawPts] = useState<readonly Point[]>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const [newType, setNewType] = useState<string>('living');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const frameRef = useRef<Frame | null>(null);

  const boundaries = draft ?? sketch.boundaries;
  // Keep the frame steady while dragging or drawing so the plan does not shift under the finger.
  const frame =
    (draft || drawPts.length > 0) && frameRef.current ? frameRef.current : frameFor(boundaries);
  frameRef.current = frame;
  const selected = boundaries.find((b) => b.id === selectedId);
  const included = new Set(
    d.schedule.rows.filter((r) => r.includedInTotal).map((r) => r.boundaryId),
  );

  const toWorld = (e: PointerEvent): Point => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const snap = (p: Point): Point => snapToGrid(p, GRID);
  const commit = (next: readonly Boundary[], message?: string) => {
    dispatch({ type: 'setBoundaries', boundaries: next }, message);
  };

  const finishShape = (pts: readonly Point[]) => {
    if (pts.length < 3) return;
    const isDeduction = (DEDUCTION_TYPES as readonly string[]).includes(newType);
    const n = boundaries.filter((b) => b.componentType === newType).length + 1;
    const id = `b-${Date.now().toString(36)}`;
    const b = makeBoundary(
      id,
      `${humanise(newType)}${n > 1 ? ` ${n}` : ''}`,
      newType as Boundary['componentType'],
      pts,
      me.userId,
      new Date().toISOString(),
      isDeduction ? 'deduction' : 'component',
    );
    commit([...boundaries, b], `${b.label} added: ${polygonArea(pts).toFixed(1)} m²`);
    setDrawPts([]);
    setHover(null);
    setMode('select');
    setSelectedId(id);
  };

  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as Element;
    const p = toWorld(e);
    if (mode === 'draw') {
      if (!canEdit) return;
      const s = snap(p);
      const first = drawPts[0];
      if (
        first &&
        drawPts.length >= 3 &&
        Math.hypot(s.x - first.x, s.y - first.y) < CLOSE_TOLERANCE
      ) {
        finishShape(drawPts);
        return;
      }
      const last = drawPts[drawPts.length - 1];
      if (!last || last.x !== s.x || last.y !== s.y) setDrawPts([...drawPts, s]);
      return;
    }
    const handle = target.getAttribute('data-vertex');
    const shapeId = target.getAttribute('data-shape');
    if (handle !== null && selected && canEdit) {
      dragRef.current = { kind: 'vertex', id: selected.id, index: Number(handle) };
    } else if (shapeId) {
      setSelectedId(shapeId);
      const b = boundaries.find((x) => x.id === shapeId);
      if (b && canEdit)
        dragRef.current = { kind: 'move', id: b.id, start: snap(p), original: b.points };
    } else {
      setSelectedId(null);
      return;
    }
    if (dragRef.current) {
      svgRef.current?.setPointerCapture(e.pointerId);
      setDraft(sketch.boundaries);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = snap(toWorld(e));
    if (mode === 'draw') {
      setHover(p);
      return;
    }
    const drag = dragRef.current;
    if (!drag || !draft) return;
    setDraft(
      draft.map((b) => {
        if (b.id !== drag.id) return b;
        if (drag.kind === 'vertex')
          return { ...b, points: b.points.map((q, i) => (i === drag.index ? p : q)) };
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        return { ...b, points: drag.original.map((q) => ({ x: q.x + dx, y: q.y + dy })) };
      }),
    );
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !draft) return;
    const changed = JSON.stringify(draft) !== JSON.stringify(sketch.boundaries);
    setDraft(null);
    if (changed) commit(draft);
  };

  const updateSelected = (patch: Partial<Boundary>, message?: string) => {
    if (!selected) return;
    commit(
      sketch.boundaries.map((b) => (b.id === selected.id ? { ...b, ...patch } : b)),
      message,
    );
  };

  const approvedEarlier = state.approvals.find((a) => a.sketchVersionId !== sketch.id);
  const blocking = d.schedule.issues.filter((i) => i.severity === 'blocking');
  const scale = Math.max(1, Math.round(frame.w / 6));

  return (
    <>
      <section class="card">
        <div class="card-head">
          <h2>Sketch and areas</h2>
          <span class="row">
            <span class="mono muted">v{sketch.version}</span>
            <Pill tone={sketch.status === 'working' ? 'plain' : 'ok'}>{sketch.status}</Pill>
          </span>
        </div>
        <div class="toolbar">
          <Segmented
            label="Tool"
            value={mode}
            options={[
              ['select', 'Select & move'],
              ['draw', 'Draw shape'],
            ]}
            onChange={(m) => {
              setMode(m);
              setDrawPts([]);
              setHover(null);
            }}
          />
          {mode === 'draw' && (
            <select
              id="new-shape-type"
              aria-label="Type of new shape"
              value={newType}
              onChange={(e) => {
                setNewType(e.currentTarget.value);
              }}
            >
              <optgroup label="Component">
                {COMPONENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanise(t)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Deduction">
                {DEDUCTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanise(t)}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
        </div>
        {!canEdit && (
          <p class="muted" style={{ fontSize: '0.86rem' }}>
            {isEditable(state.status)
              ? `${me.roleLabel}s view sketches; valuers and inspectors draw them.`
              : 'The sketch is locked while the job is in review or issued.'}
          </p>
        )}
        <div class="canvas-wrap">
          <svg
            ref={svgRef}
            class="plan"
            viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
            role="img"
            aria-label="Floor plan sketch in metres"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => {
              setHover(null);
            }}
          >
            <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="transparent" />
            <GridLines f={frame} />
            {boundaries.map((b) => {
              const c = centroid(b.points);
              return (
                <g key={b.id}>
                  <polygon
                    data-shape={b.id}
                    class={`shape ${b.id === selectedId ? 'selected' : ''} ${included.has(b.id) || b.role === 'deduction' ? '' : 'excluded'}`}
                    points={pointsAttr(b.points)}
                    style={{ fill: fillFor(b) }}
                  />
                  <text class="shape-label" x={c.x} y={c.y - 0.1}>
                    {b.label}
                  </text>
                  <text class="shape-area" x={c.x} y={c.y + 0.75}>
                    {polygonArea(b.points).toFixed(1)} m²
                  </text>
                </g>
              );
            })}
            {selected && (
              <g>
                {edgeLengths(selected.points).map((len, i) => {
                  const a = selected.points[i];
                  const b = selected.points[(i + 1) % selected.points.length];
                  if (!a || !b || len < 0.01) return null;
                  return (
                    <text key={`e${i}`} class="edge-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2}>
                      {len.toFixed(1)} m
                    </text>
                  );
                })}
                {canEdit &&
                  selected.points.map((p, i) => (
                    <g key={`h${i}`}>
                      <circle class="handle" cx={p.x} cy={p.y} r={0.38} />
                      <circle
                        class="handle-hit"
                        data-vertex={String(i)}
                        cx={p.x}
                        cy={p.y}
                        r={1.1}
                      />
                    </g>
                  ))}
              </g>
            )}
            {mode === 'draw' && drawPts.length > 0 && (
              <g>
                <polyline
                  class="draft-line"
                  points={pointsAttr(hover ? [...drawPts, hover] : drawPts)}
                />
                {drawPts.map((p, i) => (
                  <circle key={i} class="draft-point" cx={p.x} cy={p.y} r={i === 0 ? 0.42 : 0.25} />
                ))}
              </g>
            )}
            {mode === 'draw' && hover && (
              <circle class="draft-point" cx={hover.x} cy={hover.y} r={0.18} />
            )}
          </svg>
          <div class="canvas-overlay" aria-hidden="true">
            <svg
              viewBox="-12 -12 24 24"
              style={{ transform: `rotate(${sketch.northBearingDeg ?? 0}deg)` }}
            >
              <path d="M0 -10 L5 8 L0 4 L-5 8 Z" fill="currentColor" />
            </svg>
            N
          </div>
          <div
            class="scale-bar"
            aria-hidden="true"
            style={{ width: `${(scale / frame.w) * 100}%` }}
          >
            <span />
            {scale} m
          </div>
        </div>
        <p class="canvas-hint" aria-live="polite">
          {mode === 'draw'
            ? drawPts.length === 0
              ? 'Tap corners on the 0.5 m grid'
              : drawPts.length < 3
                ? `${drawPts.length} point${drawPts.length === 1 ? '' : 's'}: keep going`
                : 'Tap the first point to close'
            : selected
              ? canEdit
                ? 'Drag corners or the shape'
                : selected.label
              : 'Tap a shape to see its dimensions'}
        </p>
        {mode === 'draw' && drawPts.length > 0 && (
          <div class="row">
            <button
              type="button"
              class="btn small"
              disabled={drawPts.length < 3}
              onClick={() => {
                finishShape(drawPts);
              }}
            >
              Close shape
            </button>
            <button
              type="button"
              class="btn small"
              onClick={() => {
                setDrawPts(drawPts.slice(0, -1));
              }}
            >
              Undo point
            </button>
            <button
              type="button"
              class="link"
              onClick={() => {
                setDrawPts([]);
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {selected && mode === 'select' && (
          <div class="toolbar">
            <input
              key={`${selected.id}:${selected.label}`}
              id="shape-label"
              type="text"
              aria-label="Shape name"
              defaultValue={selected.label}
              disabled={!canEdit}
              onChange={(e) => {
                const label = e.currentTarget.value.trim();
                if (label) updateSelected({ label });
              }}
            />
            <select
              id="shape-type"
              aria-label="Shape type"
              value={selected.componentType}
              disabled={!canEdit}
              onChange={(e) => {
                const t = e.currentTarget.value;
                updateSelected({
                  componentType: t as Boundary['componentType'],
                  role: (DEDUCTION_TYPES as readonly string[]).includes(t)
                    ? 'deduction'
                    : 'component',
                });
              }}
            >
              <optgroup label="Component">
                {COMPONENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanise(t)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Deduction">
                {DEDUCTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanise(t)}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              type="button"
              class="btn small"
              disabled={!canEdit}
              onClick={() => {
                commit(
                  sketch.boundaries.filter((b) => b.id !== selected.id),
                  `${selected.label} removed`,
                );
                setSelectedId(null);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </section>

      <section class="card" aria-labelledby="schedule">
        <div class="card-head">
          <h2 id="schedule">Area schedule</h2>
          <span class="muted">computed by the domain engine</span>
        </div>
        <label class="field-label">
          Measurement convention
          <select
            id="convention"
            value={sketch.conventionId}
            disabled={!canEdit}
            onChange={(e) =>
              dispatch({ type: 'setConvention', conventionId: e.currentTarget.value })
            }
          >
            {DEFAULT_CONVENTIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p class="muted" style={{ fontSize: '0.84rem' }}>
          {d.convention.reference}. Counts:{' '}
          {d.convention.includes.map(humanise).join(', ').toLowerCase()}.{' '}
          <span class="mono">[REVIEW: {d.convention.review}]</span>
        </p>
        <div class="row" style={{ alignItems: 'baseline' }}>
          <span class="big-number">{m2(d.schedule.totalIncludedM2)}</span>
          <span class="muted">{humanise(d.schedule.basis).toLowerCase()} total</span>
        </div>
        <div class="table-scroll">
          <table class="data">
            <thead>
              <tr>
                <th>Component</th>
                <th class="r">Area</th>
                <th class="r">Counted</th>
              </tr>
            </thead>
            <tbody>
              {d.schedule.rows.map((r) => {
                const b = sketch.boundaries.find((x) => x.id === r.boundaryId);
                return (
                  <tr key={r.boundaryId} class={r.includedInTotal ? '' : 'dim'}>
                    <td>
                      <button
                        type="button"
                        class="link"
                        onClick={() => {
                          setMode('select');
                          setSelectedId(r.boundaryId);
                        }}
                      >
                        <span class="swatch" style={{ background: b ? fillFor(b) : undefined }} />
                        {r.label}
                      </button>
                      <span class="component-type">{humanise(r.componentType)}</span>
                    </td>
                    <td class="r">{m2(r.netAreaM2)}</td>
                    <td class="r">{r.includedInTotal ? 'Yes' : 'No'}</td>
                  </tr>
                );
              })}
              <tr class="total">
                <td>Total counted</td>
                <td class="r">{m2(d.schedule.totalIncludedM2)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        {(sketch.suppliedAreas ?? []).map((s) => (
          <p key={s.label} class="muted" style={{ fontSize: '0.86rem' }}>
            Compared with {s.label}: {m2(s.areaM2)} ({s.source}).
          </p>
        ))}
        {d.schedule.issues.length > 0 ? (
          <ul class="plain">
            {d.schedule.issues.map((i) => (
              <li key={i.code + i.message} class={`notice ${i.severity}`}>
                <span class="mono">{i.code}</span> {i.message}
              </li>
            ))}
          </ul>
        ) : (
          <div class="notice ok">
            No geometry issues: shapes are closed, valid and do not overlap.
          </div>
        )}
      </section>

      <section class="card" aria-labelledby="approval">
        <h2 id="approval">Valuer approval</h2>
        {d.approval ? (
          <div class="notice ok">
            Version {sketch.version} approved by {PEOPLE.valuer.displayName} on{' '}
            {when(d.approval.approvedAt)}: {m2(d.approval.totalIncludedM2)}. The approval is bound
            to schedule <span class="mono">{shortHash(d.approval.scheduleHash)}</span>, so any later
            edit needs a new version and a new approval.
          </div>
        ) : (
          <>
            {approvedEarlier && (
              <div class="notice warning">
                Version {sketch.version - 1} was approved at {m2(approvedEarlier.totalIncludedM2)}.
                You edited it, so this is version {sketch.version} and it needs approval.
              </div>
            )}
            <p class="muted">
              Reports can only use areas the responsible valuer has approved. Approval needs a
              schedule with no blocking issues.
            </p>
            {blocking.length > 0 && (
              <div class="notice blocking">Fix the blocking geometry issues above first.</div>
            )}
            <div class="row">
              <button
                type="button"
                class="btn primary"
                disabled={!canApprove || blocking.length > 0 || !d.schedule.reportable}
                onClick={() =>
                  dispatch(
                    { type: 'approveAreas' },
                    `Areas approved: ${m2(d.schedule.totalIncludedM2)}`,
                  )
                }
              >
                Approve {m2(d.schedule.totalIncludedM2)}
              </button>
              {!can(state.role, 'measurement.approve') && (
                <span class="muted">Only the valuer approves areas.</span>
              )}
            </div>
          </>
        )}
      </section>
    </>
  );
}
