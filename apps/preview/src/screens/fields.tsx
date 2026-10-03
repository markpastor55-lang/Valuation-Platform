import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  FIELD_BY_ID,
  REPORT_SECTIONS,
  effectiveValue,
  formatAustralianDate,
  hasValue,
  isValuerJudgementField,
  type FieldDef,
  type FieldRequirement,
  type SectionId,
} from '@vp/domain';
import {
  ASSET_ID,
  DATA_SOURCES,
  PEOPLE,
  SALES,
  SALE_ANALYSES,
  fieldLockReason,
  fieldValue,
  type Derived,
  type PreviewState,
} from '../model.js';
import { Pill, Segmented, aud, humanise, m2, type Dispatch, type Navigate } from '../ui.js';

interface Item {
  readonly def: FieldDef;
  readonly req: FieldRequirement;
  readonly assetId: string | null;
  readonly missing: boolean;
}

const UNITS: Partial<Record<FieldDef['type'], string>> = {
  money: 'AUD',
  area: 'm²',
  length: 'm',
  ratio: '0 – 1',
};

function SalesList(): JSX.Element {
  const source = DATA_SOURCES.find((s) => s.id === 'ds-sales');
  return (
    <div class="stack">
      {SALES.map((s) => {
        const analysis = SALE_ANALYSES.find((a) => a.saleId === s.id);
        const rate = analysis?.landRate ? effectiveValue(analysis.landRate) : undefined;
        return (
          <div key={s.id} class="sale">
            <div class="row" style={{ justifyContent: 'space-between' }}>
              <strong>{s.address}</strong>
              <Pill tone={s.comparability === 'comparable' ? 'ok' : 'plain'}>
                {humanise(s.comparability)}
              </Pill>
            </div>
            <span class="num">
              {aud(s.price)} · {formatAustralianDate(s.contractDate)} · land {m2(s.landAreaM2 ?? 0)}
              {rate !== undefined && <> · {aud(Math.round(rate))}/m² land</>}
            </span>
            <span class="muted" style={{ fontSize: '0.8rem' }}>
              {source?.name} · verified by {PEOPLE.valuer.displayName}
              {s.adjustments.map(
                (a) => ` · ${a.rationale} (${a.value > 0 ? '+' : ''}${a.value * 100}%)`,
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FieldInput(props: {
  item: Item;
  value: unknown;
  disabled: boolean;
  commit: (v: unknown) => void;
  d: Derived;
  navigate: Navigate;
}): JSX.Element {
  const { item, value, disabled, commit } = props;
  const def = item.def;
  const id = `in-${def.id}`;
  const key = `${def.id}:${JSON.stringify(value ?? null)}`;
  const text = typeof value === 'string' ? value : '';
  switch (def.type) {
    case 'text':
      return (
        <input
          key={key}
          id={id}
          type="text"
          defaultValue={text}
          disabled={disabled}
          onChange={(e) => {
            commit(e.currentTarget.value);
          }}
        />
      );
    case 'longtext':
      return (
        <textarea
          key={key}
          id={id}
          defaultValue={text}
          rows={3}
          disabled={disabled}
          onChange={(e) => {
            commit(e.currentTarget.value);
          }}
        />
      );
    case 'date':
      return (
        <input
          key={key}
          id={id}
          type="date"
          defaultValue={text}
          disabled={disabled}
          onChange={(e) => {
            commit(e.currentTarget.value);
          }}
        />
      );
    case 'number':
    case 'integer':
    case 'money':
    case 'area':
    case 'length':
    case 'ratio': {
      const unit = UNITS[def.type] ?? def.unit;
      return (
        <div class="input-unit">
          <input
            key={key}
            id={id}
            type="number"
            inputMode="decimal"
            step={def.type === 'ratio' ? '0.01' : def.type === 'integer' ? '1' : 'any'}
            defaultValue={typeof value === 'number' ? String(value) : ''}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.currentTarget.value.trim();
              commit(raw === '' ? null : Number(raw));
            }}
          />
          {unit && <span>{unit}</span>}
        </div>
      );
    }
    case 'enum':
      return (
        <select
          key={key}
          id={id}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            commit(e.currentTarget.value);
          }}
        >
          <option value="">Choose…</option>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {humanise(o)}
            </option>
          ))}
        </select>
      );
    case 'multi_enum': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div class="toggle-chips" role="group" aria-label={def.label}>
          {(def.options ?? []).map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={selected.includes(o)}
              disabled={disabled}
              onClick={() => {
                commit(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
              }}
            >
              {humanise(o)}
            </button>
          ))}
        </div>
      );
    }
    case 'boolean':
      return (
        <Segmented
          label={def.label}
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          options={[
            ['yes', 'Yes'],
            ['no', 'No'],
          ]}
          onChange={(v) => {
            if (!disabled) commit(v === 'yes');
          }}
        />
      );
    case 'list':
      return (
        <textarea
          key={key}
          id={id}
          rows={2}
          placeholder="One item per line"
          defaultValue={Array.isArray(value) ? (value as unknown[]).map(String).join('\n') : ''}
          disabled={disabled}
          onChange={(e) => {
            const items = e.currentTarget.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            commit(items.length ? items : null);
          }}
        />
      );
    case 'address': {
      const raw =
        typeof value === 'object' && value !== null
          ? (value as { formatted?: unknown }).formatted
          : undefined;
      const formatted = typeof raw === 'string' ? raw : '';
      return (
        <input
          key={key}
          id={id}
          type="text"
          defaultValue={formatted}
          disabled={disabled}
          onChange={(e) => {
            const v = e.currentTarget.value.trim();
            commit(v ? { formatted: v } : null);
          }}
        />
      );
    }
    case 'coordinates': {
      const c = (value ?? {}) as { lat?: number; lng?: number };
      return (
        <span class="mono">
          {c.lat?.toFixed(5)}, {c.lng?.toFixed(5)}{' '}
          <span class="muted">(from device location in the app)</span>
        </span>
      );
    }
    case 'user_ref':
      return (
        <select
          key={key}
          id={id}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            commit(e.currentTarget.value);
          }}
        >
          <option value="">Choose…</option>
          {Object.values(PEOPLE).map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.displayName} ({p.roleLabel})
            </option>
          ))}
        </select>
      );
    case 'evidence_list':
      return def.id === 'evidence.sales' ? (
        <SalesList />
      ) : (
        <span class="muted">{Array.isArray(value) ? value.length : 0} items</span>
      );
    case 'area_schedule_ref': {
      const s = props.d.schedule;
      return (
        <div class="row">
          <span>
            Sketch v{s.sketchVersionId.replace('sv-', '')}:{' '}
            <strong class="num">{m2(s.totalIncludedM2)}</strong>{' '}
            <span class="muted">({humanise(s.basis)})</span>
          </span>
          <button
            type="button"
            class="link"
            onClick={() => {
              props.navigate('sketch');
            }}
          >
            Open sketch
          </button>
        </div>
      );
    }
    case 'document_refs':
    case 'datasource_refs': {
      const n = Array.isArray(value) ? value.length : 0;
      return (
        <span class="muted">
          {n} {def.type === 'document_refs' ? 'document' : 'source'}
          {n === 1 ? '' : 's'} on file
          {def.type === 'document_refs' && ' (uploads come with the mobile app)'}
        </span>
      );
    }
    case 'calculation_ref':
      return <span class="muted">{text || 'Calculated in the evidence workspace'}</span>;
  }
}

function FieldRow(props: {
  item: Item;
  state: PreviewState;
  d: Derived;
  dispatch: Dispatch;
  navigate: Navigate;
  flash: boolean;
}): JSX.Element {
  const { item, state, dispatch } = props;
  const { def, req } = item;
  const [error, setError] = useState<string | null>(null);
  const lock = fieldLockReason(state, def);
  const value = fieldValue(state, def.id, item.assetId);
  return (
    <div
      id={`field-${def.id}`}
      class={`field ${item.missing && req.level === 'required' ? 'missing' : ''} ${props.flash ? 'flash' : ''}`}
    >
      <div class="field-head">
        <label for={`in-${def.id}`}>{def.label}</label>
        <div class="field-tags">
          {item.missing && req.level === 'required' && <Pill tone="blocking">Missing</Pill>}
          {req.level === 'recommended' && <Pill tone="plain">Recommended</Pill>}
          {isValuerJudgementField(def) && <Pill>Valuer judgement</Pill>}
          {def.personal && <Pill tone="warning">Personal info</Pill>}
          {def.review && (
            <Pill tone="plain">Review: {def.review.replaceAll('_', ' ').toLowerCase()}</Pill>
          )}
        </div>
      </div>
      <FieldInput
        item={item}
        value={value}
        disabled={lock !== undefined}
        d={props.d}
        navigate={props.navigate}
        commit={(v) => {
          const ok = dispatch({
            type: 'setField',
            fieldId: def.id,
            assetId: item.assetId,
            value: v,
          });
          setError(ok ? null : 'Not saved. See the message below.');
        }}
      />
      {error && <span class="error-text">{error}</span>}
      {lock && lock.kind === 'role' && (
        <span class="lock">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          {lock.text}
        </span>
      )}
      <span class="mono muted" style={{ fontSize: '0.72rem' }}>
        {def.id} · {req.ruleIds.join(', ')}
      </span>
    </div>
  );
}

export function FieldsScreen(props: {
  state: PreviewState;
  d: Derived;
  dispatch: Dispatch;
  navigate: Navigate;
  focus: { id: string; n: number } | null;
}): JSX.Element {
  const { state, d } = props;
  const [filter, setFilter] = useState<'all' | 'missing'>('all');
  const missingKeys = new Set(d.missing.map((m) => m.fieldId));
  const items: Item[] = d.requirements.fields.flatMap((req) => {
    const def = FIELD_BY_ID.get(req.fieldId);
    if (!def) return [];
    const assetId = def.level === 'asset' ? ASSET_ID : null;
    return [{ def, req, assetId, missing: missingKeys.has(def.id) }];
  });
  const shown = filter === 'missing' ? items.filter((i) => i.missing) : items;
  const bySection = new Map<SectionId, Item[]>();
  for (const i of shown) bySection.set(i.def.section, [...(bySection.get(i.def.section) ?? []), i]);
  const sections = REPORT_SECTIONS.filter((s) => bySection.has(s.id));
  const missingCount = items.filter((i) => i.missing).length;
  const focusId = props.focus?.id;

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`field-${focusId}`);
    const details = el?.closest('details');
    if (details) details.open = true;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.querySelector<HTMLElement>('input, select, textarea, button')?.focus({
      preventScroll: true,
    });
  }, [focusId, props.focus?.n]);

  return (
    <>
      <section class="card">
        <div class="card-head">
          <h2>Inspection and valuation fields</h2>
          <Segmented
            label="Show"
            value={filter}
            options={[
              ['all', `All (${items.length})`],
              ['missing', `Missing (${missingCount})`],
            ]}
            onChange={setFilter}
          />
        </div>
        <p class="muted">
          Only the fields this job needs are shown, grouped by report section. Each field lists the
          rule that requires it.
          {state.role === 'inspector' &&
            ' As a field inspector you capture facts; valuer judgement fields are locked.'}
          {state.role === 'reviewer' && ' QA reviewers see content read-only.'}
        </p>
        {filter === 'missing' && missingCount === 0 && (
          <div class="notice ok">Every required and recommended field has a value.</div>
        )}
      </section>
      {sections.map((s) => {
        const list = bySection.get(s.id) ?? [];
        const missingHere = list.filter((i) => i.missing && i.req.level === 'required').length;
        const filled = list.filter((i) => hasValue(fieldValue(state, i.def.id, i.assetId))).length;
        return (
          <details
            key={s.id}
            class="section"
            open={missingHere > 0 || filter === 'missing' || list.some((i) => i.def.id === focusId)}
          >
            <summary>
              <h3>{s.title}</h3>
              {missingHere > 0 ? (
                <Pill tone="blocking">{missingHere} missing</Pill>
              ) : (
                <span class="muted num" style={{ fontSize: '0.84rem' }}>
                  {filled}/{list.length}
                </span>
              )}
            </summary>
            <div class="section-body">
              {list.map((item) => (
                <FieldRow
                  key={item.def.id}
                  item={item}
                  state={state}
                  d={d}
                  dispatch={props.dispatch}
                  navigate={props.navigate}
                  flash={item.def.id === focusId}
                />
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}
