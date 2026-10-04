import type { ComponentChildren, JSX } from 'preact';
import {
  FIELD_BY_ID,
  INPUT_TABS,
  REPORT_SECTIONS,
  formatAud,
  type InputTabId,
  type JobStatus,
  type SectionId,
} from '@vp/domain';
import type { PreviewAction } from './model.js';

export type Dispatch = (action: PreviewAction, success?: string) => boolean;
export type Tab = InputTabId | 'qa' | 'report';
export type Navigate = (tab: Tab, focus?: string) => void;

export const TAB_TITLES: Readonly<Record<Tab, string>> = {
  ...(Object.fromEntries(INPUT_TABS.map((t) => [t.id, t.title])) as Record<InputTabId, string>),
  qa: 'QA',
  report: 'Report',
};

export const humanise = (v: string): string => {
  const s = v.replaceAll('_', ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const fieldLabel = (id: string): string => FIELD_BY_ID.get(id)?.label ?? id;

export const sectionLabel = (id: SectionId): string =>
  REPORT_SECTIONS.find((s) => s.id === id)?.title ?? id;

export const aud = (n: number): string => formatAud(n);

export const m2 = (n: number): string =>
  `${n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} m²`;

export const shortHash = (h: string): string => `${h.slice(0, 10)}…`;

export function when(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Rewrites raw field ids in engine messages into the labels people see on screen. */
export function readable(message: string): string {
  const text = message
    .replace(/\s*\((REQ|SEL)-[A-Z0-9-]+\)/g, '')
    .replace(/\b([a-z]+\.[A-Za-z]+)\b/g, (m: string) => {
      const def = FIELD_BY_ID.get(m);
      return def ? def.label : m;
    });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const STATUS_TONE: Readonly<Record<JobStatus, string>> = {
  draft: 'plain',
  active: '',
  submitted: 'warning',
  in_review: 'warning',
  returned: 'blocking',
  approved: 'ok',
  issued: 'ok',
  cancelled: 'plain',
};

export function Pill(props: { tone?: string; children: ComponentChildren }): JSX.Element {
  return <span class={`pill ${props.tone ?? ''}`}>{props.children}</span>;
}

export function Segmented<T extends string>(props: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div class="seg" role="group" aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={props.value === v}
          disabled={props.disabled}
          onClick={() => {
            props.onChange(v);
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function NextButton(props: { to: Tab; navigate: Navigate }): JSX.Element {
  return (
    <div class="next-row">
      <button
        type="button"
        class="btn primary"
        onClick={() => {
          props.navigate(props.to);
        }}
      >
        Next: {TAB_TITLES[props.to]} →
      </button>
    </div>
  );
}
