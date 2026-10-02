import type { Principal, Role } from '@vp/domain';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { Db } from '../db/db.js';
import { forbidden, unauthenticated } from '../http/errors.js';

export interface RequestCredentials {
  readonly authorization?: string | undefined;
  readonly devUserId?: string | undefined;
  readonly devMfa?: string | undefined;
  readonly devActorKind?: string | undefined;
}

export interface Authenticator {
  authenticate(creds: RequestCredentials): Promise<Principal>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loads roles, portfolio memberships and client scopes for a user. */
export async function loadPrincipal(
  db: Db,
  where: { userId: string } | { idpSubject: string },
  session: { kind: Principal['kind']; mfaVerified: boolean },
): Promise<Principal> {
  const { rows } = await db.query<{
    id: string;
    org_id: string;
    display_name: string;
    status: string;
  }>(
    'userId' in where
      ? 'SELECT id, org_id, display_name, status FROM app_user WHERE id = $1'
      : 'SELECT id, org_id, display_name, status FROM app_user WHERE idp_subject = $1',
    ['userId' in where ? where.userId : where.idpSubject],
  );
  const user = rows[0];
  if (!user) throw unauthenticated('unknown user');
  if (user.status !== 'active') throw forbidden('ACCOUNT_SUSPENDED', 'account is not active');
  const [roles, portfolios, clients] = await Promise.all([
    db.query<{ role: Role }>('SELECT role FROM user_role WHERE user_id = $1 ORDER BY role', [
      user.id,
    ]),
    db.query<{ portfolio_id: string }>(
      'SELECT portfolio_id FROM portfolio_member WHERE user_id = $1',
      [user.id],
    ),
    db.query<{ client_id: string }>('SELECT client_id FROM client_user WHERE user_id = $1', [
      user.id,
    ]),
  ]);
  return {
    kind: session.kind,
    userId: user.id,
    orgId: user.org_id,
    displayName: user.display_name,
    roles: roles.rows.map((r) => r.role),
    mfaVerified: session.mfaVerified,
    portfolioIds: portfolios.rows.map((p) => p.portfolio_id),
    clientIds: clients.rows.map((c) => c.client_id),
  };
}

/**
 * Development/test only: trusts `x-user-id`, `x-mfa` and `x-actor-kind` headers. `loadConfig`
 * refuses this mode in production.
 */
export function devAuthenticator(db: Db): Authenticator {
  return {
    async authenticate(creds) {
      if (!creds.devUserId || !UUID_RE.test(creds.devUserId))
        throw unauthenticated('x-user-id header required (dev auth)');
      const kind =
        creds.devActorKind === 'system' || creds.devActorKind === 'ai'
          ? creds.devActorKind
          : 'human';
      return loadPrincipal(
        db,
        { userId: creds.devUserId },
        { kind, mfaVerified: creds.devMfa === 'true' },
      );
    },
  };
}

/**
 * OIDC bearer tokens from the organisation's identity provider. MFA is taken from the `amr`
 * claim; service accounts (integrations, AI suggestion service) carry an `actor_kind` claim and
 * can never take human-only actions.
 */
export function oidcAuthenticator(
  db: Db,
  opts: { issuer: string; audience: string; jwks: JWTVerifyGetKey | string },
): Authenticator {
  const keys = typeof opts.jwks === 'string' ? createRemoteJWKSet(new URL(opts.jwks)) : opts.jwks;
  return {
    async authenticate(creds) {
      const m = /^Bearer (.+)$/.exec(creds.authorization ?? '');
      if (!m?.[1]) throw unauthenticated();
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(m[1], keys, {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: ['RS256', 'ES256', 'PS256'],
        }));
      } catch {
        throw unauthenticated('invalid or expired token');
      }
      if (!payload.sub) throw unauthenticated('token has no subject');
      const amr = Array.isArray(payload['amr']) ? (payload['amr'] as unknown[]) : [];
      const actorKind = payload['actor_kind'];
      const kind = actorKind === 'system' || actorKind === 'ai' ? actorKind : 'human';
      return loadPrincipal(
        db,
        { idpSubject: payload.sub },
        { kind, mfaVerified: amr.includes('mfa') || amr.includes('otp') || amr.includes('hwk') },
      );
    },
  };
}
