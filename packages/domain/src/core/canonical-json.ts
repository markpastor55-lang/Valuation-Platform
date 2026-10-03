import { DomainError } from './errors.js';

/** JSON-compatible value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Deterministic JSON serialisation (sorted object keys, no insignificant whitespace).
 * Used for audit hashing and issue snapshots, so any change here is a breaking change to every
 * stored hash: bump `CANONICAL_JSON_VERSION` and keep the old implementation for verification.
 *
 * `undefined` object properties are omitted (as JSON.stringify does); `undefined` array items,
 * non-finite numbers, functions, symbols and bigints are rejected rather than silently coerced.
 */
export const CANONICAL_JSON_VERSION = 1;

export function canonicalJson(value: unknown): string {
  return serialise(value, '$');
}

function serialise(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new DomainError('INVALID_ARGUMENT', `non-finite number at ${path}`);
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value
          .map((item, i) => {
            if (item === undefined) {
              throw new DomainError('INVALID_ARGUMENT', `undefined array item at ${path}[${i}]`);
            }
            return serialise(item, `${path}[${i}]`);
          })
          .join(',')}]`;
      }
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${serialise(record[k], `${path}.${k}`)}`).join(',')}}`;
    }
    default:
      throw new DomainError('INVALID_ARGUMENT', `unsupported ${typeof value} at ${path}`);
  }
}
