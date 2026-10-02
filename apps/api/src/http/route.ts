import type { Principal } from '@vp/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import type { AppContext } from '../context.js';

export interface HandlerArgs<P, B, Q> {
  readonly req: FastifyRequest;
  readonly reply: FastifyReply;
  readonly principal: Principal;
  readonly params: P;
  readonly body: B;
  readonly query: Q;
  readonly ctx: AppContext;
}

export interface RouteDef<P, B, Q> {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly summary: string;
  readonly tags: readonly string[];
  /** Domain permission checked by the handler (documented in the OpenAPI contract). */
  readonly permission?: string;
  readonly params?: ZodType<P>;
  readonly body?: ZodType<B>;
  readonly query?: ZodType<Q>;
  readonly responseDescription?: string;
  readonly produces?: 'application/json' | 'application/pdf';
  handler(args: HandlerArgs<P, B, Q>): Promise<unknown>;
}

export interface PublicRouteDef {
  readonly method: 'GET';
  readonly url: string;
  readonly summary: string;
  readonly tags: readonly string[];
  handler(args: { req: FastifyRequest; reply: FastifyReply; ctx: AppContext }): Promise<unknown>;
}

interface RegisteredRoute {
  readonly method: string;
  readonly url: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly permission?: string;
  readonly params?: ZodType;
  readonly body?: ZodType;
  readonly query?: ZodType;
  readonly produces: string;
  readonly authenticated: boolean;
}

const header = (req: FastifyRequest, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Registers routes on Fastify and records them for the generated OpenAPI contract. */
export class Router {
  readonly routes: RegisteredRoute[] = [];

  constructor(
    private readonly app: FastifyInstance,
    private readonly ctx: AppContext,
  ) {}

  add<P = Record<string, never>, B = undefined, Q = Record<string, never>>(
    def: RouteDef<P, B, Q>,
  ): void {
    this.routes.push({
      method: def.method,
      url: def.url,
      summary: def.summary,
      tags: def.tags,
      ...(def.permission ? { permission: def.permission } : {}),
      ...(def.params ? { params: def.params } : {}),
      ...(def.body ? { body: def.body } : {}),
      ...(def.query ? { query: def.query } : {}),
      produces: def.produces ?? 'application/json',
      authenticated: true,
    });
    this.app.route({
      method: def.method,
      url: def.url,
      handler: async (req, reply) => {
        const principal = await this.ctx.auth.authenticate({
          authorization: header(req, 'authorization'),
          devUserId: header(req, 'x-user-id'),
          devMfa: header(req, 'x-mfa'),
          devActorKind: header(req, 'x-actor-kind'),
        });
        const params = (def.params ? def.params.parse(req.params) : {}) as P;
        const body = (def.body ? def.body.parse(req.body ?? {}) : undefined) as B;
        const query = (def.query ? def.query.parse(req.query) : {}) as Q;
        const result = await def.handler({
          req,
          reply,
          principal,
          params,
          body,
          query,
          ctx: this.ctx,
        });
        if (reply.sent) return reply;
        return result;
      },
    });
  }

  addPublic(def: PublicRouteDef): void {
    this.routes.push({
      method: def.method,
      url: def.url,
      summary: def.summary,
      tags: def.tags,
      produces: 'application/json',
      authenticated: false,
    });
    this.app.route({
      method: def.method,
      url: def.url,
      handler: (req, reply) => def.handler({ req, reply, ctx: this.ctx }),
    });
  }

  /** OpenAPI 3.1 document generated from the registered routes and their zod schemas. */
  openApi(): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const r of this.routes) {
      const path = r.url.replace(/:([A-Za-z]+)/g, '{$1}');
      const parameters: unknown[] = [];
      const addParams = (schema: ZodType | undefined, where: 'path' | 'query') => {
        if (!schema) return;
        const json = z.toJSONSchema(schema, { io: 'input' }) as {
          properties?: Record<string, unknown>;
          required?: string[];
        };
        for (const [name, s] of Object.entries(json.properties ?? {})) {
          parameters.push({
            name,
            in: where,
            required: where === 'path' || (json.required ?? []).includes(name),
            schema: s,
          });
        }
      };
      addParams(r.params, 'path');
      addParams(r.query, 'query');
      const op: Record<string, unknown> = {
        summary: r.summary,
        tags: r.tags,
        ...(r.permission ? { 'x-permission': r.permission } : {}),
        ...(parameters.length ? { parameters } : {}),
        ...(r.body
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: z.toJSONSchema(r.body, { io: 'input', unrepresentable: 'any' }),
                  },
                },
              },
            }
          : {}),
        responses: {
          '200': { description: 'Success', content: { [r.produces]: {} } },
          ...(r.authenticated
            ? {
                '401': { $ref: '#/components/responses/Error' },
                '403': { $ref: '#/components/responses/Error' },
              }
            : {}),
          '400': { $ref: '#/components/responses/Error' },
          '404': { $ref: '#/components/responses/Error' },
          '409': { $ref: '#/components/responses/Error' },
          '422': { $ref: '#/components/responses/Error' },
        },
        ...(r.authenticated ? { security: [{ bearer: [] }] } : { security: [] }),
      };
      paths[path] = { ...(paths[path] ?? {}), [r.method.toLowerCase()]: op };
    }
    return {
      openapi: '3.1.0',
      info: {
        title: 'Valuation Platform API',
        version: '0.1.0',
        description: 'Generated from route definitions. Permissions are listed in x-permission.',
      },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        responses: {
          Error: {
            description: 'Error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  properties: {
                    error: {
                      type: 'object',
                      required: ['code', 'message'],
                      properties: {
                        code: { type: 'string' },
                        message: { type: 'string' },
                        details: {},
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      paths,
    };
  }
}
