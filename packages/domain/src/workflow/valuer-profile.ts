import type { Instant, LocalDate } from '../core/dates.js';
import { isAfter, isLocalDate } from '../core/dates.js';
import { sha256Hex } from '../core/hash.js';
import type { Jurisdiction } from '../config/codes.js';
import type { ValuerIdentity } from './certification.js';

/**
 * Where a valuer must hold a state registration or licence to value, and how it is described.
 * Queensland: registered valuer (Valuers Registration Act 1992). Western Australia: licensed land
 * valuer (Land Valuers Licensing Act 1978). Other states rely on professional membership.
 * [REVIEW: API_STANDARDS] [REVIEW: LEGAL]
 */
export const VALUER_REGISTRATION_RULES: Readonly<
  Partial<Record<Jurisdiction, { readonly label: string; readonly authority: string }>>
> = {
  QLD: {
    label: 'Queensland registered valuer number',
    authority: 'Valuers Registration Board of Queensland',
  },
  WA: {
    label: 'Western Australian licensed valuer number',
    authority: 'Department of Mines, Industry Regulation and Safety (WA)',
  },
};

export const registrationRequired = (jurisdiction: Jurisdiction): boolean =>
  VALUER_REGISTRATION_RULES[jurisdiction] !== undefined;

export interface ValuerRegistration {
  readonly jurisdiction: Jurisdiction;
  readonly number: string;
  readonly expiresOn?: LocalDate;
}

/** The valuer's sign-off signature: a drawn or uploaded image (PNG data URL) or typed name. */
export interface ValuerSignature {
  readonly kind: 'drawn' | 'typed';
  /** PNG data URL for drawn signatures; the typed name for typed ones. */
  readonly value: string;
  readonly updatedAt: Instant;
}

/** A valuer's own profile, used to sign reports. Only the valuer edits it. */
export interface ValuerProfile {
  readonly userId: string;
  readonly fullName: string;
  /** Designations as held, e.g. "AAPI", "FAPI", "CPV", "RPV". */
  readonly credentials: readonly string[];
  /** Australian Property Institute member number. */
  readonly apiMemberNumber?: string;
  readonly registrations: readonly ValuerRegistration[];
  readonly signature?: ValuerSignature;
}

export const MAX_SIGNATURE_DATA_URL_LENGTH = 200_000;

/** Fingerprint of the signature, recorded with each certification that used it. */
export const signatureHash = (s: ValuerSignature): string => sha256Hex(`${s.kind}\n${s.value}`);

/** Problems with the profile itself (shown on the profile screen). */
export function profileProblems(p: ValuerProfile): string[] {
  const out: string[] = [];
  if (!p.fullName.trim()) out.push('Enter your full name');
  if (p.credentials.length === 0) out.push('Add your designations, e.g. AAPI or CPV');
  if (p.apiMemberNumber !== undefined && !/^[A-Za-z0-9-]{3,20}$/.test(p.apiMemberNumber.trim()))
    out.push('API member number should be 3–20 letters or digits');
  for (const r of p.registrations) {
    if (!r.number.trim()) out.push(`Enter your ${r.jurisdiction} number`);
    if (r.expiresOn !== undefined && !isLocalDate(r.expiresOn))
      out.push(`${r.jurisdiction} expiry must be a date`);
  }
  if (p.signature) {
    if (p.signature.kind === 'drawn' && !p.signature.value.startsWith('data:image/png;base64,'))
      out.push('A drawn signature must be a PNG image');
    if (p.signature.value.length > MAX_SIGNATURE_DATA_URL_LENGTH)
      out.push('The signature image is too large');
    if (p.signature.kind === 'typed' && p.signature.value.trim().length < 2)
      out.push('Type your name as your signature');
  }
  return out;
}

/**
 * What is wrong with the valuer's state registration for `jurisdiction` on `today` (missing or
 * expired). Empty where the state needs no registration or it is in order.
 */
export function registrationProblems(
  p: ValuerProfile,
  jurisdiction: Jurisdiction,
  today: LocalDate,
): string[] {
  const rule = VALUER_REGISTRATION_RULES[jurisdiction];
  if (!rule) return [];
  const reg = p.registrations.find((r) => r.jurisdiction === jurisdiction);
  if (!reg?.number.trim()) return [`Add your ${rule.label} in your profile`];
  if (reg.expiresOn && isAfter(today, reg.expiresOn))
    return [`Your ${rule.label} expired on ${reg.expiresOn}`];
  return [];
}

/** What stops this valuer signing a job in `jurisdiction` on `today`. Empty when they can sign. */
export function signingProblems(
  p: ValuerProfile,
  jurisdiction: Jurisdiction,
  today: LocalDate,
): string[] {
  const out = profileProblems(p);
  if (!p.signature) out.push('Add your sign-off signature in your profile');
  out.push(...registrationProblems(p, jurisdiction, today));
  return out;
}

/** The identity printed on a certification for a job in `jurisdiction`. */
export function valuerIdentityFor(p: ValuerProfile, jurisdiction: Jurisdiction): ValuerIdentity {
  const reg = registrationRequired(jurisdiction)
    ? p.registrations.find((r) => r.jurisdiction === jurisdiction)
    : undefined;
  return {
    userId: p.userId,
    fullName: p.fullName,
    credentials: p.credentials,
    ...(p.apiMemberNumber?.trim() ? { apiMemberNumber: p.apiMemberNumber.trim() } : {}),
    ...(reg ? { registration: { jurisdiction, number: reg.number.trim() } } : {}),
    ...(p.signature ? { signatureSha256: signatureHash(p.signature) } : {}),
  };
}
