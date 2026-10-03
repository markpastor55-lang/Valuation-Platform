import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import {
  COMPONENT_TYPES,
  DEDUCTION_TYPES,
  DEFAULT_CONVENTIONS,
  centroid,
  edgeLengths,
  polygonArea,
  snapToGrid,
  type Boundary,
  type Point,
} from '@vp/domain';
import {
  ASSET_ID,
  fieldValue,
  isLocked,
  makeBoundary,
  type Derived,
  type PreviewState,
} from '../model.js';
import { Segmented, humanise, m2, type Dispatch } from '../ui.js';

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

type Drag =
  | { kind: 'vertex'; id: string; index: number }
  | { kind: 'move'; id: string; start: Point; original: readonly Point[] };

function TypeOptions(): JSX.Element {
  return (
    <>
      <optgroup label="Area">
        {COMPONENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {humanise(t)}
          </option>
        ))}
      </optgroup>
      <optgroup label="Cut-out">
        {DEDUCTION_TYPES.map((t) => (
          <option key={t} value={t}>
            {humanise(t)}
          </option>
        ))}
      </optgroup>
    </>
  );
}

/**
 * The valuer's on-site sketch. It is working notes only and never appears in the report; its
 * total can be copied into the Building area field.
 */
export function SketchNotes(props: {
  state: PreviewState;
  d: Derived;
  dispatch: Dispatch;
}): JSX.Element {
  const { state, d, dispatch } = props;
  const sketch = state.sketch;
  const canEdit = !isLocked(state);
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
  const counted = new Set(
    d.schedule.rows.filter((r) => r.includedInTotal).map((r) => r.boundaryId),
  );
  const total = d.schedule.totalIncludedM2;
  const buildingArea = fieldValue(state, 'improvements.buildingArea', ASSET_ID);
  const areaNeeded = d.requirements.fields.some((f) => f.fieldId === 'improvements.buildingArea');

  const toWorld = (e: PointerEvent): Point => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const snap = (p: Point): Point => snapToGrid(p, GRID);
  const commit = (next: readonly Boundary[], message?: string) => {
    dispatch({ type: 'setBoundaries', boundaries: next }, message);
  };

  const finishShape = (pts: readonly Point[]) => {
    if (pts.length < 3) return;
    const isCutOut = (DEDUCTION_TYPES as readonly string[]).includes(newType);
    const n = boundaries.filter((b) => b.componentType === newType).length + 1;
    const id = `b-${Date.now().toString(36)}`;
    const b = makeBoundary(
      id,
      `${humanise(newType)}${n > 1 ? ` ${n}` : ''}`,
      newType as Boundary['componentType'],
      pts,
      new Date().toISOString(),
      isCutOut ? 'deduction' : 'component',
    );
    commit([...boundaries, b], `${b.label} added: ${m2(polygonArea(pts))}`);
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

  const updateSelected = (patch: Partial<Boundary>) => {
    if (!selected) return;
    commit(sketch.boundaries.map((b) => (b.id === selected.id ? { ...b, ...patch } : b)));
  };

  const scale = Math.max(1, Math.round(frame.w / 6));
  const overlaps = d.schedule.issues.filter((i) => i.code === 'GEO-OVERLAP');

  return (
    <section class="card" aria-labelledby="sketch">
      <div class="card-head">
        <h3 id="sketch">Sketch</h3>
        <span class="muted small">Your notes. Not included in the report.</span>
      </div>
      <div class="toolbar">
        <Segmented
          label="Tool"
          value={mode}
          disabled={!canEdit}
          options={[
            ['select', 'Move'],
            ['draw', 'Draw'],
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
            aria-label="What you are drawing"
            value={newType}
            onChange={(e) => {
              setNewType(e.currentTarget.value);
            }}
          >
            <TypeOptions />
          </select>
        )}
      </div>
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
                  class={`shape ${b.id === selectedId ? 'selected' : ''} ${counted.has(b.id) || b.role === 'deduction' ? '' : 'excluded'}`}
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
                    <circle class="handle-hit" data-vertex={String(i)} cx={p.x} cy={p.y} r={1.1} />
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
        <div class="scale-bar" aria-hidden="true" style={{ width: `${(scale / frame.w) * 100}%` }}>
          <span />
          {scale} m
        </div>
      </div>
      <p class="canvas-hint" aria-live="polite">
        {mode === 'draw'
          ? drawPts.length === 0
            ? 'Tap each corner. Points snap to a 0.5 m grid.'
            : drawPts.length < 3
              ? 'Keep tapping corners.'
              : 'Tap the first point to close the shape.'
          : selected
            ? canEdit
              ? 'Drag a corner, or drag the shape to move it.'
              : selected.label
            : 'Tap a shape to see its measurements.'}
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
      {selected && mode === 'select' && canEdit && (
        <div class="toolbar">
          <input
            key={`${selected.id}:${selected.label}`}
            id="shape-label"
            type="text"
            aria-label="Name"
            defaultValue={selected.label}
            onChange={(e) => {
              const label = e.currentTarget.value.trim();
              if (label) updateSelected({ label });
            }}
          />
          <select
            id="shape-type"
            aria-label="Type"
            value={selected.componentType}
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
            <TypeOptions />
          </select>
          <button
            type="button"
            class="btn small"
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
      {overlaps.length > 0 && (
        <p class="notice warning">Two shapes overlap. The total counts the overlap once.</p>
      )}
      <div class="area-total">
        <div class="stack">
          <label class="field-label" for="convention">
            Counting
          </label>
          <select
            id="convention"
            value={sketch.conventionId}
            disabled={!canEdit}
            onChange={(e) =>
              dispatch({ type: 'setConvention', conventionId: e.currentTarget.value })
            }
          >
            {DEFAULT_CONVENTIONS.filter((c) => c.basis === 'BUILDING_AREA' || c.id === 'gfa').map(
              (c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ),
            )}
          </select>
          <span class="muted small">
            Counts {d.convention.includes.map(humanise).join(', ').toLowerCase()}. Dashed shapes are
            not counted.
          </span>
        </div>
        <div class="total-box">
          <span class="big-number">{m2(total)}</span>
          {areaNeeded &&
            (buildingArea === total ? (
              <span class="done small">Used as the building area</span>
            ) : (
              <button
                type="button"
                class="btn primary small"
                disabled={!canEdit || total <= 0}
                onClick={() =>
                  dispatch({ type: 'useSketchArea' }, `Building area set to ${m2(total)}`)
                }
              >
                Use as building area
              </button>
            ))}
        </div>
      </div>
    </section>
  );
}
