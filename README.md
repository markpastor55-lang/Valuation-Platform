# Valuation Platform

Inspection, valuation-workflow and report-issue platform for qualified Australian property
professionals: single-property and portfolio jobs, configurable requirements per report purpose,
property type, inspection scope and jurisdiction, evidence capture with provenance, a 2D sketch and
m² measurement workspace, validation, certification, independent QA, deterministic PDF issue,
invoicing and a tamper-evident audit trail.

> **Guardrails.** The software does not claim compliance with API Rules, IVS, AASB 13, court rules or
> tax requirements. Templates, clauses and rule sets are versioned configuration that a nominated
> standards owner and specialist reviewers approve. Only a human valuer can certify a valuation; AI
> may suggest, never decide; nothing issues without validation, certification and independent QA.

## Status — iteration 1

| Area                                                                                                                            | State                                                 |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Specification (sections 00–14, generated tables)                                                                                | Draft for review — [`docs/spec`](docs/spec/README.md) |
| `@vp/domain` — rules, calculations, geometry, workflow, permissions, audit, validation, AI governance, sync, report composition | Implemented, 200+ unit tests                          |
| `@vp/api` — Fastify service, PostgreSQL schema, auth, workflow endpoints, deterministic PDF/invoice issue, offline sync         | Implemented, end-to-end tests on embedded PostgreSQL  |
| `@vp/preview` — clickable browser preview running `@vp/domain` on synthetic data (no server)                                    | Implemented, journey tests                            |
| Market commentary library — national, state and local, by property type and suburb (D17)                                        | Implemented; demonstration text only                  |
| Mobile app (iOS/Android, offline capture, sketch canvas)                                                                        | Planned — next iteration                              |
| Web portal (allocation, QA, administration)                                                                                     | Planned                                               |
| Live data integrations, e-signature, object storage, AI models                                                                  | Planned (interfaces and policies in place)            |

See [`docs/spec/13-backlog.md`](docs/spec/13-backlog.md) for the release plan,
[`docs/spec/01-assumptions-and-decisions.md`](docs/spec/01-assumptions-and-decisions.md) for the
decisions that need an owner, and [`docs/go-live-checklist.md`](docs/go-live-checklist.md) for
what's needed to run it for real.

## Repository layout

```
docs/brief/            source brief (as supplied)
docs/spec/             specification 00–14 and generated/ tables (from code)
packages/domain/       @vp/domain — pure TypeScript domain engine shared by API, mobile and web
apps/api/              @vp/api — Fastify API, SQL migrations, PDF renderer, tests
apps/api/scripts/      documentation generator
apps/preview/          @vp/preview — single-page browser preview of the app (Preact + @vp/domain)
```

## Getting started

Requirements: Node.js ≥ 22.13 and pnpm 10.

```sh
pnpm install
pnpm check            # format, lint, typecheck, tests, generated-docs check
pnpm --filter @vp/api dev
```

`pnpm --filter @vp/api dev` starts the API on `http://127.0.0.1:3000` with an in-memory embedded
PostgreSQL (PGlite) and a demo organisation (users for every role, a client, portfolios and data
sources). In development, requests authenticate with headers:

```sh
curl -s localhost:3000/v1/reference/selection \
  -H 'x-user-id: 00000000-0000-4000-8000-000000000104' -H 'x-mfa: true'
```

`pnpm --filter @vp/preview build` writes `apps/preview/dist/index.html`, a self-contained page that
runs the domain engine in the browser with synthetic data. You work as the valuer through the input
tabs (Job, Property, Inspection, Sales & market, Valuation, Review): change the selection and watch
the requirements change, see a retrospective valuation detected from the dates, use the firm's market commentary for the
property type and suburb, keep a sketch as working notes and use its total as the building area, clear validation findings, then sign and send
to QA. A QA tab appears once the job is sent; review as QA, then issue. Nothing is sent to a server;
state stays in the browser.

The OpenAPI contract is served at `/v1/openapi.json` and committed at
[`docs/spec/generated/openapi.json`](docs/spec/generated/openapi.json). Demo user ids are listed in
`apps/api/src/db/seed.ts`.
The demo valuers have signing profiles (`GET /v1/me/profile`): placeholder API member numbers, a
typed signature and, for `valuer@example.com`, placeholder QLD and WA registration numbers, so demo
jobs can be signed in any state. The demo organisation also has an approved demonstration market
commentary library (placeholder text, `GET /v1/commentary-library`), which a firm replaces with its
own before live use.

### Configuration

| Variable                                         | Default                                                                                             | Notes                                                                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                       | `development`                                                                                       | `production` refuses dev auth, embedded databases and draft configuration                                                                                          |
| `DATABASE_URL`                                   | `pglite://memory`                                                                                   | `postgres://…` in deployed environments; `pglite:///path` for a local file                                                                                         |
| `DATABASE_SSL`                                   | `true` in production                                                                                |                                                                                                                                                                    |
| `AUTH_MODE`                                      | `dev` (non-production), `oidc` (production)                                                         |                                                                                                                                                                    |
| `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`  | —                                                                                                   | Required for `oidc`; MFA is read from the `amr` claim                                                                                                              |
| `ALLOW_DRAFT_CONFIG`                             | `true` outside production                                                                           | Lets jobs use draft rule sets/templates; issue still requires approved ones                                                                                        |
| `GST_RATE`                                       | `0.1`                                                                                               |                                                                                                                                                                    |
| `EMAIL_FROM`                                     | `reports@example.com`                                                                               | Email transport is a recording stub until a provider adapter is configured                                                                                         |
| `PROPERTY_DATA_MODE`                             | `corelogic` if both CoreLogic keys are set; else `sample` (development, test) or `off` (production) | `corelogic`, `sample` (made-up data, refused in production) or `off`                                                                                               |
| `CORELOGIC_CLIENT_ID`, `CORELOGIC_CLIENT_SECRET` | — (**not supplied yet**)                                                                            | CoreLogic (Cotality) API keys. Put them in the server's secret store, never in the repository or an env file                                                       |
| `CORELOGIC_BASE_URL`                             | `https://api.corelogic.asia`                                                                        |                                                                                                                                                                    |
| `CORELOGIC_TOKEN_URL`                            | `<base>/access/oauth/token`                                                                         | OAuth 2.0 client-credentials token endpoint                                                                                                                        |
| `CORELOGIC_TOKEN_AUTH`                           | `body`                                                                                              | How the keys are sent to the token endpoint: `body`, `basic` or `query`                                                                                            |
| `CORELOGIC_PATHS`                                | —                                                                                                   | JSON overrides for endpoint paths, e.g. `{"avm":"/avm/au/…"}` (defaults in `apps/api/src/integrations/corelogic.ts`; verify them on the Cotality developer portal) |

Secrets come from the environment or a secret manager; nothing secret is committed or logged.

Property data: the CoreLogic (Cotality) connector is built but **no API keys have been supplied**,
so it is not configured. Development and tests use clearly labelled sample data that can never be
relied on in an issued report; production has property data off until the keys are added to the
secret store and the licence is confirmed (`docs/spec/04-planning-data-adapters.md` §4.1–4.3,
decision D15). `GET /v1/integrations/status` shows which mode a server is in.

### Database

```sh
DATABASE_URL=postgres://… pnpm --filter @vp/api migrate
```

Migrations are numbered SQL files in `apps/api/migrations`, applied in order with checksum drift
detection. Never edit an applied migration; add a new one.

## Development workflow

| Command                                        | Purpose                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm test`                                    | All tests (domain unit tests; API tests run against embedded PostgreSQL)             |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Static checks                                                                        |
| `pnpm docs:generate`                           | Regenerate `docs/spec/generated/*` and the permission matrix in section 02 from code |
| `pnpm docs:check`                              | Fail if generated docs are stale (runs in CI)                                        |
| `pnpm build`                                   | Compile both packages                                                                |

Conventions: identifiers, codes and audit actions are defined in
[`docs/spec/00-architecture-and-conventions.md`](docs/spec/00-architecture-and-conventions.md).
Rules, formulas, templates and clauses are versioned — add a new version rather than editing one that
may have been used in an issued report.
