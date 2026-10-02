import { AU_CORE_RULE_SET, DEFAULT_TEMPLATE, hashCanonical, type Role } from '@vp/domain';
import type { Db } from './db.js';

export interface SeededOrg {
  readonly orgId: string;
  readonly ruleSetVersionId: string;
  readonly templateVersionId: string;
}

/**
 * Bootstraps an organisation with the seed rule set and template (both **draft** — they must be
 * reviewed and approved by the standards owner before reports can be issued).
 */
export async function seedOrganisation(
  db: Db,
  ids: { orgId: string; ruleSetVersionId: string; templateVersionId: string },
  name: string,
): Promise<SeededOrg> {
  await db.transaction(async (tx) => {
    await tx.query('INSERT INTO organisation (id, name) VALUES ($1, $2)', [ids.orgId, name]);
    await tx.query(
      `INSERT INTO rule_set_version (id, org_id, rule_set_id, version, status, effective_from, content, content_hash, authored_by)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8)`,
      [
        ids.ruleSetVersionId,
        ids.orgId,
        AU_CORE_RULE_SET.id,
        AU_CORE_RULE_SET.version,
        AU_CORE_RULE_SET.effectiveFrom,
        JSON.stringify(AU_CORE_RULE_SET),
        hashCanonical(AU_CORE_RULE_SET),
        AU_CORE_RULE_SET.authoredBy,
      ],
    );
    await tx.query(
      `INSERT INTO template_version (id, org_id, template_id, version, status, content, content_hash, authored_by)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7)`,
      [
        ids.templateVersionId,
        ids.orgId,
        DEFAULT_TEMPLATE.templateId,
        DEFAULT_TEMPLATE.version,
        JSON.stringify(DEFAULT_TEMPLATE),
        hashCanonical(DEFAULT_TEMPLATE),
        DEFAULT_TEMPLATE.authoredBy,
      ],
    );
  });
  return ids;
}

export async function createUser(
  db: Db,
  u: {
    id: string;
    orgId: string;
    email: string;
    displayName: string;
    roles: readonly Role[];
    idpSubject?: string;
    credentials?: readonly string[];
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      'INSERT INTO app_user (id, org_id, email, display_name, idp_subject, credentials) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        u.id,
        u.orgId,
        u.email,
        u.displayName,
        u.idpSubject ?? null,
        JSON.stringify(u.credentials ?? []),
      ],
    );
    for (const role of u.roles)
      await tx.query('INSERT INTO user_role (user_id, role) VALUES ($1, $2)', [u.id, role]);
  });
}

/** Fixed identifiers for the local demo organisation (development and tests only). */
export const DEMO = {
  orgId: '00000000-0000-4000-8000-000000000001',
  ruleSetVersionId: '00000000-0000-4000-8000-000000000002',
  templateVersionId: '00000000-0000-4000-8000-000000000003',
  clientId: '00000000-0000-4000-8000-000000000010',
  portfolioId: '00000000-0000-4000-8000-000000000011',
  restrictedPortfolioId: '00000000-0000-4000-8000-000000000012',
  users: {
    admin: '00000000-0000-4000-8000-000000000101',
    standardsOwner: '00000000-0000-4000-8000-000000000102',
    allocator: '00000000-0000-4000-8000-000000000103',
    valuer: '00000000-0000-4000-8000-000000000104',
    valuer2: '00000000-0000-4000-8000-000000000105',
    inspector: '00000000-0000-4000-8000-000000000106',
    reviewer: '00000000-0000-4000-8000-000000000107',
    finance: '00000000-0000-4000-8000-000000000108',
    client: '00000000-0000-4000-8000-000000000109',
    legal: '00000000-0000-4000-8000-000000000110',
    aiService: '00000000-0000-4000-8000-000000000111',
  },
} as const;

export async function seedDemo(db: Db): Promise<typeof DEMO> {
  await seedOrganisation(db, DEMO, 'Example Valuers Pty Ltd');
  const u = DEMO.users;
  const people: [string, string, string, Role[], string[]?][] = [
    [u.admin, 'admin@example.com', 'Avery Admin', ['ADMINISTRATOR']],
    [u.standardsOwner, 'standards@example.com', 'Sam Standards', ['STANDARDS_OWNER']],
    [u.allocator, 'allocator@example.com', 'Alex Allocator', ['ALLOCATOR']],
    [u.valuer, 'valuer@example.com', 'Val Valuer', ['VALUER'], ['AAPI', 'CPV']],
    [u.valuer2, 'valuer2@example.com', 'Vic Valuer', ['VALUER', 'QA_REVIEWER'], ['AAPI', 'CPV']],
    [u.inspector, 'inspector@example.com', 'Indy Inspector', ['FIELD_INSPECTOR']],
    [u.reviewer, 'reviewer@example.com', 'Rae Reviewer', ['QA_REVIEWER'], ['FAPI', 'CPV']],
    [u.finance, 'finance@example.com', 'Fin Finance', ['FINANCE']],
    [u.client, 'client@lender.example', 'Client Reader', ['CLIENT_READONLY']],
    [u.legal, 'legal@example.com', 'Lee Legal', ['STANDARDS_OWNER']],
    [u.aiService, 'ai-service@example.com', 'Photo classification service', ['FIELD_INSPECTOR']],
  ];
  for (const [id, email, displayName, roles, credentials] of people) {
    await createUser(db, {
      id,
      orgId: DEMO.orgId,
      email,
      displayName,
      roles,
      ...(credentials ? { credentials } : {}),
    });
  }
  await db.query('INSERT INTO client (id, org_id, name, abn) VALUES ($1, $2, $3, $4)', [
    DEMO.clientId,
    DEMO.orgId,
    'Example Lending Pty Ltd',
    '00 000 000 000',
  ]);
  await db.query('INSERT INTO client_user (user_id, client_id) VALUES ($1, $2)', [
    u.client,
    DEMO.clientId,
  ]);
  await db.query(
    'INSERT INTO portfolio (id, org_id, client_id, name, restricted) VALUES ($1, $2, $3, $4, false), ($5, $2, $3, $6, true)',
    [
      DEMO.portfolioId,
      DEMO.orgId,
      DEMO.clientId,
      'Residential panel',
      DEMO.restrictedPortfolioId,
      'Restricted — litigation matters',
    ],
  );
  await db.query('INSERT INTO portfolio_member (portfolio_id, user_id) VALUES ($1, $2), ($3, $4)', [
    DEMO.restrictedPortfolioId,
    u.valuer2,
    DEMO.portfolioId,
    u.aiService,
  ]);
  await db.query(
    `INSERT INTO data_source (id, org_id, name, provider, kind, jurisdictions, licence, freshness_days)
     VALUES ('ds-sales', $1, 'Licensed sales feed (example)', 'Example Data Co', 'sales', '{VIC,NSW}', $2, 365),
            ('ds-planning-vic', $1, 'Victorian planning data (example)', 'State government', 'planning', '{VIC}', $3, 90),
            ('ds-client-docs', $1, 'Client-supplied documents', 'Client', 'client_document', '{}', $4, NULL)`,
    [
      DEMO.orgId,
      JSON.stringify({
        basis: 'licensed',
        reference: 'Licence agreement (example)',
        permitsStorage: true,
        permitsReportReproduction: true,
        permitsBulkUse: false,
      }),
      JSON.stringify({
        basis: 'open_licence',
        attribution: 'State of Victoria (example attribution)',
        permitsStorage: true,
        permitsReportReproduction: true,
        permitsBulkUse: false,
      }),
      JSON.stringify({
        basis: 'client_supplied',
        permitsStorage: true,
        permitsReportReproduction: true,
        permitsBulkUse: false,
      }),
    ],
  );
  return DEMO;
}
