import Fastify, { type FastifyInstance } from 'fastify';
import { devAuthenticator, oidcAuthenticator, type Authenticator } from './auth/auth.js';
import type { AppConfig } from './config.js';
import { systemClock, uuid, type AppContext, type Clock } from './context.js';
import type { Db } from './db/db.js';
import { AuthorizationDenied, toHttpError } from './http/errors.js';
import { recordDenial } from './repo/jobs.js';
import { Router } from './http/route.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerEvidenceRoutes } from './routes/evidence.js';
import { registerInspectionRoutes } from './routes/inspection.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerWorkflowRoutes } from './routes/workflow.js';
import { RecordingEmailTransport, type EmailTransport } from './services/email.js';

export interface BuildOptions {
  readonly config: AppConfig;
  readonly db: Db;
  readonly clock?: Clock;
  readonly newId?: () => string;
  readonly email?: EmailTransport;
  readonly auth?: Authenticator;
  readonly logger?: boolean;
}

export async function buildApp(
  opts: BuildOptions,
): Promise<{ app: FastifyInstance; ctx: AppContext; router: Router }> {
  const { config, db } = opts;
  const app = Fastify({
    logger: opts.logger
      ? {
          level: config.logLevel,
          // Never log credentials or personal information carried in headers.
          redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-user-id"]'],
        }
      : false,
    bodyLimit: 5 * 1024 * 1024,
    genReqId: () => uuid(),
  });
  const auth =
    opts.auth ??
    (config.auth.mode === 'oidc'
      ? oidcAuthenticator(db, {
          issuer: config.auth.issuer,
          audience: config.auth.audience,
          jwks: config.auth.jwksUrl,
        })
      : devAuthenticator(db));
  const ctx: AppContext = {
    config,
    db,
    auth,
    clock: opts.clock ?? systemClock,
    newId: opts.newId ?? uuid,
    email: opts.email ?? new RecordingEmailTransport(),
  };

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof AuthorizationDenied) {
      // The request's transaction has rolled back; record the denial in its own transaction.
      await recordDenial(ctx, err).catch((e: unknown) => {
        req.log.error({ err: e }, 'failed to record authorisation denial');
      });
    }
    const { status, body } = toHttpError(err);
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.status(status).send(body);
  });
  app.addHook('onSend', (_req, reply, payload, done) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('cache-control', 'no-store');
    done(null, payload);
  });

  const router = new Router(app, ctx);
  router.addPublic({
    method: 'GET',
    url: '/health',
    summary: 'Liveness and database readiness',
    tags: ['ops'],
    handler: async () => {
      await db.query('SELECT 1');
      return { status: 'ok' };
    },
  });
  registerJobRoutes(router);
  registerEvidenceRoutes(router);
  registerInspectionRoutes(router);
  registerWorkflowRoutes(router);
  registerReportRoutes(router);
  registerAdminRoutes(router);
  registerSyncRoutes(router);
  router.addPublic({
    method: 'GET',
    url: '/v1/openapi.json',
    summary: 'OpenAPI contract generated from route definitions',
    tags: ['ops'],
    handler: () => Promise.resolve(router.openApi()),
  });
  await app.ready();
  return { app, ctx, router };
}
