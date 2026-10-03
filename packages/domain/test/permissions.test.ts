import { describe, expect, it } from 'vitest';
import {
  HUMAN_ONLY_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  authorize,
  permissionMatrix,
  type Principal,
  type ResourceScope,
  type Role,
} from '../src/index.js';

const user = (userId: string, roles: Role[], extra: Partial<Principal> = {}): Principal => ({
  kind: 'human',
  userId,
  orgId: 'org1',
  roles,
  mfaVerified: true,
  portfolioIds: [],
  clientIds: [],
  ...extra,
});

const job: ResourceScope = {
  orgId: 'org1',
  jobId: 'job1',
  portfolioId: 'pf1',
  clientId: 'client1',
  responsibleValuerId: 'valuer1',
  reviewerId: 'reviewer1',
  inspectorIds: ['inspector1'],
};

describe('permission matrix', () => {
  it('only grants known permissions and every permission is granted to some role', () => {
    const granted = new Set(ROLES.flatMap((r) => ROLE_PERMISSIONS[r]));
    for (const p of granted) expect(PERMISSIONS).toContain(p);
    for (const p of PERMISSIONS) expect(granted.has(p)).toBe(true);
    expect(permissionMatrix().length).toBe(PERMISSIONS.length);
  });

  it('never grants certification or QA approval to administrators, allocators or clients', () => {
    for (const role of ['ADMINISTRATOR', 'ALLOCATOR', 'CLIENT_READONLY', 'FINANCE'] as const) {
      expect(ROLE_PERMISSIONS[role]).not.toContain('certification.sign');
      expect(ROLE_PERMISSIONS[role]).not.toContain('qa.approve');
    }
  });

  it('read-only client role has no write permissions', () => {
    expect([...ROLE_PERMISSIONS.CLIENT_READONLY].sort()).toEqual([
      'invoice.read',
      'report.read_issued',
    ]);
  });
});

describe('authorize', () => {
  it('denies across organisations', () => {
    const r = authorize(user('valuer1', ['VALUER']), 'job.read', { ...job, orgId: 'org2' });
    expect(r).toMatchObject({ allowed: false, code: 'WRONG_ORGANISATION' });
  });

  it('allows the responsible valuer to sign and denies other valuers', () => {
    expect(authorize(user('valuer1', ['VALUER']), 'certification.sign', job).allowed).toBe(true);
    const other = authorize(
      user('valuer2', ['VALUER'], { portfolioIds: ['pf1'] }),
      'certification.sign',
      job,
    );
    expect(other).toMatchObject({ allowed: false, code: 'SEPARATION_OF_DUTIES' });
  });

  it('requires MFA and a human for certification', () => {
    expect(
      authorize(user('valuer1', ['VALUER'], { mfaVerified: false }), 'certification.sign', job),
    ).toMatchObject({
      allowed: false,
      code: 'MFA_REQUIRED',
    });
    for (const kind of ['ai', 'system'] as const) {
      expect(
        authorize(user('valuer1', ['VALUER'], { kind }), 'certification.sign', job),
      ).toMatchObject({
        allowed: false,
        code: 'HUMAN_REQUIRED',
      });
    }
  });

  it('AI actors can never take professional decisions', () => {
    const ai = user('model', [...ROLES], { kind: 'ai', portfolioIds: ['pf1'] });
    for (const p of HUMAN_ONLY_PERMISSIONS) {
      expect(authorize(ai, p, job).allowed).toBe(false);
    }
  });

  it('prevents self-approval in QA unless an authorised exception exists', () => {
    const valuerReviewer = user('valuer1', ['VALUER', 'QA_REVIEWER']);
    expect(authorize(valuerReviewer, 'qa.approve', job)).toMatchObject({
      allowed: false,
      code: 'SEPARATION_OF_DUTIES',
    });
    expect(
      authorize(valuerReviewer, 'qa.approve', { ...job, selfApprovalExceptionAuthorised: true })
        .allowed,
    ).toBe(true);
    expect(authorize(user('reviewer1', ['QA_REVIEWER']), 'qa.approve', job).allowed).toBe(true);
  });

  it('the valuer cannot authorise their own self-approval exception', () => {
    const admin = user('valuer1', ['ADMINISTRATOR', 'VALUER']);
    expect(authorize(admin, 'qa.self_approval_exception', job)).toMatchObject({ allowed: false });
    expect(
      authorize(user('admin1', ['ADMINISTRATOR']), 'qa.self_approval_exception', job).allowed,
    ).toBe(true);
  });

  it('assignment-scoped roles need an assignment or portfolio membership', () => {
    expect(authorize(user('valuer9', ['VALUER']), 'job.read', job)).toMatchObject({
      allowed: false,
      code: 'NOT_ASSIGNED',
    });
    expect(
      authorize(user('valuer9', ['VALUER'], { portfolioIds: ['pf1'] }), 'job.read', job).allowed,
    ).toBe(true);
    expect(authorize(user('inspector1', ['FIELD_INSPECTOR']), 'photo.capture', job).allowed).toBe(
      true,
    );
    expect(
      authorize(user('inspector1', ['FIELD_INSPECTOR']), 'certification.sign', job),
    ).toMatchObject({
      code: 'NO_ROLE_GRANT',
    });
  });

  it('restricted portfolios require membership even for organisation-wide roles', () => {
    const restricted = { ...job, portfolioRestricted: true };
    expect(authorize(user('alloc1', ['ALLOCATOR']), 'job.read', restricted)).toMatchObject({
      code: 'RESTRICTED_PORTFOLIO',
    });
    expect(
      authorize(user('alloc1', ['ALLOCATOR'], { portfolioIds: ['pf1'] }), 'job.read', restricted)
        .allowed,
    ).toBe(true);
  });

  it('clients read only issued reports for their own entities', () => {
    const client = user('c1', ['CLIENT_READONLY'], { clientIds: ['client1'] });
    expect(authorize(client, 'report.read_issued', job)).toMatchObject({
      allowed: false,
      code: 'CLIENT_SCOPE',
    });
    expect(authorize(client, 'report.read_issued', { ...job, reportIssued: true }).allowed).toBe(
      true,
    );
    expect(
      authorize(client, 'report.read_issued', { ...job, reportIssued: true, clientId: 'client2' })
        .allowed,
    ).toBe(false);
    expect(authorize(client, 'job.read', job)).toMatchObject({ code: 'NO_ROLE_GRANT' });
  });

  it('authors cannot approve their own template versions', () => {
    const owner = user('so1', ['STANDARDS_OWNER']);
    expect(authorize(owner, 'template.approve', { orgId: 'org1', authorId: 'so1' })).toMatchObject({
      code: 'SEPARATION_OF_DUTIES',
    });
    expect(authorize(owner, 'template.approve', { orgId: 'org1', authorId: 'so2' }).allowed).toBe(
      true,
    );
  });

  it('only the responsible valuer or an administrator can issue', () => {
    expect(authorize(user('valuer1', ['VALUER']), 'report.issue', job).allowed).toBe(true);
    expect(
      authorize(user('valuer2', ['VALUER'], { portfolioIds: ['pf1'] }), 'report.issue', job)
        .allowed,
    ).toBe(false);
    expect(authorize(user('admin1', ['ADMINISTRATOR']), 'report.issue', job).allowed).toBe(true);
  });
});
