import { DomainError } from './errors.js';

/** A calendar date with no time zone, formatted `YYYY-MM-DD`. Valuation dates are LocalDates. */
export type LocalDate = string;
/** An instant formatted as ISO-8601 UTC, e.g. `2026-10-02T03:12:00.000Z`. */
export type Instant = string;

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = LOCAL_DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function assertLocalDate(value: unknown, label = 'date'): asserts value is LocalDate {
  if (!isLocalDate(value)) {
    throw new DomainError('INVALID_DATE', `${label} must be a calendar date (YYYY-MM-DD)`, {
      value,
    });
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parts(date: LocalDate): [number, number, number] {
  assertLocalDate(date);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return [y, m, d];
}

function toUtcMs(date: LocalDate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compareDates(a: LocalDate, b: LocalDate): number {
  return toUtcMs(a) - toUtcMs(b);
}

export const isBefore = (a: LocalDate, b: LocalDate): boolean => compareDates(a, b) < 0;
export const isAfter = (a: LocalDate, b: LocalDate): boolean => compareDates(a, b) > 0;

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcMs(toUtcMs(date) + days * 86_400_000);
}

/** Adds calendar months, clamping to the end of month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** Whole calendar months elapsed from `from` to `to` (negative if `to` precedes `from`). */
export function monthsBetween(from: LocalDate, to: LocalDate): number {
  if (isBefore(to, from)) return -monthsBetween(to, from);
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd && addMonths(from, months) !== to) months -= 1;
  return months;
}

/**
 * The calendar date of an instant in an IANA time zone. Valuation work is dated in the
 * jurisdiction of the property, so callers pass e.g. `Australia/Perth` for WA.
 */
export function localDateOf(instant: Instant | Date, timeZone: string): LocalDate {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) {
    throw new DomainError('INVALID_DATE', 'instant is not a valid date', { instant });
  }
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return formatted;
}

export function isInstant(value: unknown): value is Instant {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** Formats a LocalDate in Australian long form, e.g. `2 October 2026`. */
export function formatAustralianDate(date: LocalDate): string {
  const [y, m, d] = parts(date);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${d} ${months[m - 1] ?? ''} ${y}`;
}
