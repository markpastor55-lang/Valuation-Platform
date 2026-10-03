# 07 — API contracts

> Status: **Draft for review** · Owner: Product architecture (with `SECURITY` reviewer for authentication, authorisation and integrations) · Applies to: `apps/api` (`@vp/api`), the mobile and web clients, and integration service accounts

This section explains the semantics of the HTTP API: authentication, authorisation, errors,
concurrency, idempotency and offline sync, plus a resource catalogue for the key flows. The exact
contract is generated from the route definitions and must not be edited by hand:
`GET /v1/openapi.json` at runtime, and the committed copies `generated/openapi.json` and
`generated/api-endpoints.md` (CI fails if they are stale). Vocabulary follows
`00-architecture-and-conventions.md`; the data model is in `06-data-model-and-audit.md`. Anything
not in code is marked **Planned**.

## 1. Principles

| #   | Principle                                      | Implementation                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | REST over HTTPS, JSON in and out               | Fastify; TLS terminated at the edge (11 TB-1). PDFs are returned as `application/pdf`                                                                                                                                                                                |
| P2  | Versioned base path                            | Every business route is under `/v1`. Additive changes stay in `v1`; breaking changes need `/v2`. A deprecation policy is **Planned**                                                                                                                                 |
| P3  | Contract generated from code                   | `Router` (`http/route.ts`) records each route's method, path, summary, tags, zod schemas, permission and allowed actor kinds and emits OpenAPI 3.1 (`z.toJSONSchema`, input shapes)                                                                                  |
| P4  | Input validation                               | Path, query and body are parsed with zod before the handler runs; failures return `400 BAD_REQUEST` with per-path details                                                                                                                                            |
| P5  | Every route declares its permission and actors | `permission` is published as `x-permission`; the handler enforces it through the domain `authorize()` (§2.3). `actors` (default `['human']`) is published as `x-actors`; the router refuses any other actor kind before the handler runs (`403 ACTOR_NOT_PERMITTED`) |
| P6  | Domain decides                                 | Handlers call `@vp/domain` for permissions, requirements, validation, calculations, geometry and workflow guards; the API persists and audits                                                                                                                        |
| P7  | One transaction per mutation                   | Each mutating handler runs in one database transaction with its audit events (06 §5.2)                                                                                                                                                                               |
| P8  | Successes return `200`                         | Creates also return `200` with the created representation; `201`/`204` are not used                                                                                                                                                                                  |

Endpoints that are not under `/v1`: `GET /health` (public liveness and database readiness).
`GET /v1/openapi.json` is public. `GET /v1/reference/selection` and `GET /v1/reference/fields`
require authentication but no permission; the generated endpoint table labels them
"authenticated" and appends "— ai actors only" / "— system actors only" to the two routes that
are not for people.

## 2. Authentication and authorisation

### 2.1 Modes

| Mode   | When                                                                        | Credentials                                                     | Notes                                                                                                                              |
| ------ | --------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `oidc` | Required in production; selected by `AUTH_MODE=oidc`                        | `Authorization: Bearer <JWT>`                                   | Verified with `jose` against `OIDC_JWKS_URL`, issuer `OIDC_ISSUER`, audience `OIDC_AUDIENCE`, algorithms `RS256`, `ES256`, `PS256` |
| `dev`  | Default when `NODE_ENV` is `development` or `test` and `AUTH_MODE` is unset | `x-user-id` (UUID), `x-mfa: true`, `x-actor-kind: system \| ai` | Trusts headers. `loadConfig()` refuses to start in production unless `AUTH_MODE=oidc` and all three OIDC settings are present      |

### 2.2 Token claims and principal

| Claim / source                                 | Use                                                                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sub`                                          | Looked up as `app_user.idp_subject`; unknown subject → `401 UNAUTHENTICATED`                                                                          |
| `iss`, `aud`, `exp`                            | Verified; failure → `401 UNAUTHENTICATED` ("invalid or expired token")                                                                                |
| `amr`                                          | Contains `mfa`, `otp` or `hwk` → `mfaVerified = true`                                                                                                 |
| `actor_kind`                                   | `system` or `ai` → service-account actor; anything else → `human`. Service accounts can call only the routes whose `actors` include their kind (§2.3) |
| `app_user.status`                              | Must be `active`; otherwise `403 ACCOUNT_SUSPENDED`                                                                                                   |
| `app_user.org_id`                              | The tenant. Never taken from the request body                                                                                                         |
| `user_role`, `portfolio_member`, `client_user` | Roles, portfolio memberships and client scopes of the `Principal`                                                                                     |

Gaps `[REVIEW: SECURITY]`: step-up freshness (`auth_time` within 10 minutes for MFA actions, 11
SC-02) is not checked; there is no device binding or token revocation list; trust in `actor_kind`
depends on the IdP issuing it only to service clients.

### 2.3 Authorisation pipeline

**Actor guard (router).** After authentication and before the handler runs, `Router` checks the
principal's actor kind against the route's `actors` (default `['human']`, published as `x-actors`).
Only `POST /v1/jobs/{jobId}/ai-suggestions` admits `ai` (and only `ai`), and only
`POST /v1/email-deliveries/{id}/status` admits `system` (and only `system`). Any other combination
returns `403 ACTOR_NOT_PERMITTED` and is recorded as `auth.denied` (entity type `route`, entity id
`<METHOD> <path>`). Service and AI accounts therefore cannot reach any other route, whatever roles
they hold.

`authorize(principal, permission, resource)` (`packages/domain/src/auth/permissions.ts`) then
evaluates, in order:

| Step                                                                                                                                                                                                                         | Denial code                    | HTTP result                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------- |
| Resource in another organisation                                                                                                                                                                                             | `WRONG_ORGANISATION`           | `404 NOT_FOUND` (existence hidden)    |
| No role grants the permission                                                                                                                                                                                                | `NO_ROLE_GRANT`                | `403`                                 |
| Human-only permission and actor is `system`/`ai`                                                                                                                                                                             | `HUMAN_REQUIRED`               | `403`                                 |
| MFA permission without MFA                                                                                                                                                                                                   | `MFA_REQUIRED`                 | `403`                                 |
| Restricted portfolio and not a member                                                                                                                                                                                        | `RESTRICTED_PORTFOLIO`         | `404 NOT_FOUND` (information barrier) |
| For each granting role: scope — org-wide roles pass; others need assignment (valuer, reviewer, inspector) or portfolio membership; `CLIENT_READONLY` needs own client and an issued report                                   | `NOT_ASSIGNED`, `CLIENT_SCOPE` | `403`                                 |
| Separation of duties (00 §5): certification only by responsible valuer; QA not by responsible valuer without an exception; exception not by responsible valuer; config approval not by author; `VALUER` issues only own jobs | `SEPARATION_OF_DUTIES`         | `403`                                 |

Every denial (`AuthorizationDenied`) is recorded as `auth.denied` in the `org:<orgId>` stream of
the caller's organisation, in its own transaction after the request rolls back, with the permission
and code. The two `404` outcomes are recorded too: the response stays `404 NOT_FOUND`, but the event
carries the real code (`WRONG_ORGANISATION` or `RESTRICTED_PORTFOLIO`), so attempts to reach other
tenants or restricted portfolios leave a security event. A same-organisation user who is not
assigned receives `403 NOT_ASSIGNED`, so job existence is visible inside an organisation. List
endpoints (`GET /v1/jobs`, `GET /v1/map/assets`) filter silently and record nothing.

Handlers that check a second permission through `authorize()`:

| Route                                   | Additional check                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /v1/jobs/{jobId}/fields`           | `job.update` if any value is job level, otherwise `asset.edit`; **plus `valuation.edit`** (VALUER only, human only) when any field belongs to a section in `VALUER_JUDGEMENT_SECTIONS` (`packages/domain/src/config/fields.ts`: `market`, `hbu`, `sales_evidence`, `rental_evidence`, `valuation_approach`, `income_approach`, `cost_approach`, `rental_determination`, `insurance`, `fair_value`, `reconciliation`, `portfolio_summary`, `risk`, `specialised`) |
| `POST /v1/jobs/{jobId}/risk-flags`      | `inspection.capture`; **plus `validation.acknowledge`** (VALUER) when `status` is not `open` (accepting or resolving a risk)                                                                                                                                                                                                                                                                                                                                     |
| `POST /v1/reports/{reportId}/reproduce` | Report access (`report.read_issued` or `job.read`), then `job.read` on the report's job, so client users cannot run it                                                                                                                                                                                                                                                                                                                                           |

Route-level checks outside `authorize()`. Since iteration 1 the 403s are raised with `denied()` and
recorded as `auth.denied` like any other denial:

| Code                     | Status | Route                                                                                                                                                  |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACTOR_NOT_PERMITTED`    | 403    | Every route: actor kind not in the route's `actors` (router guard above)                                                                               |
| `AI_SERVICE_ONLY`        | 403    | `POST /v1/jobs/{jobId}/ai-suggestions` re-checks actor kind `ai` (defence in depth; the router guard answers first)                                    |
| `SYSTEM_ONLY`            | 403    | `POST /v1/email-deliveries/{id}/status` re-checks actor kind `system` (defence in depth), then `authorize(email.send)`                                 |
| `HUMAN_REQUIRED`         | 403    | `POST …/sketch-versions/{versionId}/confirm-scale` (defence in depth; human-only by the router default)                                                |
| `NOT_REVIEWER`           | 403    | QA checklist, raising findings and `POST …/qa/return`: only the reviewer conducting the review. Closing a finding checks only `qa.review`              |
| `NOT_RESPONSIBLE_VALUER` | 403    | `POST …/qa/findings/{findingId}/respond`: only the job's responsible valuer (and only while the job is `returned`, otherwise `409 INVALID_TRANSITION`) |
| `ADMIN_ONLY`             | 403    | `GET /v1/admin/security-events`                                                                                                                        |
| `SEPARATION_OF_DUTIES`   | 403    | `POST /v1/jobs` and `POST /v1/jobs/{jobId}/assign` with valuer = reviewer (was 422 before iteration 1)                                                 |

Permissions granted to roles but not yet checked by any route: `org.manage`, `user.manage`,
`datasource.manage`, `ruleset.edit`, `photo.view_unredacted`, `invoice.manage`,
`retention.manage` (their endpoints are **Planned**). `x-permission` is free text on six routes
(`job.update | asset.edit`, `report.read_issued | job.read`, `asset.edit / photo.capture`,
`inspection.capture (AI service accounts only)`, `email.send (system)`), and the conditional
`valuation.edit` and `validation.acknowledge` checks above do not appear in it. Actor kinds are
structured (`x-actors`); a structured `x-permissions` array is still recommended.

## 3. Error model

### 3.1 Envelope

```json
{
  "error": {
    "code": "GUARD_FAILED",
    "message": "cannot acceptEngagement: …",
    "details": { "failures": ["…"] }
  }
}
```

`code` is stable and machine-readable; `message` is for people; `details` is optional and
code-specific. Bodies never contain stack traces or SQL (`toHttpError` in `http/errors.ts`).

### 3.2 Status mapping

| Source                                                                                                                                                                                | Status                              | `code`                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ZodError` (path, query, body)                                                                                                                                                        | 400                                 | `BAD_REQUEST`, `details: [{ path, message }]`                                                                                                                 |
| Fastify client errors (invalid JSON, body over limit, unsupported media type)                                                                                                         | Fastify status (e.g. 400, 413, 415) | `BAD_REQUEST`                                                                                                                                                 |
| Missing/invalid credentials                                                                                                                                                           | 401                                 | `UNAUTHENTICATED`                                                                                                                                             |
| `DomainError` `FORBIDDEN`, `SEPARATION_OF_DUTIES`, `HUMAN_ACTOR_REQUIRED`, `MFA_REQUIRED`                                                                                             | 403                                 | same as domain code                                                                                                                                           |
| `AuthorizationDenied` (from `authorize()`, the router actor guard or a route-level check)                                                                                             | 403                                 | denial code (§2.3)                                                                                                                                            |
| `DomainError` `NOT_FOUND`; hidden cross-tenant or barrier resources (an `AuthorizationDenied` with status 404, still recorded as `auth.denied`)                                       | 404                                 | `NOT_FOUND`                                                                                                                                                   |
| `DomainError` `INVALID_TRANSITION`, `GUARD_FAILED`, `RECORD_LOCKED`, `IMMUTABLE_RECORD`, `TEMPLATE_NOT_APPROVED`, `CONFLICT`                                                          | 409                                 | same                                                                                                                                                          |
| PostgreSQL `P0001` (immutability or legal-hold trigger, 06 §7)                                                                                                                        | 409                                 | `IMMUTABLE_RECORD` with the generic message "the record is immutable or under legal hold" (the trigger message, which names internal tables, is not returned) |
| PostgreSQL `23505` unique violation                                                                                                                                                   | 409                                 | `CONFLICT` ("duplicate record")                                                                                                                               |
| PostgreSQL `23503` foreign-key violation                                                                                                                                              | 422                                 | `INVALID_REFERENCE`                                                                                                                                           |
| `DomainError` `INVALID_ARGUMENT`, `INVALID_DATE`, `INVALID_UNIT`, `UNKNOWN_FORMULA`, `OVERRIDE_REASON_REQUIRED`, `CALIBRATION_INVALID`, `GEOMETRY_INVALID`, `AI_INFERENCE_PROHIBITED` | 422                                 | same                                                                                                                                                          |
| Anything else                                                                                                                                                                         | 500                                 | `INTERNAL` (logged with the request id)                                                                                                                       |

### 3.3 Route-specific codes

| Status | Codes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 403    | `ACCOUNT_SUSPENDED`, `ACTOR_NOT_PERMITTED`, `AI_SERVICE_ONLY`, `SYSTEM_ONLY`, `HUMAN_REQUIRED`, `NOT_REVIEWER`, `NOT_RESPONSIBLE_VALUER`, `ADMIN_ONLY`, `SEPARATION_OF_DUTIES` (create, assign)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 409    | `NO_RULE_SET`, `NO_TEMPLATE`, `NO_QA_REVIEW`, `STALE_VERSION`, `SNAPSHOT_MISMATCH` (QA start), `REPORT_NOT_ISSUABLE` (`details.problems`), `IMMUTABLE_RECORD` (configuration already approved or retired), `INVALID_TRANSITION` (responding to a finding while the job is not `returned`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 422    | `SINGLE_ASSET_MODE`, `UNKNOWN_CLIENT`, `UNKNOWN_USER`, `ROLE_REQUIRED`, `UNKNOWN_FIELD`, `ASSET_REQUIRED`, `JOB_LEVEL_FIELD`, `INVALID_FIELD_VALUE`, `SYSTEM_FIELD` (a field marked `entry: 'system'` sent to `PUT /fields`), `UNKNOWN_ASSET`, `RESOLUTION_NOTE_REQUIRED`, `UNKNOWN_CONVENTION`, `SKETCH_ASSET_MISMATCH`, `SOURCE_PLAN_REQUIRED`, `UNKNOWN_SOURCE_PLAN`, `INVALID_COMPONENT_TYPE`, `SKETCH_INCOMPLETE`, `NO_CALIBRATION`, `CERTIFICATION_MISMATCH`, `FEE_REQUIRED`, `UNAPPROVED_RECIPIENTS` (`details.unapproved`), `INVALID_TEMPLATE` / `INVALID_RULE_SET` (`details.problems`), `WRONG_JOB`, `ASSET_INCOMPLETE`, `PHOTO_INCOMPLETE`, `UNKNOWN_PHOTO`, `UNKNOWN_RISK_FLAG`, `INVALID_REDACTION`, `SUPPLIER_ABN_REQUIRED`, `INVALID_PROFILE` (`PUT /v1/me/profile`, `details.problems`), `PROFILE_INCOMPLETE` (certification: the signer's profile cannot sign for this job's state, `details.problems`) |
| 409    | `DATA_SOURCE_NOT_REGISTERED` (property data: the provider's data source is not registered and active for the organisation; `details.sourceId`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 422    | `NO_PROPERTY_MATCH` (property data: no provider property matched the asset's address, or the given `propertyId` is unknown), `SUBJECT_LOCATION_REQUIRED` (comparable search: no coordinates for the asset or the matched property)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 502    | `PROPERTY_DATA_UNAVAILABLE` (the provider failed after the connector policy; `details.failure` ∈ timeout, circuit_open, rate_limited, failed; `details.attempts`; `details.fallback: manual_entry`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 503    | `PROPERTY_DATA_NOT_CONFIGURED` (property data is off; the message gives the reason, e.g. "CoreLogic API keys not supplied"; `details.status`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Workflow transitions (`transitionJob`) fail with `409 INVALID_TRANSITION` when the job is in the
wrong state and `409 GUARD_FAILED` when a guard fails; both carry every failed guard in
`details.failures`. `GET /v1/jobs/{jobId}` returns the same evaluation for every action under
`transitions` so clients can explain disabled buttons without calling the action. Inconsistency
to resolve: `HUMAN_REQUIRED` and `HUMAN_ACTOR_REQUIRED` name the same rule. (`SEPARATION_OF_DUTIES`
from create and assign is 403 like everywhere else since iteration 1.)

## 4. Concurrency and idempotency

### 4.1 Transactions and locks

| Mechanism                          | Where                                                                                    | Effect                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Job row lock `SELECT … FOR UPDATE` | Every job-scoped mutation (`authorizeJob(…, { forUpdate: true })`)                       | Writes to one job serialise; guards see a consistent aggregate |
| Row locks on children              | `field_value`, `ai_suggestion`, `email_delivery`, `template_version`, `rule_set_version` | Serialise concurrent edits of the same record                  |
| Status lock                        | `assertEditable()` → `409 RECORD_LOCKED` outside `draft`, `active`, `returned`           | Submitted, reviewed, approved and issued content cannot change |
| Content hash preconditions         | Certification, QA start, approval and issue (06 §6.2)                                    | Any content change after certification invalidates it          |
| Latest-version check               | Sketch confirm-scale and approve → `409 STALE_VERSION`                                   | No approval of a superseded version                            |
| `job.version`                      | Incremented by `touchJob()` after content changes; returned by `GET /v1/jobs/{jobId}`    | Informational. `If-Match`/`ETag` preconditions are **Planned** |
| Per-stream advisory lock           | Audit append                                                                             | Chains never fork                                              |

Invoice numbers come from the per-organisation, per-year `invoice_counter` row, incremented
atomically inside the issue transaction (`INSERT … ON CONFLICT (org_id, year) DO UPDATE …
RETURNING`, migration 0003), so concurrent issues get distinct numbers (fixed in iteration 1; it
was `count + 1`). Known race: emails are sent after the issue transaction commits; a crash leaves
deliveries `queued` and there is no retry worker yet (outbox **Planned**).

### 4.2 Idempotency

| Operation                                          | Behaviour on retry                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Creates with client UUIDs (assets, sales, rentals) | Same id again → `409 CONFLICT` (record already exists)                                               |
| `POST …/photos`                                    | Same `(assetId, sha256)` → `200 { id: <existing>, deduplicated: true }`, no audit event              |
| `POST …/risk-flags` with `id`                      | Upsert by id                                                                                         |
| `PUT …/fields`                                     | Unchanged values are no-ops (no history row, no audit event); response `changed` counts real changes |
| `POST …/acknowledgements`                          | Upsert on `(job, code, path)`                                                                        |
| Workflow transitions and issue                     | Not idempotent; a retry after success fails the state guard (`409 INVALID_TRANSITION`)               |
| `POST /v1/sync`                                    | Idempotent per `(organisation, deviceId, opId)` (§4.3)                                               |

An `Idempotency-Key` header for non-sync POSTs is **Planned**.

### 4.3 Offline sync (`POST /v1/sync`)

Request: `{ deviceId (3–100), operations[1..500] }`; each operation has `opId` (8–100 chars),
`jobId`, `entityType` (`asset` | `photo`), `entityId` (client UUID), `kind`
(`create` | `update` | `delete`), `baseVersion` (`null` for creates), `changes` (JSON object),
`clientTimestamp` (UTC instant), optional `contentHash` (SHA-256 hex) and `parentId` (asset id for
photos). `changes` keys are allow-listed; any other key returns `422 UNKNOWN_FIELD`:

| Entity  | Keys a device may sync                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `asset` | `label`, `address`, `latitude`, `longitude`                                                                              |
| `photo` | `caption`, `roomOrArea`, `sequence`, `capturedAt`, `gps`, `quality`, `qualityOverrideReason`, `includeInReport`, `dHash` |

Privacy status, privacy flags, redaction and consent references change only through
`POST …/photos/{photoId}/privacy`, never through sync; a photo created by sync starts `clear` with
no flags.

Each operation runs in its own transaction, in order: check the `changes` keys → authorise
(`asset.edit` or `photo.capture` on `jobId`, job row locked) → for photos, `parentId` must be an
asset of that job (`422 UNKNOWN_ASSET`) → look up `(org_id, deviceId, opId)` in `sync_operation`
→ plan with `planSyncOperation()` → persist → record.

| Outcome        | When                                                                                                                                                                     | Recorded                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applied`      | New entity, or update/delete at the current `baseVersion`                                                                                                                | `sync_operation`, `sync.operation_applied`                                                                                                        |
| `merged`       | Older `baseVersion` but no changed field was also changed on the server                                                                                                  | as above                                                                                                                                          |
| `duplicate_op` | `opId` already recorded for this organisation and device; retried create with identical content; delete of a deleted entity                                              | nothing                                                                                                                                           |
| `deduplicated` | Photo create whose `(parentId, contentHash)` already exists in the same job; `detail.existingId`                                                                         | `sync_operation`, `sync.operation_applied`                                                                                                        |
| `conflict`     | A changed field differs from a server change made after `baseVersion`; delete after server changes; update of a deleted entity. Non-conflicting fields are still applied | `sync_conflict` (`open`), `sync_operation`, `sync.conflict_detected`; `detail.conflicts[{ field, serverValue, clientValue, serverFieldVersion }]` |
| `rejected`     | Job locked; unknown entity for update/delete; `baseVersion` null or newer than server; `detail.reason`                                                                   | nothing (the op may be replayed after an amendment)                                                                                               |

Per-field versions (`field_versions`) drive merging; the default policy is `manual` for every
field, so evidence is never silently overwritten. Fixed in iteration 1: photo fields are
allow-listed, photo `parentId` must belong to the job, de-duplication is scoped to the job, and
idempotency is keyed by `(org_id, device_id, op_id)` (migration 0003), so an `opId` used by another
device or organisation can no longer cause an operation to be dropped as a duplicate. Gaps: there
is no conflict-resolution endpoint (`sync.conflict_resolved` **Planned**); a request-level error
(`403`, `422 UNKNOWN_FIELD`, `UNKNOWN_ASSET`, `WRONG_JOB`) aborts the batch after earlier
operations have committed, so clients must replay the batch (safe because of the idempotency key);
asset changes made through sync do not update the `location.*` field values or their history;
only assets and photos sync today.

Example: device 2 (`"deviceId": "tablet-2"`) retries a batch whose first operation,
`device2-op-0001`, was already applied before the connection dropped, and whose second operation
registers the same image (same `contentHash`, new `entityId`) that device 1 has already synced to
the same asset. Because the idempotency key includes the device, only device 2's own earlier
operation is recognised as a replay. The second operation:

```json
{
  "opId": "device2-op-0002",
  "jobId": "b72fd194-4774-460b-a9e4-42672da8fe91",
  "entityType": "photo",
  "entityId": "44444444-4444-4444-8444-444444444444",
  "kind": "create",
  "baseVersion": null,
  "changes": { "caption": "Facade", "sequence": 1, "capturedAt": "2026-10-01T23:05:00Z" },
  "clientTimestamp": "2026-10-01T23:05:00Z",
  "contentHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "parentId": "22222222-2222-4222-8222-222222222222"
}
```

Response:

```json
{
  "results": [
    { "opId": "device2-op-0001", "outcome": "duplicate_op" },
    {
      "opId": "device2-op-0002",
      "outcome": "deduplicated",
      "detail": { "existingId": "33333333-3333-4333-8333-333333333333" }
    }
  ]
}
```

## 5. Resource catalogue

`generated/api-endpoints.md` lists all 66 operations with method, path, permission (with any
non-human actor restriction) and summary.
Summary by area:

| Area                        | Operations                                                                                                                         | Permission(s)                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference                   | `GET /v1/reference/selection`, `GET /v1/reference/fields`                                                                          | authenticated                                                                                                                                           |
| Jobs and map                | create, list (≤ 500), detail, change selection, assign, requirements, capture fields, add asset; `GET /v1/map/assets` (GeoJSON)    | `job.create`, `job.read`, `job.update`, `job.allocate`, `asset.edit`, `valuation.edit` (judgement fields)                                               |
| Evidence and calculations   | sales, rentals, commentary, risk flags; run and override calculations                                                              | `evidence.edit`, `inspection.capture` (+ `validation.acknowledge` to accept or resolve a risk flag), `calculation.run`, `calculation.override`          |
| Areas                       | create sketch/version, confirm scale, approve schedule                                                                             | `sketch.edit`, `measurement.approve`                                                                                                                    |
| Inspection and AI           | register photo, privacy action; AI suggestion; decision                                                                            | `photo.capture`, `photo.redact`, `inspection.capture` for `ai` actors only, `ai.decide`                                                                 |
| Validation and workflow     | validate, acknowledge, engagement accept, cancel, amend, certification, submit                                                     | `job.read`, `validation.acknowledge`, `engagement.accept`, `job.cancel`, `job.update`, `certification.sign`                                             |
| QA                          | self-approval exception, start, checklist, findings, respond, close, return, approve                                               | `qa.self_approval_exception`, `qa.review`, `job.update`, `qa.approve`                                                                                   |
| Reports                     | draft PDF, issue, metadata, PDF, invoice PDF, reproduce, delivery callback                                                         | `report.generate_draft`, `report.issue`, `report.read_issued`/`job.read` (reproduce: `job.read`), `invoice.read`, `email.send` for `system` actors only |
| Administration and audit    | template list/create/review/approve, rule-set approve, approve recipient, apply legal hold; job audit, verify, security events     | `template.edit`, `template.approve`, `ruleset.approve`, `job.allocate`, `legal_hold.manage`, `audit.read`                                               |
| Sync                        | `POST /v1/sync`                                                                                                                    | per operation                                                                                                                                           |
| Valuer profile              | `GET /v1/me/profile`, `PUT /v1/me/profile` (own profile only)                                                                      | authenticated (read); `certification.sign` to update (human, MFA)                                                                                       |
| Work in progress and search | `GET /v1/jobs` with `q`, `stage`, `valuerId`, `status` (WIP fields, stage counts, overdue); `GET /v1/property-search?q=`           | `job.read` (jobs filtered by visibility)                                                                                                                |
| Property data and maps      | `GET /v1/integrations/status`; property data lookup and comparable search for an asset (nothing saved); `GET /v1/jobs/{jobId}/map` | `job.read`; `asset.edit` (lookup; the automated estimate also needs `valuation.edit`); `evidence.edit` (comparables)                                    |

### 5.1 Key flows

Paths are relative to `/v1/jobs/{jobId}` unless absolute.

| Flow                                                                                                                            | Request essentials                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Response essentials                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create job `POST /v1/jobs`                                                                                                      | `reference` (3–40), `clientId`, `portfolioId?`, `selection` (5 codes, 00 §4), `responsibleValuerId?`, `reviewerId?`, `inspectorIds[]` (default empty; only where the firm uses separate inspectors, 01 D12), `feeCents?` (integer ≥ 0), `instructedOn?` (date; default today in the jurisdiction → `dates.instruction`), `dueDate?` (→ `instruction.dueDate`), `assets[1..500]` (`id?`, `label`, `address.formatted`, `latitude?`, `longitude?`, `geocodeConfidence?`); `SINGLE` mode needs exactly one asset                                                                         | Job view (example §5.2). The client must belong to the organisation (`422 UNKNOWN_CLIENT`); each assignee must be an active user of the organisation (`422 UNKNOWN_USER`) holding `VALUER` (valuer), `QA_REVIEWER` (reviewer) or `FIELD_INSPECTOR`/`VALUER` (inspectors) (`422 ROLE_REQUIRED`); valuer = reviewer → `403 SEPARATION_OF_DUTIES`. `POST /assign` applies the same checks. Picks the effective rule set (`409 NO_RULE_SET` if none) and the best template for selection, client and date                                                                      |
| Change selection `PATCH /selection`                                                                                             | `selection`, `reason` (≥ 5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `{ selection, diff: { newlyRequired, noLongerRequired, sectionsAdded, sectionsRemoved, retainedValues }, sections, selectionIssues }`. Values are retained; template re-selected; the pinned rule-set version does not change                                                                                                                                                                                                                                                                                                                                              |
| Capture fields `PUT /fields`                                                                                                    | `values[1..200]`: `fieldId`, `assetId` (null = job level), `value`, `provenance?` (`origin` ∈ manual_entry, external_source, client_supplied, calculated, measured; `sourceId`, `sourceRef`, `retrievedAt`, `effectiveDate`, `licenceBasis`, `verification` ∈ unverified, verified, disputed), `reason?`                                                                                                                                                                                                                                                                              | `{ changed }`. `job.update` if any job-level value, else `asset.edit`; plus `valuation.edit` (valuer) for fields in `VALUER_JUDGEMENT_SECTIONS` (§2.3). Server sets `capturedBy/At` and, for `verified`, `verifiedBy/At`                                                                                                                                                                                                                                                                                                                                                   |
| Add sale `POST /sales`                                                                                                          | `assetId`, `address`, `contractDate`, `price` (dollars), `interest`, `propertyType`, areas, `provenance` (origin external_source, client_supplied or manual_entry), `comparability`, `adjustments[]` (`factor`, `kind`, `value`, `rationale`), `analysisBasis`, `postValuationDateUse?`                                                                                                                                                                                                                                                                                               | `{ sale, analysis: { saleId, landRate?, buildingRate?, adjusted? } }` — traced `CalculationRecord`s stored with ids `<saleId>:<kind>`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Run calculation `POST /calculations`                                                                                            | `formulaId`, `formulaVersion?`, `inputs[{ name, value, unit, sourceRef? }]`, `assetId?`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `CalculationRecord`: `formulaId`, `formulaVersion`, `expression`, traced inputs with normalised units, `output { value, unit, unrounded }`, `traceHash`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Override `POST /calculations/{calcId}/override`                                                                                 | `value`, `reason`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Record with `override { value, reason, by, at }`; original output kept; `422 OVERRIDE_REASON_REQUIRED` without a reason                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Sketch `POST /assets/{assetId}/sketches`                                                                                        | New: `units`, `basis`, `conventionId`, `boundaries[]` (`id?`, `level`, `label`, `role`, `componentType`, `points`, `closed`, `dimensionSource`, `origin`), `changeSummary`; optional `sourcePlanId`, `calibration` (`two_point` or `stated_scale`), `northBearingDeg`, `suppliedAreas`, `includeInClientReport` (default false: the drawing is working notes, 01 D11), `useForReport` (default false; true links the sketch to the asset through `improvements.areaSchedule`, so its schedule is checked by `VAL-AREA-*` and needs approval). New version: `sketchId` + changed parts | `{ version, schedule }` (rows, level totals, issues, `scaleStatus`, `reportable`, `scheduleHash`). `sourcePlanId` must be a photo or document of the job (`422 UNKNOWN_SOURCE_PLAN`); `componentType` must be in `COMPONENT_TYPES` (components) or `DEDUCTION_TYPES` (deductions) (`422 INVALID_COMPONENT_TYPE`); a boundary re-sent unchanged keeps its original `measuredBy`/`measuredAt`                                                                                                                                                                                |
| Confirm scale / approve `POST /sketch-versions/{versionId}/confirm-scale` · `/approve`                                          | `checkNote` (≥ 5) · no body                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `{ version, schedule }` (new version) · `{ approval, schedule }`; latest version only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Photos `POST /photos` · `POST /photos/{photoId}/privacy`                                                                        | `assetId`, `sha256`, `sequence`, `capturedAt`, optional `dHash`, `gps`, `caption`, `roomOrArea`, `quality`, `qualityOverrideReason`, `includeInReport` · `action` ∈ `flag {flags[]}`, `redact {redactedPhotoId}`, `consent {consentRef}`, `exclude`                                                                                                                                                                                                                                                                                                                                   | `{ id, deduplicated }` · updated `PhotoRecord`. Only metadata is registered; image bytes are not uploaded (§6.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AI suggestion `POST /ai-suggestions` (`ai` actors only) · decision `POST /ai-suggestions/{id}/decision`                         | `assetId`, `kind`, `photoId?`, `sourcePlanId?`, `label`, `value?`, `confidence` (0–1), `model { provider, model, version }` · `decision` ∈ accept, edit, reject; `editedLabel?`, `editedValue?`, `reason?`                                                                                                                                                                                                                                                                                                                                                                            | Pending `AiSuggestion` (`422 AI_INFERENCE_PROHIBITED` for prohibited inferences; `photoId` and `sourcePlanId` must belong to the job: `UNKNOWN_PHOTO`, `UNKNOWN_SOURCE_PLAN`) · `{ suggestion, fact }` — a fact exists only after a human accept or edit                                                                                                                                                                                                                                                                                                                   |
| Validate / acknowledge `POST /validate` · `/acknowledgements`                                                                   | `stage` ∈ draft, submit, issue (default submit) · `code`, `path`, `reason`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `ValidationResult { stage, ranAt, findings[], blockingCount, unacknowledgedWarningCount, rulesEvaluated }` (stored in `validation_run`) · acknowledgement; blocking findings → `409 GUARD_FAILED`                                                                                                                                                                                                                                                                                                                                                                          |
| Certification `POST /certification`                                                                                             | `inspectionScopeStatement`, `valuationDate` (must equal `dates.valuation`), `basisOfValue`, `amount { value, kind }`, `independenceStatement`, `conflictsStatement`, `assumptions[]`, `specialAssumptions[]`, `limitations[1..]`, `standardsReliedOn[1..]`, `attestationText` (≥ 20)                                                                                                                                                                                                                                                                                                  | `Certification` with `snapshotHash` and `signature { method: typed_attestation, attestationHash }`. Responsible valuer, human, MFA. The printed identity (`valuer`: full name, designations, API member number, the QLD or WA registration where the job's state needs one, `signatureSha256`) comes from the signer's saved profile at the moment of signing; a `valuer` object in the body is ignored. `422 PROFILE_INCOMPLETE` with `details.problems` (`signingProblems`: profile problems, no signature, registration missing or expired on the state's current date) |
| Valuer profile `GET /v1/me/profile` · `PUT /v1/me/profile`                                                                      | — · `fullName`, `credentials[]`, `apiMemberNumber?` (3–20 letters, digits or hyphens; empty or `null` clears it), `registrations[]` (`jurisdiction` ∈ QLD, WA, one each; `number`; `expiresOn?`), `signature?` (`{ kind: drawn \| typed, value }`: a drawn signature is a `data:image/png;base64,` URL of at most 200,000 characters whose bytes must decode as a PNG; a typed one is the name as signed). Omitting `signature` keeps the saved one; `null` removes it                                                                                                                | `{ profile, saved, updatedAt, signingRole, problems, readyToSign, stateRegistrations[{ jurisdiction, label, authority, satisfied, problems }] }`. There is no user id in the path: callers read and change only their own profile. Before the first save the profile defaults to the user's display name and credentials. Updating needs `certification.sign` (valuers; human; MFA) and fails with `422 INVALID_PROFILE` and `details.problems` (`profileProblems`, plus unreadable PNG). Audited as `profile.updated` with the signature's fingerprint, never the image   |
| Submit `POST /submit`                                                                                                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `{ status: "submitted", snapshotHash }`; needs clean validation and a current certification. `VAL-CERT-002` (blocking at submit and issue) requires the certified amount, basis of value and valuation date to match the report                                                                                                                                                                                                                                                                                                                                            |
| QA `POST /qa/start`, `/qa/checklist`, `/qa/findings`, `/qa/findings/{findingId}/respond`, `/close`, `/qa/return`, `/qa/approve` | checklist `itemId`, `response` ∈ yes, no, na; finding `severity` ∈ critical, major, minor, observation, `category`, `description`, `ref?`; respond `response`; close `status` ∈ resolved, accepted, withdrawn, `note`; return `reason?`                                                                                                                                                                                                                                                                                                                                               | `QaReview` (start and edits; findings of a returned round carry forward) · `{ status: "returned" }` · `{ status: "approved", approvedSnapshotHash }`. Start verifies the submitted snapshot (`409 SNAPSHOT_MISMATCH`) and makes the caller the job reviewer; checklist, findings and return only by that reviewer (`403 NOT_REVIEWER`); respond only by the responsible valuer (`403 NOT_RESPONSIBLE_VALUER`) while the job is `returned`                                                                                                                                  |
| Issue `POST /issue`                                                                                                             | `recipients[1..20]` (approved for the client; the approval lookup is scoped to the organisation), `invoiceDescription`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | §5.2. Needs the job fee (`FEE_REQUIRED`) and the organisation ABN (`SUPPLIER_ABN_REQUIRED`) `[REVIEW: TAX]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Reproduce `POST /v1/reports/{reportId}/reproduce`                                                                               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | §5.2. Needs `job.read` on the report's job (client users cannot run it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Audit `GET /audit` · `GET /audit/verify`                                                                                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `{ events[] }` · `{ valid, count, headHash }` or `{ valid: false, brokenAtSeq, reason }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| WIP list `GET /v1/jobs`                                                                                                         | Query `q?` (≤ 200; every word must match reference, client, addresses, valuer, purpose, type, state or stage), `stage?` (`new`, `to_inspect`, `in_progress`, `returned`, `with_qa`, `to_issue`, `issued`, `cancelled`), `valuerId?`, `status?` → `{ today, jobs[{ id, reference, status, selection, responsibleValuerId, stage, due, clientName, addresses[], valuerName, dueDate, inspectionDate }], counts{stage: n}, overdue }`; most urgent first; counts are before the stage filter; "today" is Australia/Sydney (01 D14)                                                       |
| Property search `GET /v1/property-search`                                                                                       | `q` (2–200) → `{ status, matches[{ propertyId, address, latitude?, longitude?, confidence? }], jobs[] (as the WIP list, ≤ 25) }`; with property data off, `matches` is empty; a provider problem is returned as `propertyDataProblem { code, message, details? }` and never hides the jobs                                                                                                                                                                                                                                                                                            |
| Property data `POST /assets/{assetId}/property-data`                                                                            | `propertyId?` (else the asset's address is matched) → `{ status, source { id, name, provider, attribution, licenceBasis, reportable }, propertyId, match, attributes, suggestions[{ fieldId, assetId, value, display, provenance }], salesHistory[], avm { estimate, low, high, confidence, asAt, model, notice, source } \| null }`. Writes nothing; accept a suggestion with `PUT /fields` and its provenance marked `verified`. Audit `property_data.retrieved` (counts only)                                                                                                      |
| Comparable search `POST /assets/{assetId}/comparables/search`                                                                   | `radiusKm` (0.5–10, default 2), `months` (3–36, default 12), `limit` (1–20, default 10), `propertyId?` → `{ status, source, propertyId, search { latitude, longitude, radiusKm, months, toDate }, candidates[{ sale, evidence }] }`; `evidence` is an unverified `SaleComparable` to post (without `id`) to `POST /sales` once checked. Writes nothing. Audit `property_data.retrieved`                                                                                                                                                                                               |
| Job map `GET /map`                                                                                                              | → `{ jurisdiction, service (state government viewer and basemap), subject[{ assetId, label, address, latitude, longitude, risk }], sales[], notes[] }`; sales evidence has no coordinates yet, so `sales` is empty and a note says so                                                                                                                                                                                                                                                                                                                                                 |
| Integration status `GET /v1/integrations/status`                                                                                | → `{ propertyData { state: connected \| sample \| not_configured, provider, reason? }, maps (per jurisdiction) }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### 5.2 Examples

Captured from the iteration-1 test flow (`apps/api/test/lifecycle.test.ts`, dev authentication).
Arrays marked "abbreviated" are shortened, the issue request spells out the default
`invoiceDescription`, and the `renderer` block of the reproduce response (added to the code after
the capture) is shown with the current renderer version; everything else is verbatim.

**Create job** — `POST /v1/jobs` as an `ALLOCATOR`:

```json
{
  "reference": "VAL-2026-833856",
  "clientId": "00000000-0000-4000-8000-000000000010",
  "portfolioId": "00000000-0000-4000-8000-000000000011",
  "selection": {
    "jurisdiction": "VIC",
    "purpose": "MARKET_VALUE",
    "propertyType": "RESIDENTIAL",
    "scope": "FULL",
    "mode": "SINGLE"
  },
  "responsibleValuerId": "00000000-0000-4000-8000-000000000104",
  "reviewerId": "00000000-0000-4000-8000-000000000107",
  "inspectorIds": ["00000000-0000-4000-8000-000000000106"],
  "feeCents": 88000,
  "assets": [
    {
      "label": "10 Sample Road, Exampleton VIC 3000",
      "address": { "formatted": "10 Sample Road, Exampleton VIC 3000" },
      "latitude": -37.81,
      "longitude": 144.96
    }
  ]
}
```

`200` response (abbreviated: `sections` from 20 entries, `missingRequired` from 40, `transitions`
from 8):

```json
{
  "id": "0bf2ef9d-a524-403d-8847-ad9d8f62b82a",
  "reference": "VAL-2026-833856",
  "status": "draft",
  "clientId": "00000000-0000-4000-8000-000000000010",
  "portfolioId": "00000000-0000-4000-8000-000000000011",
  "selection": {
    "jurisdiction": "VIC",
    "purpose": "MARKET_VALUE",
    "propertyType": "RESIDENTIAL",
    "scope": "FULL",
    "mode": "SINGLE"
  },
  "responsibleValuerId": "00000000-0000-4000-8000-000000000104",
  "reviewerId": "00000000-0000-4000-8000-000000000107",
  "feeCents": 88000,
  "ruleSet": "au-core@2026.1 (approved)",
  "template": "au-generic v2 (approved)",
  "version": 1,
  "assets": [
    {
      "id": "ec991e17-2c5e-4c5c-afb6-c2da559e2e09",
      "label": "10 Sample Road, Exampleton VIC 3000",
      "address": { "formatted": "10 Sample Road, Exampleton VIC 3000" },
      "latitude": -37.81,
      "longitude": 144.96,
      "riskLevel": "none",
      "version": 1
    }
  ],
  "requirements": {
    "sections": ["instructions", "scope", "basis", "sales_evidence", "areas", "certification"],
    "warnings": [],
    "selectionIssues": [],
    "specialistReviews": ["API_STANDARDS"],
    "requiredCount": 42,
    "missingRequired": [
      { "fieldId": "dates.valuation", "assetId": null },
      { "fieldId": "evidence.sales", "assetId": "ec991e17-2c5e-4c5c-afb6-c2da559e2e09" }
    ]
  },
  "transitions": {
    "acceptEngagement": {
      "allowed": false,
      "to": "active",
      "failures": [
        "conflict-of-interest check has not been recorded",
        "engagement documents must be attached"
      ]
    },
    "cancel": { "allowed": false, "to": "cancelled", "failures": ["a reason is required"] }
  }
}
```

Calling that transition anyway (`POST /v1/jobs/{jobId}/engagement/accept`) returns `409`:

```json
{
  "error": {
    "code": "GUARD_FAILED",
    "message": "cannot acceptEngagement: conflict-of-interest check has not been recorded; engagement documents must be attached",
    "details": {
      "failures": [
        "conflict-of-interest check has not been recorded",
        "engagement documents must be attached"
      ]
    }
  }
}
```

**Issue** — `POST /v1/jobs/{jobId}/issue` as the responsible `VALUER` with MFA, after QA approval:

```json
{ "recipients": ["credit@lender.example"], "invoiceDescription": "Professional valuation services" }
```

```json
{
  "reportId": "7ea59e31-97e1-4a93-8180-221ef7f44ef3",
  "version": 1,
  "snapshotHash": "c2ce167f56f857fd9a6d2467ff4b6b98c26f4ac36008f4850f2519a4e38a1968",
  "contentHash": "1bcf1a0b355cef2e1b0b914dc0f1d2e80d437d4d3c6e860b2139454d496e323d",
  "pdfSha256": "69fcb87524a7081a8f7cd12de9d9f86a43c4b667188286ece1b82dd48f1878a0",
  "invoice": {
    "number": "INV-2026-00001",
    "totalCents": 96800,
    "gstCents": 8800,
    "pdfSha256": "63a93b383aaf1cb35f6cf3af6417c49485def758956c41330df3c5699aa28a6b"
  },
  "deliveries": [
    {
      "id": "ad1ef95e-0492-414e-aa9e-fd7114a9a0de",
      "recipient": "credit@lender.example",
      "status": "sent",
      "providerMessageId": "local-1042bcd290678a4966ab"
    }
  ]
}
```

An unapproved recipient returns `422 UNAPPROVED_RECIPIENTS` with
`details.unapproved: ["someone@else.example"]`; a valuer not assigned to the job gets
`403 NOT_ASSIGNED`; an organisation without an ABN gets `422 SUPPLIER_ABN_REQUIRED`.

**Reproduce** — `POST /v1/reports/{reportId}/reproduce` (no body) as the QA reviewer:

```json
{
  "snapshotIntact": true,
  "renderer": { "snapshot": "pdf-renderer@3", "current": "pdf-renderer@3", "match": true },
  "pdf": {
    "stored": "69fcb87524a7081a8f7cd12de9d9f86a43c4b667188286ece1b82dd48f1878a0",
    "reproduced": "69fcb87524a7081a8f7cd12de9d9f86a43c4b667188286ece1b82dd48f1878a0",
    "match": true
  },
  "invoice": {
    "stored": "63a93b383aaf1cb35f6cf3af6417c49485def758956c41330df3c5699aa28a6b",
    "reproduced": "63a93b383aaf1cb35f6cf3af6417c49485def758956c41330df3c5699aa28a6b",
    "match": true
  },
  "emails": [
    {
      "recipient": "credit@lender.example",
      "stored": "1042bcd290678a4966abab02ae3f211ad32d6727dbe58e76b29b8e0a1ff537ea",
      "reproduced": "1042bcd290678a4966abab02ae3f211ad32d6727dbe58e76b29b8e0a1ff537ea",
      "match": true
    }
  ],
  "reproducible": true
}
```

The procedure is in 06 §6.4. `reproducible` is `false` whenever `renderer.match` is `false`, even
if the stored hashes happen to match.

## 6. Integrations and webhooks

### 6.1 Email delivery

Outbound email goes through the `EmailTransport` interface after the issue transaction commits;
development and tests use `RecordingEmailTransport`. Each delivery has a `payload_hash`
(canonical hash of from, lower-cased to, subject, text and attachment metadata).

Delivery-status callback `POST /v1/email-deliveries/{id}/status`:

| Aspect   | Contract                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caller   | Service account in the same organisation with `actor_kind = system` (the route declares `actors: [system]`, so any other actor kind gets `403 ACTOR_NOT_PERMITTED` from the router; the handler re-checks with `SYSTEM_ONLY`) and a role granting `email.send` (today `VALUER` or `FINANCE`; a dedicated integration role is recommended `[REVIEW: SECURITY]`); delivery in another organisation → `404` |
| Body     | `{ status: delivered \| bounced \| failed, providerMessageId? }`                                                                                                                                                                                                                                                                                                                                         |
| Response | `{ id, status }`; audit `email.delivery_updated` with before/after status                                                                                                                                                                                                                                                                                                                                |
| Gaps     | `providerMessageId` is neither checked nor stored; no status-transition guard (e.g. `delivered → failed`); no provider signature verification; no event-id idempotency. A live provider with signed webhooks is **Planned** (S-058, S-072) `[REVIEW: SECURITY]`                                                                                                                                          |

### 6.2 Planning adapters (domain contract, no HTTP endpoint yet)

`packages/domain/src/integration/planning.ts` defines `PlanningAdapter { id, jurisdiction,
dataSourceId, capabilities[], lookup(req, ctx) }`. `PlanningLookupRequest` takes jurisdiction and
address, parcel (`lot`, `plan`, `volumeFolio`) or coordinates; `PlanningControlResult` returns
zone, overlays, instrument, permissible/prohibited uses, an optional property report reference and
a full `Provenance`. `lookupPlanning()` runs the adapter under the connector policy and returns
`found` or `manual_fallback` (reason, attempts), including when provenance is incomplete;
`manualPlanningResult()` builds a result from an uploaded planning document. The per-jurisdiction
plan (`PLANNING_ADAPTER_PLAN`): VIC MVP and NSW Pilot are `planned`; the other six are
`manual_only` (04 §3). An API endpoint, the `datasource.lookup`/`datasource.verify` permissions
and the field mapping to `planning.*` values are **Planned** (04 §2) `[REVIEW: DATA_LICENSING]`.

### 6.3 Connector policy

`DEFAULT_CONNECTOR_POLICY` (`integration/connector.ts`) applies to every external connector:

| Setting         | Default                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| Timeout         | 10 s per attempt (aborts the call)                                           |
| Retries         | 2, exponential backoff 500 ms × 2ⁿ; `PermanentConnectorError` is not retried |
| Rate limit      | 60 calls per minute (sliding window) → `rate_limited`                        |
| Circuit breaker | Opens after 5 failures; half-open after 60 s → `circuit_open`                |
| Freshness       | 90 days (stale data → validation `VAL-STALE-002`)                            |
| Fallback        | Always `manual_entry`; outages never block field work                        |

Licence rules come from the `data_source` registry: `checkDataSourceUsage()` reports whether a
datum is storable, reproducible in a report, expired or stale `[REVIEW: DATA_LICENSING]`.

### 6.4 Not yet exposed (Planned)

| Capability                                                                                                                   | State today                                                                                                                                                                                                                                                  | Backlog                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Document and plan upload, object storage, signed short-lived URLs                                                            | `document` table only; photos register metadata and sha256; PDFs stored in the database                                                                                                                                                                      | S-034, S-047            |
| E-signature for certification                                                                                                | `Certification.signature.method` reserves `e_signature` and `providerRef`; only typed attestation is implemented. The report shows the valuer's drawn or typed sign-off signature from their profile (01 D13); that image is not a cryptographic e-signature | S-070 `[REVIEW: LEGAL]` |
| Accounting export, credit notes                                                                                              | Invoice PDF only                                                                                                                                                                                                                                             | S-071                   |
| Live email provider and signed webhooks                                                                                      | Recording transport; system-actor callback (§6.1)                                                                                                                                                                                                            | S-058, S-072            |
| Geocoding                                                                                                                    | Coordinates and confidence accepted from clients                                                                                                                                                                                                             | S-039                   |
| AI model integration                                                                                                         | Suggestions accepted only from `ai` service accounts                                                                                                                                                                                                         | 13 §1.5                 |
| Administration of organisations, users, clients, portfolios, data sources; rule-set authoring; legal-hold release; retention | Seed data or not implemented                                                                                                                                                                                                                                 | S-077, S-091            |
| Sync conflict resolution; sync of fields, evidence and sketches                                                              | Assets and photos only                                                                                                                                                                                                                                       | 13                      |

### 6.5 Property data provider (CoreLogic / Cotality) and state map services

Decision 01 D15; adapter details in 04 §4.1–4.3. The provider is chosen at start-up from
configuration (`PROPERTY_DATA_MODE`, `CORELOGIC_*`; README): CoreLogic when both API keys are
supplied, sample data in development and test, otherwise off. **CoreLogic API keys have not been
supplied**, so deployed environments report `not_configured` and the property data routes answer
`503 PROPERTY_DATA_NOT_CONFIGURED` until they are.

| Aspect        | Contract                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration  | The provider's data source (`ds-corelogic` or `ds-sample-property-data`) must be registered and `active` for the organisation, or the lookup returns `409 DATA_SOURCE_NOT_REGISTERED` before any provider call. The automated estimate is fetched only when its own source (`ds-corelogic-avm` or `ds-sample-avm`) is active. Licence terms are read from the registry, not the code `[REVIEW: DATA_LICENSING]` |
| Provenance    | Suggestions and candidate sales carry `origin: external_source`, `sourceId`, `sourceRef` (provider property or sale id), `retrievedAt` (now), `effectiveDate`, `licenceBasis`, `verification: unverified`, `capturedBy` (caller)                                                                                                                                                                                |
| Nothing saved | Lookups and searches never write to the job. The valuer accepts values through `PUT /fields` and sales through `POST /sales`, each with provenance                                                                                                                                                                                                                                                              |
| Reports       | Sample data and automated estimates have `permitsReportReproduction: false`; relying on them makes `VAL-PROV-003` block issue. The automated estimate is a cross-check shown only to callers with `valuation.edit` and is never reproduced in a report                                                                                                                                                          |
| Failures      | Every provider call runs under the connector policy (§6.3). A failure returns `502 PROPERTY_DATA_UNAVAILABLE` with `details.failure` and `details.fallback: manual_entry`; property search still returns the user's jobs                                                                                                                                                                                        |
| Secrets       | Keys are read from the server's secret store only; they are never logged, returned or included in error messages                                                                                                                                                                                                                                                                                                |
| Maps          | `STATE_MAP_SERVICES` gives each jurisdiction's government viewer and, where published, a basemap tile template with attribution; terms of use are to be confirmed `[REVIEW: DATA_LICENSING]`                                                                                                                                                                                                                    |

## 7. Non-functional contract

| Concern               | Today                                                                                                                                                                                                                                | Planned                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Rate limiting         | None in the API                                                                                                                                                                                                                      | Edge/WAF per-user and per-device limits; `429` with `Retry-After` (11 T-32)             |
| Pagination            | `GET /v1/jobs` reads the newest 500 jobs of the organisation, then filters by permission (a user may see fewer than exist); `GET /v1/map/assets` and `GET /v1/jobs/{jobId}/audit` are unbounded; security events return the last 200 | Cursor pagination (`limit`, opaque `cursor`, `nextCursor`) on every list                |
| Request size          | Body limit 5 MB (`413`); schema bounds: assets ≤ 500, field values ≤ 200, sync operations ≤ 500, boundaries ≤ 300, points ≤ 500, recipients ≤ 20                                                                                     | Resumable uploads with quotas for binaries                                              |
| Security headers      | `x-content-type-options: nosniff` and `cache-control: no-store` on every response; no CORS plugin (cross-origin browser calls are not enabled)                                                                                       | HSTS and CORS allow-list at the edge `[REVIEW: SECURITY]`                               |
| Transport             | TLS at the edge; database TLS with certificate verification when `DATABASE_SSL` (default on in production)                                                                                                                           | Mutual TLS or private networking for service accounts                                   |
| Logging               | Fastify/pino; redacts `authorization`, `cookie` and `x-user-id` headers; request bodies not logged; 5xx logged with the error                                                                                                        | Field allow-list with no personal information (11 SC-16)                                |
| Correlation           | `genReqId` gives each request a UUID used in logs                                                                                                                                                                                    | Echo it as `x-request-id`, accept one from the edge, propagate to connectors (04 CT-12) |
| Formats               | Instants ISO-8601 UTC; dates `YYYY-MM-DD`; money as integer cents in `feeCents` and invoice totals but dollars inside evidence and certification payloads (06 DM-1)                                                                  | Single money representation `[REVIEW: ACCOUNTING]`                                      |
| Contract completeness | OpenAPI lists request schemas, `x-permission`, `x-actors` and a shared error schema; success responses have no schema                                                                                                                | Response schemas from zod; structured permission metadata (§2.3)                        |
