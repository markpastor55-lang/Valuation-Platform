import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalJson } from './canonical-json.js';

/** Lower-case hex SHA-256 of a UTF-8 string or raw bytes. */
export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256(typeof input === 'string' ? utf8ToBytes(input) : input));
}

/** SHA-256 of the canonical JSON form of a value. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
