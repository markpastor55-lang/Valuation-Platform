import type { Actor } from '../core/actor.js';
import type { Permission, Role } from './roles.js';
import { ROLES } from './roles.js';

/**
 * Role → permission grants (least privilege). Holding a grant is necessary but not sufficient:
 * `authorize` also applies organisation, portfolio, assignment, client and separation-of-duties
 * rules. The generated table lives in docs/spec/generated/permission-matrix.md.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  ADMINISTRATOR: [
    'org.manage',
    'user.manage',
    'datasource.manage',
    'job.read',
    'job.cancel',
    'qa.self_approval_exception',
    'report.issue',
    'report.read_issued',
    'invoice.read',
    'audit.read',
    'legal_hold.manage',
    'retention.manage',
  ],
  STANDARDS_OWNER: ['template.edit', 'template.approve', 'ruleset.edit', 'ruleset.approve'],
  ALLOCATOR: [
    'job.create',
    'job.read',
    'job.update',
    'job.allocate',
    'job.cancel',
    'engagement.accept',
    'asset.edit',
    'report.read_issued',
    'invoice.read',
  ],
  VALUER: [
    'job.read',
    'job.update',
    'engagement.accept',
    'asset.edit',
    'inspection.capture',
    'photo.capture',
    'photo.redact',
    'photo.view_unredacted',
    'evidence.edit',
    'valuation.edit',
    'calculation.run',
    'calculation.override',
    'sketch.edit',
    'measurement.approve',
    'ai.decide',
    'validation.acknowledge',
    'certification.sign',
    'report.generate_draft',
    'report.issue',
    'report.read_issued',
    'email.send',
  ],
  FIELD_INSPECTOR: [
    'job.read',
    'asset.edit',
    'inspection.capture',
    'photo.capture',
    'photo.redact',
    'sketch.edit',
    'ai.decide',
  ],
  QA_REVIEWER: [
    'job.read',
    'photo.view_unredacted',
    'qa.review',
    'qa.approve',
    'report.generate_draft',
    'report.read_issued',
    'audit.read',
  ],
  FINANCE: ['job.read', 'invoice.manage', 'invoice.read', 'email.send', 'report.read_issued'],
  CLIENT_READONLY: ['report.read_issued', 'invoice.read'],
};

/** Roles whose grants apply across the organisation (subject to restricted portfolios). */
export const ORG_WIDE_ROLES: ReadonlySet<Role> = new Set([
  'ADMINISTRATOR',
  'STANDARDS_OWNER',
  'ALLOCATOR',
  'FINANCE',
]);

/** Professional decisions that software or AI must never take. */
export const HUMAN_ONLY_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'valuation.edit',
  'engagement.accept',
  'calculation.override',
  'measurement.approve',
  'ai.decide',
  'validation.acknowledge',
  'certification.sign',
  'qa.review',
  'qa.approve',
  'qa.self_approval_exception',
  'report.issue',
  'template.approve',
  'ruleset.approve',
]);

/** Actions that require a multi-factor-authenticated session. */
export const MFA_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'certification.sign',
  'qa.approve',
  'qa.self_approval_exception',
  'report.issue',
  'template.approve',
  'ruleset.approve',
  'user.manage',
  'legal_hold.manage',
  'retention.manage',
]);

export interface Principal extends Actor {
  /** Portfolios the user is a member of (team access and restricted-portfolio walls). */
  readonly portfolioIds: readonly string[];
  /** For client users: the client entities whose issued reports they may read. */
  readonly clientIds: readonly string[];
}

export interface ResourceScope {
  readonly orgId: string;
  readonly jobId?: string;
  readonly portfolioId?: string | null;
  /** Restricted portfolios (information barriers) require explicit membership for every role. */
  readonly portfolioRestricted?: boolean;
  readonly clientId?: string | null;
  readonly responsibleValuerId?: string | null;
  readonly reviewerId?: string | null;
  readonly inspectorIds?: readonly string[];
  readonly reportIssued?: boolean;
  /** Author of the template / rule-set version being approved. */
  readonly authorId?: string;
  /** A documented, separately authorised self-approval exception exists for this job. */
  readonly selfApprovalExceptionAuthorised?: boolean;
}

export type DenialCode =
  | 'NO_ROLE_GRANT'
  | 'WRONG_ORGANISATION'
  | 'RESTRICTED_PORTFOLIO'
  | 'NOT_ASSIGNED'
  | 'CLIENT_SCOPE'
  | 'SEPARATION_OF_DUTIES'
  | 'HUMAN_REQUIRED'
  | 'MFA_REQUIRED';

export type AuthorizationDecision =
  | { readonly allowed: true; readonly grantedBy: Role }
  | { readonly allowed: false; readonly code: DenialCode; readonly reason: string };

const deny = (code: DenialCode, reason: string): AuthorizationDecision => ({
  allowed: false,
  code,
  reason,
});

function rolesGranting(principal: Principal, permission: Permission): Role[] {
  return principal.roles.filter((role) => ROLE_PERMISSIONS[role].includes(permission));
}

function isAssigned(principal: Principal, resource: ResourceScope): boolean {
  return (
    resource.responsibleValuerId === principal.userId ||
    resource.reviewerId === principal.userId ||
    (resource.inspectorIds ?? []).includes(principal.userId)
  );
}

function scopeAllows(role: Role, principal: Principal, resource: ResourceScope): boolean {
  if (role === 'CLIENT_READONLY') {
    return (
      resource.clientId !== undefined &&
      resource.clientId !== null &&
      principal.clientIds.includes(resource.clientId) &&
      resource.reportIssued === true
    );
  }
  if (ORG_WIDE_ROLES.has(role)) return true;
  if (resource.jobId === undefined) return true;
  const portfolioMember =
    resource.portfolioId !== undefined &&
    resource.portfolioId !== null &&
    principal.portfolioIds.includes(resource.portfolioId);
  return isAssigned(principal, resource) || portfolioMember;
}

function separationOfDuties(
  permission: Permission,
  principal: Principal,
  resource: ResourceScope,
  role: Role,
): AuthorizationDecision | null {
  switch (permission) {
    case 'certification.sign':
      if (resource.responsibleValuerId !== principal.userId) {
        return deny(
          'SEPARATION_OF_DUTIES',
          'only the responsible valuer may sign the certification',
        );
      }
      return null;
    case 'qa.review':
    case 'qa.approve':
      if (
        resource.responsibleValuerId === principal.userId &&
        resource.selfApprovalExceptionAuthorised !== true
      ) {
        return deny(
          'SEPARATION_OF_DUTIES',
          'the responsible valuer cannot review or approve their own job without an authorised exception',
        );
      }
      return null;
    case 'qa.self_approval_exception':
      if (resource.responsibleValuerId === principal.userId) {
        return deny(
          'SEPARATION_OF_DUTIES',
          'a self-approval exception must be authorised by another person',
        );
      }
      return null;
    case 'template.approve':
    case 'ruleset.approve':
      if (resource.authorId === principal.userId) {
        return deny('SEPARATION_OF_DUTIES', 'the author of a version cannot approve it');
      }
      return null;
    case 'report.issue':
      if (role === 'VALUER' && resource.responsibleValuerId !== principal.userId) {
        return deny(
          'SEPARATION_OF_DUTIES',
          'only the responsible valuer (or an administrator) may issue',
        );
      }
      return null;
    default:
      return null;
  }
}

/**
 * Decides whether `principal` may perform `permission` on `resource`. Every denial carries a
 * machine-readable code for the `auth.denied` audit event.
 */
export function authorize(
  principal: Principal,
  permission: Permission,
  resource?: ResourceScope,
): AuthorizationDecision {
  if (resource && resource.orgId !== principal.orgId) {
    return deny('WRONG_ORGANISATION', 'resource belongs to another organisation');
  }
  const granting = rolesGranting(principal, permission);
  if (granting.length === 0) return deny('NO_ROLE_GRANT', `no role grants ${permission}`);
  if (HUMAN_ONLY_PERMISSIONS.has(permission) && principal.kind !== 'human') {
    return deny('HUMAN_REQUIRED', `${permission} requires a human user`);
  }
  if (MFA_PERMISSIONS.has(permission) && principal.mfaVerified !== true) {
    return deny('MFA_REQUIRED', `${permission} requires multi-factor authentication`);
  }
  if (!resource) return { allowed: true, grantedBy: granting[0] as Role };

  if (
    resource.portfolioRestricted === true &&
    (resource.portfolioId === undefined ||
      resource.portfolioId === null ||
      !principal.portfolioIds.includes(resource.portfolioId))
  ) {
    return deny('RESTRICTED_PORTFOLIO', 'restricted portfolio requires explicit membership');
  }

  let lastDenial: AuthorizationDecision | null = null;
  for (const role of granting) {
    if (!scopeAllows(role, principal, resource)) {
      lastDenial =
        role === 'CLIENT_READONLY'
          ? deny('CLIENT_SCOPE', 'clients may only read issued reports for their own entities')
          : deny('NOT_ASSIGNED', 'user is not assigned to this job or a member of its portfolio');
      continue;
    }
    const sod = separationOfDuties(permission, principal, resource, role);
    if (sod) {
      lastDenial = sod;
      continue;
    }
    return { allowed: true, grantedBy: role };
  }
  return lastDenial ?? deny('NO_ROLE_GRANT', `no role grants ${permission}`);
}

/** Matrix view used by documentation and admin UI. */
export function permissionMatrix(): { permission: Permission; roles: Role[] }[] {
  const perms = new Set<Permission>();
  for (const role of ROLES) for (const p of ROLE_PERMISSIONS[role]) perms.add(p);
  return [...perms].map((permission) => ({
    permission,
    roles: ROLES.filter((r) => ROLE_PERMISSIONS[r].includes(permission)),
  }));
}
