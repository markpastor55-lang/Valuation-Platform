import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  FIELD_BY_ID,
  FIELD_CATALOGUE,
  REPORT_SECTIONS,
  inputTabForField,
  type FieldDef,
  type FieldRequirement,
  type InputTabId,
  type SectionId,
} from '@vp/domain';
import { ASSET_ID, fieldValue, isLocked, type Derived, type PreviewState } from '../model.js';
import { Pill, Segmented, humanise, type Dispatch } from '../ui.js';

const CATALOGUE_ORDER = FIELD_CATALOGUE.map((f) => f.id);

interface Item {
  readonly def: FieldDef;
  readonly req: FieldRequirement;
  readonly assetId: string | null;
  readonly missing: boolean;
}

const UNITS: Partial<Record<FieldDef['type'], string>> = {
  money: '$',
  area: 'm²',
  length: 'm',
  ratio: '0 – 1',
};

function FieldInput(props: {
  def: FieldDef;
  value: unknown;
  disabled: boolean;
  commit: (v: unknown) => void;
}): JSX.Element {
  const { def, value, disabled, commit } = props;
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
          {def.type === 'money' && <span>$</span>}
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
          {unit && def.type !== 'money' && <span>{unit}</span>}
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
          disabled={disabled}
          onChange={(v) => {
            commit(v === 'yes');
          }}
        />
      );
    case 'list':
      return (
        <textarea
          key={key}
          id={id}
          rows={2}
          placeholder="One per line"
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
      return (
        <input
          key={key}
          id={id}
          type="text"
          defaultValue={typeof raw === 'string' ? raw : ''}
          disabled={disabled}
          onChange={(e) => {
            const v = e.currentTarget.value.trim();
            commit(v ? { formatted: v } : null);
          }}
        />
      );
    }
    case 'evidence_list':
      return <span class="muted">{Array.isArray(value) ? value.length : 0} added</span>;
    case 'document_refs':
    case 'datasource_refs': {
      const n = Array.isArray(value) ? value.length : 0;
      return (
        <span class="muted">
          {n === 0
            ? 'Nothing attached yet (uploads come with the mobile app)'
            : `${n} ${def.type === 'document_refs' ? 'document' : 'source'}${n === 1 ? '' : 's'} attached`}
        </span>
      );
    }
    default:
      return <span class="muted">{text || 'Filled in automatically'}</span>;
  }
}

/** Shortcuts that save typing for values that are usually the same as another. */
function Shortcut(props: {
  def: FieldDef;
  state: PreviewState;
  dispatch: Dispatch;
  disabled: boolean;
}): JSX.Element | null {
  const { def, state, dispatch, disabled } = props;
  const job = state.values.job;
  if (def.id === 'dates.valuation') {
    const inspection = job['dates.inspection'];
    if (typeof inspection !== 'string' || job['dates.valuation'] === inspection) return null;
    return (
      <button
        type="button"
        class="link small"
        disabled={disabled}
        onClick={() =>
          dispatch({ type: 'setField', fieldId: def.id, assetId: null, value: inspection })
        }
      >
        Same as inspection date
      </button>
    );
  }
  if (def.id === 'instruction.intendedUsers') {
    const client = job['instruction.clientEntity'];
    if (typeof client !== 'string' || !client.trim()) return null;
    const current = job['instruction.intendedUsers'];
    if (Array.isArray(current) && current.length === 1 && current[0] === client) return null;
    return (
      <button
        type="button"
        class="link small"
        disabled={disabled}
        onClick={() =>
          dispatch({ type: 'setField', fieldId: def.id, assetId: null, value: [client] })
        }
      >
        Same as client
      </button>
    );
  }
  return null;
}

function FieldRow(props: {
  item: Item;
  state: PreviewState;
  dispatch: Dispatch;
  flash: boolean;
}): JSX.Element {
  const { item, state, dispatch } = props;
  const { def, req } = item;
  const [error, setError] = useState<string | null>(null);
  const locked = isLocked(state);
  const needed = item.missing && req.level === 'required';
  return (
    <div
      id={`field-${def.id}`}
      class={`field ${needed ? 'missing' : ''} ${props.flash ? 'flash' : ''}`}
    >
      <div class="field-head">
        <label for={`in-${def.id}`}>
          {def.label}
          {req.level === 'recommended' && <span class="optional"> (optional)</span>}
        </label>
        {needed && <Pill tone="blocking">To do</Pill>}
      </div>
      {def.help && <span class="help">{def.help}</span>}
      <FieldInput
        def={def}
        value={fieldValue(state, def.id, item.assetId)}
        disabled={locked}
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
      <Shortcut def={def} state={state} dispatch={dispatch} disabled={locked} />
      {error && <span class="error-text">{error}</span>}
    </div>
  );
}

/** The fields a job needs on one input tab, grouped by report section. */
export function InputFields(props: {
  tab: InputTabId;
  state: PreviewState;
  d: Derived;
  dispatch: Dispatch;
  focus: { id: string; n: number } | null;
  only?: readonly SectionId[];
}): JSX.Element | null {
  const { tab, state, d } = props;
  const missingKeys = new Set(d.missing.map((m) => m.fieldId));
  const items: Item[] = d.requirements.fields.flatMap((req) => {
    const def = FIELD_BY_ID.get(req.fieldId);
    // Sales evidence has its own card on the Sales & market tab
    if (
      !def ||
      def.entry === 'system' ||
      def.id === 'evidence.sales' ||
      inputTabForField(def.id) !== tab
    )
      return [];
    if (props.only && !props.only.includes(def.section)) return [];
    return [
      {
        def,
        req,
        assetId: def.level === 'asset' ? ASSET_ID : null,
        missing: missingKeys.has(def.id),
      },
    ];
  });
  const bySection = new Map<SectionId, Item[]>();
  for (const i of items) bySection.set(i.def.section, [...(bySection.get(i.def.section) ?? []), i]);
  // Catalogue order (the order a valuer works), optional fields last
  for (const list of bySection.values())
    list.sort(
      (a, b) =>
        Number(a.req.level === 'recommended') - Number(b.req.level === 'recommended') ||
        CATALOGUE_ORDER.indexOf(a.def.id) - CATALOGUE_ORDER.indexOf(b.def.id),
    );
  const sections = REPORT_SECTIONS.filter((s) => bySection.has(s.id));
  const focusId = props.focus?.id;

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`field-${focusId}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.querySelector<HTMLElement>('input, select, textarea, button')?.focus({
      preventScroll: true,
    });
  }, [focusId, props.focus?.n]);

  if (sections.length === 0) return null;
  return (
    <>
      {sections.map((s) => (
        <section key={s.id} class="card fields-card" aria-label={s.title}>
          <h3>{s.title}</h3>
          <div class="field-list">
            {(bySection.get(s.id) ?? []).map((item) => (
              <FieldRow
                key={item.def.id}
                item={item}
                state={state}
                dispatch={props.dispatch}
                flash={item.def.id === focusId}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
