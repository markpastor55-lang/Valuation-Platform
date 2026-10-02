import type { ComponentChildren, JSX } from 'preact';
import {
  FIELD_BY_ID,
  REPORT_SECTIONS,
  formatAud,
  type JobStatus,
  type SectionId,
} from '@vp/domain';
import type { PreviewAction, PreviewRole } from './model.js';

export type Dispatch = (action: PreviewAction, success?: string) => boolean;
export type Tab = 'job' | 'fields' | 'sketch' | 'checks' | 'report';
export type Navigate = (tab: Tab, focus?: string) => void;

export const humanise = (v: string): string => {
  const s = v.replaceAll('_', ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const fieldLabel = (id: string): string => FIELD_BY_ID.get(id)?.label ?? id;

export const sectionLabel = (id: SectionId): string =>
  REPORT_SECTIONS.find((s) => s.id === id)?.title ?? id;

export const aud = (n: number): string => formatAud(n);

export const m2 = (n: number): string =>
  `${n.toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} m²`;

export const shortHash = (h: string): string => `${h.slice(0, 10)}…`;

export function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Rewrites raw field ids in engine messages into the labels people see on screen. */
export function readable(message: string): string {
  const text = message.replace(/\b([a-z]+\.[A-Za-z]+)\b/g, (m: string) => {
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
  full?: boolean;
}): JSX.Element {
  return (
    <div class={`seg ${props.full ? 'full' : ''}`} role="group" aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={props.value === v}
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

const ICON_PATHS: Readonly<Record<Tab, string>> = {
  job: 'M4 7h16v12H4zM9 7V5h6v2M4 12h16',
  fields: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
  sketch: 'M4 20V4h9v6h7v10zM13 4v6M4 13h9',
  checks: 'M5 12l4 4 10-10M5 20h14',
  report: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7',
};

export function Icon(props: { name: Tab }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[props.name]} />
    </svg>
  );
}

export const ROLE_OPTIONS: readonly (readonly [PreviewRole, string])[] = [
  ['valuer', 'Valuer'],
  ['inspector', 'Inspector'],
  ['reviewer', 'QA reviewer'],
];
