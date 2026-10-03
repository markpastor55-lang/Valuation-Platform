import { z } from 'zod';
import { CORELOGIC_DEFAULT_PATHS, type CoreLogicEndpoint } from './integrations/corelogic.js';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: bool.optional(),
  AUTH_MODE: z.enum(['dev', 'oidc']).optional(),
  OIDC_ISSUER: z.url().optional(),
  OIDC_AUDIENCE: z.string().optional(),
  OIDC_JWKS_URL: z.url().optional(),
  ALLOW_DRAFT_CONFIG: bool.optional(),
  REQUIRE_APPROVED_CONFIG_FOR_ISSUE: bool.optional(),
  GST_RATE: z.coerce.number().min(0).max(1).default(0.1),
  EMAIL_FROM: z.email().default('reports@example.com'),
  PROPERTY_DATA_MODE: z.enum(['corelogic', 'sample', 'off']).optional(),
  CORELOGIC_CLIENT_ID: z.string().trim().min(1).optional(),
  CORELOGIC_CLIENT_SECRET: z.string().trim().min(1).optional(),
  CORELOGIC_BASE_URL: z.url().default('https://api.corelogic.asia'),
  CORELOGIC_TOKEN_URL: z.url().optional(),
  CORELOGIC_TOKEN_AUTH: z.enum(['body', 'basic', 'query']).default('body'),
  /** JSON object overriding endpoint paths, e.g. {"avm":"/avm/au/…"}. */
  CORELOGIC_PATHS: z.string().optional(),
});

export interface AppConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly databaseSsl: boolean;
  readonly auth:
    | { readonly mode: 'dev' }
    | {
        readonly mode: 'oidc';
        readonly issuer: string;
        readonly audience: string;
        readonly jwksUrl: string;
      };
  /** Non-production only: jobs may use draft rule sets and templates. */
  readonly allowDraftConfig: boolean;
  /** Issue requires approved rule set and template versions (always true in production). */
  readonly requireApprovedConfigForIssue: boolean;
  readonly gstRate: number;
  readonly emailFrom: string;
  /**
   * Licensed property data. `corelogic` only when both API keys are supplied; otherwise `sample`
   * (made-up data, development and test only) or `off`. Keys come from the secret store.
   */
  readonly propertyData: {
    readonly mode: 'corelogic' | 'sample' | 'off';
    readonly keysSupplied: boolean;
    readonly corelogic: {
      readonly clientId?: string;
      readonly clientSecret?: string;
      readonly baseUrl: string;
      readonly tokenUrl: string;
      readonly tokenAuth: 'body' | 'basic' | 'query';
      readonly paths: Readonly<Partial<Record<CoreLogicEndpoint, string>>>;
    };
  };
}

/** Overrides for the CoreLogic endpoint paths (unknown endpoint names are refused). */
const CoreLogicPathsSchema = z.partialRecord(
  z.enum(Object.keys(CORELOGIC_DEFAULT_PATHS) as [CoreLogicEndpoint, ...CoreLogicEndpoint[]]),
  z.string().regex(/^(\/.*)?$/),
);

/**
 * Loads environment-specific configuration. Secrets (database credentials, IdP settings) come
 * from the environment / secret manager only and are never logged. Production refuses unsafe
 * settings rather than silently degrading.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const e = EnvSchema.parse(env);
  const production = e.NODE_ENV === 'production';
  const authMode = e.AUTH_MODE ?? (production ? 'oidc' : 'dev');
  const problems: string[] = [];
  if (production && authMode !== 'oidc') problems.push('AUTH_MODE must be oidc in production');
  if (production && !e.DATABASE_URL?.startsWith('postgres'))
    problems.push('DATABASE_URL must be a PostgreSQL URL in production');
  if (production && e.ALLOW_DRAFT_CONFIG === true)
    problems.push('ALLOW_DRAFT_CONFIG cannot be enabled in production');
  if (production && e.REQUIRE_APPROVED_CONFIG_FOR_ISSUE === false)
    problems.push('approved configuration is always required for issue in production');
  if (authMode === 'oidc' && (!e.OIDC_ISSUER || !e.OIDC_AUDIENCE || !e.OIDC_JWKS_URL)) {
    problems.push('OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URL are required for oidc auth');
  }
  if (production && e.PROPERTY_DATA_MODE === 'sample')
    problems.push('PROPERTY_DATA_MODE=sample (made-up data) cannot be used in production');
  let corelogicPaths: Partial<Record<CoreLogicEndpoint, string>> = {};
  if (e.CORELOGIC_PATHS) {
    try {
      corelogicPaths = CoreLogicPathsSchema.parse(JSON.parse(e.CORELOGIC_PATHS));
    } catch {
      problems.push('CORELOGIC_PATHS must be a JSON object of endpoint paths starting with /');
    }
  }
  if (problems.length) throw new Error(`invalid configuration: ${problems.join('; ')}`);
  const keysSupplied = Boolean(e.CORELOGIC_CLIENT_ID && e.CORELOGIC_CLIENT_SECRET);
  const propertyDataMode =
    e.PROPERTY_DATA_MODE === 'corelogic' || e.PROPERTY_DATA_MODE === undefined
      ? keysSupplied
        ? 'corelogic'
        : e.PROPERTY_DATA_MODE === undefined && !production
          ? 'sample'
          : 'off'
      : e.PROPERTY_DATA_MODE;

  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL ?? 'pglite://memory',
    databaseSsl: e.DATABASE_SSL ?? production,
    auth:
      authMode === 'oidc'
        ? {
            mode: 'oidc',
            issuer: e.OIDC_ISSUER as string,
            audience: e.OIDC_AUDIENCE as string,
            jwksUrl: e.OIDC_JWKS_URL as string,
          }
        : { mode: 'dev' },
    allowDraftConfig: e.ALLOW_DRAFT_CONFIG ?? !production,
    requireApprovedConfigForIssue: production
      ? true
      : (e.REQUIRE_APPROVED_CONFIG_FOR_ISSUE ?? true),
    gstRate: e.GST_RATE,
    emailFrom: e.EMAIL_FROM,
    propertyData: {
      mode: propertyDataMode,
      keysSupplied,
      corelogic: {
        ...(e.CORELOGIC_CLIENT_ID ? { clientId: e.CORELOGIC_CLIENT_ID } : {}),
        ...(e.CORELOGIC_CLIENT_SECRET ? { clientSecret: e.CORELOGIC_CLIENT_SECRET } : {}),
        baseUrl: e.CORELOGIC_BASE_URL,
        tokenUrl:
          e.CORELOGIC_TOKEN_URL ?? `${e.CORELOGIC_BASE_URL.replace(/\/+$/, '')}/access/oauth/token`,
        tokenAuth: e.CORELOGIC_TOKEN_AUTH,
        paths: corelogicPaths,
      },
    },
  };
}
