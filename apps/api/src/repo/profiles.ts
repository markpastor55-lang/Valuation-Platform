import type { Certification, ValuerProfile, ValuerRegistration, ValuerSignature } from '@vp/domain';
import type { Db } from '../db/db.js';
import { notFound } from '../http/errors.js';

interface ProfileRow {
  readonly user_id: string;
  readonly full_name: string;
  readonly credentials: string[];
  readonly api_member_number: string | null;
  readonly registrations: ValuerRegistration[];
  readonly signature: ValuerSignature | null;
  readonly updated_at: Date | string;
}

export interface LoadedProfile {
  readonly profile: ValuerProfile;
  /** False when the valuer has not saved a profile yet (defaults come from their user record). */
  readonly saved: boolean;
  readonly updatedAt: string | null;
}

/**
 * The user's valuer profile. Before the first save it defaults to their user record's display
 * name and credentials, with no API member number, registrations or signature.
 */
export async function loadValuerProfile(db: Db, userId: string): Promise<LoadedProfile> {
  const { rows } = await db.query<ProfileRow>(
    'SELECT user_id, full_name, credentials, api_member_number, registrations, signature, updated_at FROM valuer_profile WHERE user_id = $1',
    [userId],
  );
  const row = rows[0];
  if (row) {
    return {
      profile: {
        userId: row.user_id,
        fullName: row.full_name,
        credentials: row.credentials,
        ...(row.api_member_number !== null ? { apiMemberNumber: row.api_member_number } : {}),
        registrations: row.registrations,
        ...(row.signature ? { signature: row.signature } : {}),
      },
      saved: true,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
  const user = await db.query<{ display_name: string; credentials: string[] }>(
    'SELECT display_name, credentials FROM app_user WHERE id = $1',
    [userId],
  );
  const u = user.rows[0];
  if (!u) throw notFound('user');
  return {
    profile: { userId, fullName: u.display_name, credentials: u.credentials, registrations: [] },
    saved: false,
    updatedAt: null,
  };
}

export async function saveValuerProfile(
  db: Db,
  orgId: string,
  profile: ValuerProfile,
  at: string,
): Promise<void> {
  await db.query(
    `INSERT INTO valuer_profile (user_id, org_id, full_name, credentials, api_member_number, registrations, signature, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, credentials = EXCLUDED.credentials,
       api_member_number = EXCLUDED.api_member_number, registrations = EXCLUDED.registrations,
       signature = EXCLUDED.signature, updated_at = EXCLUDED.updated_at`,
    [
      profile.userId,
      orgId,
      profile.fullName,
      JSON.stringify(profile.credentials),
      profile.apiMemberNumber ?? null,
      JSON.stringify(profile.registrations),
      profile.signature ? JSON.stringify(profile.signature) : null,
      at,
    ],
  );
}

/** Keeps a copy of the signature used for a certification, keyed by its fingerprint. */
export async function recordSignatureUse(
  db: Db,
  orgId: string,
  userId: string,
  sha256: string,
  signature: ValuerSignature,
  at: string,
): Promise<void> {
  await db.query(
    `INSERT INTO valuer_signature (user_id, sha256, org_id, kind, value, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, sha256) DO NOTHING`,
    [userId, sha256, orgId, signature.kind, signature.value, at],
  );
}

export interface SignatureImage {
  readonly kind: ValuerSignature['kind'];
  readonly value: string;
}

/** The signature recorded for a certification, keyed by fingerprint (empty when it has none). */
export async function certificationSignatures(
  db: Db,
  certification: Certification | undefined,
): Promise<Record<string, SignatureImage>> {
  const sha = certification?.valuer.signatureSha256;
  if (!certification || !sha) return {};
  const { rows } = await db.query<SignatureImage>(
    'SELECT kind, value FROM valuer_signature WHERE user_id = $1 AND sha256 = $2',
    [certification.valuer.userId, sha],
  );
  return rows[0] ? { [sha]: { kind: rows[0].kind, value: rows[0].value } } : {};
}
