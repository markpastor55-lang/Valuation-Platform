import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcAuthenticator } from '../src/auth/auth.js';
import { loadConfig } from '../src/config.js';
import { DEMO, createTestApp, newJobBody, type TestApp } from './helpers.js';

describe('configuration safety', () => {
  it('refuses development auth, embedded databases and draft configuration in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'dev', DATABASE_URL: 'postgres://x' }),
    ).toThrow(/AUTH_MODE must be oidc/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'pglite://memory',
        OIDC_ISSUER: 'https://idp.example',
        OIDC_AUDIENCE: 'api',
        OIDC_JWKS_URL: 'https://idp.example/jwks',
      }),
    ).toThrow(/PostgreSQL/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://x',
        ALLOW_DRAFT_CONFIG: 'true',
        OIDC_ISSUER: 'https://idp.example',
        OIDC_AUDIENCE: 'api',
        OIDC_JWKS_URL: 'https://idp.example/jwks',
      }),
    ).toThrow(/ALLOW_DRAFT_CONFIG/);
    const ok = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      OIDC_ISSUER: 'https://idp.example',
      OIDC_AUDIENCE: 'api',
      OIDC_JWKS_URL: 'https://idp.example/jwks',
    });
    expect(ok).toMatchObject({
      allowDraftConfig: false,
      requireApprovedConfigForIssue: true,
      databaseSsl: true,
      auth: { mode: 'oidc' },
    });
  });
});

describe('OIDC authentication', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await t.db.query("UPDATE app_user SET idp_subject = 'idp|valuer' WHERE id = $1", [
      DEMO.users.valuer,
    ]);
  });
  afterAll(async () => t.close());

  it('verifies tokens against the issuer keys and maps amr to MFA', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' }],
    });
    const auth = oidcAuthenticator(t.db, {
      issuer: 'https://idp.example',
      audience: 'valuation-api',
      jwks,
    });
    const token = (claims: Record<string, unknown>, issuer = 'https://idp.example') =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setSubject('idp|valuer')
        .setIssuer(issuer)
        .setAudience('valuation-api')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);

    const p = await auth.authenticate({
      authorization: `Bearer ${await token({ amr: ['pwd', 'mfa'] })}`,
    });
    expect(p).toMatchObject({
      userId: DEMO.users.valuer,
      kind: 'human',
      mfaVerified: true,
      roles: ['VALUER'],
    });
    const noMfa = await auth.authenticate({
      authorization: `Bearer ${await token({ amr: ['pwd'] })}`,
    });
    expect(noMfa.mfaVerified).toBe(false);
    const service = await auth.authenticate({
      authorization: `Bearer ${await token({ actor_kind: 'ai' })}`,
    });
    expect(service.kind).toBe('ai');
    await expect(
      auth.authenticate({ authorization: `Bearer ${await token({}, 'https://evil.example')}` }),
    ).rejects.toThrow(/invalid or expired/);
    await expect(auth.authenticate({})).rejects.toThrow(/authentication required/);
  });

  it('rejects unauthenticated API calls', async () => {
    const res = await t.call(null, 'GET', '/v1/jobs');
    expect(res.status).toBe(401);
  });
});

describe('separation of duties in QA', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('prevents self-review unless another person authorises a documented exception', async () => {
    // valuer2 holds both VALUER and QA_REVIEWER roles and is the responsible valuer
    const job = await t.call<{ id: string }>(
      'allocator',
      'POST',
      '/v1/jobs',
      newJobBody({ responsibleValuerId: DEMO.users.valuer2, reviewerId: DEMO.users.reviewer }),
    );
    await t.db.query("UPDATE job SET status = 'submitted' WHERE id = $1", [job.body.id]);
    const self = await t.call<{ error: { code: string } }>(
      'valuer2',
      'POST',
      `/v1/jobs/${job.body.id}/qa/start`,
    );
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SEPARATION_OF_DUTIES');
    const ownException = await t.call(
      'valuer2',
      'POST',
      `/v1/jobs/${job.body.id}/qa/self-approval-exception`,
      { reason: 'Sole practitioner office, no other reviewer available' },
    );
    expect(ownException.status).toBe(403);
    const noMfa = await t.call(
      'admin',
      'POST',
      `/v1/jobs/${job.body.id}/qa/self-approval-exception`,
      { reason: 'Sole practitioner office, no other reviewer available' },
      { mfa: false },
    );
    expect(noMfa.status).toBe(403);
    const exception = await t.call(
      'admin',
      'POST',
      `/v1/jobs/${job.body.id}/qa/self-approval-exception`,
      { reason: 'Sole practitioner office, no other reviewer available' },
    );
    expect(exception.status).toBe(200);
    const start = await t.call<{ selfApprovalException: { authorisedBy: string } }>(
      'valuer2',
      'POST',
      `/v1/jobs/${job.body.id}/qa/start`,
    );
    expect(start.status).toBe(200);
    expect(start.body.selfApprovalException.authorisedBy).toBe(DEMO.users.admin);
  });

  it('allocators cannot make the reviewer the responsible valuer', async () => {
    const job = await t.call<{ id: string }>('allocator', 'POST', '/v1/jobs', newJobBody());
    const res = await t.call<{ error: { code: string } }>(
      'allocator',
      'POST',
      `/v1/jobs/${job.body.id}/assign`,
      { reviewerId: DEMO.users.valuer },
    );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SEPARATION_OF_DUTIES');
  });

  it('template authors cannot approve their own versions', async () => {
    const { DEFAULT_TEMPLATE } = await import('@vp/domain');
    const created = await t.call<{ version: number }>(
      'standardsOwner',
      'POST',
      '/v1/admin/templates',
      { template: DEFAULT_TEMPLATE },
    );
    const res = await t.call<{ error: { code: string } }>(
      'standardsOwner',
      'POST',
      `/v1/admin/templates/au-generic/versions/${created.body.version}/approve`,
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SEPARATION_OF_DUTIES');
    const placeholders = await t.call<{ error: { code: string } }>(
      'legal',
      'POST',
      `/v1/admin/templates/au-generic/versions/${created.body.version}/approve`,
    );
    expect(placeholders.status).toBe(409);
  });
});

describe('OpenAPI contract', () => {
  it('documents every route with its permission', async () => {
    const t = await createTestApp();
    try {
      const res = await t.call<{
        openapi: string;
        paths: Record<string, Record<string, { 'x-permission'?: string; summary: string }>>;
      }>(null, 'GET', '/v1/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      expect(Object.keys(res.body.paths)).toEqual(
        expect.arrayContaining([
          '/v1/jobs',
          '/v1/jobs/{jobId}/issue',
          '/v1/reports/{reportId}/reproduce',
          '/v1/sync',
        ]),
      );
      expect(res.body.paths['/v1/jobs/{jobId}/certification']!['post']!['x-permission']).toBe(
        'certification.sign',
      );
    } finally {
      await t.close();
    }
  });
});
