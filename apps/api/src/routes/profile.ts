import {
  JURISDICTIONS,
  JURISDICTION_TIME_ZONES,
  MAX_SIGNATURE_DATA_URL_LENGTH,
  ROLE_PERMISSIONS,
  VALUER_REGISTRATION_RULES,
  localDateOf,
  profileProblems,
  registrationProblems,
  registrationRequired,
  signatureHash,
  type Json,
  type Jurisdiction,
  type Principal,
  type ValuerProfile,
  type ValuerSignature,
} from '@vp/domain';
import { z } from 'zod';
import { HttpError } from '../http/errors.js';
import type { Router } from '../http/route.js';
import { authorizeOrThrow } from '../repo/jobs.js';
import { loadValuerProfile, saveValuerProfile, type LoadedProfile } from '../repo/profiles.js';
import { audit, orgStream } from '../services/audit.js';
import { PNG_DATA_URL_PREFIX, decodePngDataUrl, isEmbeddablePng } from '../services/pdf.js';
import { LocalDateSchema } from './schemas.js';

/** States where a valuer must record a registration or licence number (QLD, WA). */
const REGISTRATION_JURISDICTIONS: Jurisdiction[] = JURISDICTIONS.filter(registrationRequired);

const ProfileBody = z.object({
  fullName: z.string().max(200),
  credentials: z.array(z.string().max(40)).max(20),
  apiMemberNumber: z.string().max(40).nullish(),
  registrations: z
    .array(
      z.object({
        jurisdiction: z.enum(REGISTRATION_JURISDICTIONS),
        number: z.string().max(40),
        expiresOn: LocalDateSchema.optional(),
      }),
    )
    .max(REGISTRATION_JURISDICTIONS.length)
    .refine((rs) => new Set(rs.map((r) => r.jurisdiction)).size === rs.length, {
      message: 'record one registration per state',
    }),
  /** Omit to keep the saved signature; `null` removes it. */
  signature: z
    .object({ kind: z.enum(['drawn', 'typed']), value: z.string() })
    .nullable()
    .optional(),
});

const holdsSigningRole = (principal: Principal): boolean =>
  principal.roles.some((r) => ROLE_PERMISSIONS[r].includes('certification.sign'));

/** The profile as shown to its owner, with what still stops them signing. */
function profileView(loaded: LoadedProfile, principal: Principal, now: string) {
  const p = loaded.profile;
  const problems = profileProblems(p);
  return {
    profile: {
      userId: p.userId,
      fullName: p.fullName,
      credentials: p.credentials,
      apiMemberNumber: p.apiMemberNumber ?? null,
      registrations: p.registrations,
      signature: p.signature ? { ...p.signature, sha256: signatureHash(p.signature) } : null,
    },
    saved: loaded.saved,
    updatedAt: loaded.updatedAt,
    signingRole: holdsSigningRole(principal),
    problems,
    readyToSign: problems.length === 0 && p.signature !== undefined,
    stateRegistrations: REGISTRATION_JURISDICTIONS.map((jurisdiction) => {
      const rule = VALUER_REGISTRATION_RULES[jurisdiction];
      const issues = registrationProblems(
        p,
        jurisdiction,
        localDateOf(now, JURISDICTION_TIME_ZONES[jurisdiction]),
      );
      return {
        jurisdiction,
        label: rule?.label ?? jurisdiction,
        authority: rule?.authority ?? '',
        satisfied: issues.length === 0,
        problems: issues,
      };
    }),
  };
}

/** What the audit trail records about a profile: identifiers and the signature's fingerprint only. */
const auditSummary = (p: ValuerProfile): Json => ({
  fullName: p.fullName,
  credentials: [...p.credentials],
  apiMemberNumber: p.apiMemberNumber ?? null,
  registrations: p.registrations.map((r) => ({
    jurisdiction: r.jurisdiction,
    number: r.number,
    expiresOn: r.expiresOn ?? null,
  })),
  signature: p.signature ? { kind: p.signature.kind, sha256: signatureHash(p.signature) } : null,
});

export function registerProfileRoutes(r: Router): void {
  r.add({
    method: 'GET',
    url: '/v1/me/profile',
    summary:
      'Your valuer profile (signature, API member number, state registrations) and what stops you signing',
    tags: ['profile'],
    handler: async ({ ctx, principal }) =>
      profileView(await loadValuerProfile(ctx.db, principal.userId), principal, ctx.clock.now()),
  });

  r.add({
    method: 'PUT',
    url: '/v1/me/profile',
    summary:
      'Update your own valuer profile used to sign reports (valuers only, MFA); the signature is kept when omitted',
    tags: ['profile'],
    permission: 'certification.sign',
    body: ProfileBody,
    handler: async ({ ctx, principal, body }) => {
      // Only people who sign reports keep a signing profile, and only for themselves (no user id
      // in the path). Same session strength as signing: human, MFA-verified.
      await authorizeOrThrow(ctx, principal, 'certification.sign', undefined, {
        type: 'valuer_profile',
        id: principal.userId,
      });
      const now = ctx.clock.now();
      return ctx.db.transaction(async (tx) => {
        const current = await loadValuerProfile(tx, principal.userId);
        let signature: ValuerSignature | undefined = current.profile.signature;
        if (body.signature === null) signature = undefined;
        else if (body.signature) {
          const value =
            body.signature.kind === 'typed' ? body.signature.value.trim() : body.signature.value;
          const unchanged = signature?.kind === body.signature.kind && signature.value === value;
          if (!unchanged) signature = { kind: body.signature.kind, value, updatedAt: now };
        }
        const apiMemberNumber = body.apiMemberNumber?.trim();
        const profile: ValuerProfile = {
          userId: principal.userId,
          fullName: body.fullName.trim(),
          credentials: body.credentials.map((c) => c.trim()).filter(Boolean),
          ...(apiMemberNumber ? { apiMemberNumber } : {}),
          registrations: body.registrations.map((reg) => ({
            jurisdiction: reg.jurisdiction,
            number: reg.number.trim(),
            ...(reg.expiresOn ? { expiresOn: reg.expiresOn } : {}),
          })),
          ...(signature ? { signature } : {}),
        };
        const problems = profileProblems(profile);
        if (
          signature?.kind === 'drawn' &&
          signature.value.startsWith(PNG_DATA_URL_PREFIX) &&
          signature.value.length <= MAX_SIGNATURE_DATA_URL_LENGTH
        ) {
          const png = decodePngDataUrl(signature.value);
          if (!png || !(await isEmbeddablePng(png)))
            problems.push('The drawn signature is not a readable PNG image');
        }
        if (problems.length)
          throw new HttpError(422, 'INVALID_PROFILE', 'the profile cannot be saved', {
            problems,
          });
        await saveValuerProfile(tx, principal.orgId, profile, now);
        await audit(tx, ctx, {
          orgId: principal.orgId,
          streamId: orgStream(principal.orgId),
          actor: principal,
          action: 'profile.updated',
          entityType: 'valuer_profile',
          entityId: principal.userId,
          ...(current.saved ? { before: auditSummary(current.profile) } : {}),
          after: auditSummary(profile),
        });
        return profileView({ profile, saved: true, updatedAt: now }, principal, now);
      });
    },
  });
}
