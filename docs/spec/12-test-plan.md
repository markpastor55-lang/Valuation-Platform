# 12 — Test plan

> Status: **Draft for review** · Owner: Quality engineering · Applies to: `packages/domain`, `apps/api`,
> mobile app, web portal, integrations and every release gate (MVP, Pilot, Production)

This plan defines how the platform is tested, how each brief §10 MVP acceptance criterion is
traced to automated tests, and the entry/exit criteria for each release. Vocabulary (codes, roles,
lifecycle states, audit actions) is as fixed in `00-architecture-and-conventions.md`.

Tests prove that the software behaves as configured. They do **not** prove that configured
templates, rule sets or certification wording meet API/IVS, AASB 13, ATO or court requirements;
that is a specialist review outcome, recorded separately `[REVIEW: API_STANDARDS]`.

## 1. Test strategy and levels

### 1.1 Principles

| #   | Principle               | Rule                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Domain first            | Rules, calculations, geometry, permissions, workflow guards and sync planning live in `@vp/domain` (pure, no I/O), so most rule coverage is fast unit tests. API and client tests cover wiring, persistence, authorisation, audit emission and UX, not re-derivation of rule logic.                                |
| P2  | Traceable               | Each automated test title starts with its catalogue ID, e.g. `it('TC-GEO-004 overlap counted once', …)`. A CI report lists catalogued IDs vs. IDs found; from MVP, a catalogued P1 ID with no test fails the build. File names in this plan are indicative patterns; the ID in the test title is the binding link. |
| P3  | Deterministic           | Injected clock and ID generator, seeded randomness, fixed `TZ` matrix, no wall-clock reads in domain code. CI blocks outbound network; any non-loopback request fails the test.                                                                                                                                    |
| P4  | Synthetic data          | No real personal data in local, CI or staging by default (§4.1).                                                                                                                                                                                                                                                   |
| P5  | Real database semantics | API tests run against PostgreSQL semantics (PGlite in CI, PostgreSQL 16 in staging), never against mocks of the database.                                                                                                                                                                                          |
| P6  | Guardrails are P1       | Any test protecting a guardrail in 00 §1 (G1–G6) is priority P1 and blocks merge.                                                                                                                                                                                                                                  |

### 1.2 Levels

| Level                       | Scope                                                                                                                                                                       | Tooling                                                                                                         | Runs                                                                          | Gate                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| L1 Domain unit              | `packages/domain`: requirement resolution, validation, calculations, geometry, workflow, RBAC, audit hashing, AI governance, photo metrics, sync planning, connector policy | Vitest; property-based tests (fast-check) for conversions and geometry                                          | Every PR                                                                      | All P1/P2 pass                       |
| L2 API integration          | `apps/api` routes, SQL, transactions, triggers, authentication, audit emission, PDF/invoice/email records                                                                   | Vitest + Fastify `inject`; PGlite in CI; PostgreSQL 16 in staging                                               | PR (PGlite); nightly + pre-release (PG16)                                     | All P1 pass                          |
| L3 Migration                | Apply from empty, checksum drift, append-only triggers, role privileges                                                                                                     | Vitest against PGlite and PG16                                                                                  | Every PR                                                                      | All pass                             |
| L4 OpenAPI contract         | Every route documented; requests/responses validated against schema; breaking-change diff vs `main`                                                                         | Generated OpenAPI document + schema validation in L2; OpenAPI diff tool                                         | Every PR                                                                      | No undeclared breaking change        |
| L5 Adapter contract         | Jurisdiction/planning, geocoding, hazard, email, e-signature and accounting adapters against recorded or synthetic fixtures                                                 | Shared contract suite per adapter interface; local fixture server                                               | Every PR                                                                      | All pass; no live calls              |
| L6 Mobile E2E               | Inspection journeys incl. offline/airplane mode, camera, sketch, sync                                                                                                       | Detox or Maestro (choice follows ADR-002 / D5); iOS simulator + Android emulator in CI; device farm pre-release | Nightly; pre-release                                                          | Critical journeys pass               |
| L7 Web E2E                  | Allocation, selection, evidence, validation, QA, issue, admin, client read-only                                                                                             | Playwright (Chromium, WebKit, Firefox)                                                                          | PR (smoke); nightly (full)                                                    | Critical journeys pass               |
| L8 PDF determinism & visual | Same snapshot ⇒ identical bytes/hash; golden page images per template section                                                                                               | Pinned renderer; page rasterisation in pinned container; image diff                                             | Every PR                                                                      | Hash equality; golden diffs approved |
| L9 Security                 | Authorisation matrix, separation of duties, ASVS L2 checks, SAST, dependency, secrets and container scanning, DAST, pen test                                                | Vitest (matrix), CodeQL or Semgrep, OSV-Scanner/`pnpm audit`, gitleaks, Trivy, OWASP ZAP baseline               | PR (static); nightly (DAST, staging); pre-Pilot and pre-Production (pen test) | No open critical/high                |
| L10 Accessibility           | WCAG 2.2 AA target for web and mobile                                                                                                                                       | axe-core (`@axe-core/playwright`), RN accessibility lint, manual VoiceOver/TalkBack scripts                     | PR (automated); per release (manual)                                          | 0 serious/critical axe issues        |
| L11 Performance             | Photo sync, large portfolio map, large PDF, rule evaluation at scale                                                                                                        | Device profiler, Playwright traces, k6, Vitest bench                                                            | Nightly (bench); pre-release (full)                                           | Targets in §1.6                      |
| L12 Resilience              | Connector outage, timeouts, retries, circuit breaker, storage/DB faults                                                                                                     | Fault-injecting fixture server; chaos runs in staging                                                           | Nightly; pre-Pilot                                                            | Scenarios in §1.7 pass               |
| L13 Data migration          | Schema backfills and any legacy import (D1)                                                                                                                                 | Reconciliation scripts on anonymised extract in staging                                                         | Per migration                                                                 | Reconciliation clean                 |
| L14 UAT                     | Practising valuers execute scripted and exploratory scenarios                                                                                                               | Scripts per MVP product (D3)                                                                                    | MVP and Pilot                                                                 | §1.9                                 |
| L15 Pilot acceptance        | Real jobs in pilot environment                                                                                                                                              | Metrics in §1.10                                                                                                | End of Pilot                                                                  | §1.10                                |

### 1.3 Database, migration and contract specifics

- **PGlite vs PostgreSQL 16.** PGlite is single-connection; tests needing concurrent sessions, row
  locks or serialisation failures (e.g. TC-WF-006) are tagged `pg16-only` and run in the staging
  suite. The full L2 suite runs nightly on PG16 to detect semantic divergence from PGlite.
- **Migrations** are forward-only and checksummed. L3 asserts: apply from empty succeeds on both
  engines; re-running is a no-op; editing an applied file is detected as drift and stops
  migration/startup; append-only triggers reject `UPDATE`/`DELETE` on audit-event and
  issued-snapshot tables; the application role cannot run DDL or `TRUNCATE` those tables.
- **OpenAPI.** Every route has request/response schemas; L2 tests validate actual responses against
  the document; a breaking change (removed field, narrowed type, new required input) fails the PR
  unless the API version is incremented.

### 1.4 Security specifics

| Area                 | Approach                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authorisation matrix | L1: every permission × role asserted against the reviewed snapshot of `generated/permission-matrix.md` (generated from `packages/domain/src/auth/permissions.ts`); a matrix change requires the snapshot update in the same PR `[REVIEW: SECURITY]`. L2: every route × role called with synthetic tokens; expected allow/403 per route-permission map; each 403 emits `auth.denied`. |
| Separation of duties | Dedicated tests for the 00 §5 rules: `certification.sign`, `qa.approve` and self-approval exception, `template.approve` / `ruleset.approve`, `CLIENT_READONLY` scoping, restricted portfolios.                                                                                                                                                                                       |
| OWASP ASVS L2        | Selected Level 2 requirements (ASVS version pinned in section 11) mapped to test IDs: authentication and MFA, session handling, access control, input validation on every route, file upload limits and image decoding, logging without secrets or personal information, data protection, TLS, security headers. Mapping is maintained in section 11 `[REVIEW: SECURITY]`.           |
| Mobile               | Encrypted local store (SQLCipher) not readable without key; no secrets in app bundle; TLS validation not bypassable; sensitive screens excluded from OS app-switcher snapshots where supported.                                                                                                                                                                                      |
| Supply chain         | Dependency scanning and licence scan on every PR; SAST; secrets scanning (pre-commit and CI); container image scan before deploy.                                                                                                                                                                                                                                                    |
| Dynamic              | OWASP ZAP baseline against staging nightly; independent penetration test before Pilot and before Production.                                                                                                                                                                                                                                                                         |

### 1.5 Accessibility specifics

Target: WCAG 2.2 AA (conformance is not claimed until an external audit is completed).

- Automated: axe-core on every web route and key UI state (dialogs, validation panel, QA
  findings, map with filters); RN accessibility lint and label assertions in L6.
- Manual per release: VoiceOver (iOS) and TalkBack (Android) scripts for login, job list,
  selection step, checklist capture, photo capture and caption, sketch (via exact-length
  wall entry, the non-dragging alternative for 2.5.7), validation, certification signing and QA.
- Specific checks: map pin status not by colour alone (1.4.1); target size ≥ 24 × 24 CSS px
  (2.5.8); focus not obscured (2.4.11); redundant entry (3.3.7); accessible authentication
  (3.3.8); text scaling to 200 % / OS large text without loss of function.
- Issued PDF: tagged structure and reading order are a P3 target pending decision D6.

### 1.6 Performance scenarios

Targets are **proposed** and confirmed before Pilot (they depend on D5/D6 hosting and device choices).

| ID      | Scenario                         | Setup                                                                                                                                                                | Proposed target                                                                                                                       |
| ------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-01 | Sync of 500 photos               | 500 × ~4 MB JPEG + 2,000 field operations; uplink shaped to 10 Mbit/s, 100 ms RTT, 1 % loss; app killed once mid-sync; mid-range Android and oldest supported iPhone | 0 duplicates; resumes from last acknowledged upload; UI input latency p95 < 100 ms during sync; wall time ≤ 1.3 × payload ÷ bandwidth |
| PERF-02 | Portfolio of 1,000 assets on map | 1,000 assets across two states, mixed status/risk                                                                                                                    | Map feed p95 < 500 ms; first clustered render < 2 s on mid-range device; pan/zoom ≥ 45 fps                                            |
| PERF-03 | PDF of 200 pages                 | 200 pages incl. 300 photos, 20 sketches, 50 evidence rows                                                                                                            | Render p95 < 60 s on staging worker; peak memory < 1.5 GB; identical hash on 3 consecutive renders                                    |
| PERF-04 | Rules at scale                   | Portfolio job of 1,000 assets                                                                                                                                        | Requirement resolution ≤ 50 ms per asset; full validation run ≤ 5 s                                                                   |
| PERF-05 | API baseline                     | 50 concurrent users, mixed read/write                                                                                                                                | Read p95 < 300 ms; write p95 < 600 ms; 0 errors                                                                                       |

### 1.7 Resilience scenarios

| Scenario                                     | Expected behaviour                                                                                                                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connector returns 5xx / times out            | Per-connector timeout enforced; retries only for idempotent calls with exponential backoff and jitter; circuit opens at threshold; UI offers manual entry or document upload; manual data recorded with `manual` provenance and unverified status. |
| Circuit half-open                            | Single probe; success closes circuit; failure re-opens with backoff.                                                                                                                                                                               |
| Rate limit (429)                             | `Retry-After` honoured; no retry storm across workers.                                                                                                                                                                                             |
| Stale cached datum                           | Freshness flag set from effective/retrieval dates; validation warning raised.                                                                                                                                                                      |
| DB connection lost during `issue`            | Transaction rolls back; job remains `approved`; no partial issued copy; retry is idempotent.                                                                                                                                                       |
| Object storage unavailable during upload     | Photo retained on device; upload resumes; no duplicate on recovery.                                                                                                                                                                                |
| Email provider outage                        | Delivery stays queued (`email.queued`); retried; `email.delivery_updated` idempotent.                                                                                                                                                              |
| API instance killed mid-sync (staging chaos) | Client retries batch; idempotency keys prevent duplicates.                                                                                                                                                                                         |

### 1.8 Jurisdiction-adapter contract tests

- One shared contract suite per adapter interface (e.g. planning) runs against every adapter
  implementation; each must return typed results carrying source, retrieval time, effective date,
  licence/usage basis and verification status.
- Fixtures are **recorded** only where the provider's licence permits storing responses for
  testing; otherwise they are synthetic and conform to the provider's documented schema
  `[REVIEW: DATA_LICENSING]`. Each fixture set records capture date, provider API version and
  licence basis. Fixtures contain no personal information.
- Scenarios: found, not found, multiple parcels, partial overlays, unknown fields (ignored), missing
  required fields (typed error), timeout, outage, rate limit.
- No live calls in CI. Scheduled canary checks against provider sandboxes run in staging only,
  with licensed credentials, alerting on schema drift.

### 1.9 Data migration and UAT

- **Data migration (L13).** For each data migration or legacy import (only if D1 selects an
  internal-firm rollout with legacy data): dry run on an anonymised extract; record counts and
  checksums reconcile; codes map to the 00 §4 vocabulary; imported records carry migrated
  provenance with source system; legacy issued reports are imported as read-only documents and
  never regenerated.
- **UAT (L14).** At least three practising valuers (one acting as QA reviewer) execute scripted
  scenarios for each MVP product (D3) across `FULL`, `KERBSIDE` and `DESKTOP` scopes using synthetic
  jobs, plus exploratory sessions. Exit: all scripts executed, no open S1/S2, workflow-fit feedback
  recorded. Template and certification wording is reviewed separately `[REVIEW: API_STANDARDS]`.

### 1.10 Pilot acceptance (L15)

| Measure                     | Proposed threshold                                                          |
| --------------------------- | --------------------------------------------------------------------------- |
| Real jobs issued end to end | ≥ 30 across ≥ 3 valuers and ≥ 1 QA reviewer, covering each pilot product    |
| Data integrity              | 0 lost or duplicated assets/photos; 0 audit-chain verification failures     |
| Reproducibility             | 100 % of issued reports re-render to the issued hash (nightly check)        |
| Defects                     | 0 S1 in the final 4 weeks; 0 open S2 at exit                                |
| Measurement                 | Sampled sketch areas compared with supplied plans; every variance explained |
| Usability                   | Core journeys completed without off-platform workaround                     |

Reliance on reports issued during the pilot, and whether a parallel run with the firm's existing
process is required, are open `[REVIEW: LEGAL]` `[REVIEW: API_STANDARDS]`.

## 2. Traceability: brief §10 MVP acceptance criteria

| AC    | Criterion (brief §10, abridged)                                                                                                                                            | Test IDs                                                      | Levels          | Where implemented                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | One job with one or many assets, shown on a permission-aware map                                                                                                           | TC-JOB-001…002, TC-ROLE-007…008, PERF-02                      | L2, L6, L7, L11 | `apps/api/test/*.test.ts` (jobs, assets, map feed); `packages/domain/test/permissions*.test.ts`; map UI E2E added at MVP  |
| AC-02 | Changing purpose, type, jurisdiction or scope changes fields and sections without losing data                                                                              | TC-FLD-001…008                                                | L1, L2, L6, L7  | `packages/domain/test/requirements.test.ts`; `apps/api/test/*.test.ts` (selection); selection UI E2E at MVP               |
| AC-03 | Works offline; syncs without duplicate assets/photos                                                                                                                       | TC-SYNC-001…007, PERF-01                                      | L1, L2, L6, L11 | `packages/domain/test/sync.test.ts`; sync endpoint tests in `apps/api/test/*.test.ts` and airplane-mode E2E at MVP        |
| AC-04 | Rates traceable to inputs, units, formula, version; override only with reason                                                                                              | TC-CALC-001…009, TC-UNIT-001…006                              | L1, L2          | `packages/domain/test/calc*.test.ts`, `units*.test.ts`; `apps/api/test/*.test.ts` (calculations)                          |
| AC-05 | AI photo extraction never writes accepted facts without human confirmation                                                                                                 | TC-AI-001…004, TC-ROLE-005                                    | L1, L2          | `packages/domain/test/ai*.test.ts`; API tests when model integration lands (Pilot)                                        |
| AC-06 | No issue with blocking validations, absent certification or incomplete QA                                                                                                  | TC-WF-001…006, TC-VAL-001…004, TC-ROLE-003…004                | L1, L2, L7      | `packages/domain/test/workflow.test.ts`, `validation*.test.ts`; `apps/api/test/*.test.ts` (certification, QA, issue)      |
| AC-07 | Issued PDF, invoice and email record reproducible from immutable audit snapshot                                                                                            | TC-PDF-001…006, TC-AUD-001…005, TC-MIG-002                    | L1, L2, L3, L8  | `packages/domain/test/audit.test.ts`; `apps/api/test/*.test.ts` (PDF, invoice, email, audit)                              |
| AC-08 | Import/photograph plan, calibrate, draw/confirm closed boundaries, component and total m², measurement basis, trace to source, sketch version and approver                 | TC-GEO-001…011                                                | L1, L2, L6, L7  | `packages/domain/test/geometry*.test.ts`, `area-schedule*.test.ts`; `apps/api/test/*.test.ts` (sketch); sketch E2E at MVP |
| AC-09 | Automated tests cover field rules, date logic, unit conversions, valuation calculations, role separation, offline sync, jurisdiction adapters, PDF output, audit integrity | FLD, DATE, UNIT, CALC, ROLE, SYNC, CONN, PDF, AUD groups (§3) | All             | CI workflow runs all groups; traceability report (P2) shows ≥ 1 passing P1 test per listed area                           |

## 3. Test catalogue

Levels: L1 domain unit · L2 API integration · L3 migration · L5 adapter contract · L6 mobile E2E ·
L7 web E2E · L8 PDF. Priority: **P1** blocks merge (guardrails, AC coverage); **P2** must pass
before any release; **P3** tracked, nightly.

### 3.1 Field rules (FLD) — `packages/domain/test/requirements.test.ts`, `apps/api/test/*.test.ts`

| ID         | Description                                                                                                                                                                                                                        | Level | Pri |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-FLD-001 | Resolver returns a requirement set for every purpose × property type × scope × jurisdiction (6 × 6 × 4 × 8 = 1,152), and per asset in `PORTFOLIO` mode                                                                             | L1    | P1  |
| TC-FLD-002 | Purpose and type additions present, e.g. `FAMILY_LAW` court, proceeding number, single-expert status; `FINANCIAL_REPORTING` unit of account, principal market, `fr.fairValueHierarchyLevel`; `INDUSTRIAL` site coverage, clearance | L1    | P1  |
| TC-FLD-003 | Scope rules: `DESKTOP` adds data-source register, imagery dates, limitation statement; `KERBSIDE`/`RESTRICTED` add areas not inspected, access attempts, internal-condition assumption; `SEL-001` warns on insurance + vacant land | L1    | P1  |
| TC-FLD-004 | Selection change returns diff of added/removed fields and sections; values of no-longer-required fields retained and marked not required, never deleted                                                                            | L1    | P1  |
| TC-FLD-005 | Round trip A → B → A restores the identical requirement set with all prior values intact                                                                                                                                           | L1    | P1  |
| TC-FLD-006 | Job pins its rule-set version; a newly approved version changes nothing until an explicit, audited re-resolution                                                                                                                   | L1    | P1  |
| TC-FLD-007 | Rule set, template or clause in `placeholder`/`draft` `reviewStatus` rejected by production configuration loading (G1)                                                                                                             | L1/L2 | P1  |
| TC-FLD-008 | API selection change persists, emits `job.selection_changed` with before/after and diff, returns new sections in the same response                                                                                                 | L2    | P1  |

### 3.2 Date logic (DATE) — `packages/domain/test/dates*.test.ts`, `validation*.test.ts`

| ID          | Description                                                                                                                                                                                                 | Level | Pri |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-DATE-001 | `CGT_RETROSPECTIVE`: evidence or datum effective after the retrospective-data cut-off raises a `VAL-DATE-*` result; reliance needs reasoned acknowledgement `[REVIEW: TAX]`                                 | L1    | P1  |
| TC-DATE-002 | Market commentary dated after a retrospective valuation date is blocked; commentary dated on the valuation date accepted (boundary)                                                                         | L1    | P1  |
| TC-DATE-003 | Valuation date later than report date requires a linked special-assumption record; absence is blocking `[REVIEW: API_STANDARDS]`                                                                            | L1    | P1  |
| TC-DATE-004 | Key-date ordering (instruction, inspection, valuation, research cut-off, review, issue) yields the catalogued severity per violation                                                                        | L1    | P1  |
| TC-DATE-005 | `LocalDate` rejects invalid or non-ISO input (`2026-02-30`, `30/06/2026`) and never round-trips through a JS `Date`                                                                                         | L1    | P1  |
| TC-DATE-006 | Suite runs under `TZ` = `UTC`, `Australia/Perth`, `Australia/Lord_Howe`, `Pacific/Kiritimati`; identical date results incl. AEST/AEDT transition days; "today" from injected clock + organisation time zone | L1    | P1  |
| TC-DATE-007 | Data-source effective date older than configured freshness relative to valuation date raises a stale-data warning                                                                                           | L1    | P2  |

### 3.3 Unit conversions (UNIT) — `packages/domain/test/units*.test.ts`

| ID          | Description                                                                                                           | Level | Pri |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-UNIT-001 | Exact factors: 1 ha = 10,000 m²; 1 ft² = 0.09290304 m²; 1 acre = 4,046.8564224 m²                                     | L1    | P1  |
| TC-UNIT-002 | 1 rood = 1,011.7141056 m²; 1 perch = 25.29285264 m²                                                                   | L1    | P1  |
| TC-UNIT-003 | Composite `2a 1r 15p` = 9,484.81974 m² (displayed 9,484.82 m²); roods > 3 or perches ≥ 40 rejected                    | L1    | P1  |
| TC-UNIT-004 | Converted value stores original value and unit beside canonical `m2`                                                  | L1    | P1  |
| TC-UNIT-005 | Property-based round trip for every supported unit within 1e-9 relative; linear ft ↔ m (0.3048) for sketch dimensions | L1    | P2  |
| TC-UNIT-006 | Negative, NaN and Infinity inputs rejected with typed error                                                           | L1    | P1  |

### 3.4 Valuation calculations (CALC) — `packages/domain/test/calc*.test.ts`, `apps/api/test/*.test.ts`

| ID          | Description                                                                                                                                                                                          | Level | Pri |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-CALC-001 | `land.rate_per_m2@1` = price ÷ land area; result records inputs, units, formula ID and version; improvement $/m² after land deduction                                                                | L1    | P1  |
| TC-CALC-002 | Comparable adjustments (percentage and absolute) give adjusted indications with raw inputs unchanged; rate outside configured band flagged as outlier                                                | L1    | P1  |
| TC-CALC-003 | Yield and capitalisation: initial yield, value = net income ÷ cap rate, capital adjustments applied after capitalisation; gross/net basis recorded                                                   | L1    | P1  |
| TC-CALC-004 | Effective rent from face rent with rent-free and fit-out incentives over term `[REVIEW: API_STANDARDS]`                                                                                              | L1    | P1  |
| TC-CALC-005 | WALE by income and by area; vacancies excluded; leases expired at valuation date contribute zero                                                                                                     | L1    | P1  |
| TC-CALC-006 | Replacement-cost build-up (base rate × area, services, demolition/debris, fees, escalation, GST treatment); missing cost-source edition, locality or date is blocking `[REVIEW: QUANTITY_SURVEYOR]`  | L1    | P1  |
| TC-CALC-007 | Fair-value hierarchy level = lowest level of any significant input; sensitivity grid monotonic for cap-rate and rent shifts `[REVIEW: ACCOUNTING]`                                                   | L1    | P1  |
| TC-CALC-008 | Rounding only at presentation (cents; template value increment); integer-cents DB round trip lossless; divide-by-zero or missing input gives typed error, no NaN persisted                           | L1/L2 | P1  |
| TC-CALC-009 | Override without reason rejected; accepted override keeps computed value, actor, time, needs `calculation.override`, emits `calculation.overridden`; formula version bump never alters prior results | L1/L2 | P1  |

### 3.5 Geometry and areas (GEO) — `packages/domain/test/geometry*.test.ts`, `area-schedule*.test.ts`

| ID         | Description                                                                                                                                                                                                                                                    | Level | Pri |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-GEO-001 | Shoelace area and perimeter for rectangle, L-shape and concave polygon; CW and CCW identical                                                                                                                                                                   | L1    | P1  |
| TC-GEO-002 | Open shape and self-intersecting (bow-tie) polygon flagged and not reportable                                                                                                                                                                                  | L1    | P1  |
| TC-GEO-003 | Overlapping polygons on one level counted once in totals; `GEO-OVERLAP` raised                                                                                                                                                                                 | L1    | P1  |
| TC-GEO-004 | Deductions (void, courtyard) subtract from parent; deduction outside parent flagged                                                                                                                                                                            | L1    | P1  |
| TC-GEO-005 | Two-point calibration (known 10.000 m) and stated scale (1:100 on PDF page) give expected scale factor and m²                                                                                                                                                  | L1    | P1  |
| TC-GEO-006 | Image-derived area without confirmed scale carries `GEO-SCALE-UNVERIFIED` and is excluded from reportable totals                                                                                                                                               | L1    | P1  |
| TC-GEO-007 | Recalibration creates new calibration version, recomputes dependent areas, keeps prior version and results; emits `calibration.created`, then `calibration.confirmed` on valuer confirmation                                                                   | L1/L2 | P1  |
| TC-GEO-008 | Four-point homography maps a photographed rectangle within tolerance; output labelled perspective-corrected, not surveyed                                                                                                                                      | L1    | P2  |
| TC-GEO-009 | Implausible dimensions, inconsistent floor totals and variance from supplied/online area beyond tolerance flagged (`VAL-AREA-*`)                                                                                                                               | L1    | P2  |
| TC-GEO-010 | Wall-entry polygon (lengths + angles) closes; closure error above tolerance reported; snapping to corners/grid/right angles deterministic                                                                                                                      | L1    | P2  |
| TC-GEO-011 | Schedule rows (level, component, use, basis, gross, deductions, net, source, confidence, measurer, date) link to sketch version, calibration, source plan and `measurement.approved` approver; unapproved or AI-suggested unaccepted boundaries not reportable | L1/L2 | P1  |

### 3.6 Role separation (ROLE) — `packages/domain/test/permissions*.test.ts`, `apps/api/test/*.test.ts`

| ID          | Description                                                                                                                                                                                                                                           | Level | Pri |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-ROLE-001 | Every role × permission matches the reviewed snapshot of `generated/permission-matrix.md`; every route × role returns allow/403 per route-permission map, each 403 emits `auth.denied`                                                                | L1/L2 | P1  |
| TC-ROLE-002 | Unauthenticated requests rejected on every non-health route                                                                                                                                                                                           | L2    | P1  |
| TC-ROLE-003 | Responsible valuer cannot `qa.approve` own job unless a different user holding `qa.self_approval_exception` authorised it (`qa.self_approval_exception_authorised`); template/rule-set author cannot `template.approve`/`ruleset.approve` own version | L1/L2 | P1  |
| TC-ROLE-004 | `certification.sign` succeeds only for the job's responsible valuer, as a human actor, with MFA asserted in the token                                                                                                                                 | L1/L2 | P1  |
| TC-ROLE-005 | AI and system actors denied sign, approve, accept and issue                                                                                                                                                                                           | L1    | P1  |
| TC-ROLE-006 | `FIELD_INSPECTOR` can capture inspection evidence but cannot run/override calculations, certify or issue                                                                                                                                              | L1/L2 | P1  |
| TC-ROLE-007 | `CLIENT_READONLY` sees only issued reports and invoices of its own client entities; drafts and other clients return 404                                                                                                                               | L2    | P1  |
| TC-ROLE-008 | Restricted portfolio requires explicit membership even for `ADMINISTRATOR`; other organisations' IDs return 404 (no existence leak)                                                                                                                   | L2    | P1  |
| TC-ROLE-009 | Dev-header authentication refused, and startup fails if enabled, in any environment other than local/test                                                                                                                                             | L2    | P1  |

### 3.7 Offline sync (SYNC) — `packages/domain/test/sync.test.ts`, `apps/api/test/*.test.ts`, mobile E2E

| ID          | Description                                                                                                                                                                 | Level | Pri |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-SYNC-001 | Replaying the same operation batch (same idempotency keys) twice yields identical state and no duplicate assets                                                             | L1/L2 | P1  |
| TC-SYNC-002 | Same photo content (SHA-256) uploaded twice, from one or two devices, stores one object; both references resolve                                                            | L1/L2 | P1  |
| TC-SYNC-003 | Concurrent edits to different fields of one record merge at field level without loss                                                                                        | L1    | P1  |
| TC-SYNC-004 | Concurrent edits to the same field, or delete vs update, emit `sync.conflict_detected`; both values retained until `sync.conflict_resolved`; no silent resurrection or loss | L1/L2 | P1  |
| TC-SYNC-005 | Operations against a job in `submitted` or later rejected with typed reason and retained on device                                                                          | L1/L2 | P1  |
| TC-SYNC-006 | Out-of-order batch arrival applied in causal order; partial batch failure leaves no half-applied record                                                                     | L1/L2 | P2  |
| TC-SYNC-007 | Airplane mode: create asset, 50 photos, fields and sketch offline; kill and restart app; reconnect; server state equals device state; no duplicates                         | L6    | P1  |

### 3.8 AI governance (AI) — `packages/domain/test/ai*.test.ts`

| ID        | Description                                                                                                                                                       | Level | Pri |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-AI-001 | Suggestion stores confidence, source photo, model ID/version; emits `ai.suggestion_created`; target field unchanged                                               | L1    | P1  |
| TC-AI-002 | Only human accept/edit writes the fact, with author, time and photo provenance; `ai.suggestion_accepted`/`ai.suggestion_edited` record suggested and final values | L1/L2 | P1  |
| TC-AI-003 | Prohibited inferences (concealed construction, operational condition, brand, compliance, dimensions, defects) rejected at ingestion                               | L1    | P1  |
| TC-AI-004 | Suggestion rejected (`ai.suggestion_rejected`) cannot later be applied without a new human action                                                                 | L1    | P2  |

### 3.9 Photo quality and privacy (PHOTO) — `packages/domain/test/photo*.test.ts`

| ID           | Description                                                                                                                                                                                                   | Level | Pri |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-PHOTO-001 | Blur and low-light metrics flag synthetic degraded images; sharp, well-lit references pass                                                                                                                    | L1    | P2  |
| TC-PHOTO-002 | dHash near-duplicate within Hamming threshold flagged; distinct scenes not flagged                                                                                                                            | L1    | P2  |
| TC-PHOTO-003 | Photo flagged for people, documents or number plates (`photo.privacy_flagged`) ineligible for report until consent or redaction (`photo.redacted`); original kept under restricted access `[REVIEW: PRIVACY]` | L1/L2 | P1  |

### 3.10 Validation engine (VAL) — `packages/domain/test/validation*.test.ts`

| ID         | Description                                                                                                                                                     | Level | Pri |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-VAL-001 | Missing mandatory field produces a blocking result with rule code and field ID                                                                                  | L1    | P1  |
| TC-VAL-002 | External datum lacking source, retrieval time, effective date, licence basis or verification status is blocking (G3)                                            | L1    | P1  |
| TC-VAL-003 | Warnings acknowledged with reason (`validation.acknowledged`); blocking results cannot be acknowledged                                                          | L1/L2 | P1  |
| TC-VAL-004 | Catalogue meta-test: unique codes, severity and message per rule, ≥ 1 passing and failing fixture each; results identical in content and order for one snapshot | L1    | P1  |

### 3.11 Workflow guards (WF) — `packages/domain/test/workflow.test.ts`, `apps/api/test/*.test.ts`

| ID        | Description                                                                                                                                  | Level | Pri |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-WF-001 | Exhaustive state × command table: every 00 §7 transition accepted, all others rejected; edits rejected outside `draft`, `active`, `returned` | L1/L2 | P1  |
| TC-WF-002 | `submitForQa` requires signed certification and no blocking validations; records snapshot hash                                               | L1/L2 | P1  |
| TC-WF-003 | `issue` requires `approved`, all QA findings closed, certification present and no blocking validations                                       | L1/L2 | P1  |
| TC-WF-004 | Snapshot changed after submission/approval (hash mismatch) rejects `approve` and `issue`                                                     | L1/L2 | P1  |
| TC-WF-005 | `openAmendment` from `issued` returns job to `active` as a new version; issued snapshot, PDF, sketch and area schedule unchanged             | L1/L2 | P1  |
| TC-WF-006 | Two concurrent `issue` requests: exactly one succeeds (`pg16-only`)                                                                          | L2    | P1  |

### 3.12 Audit chain integrity (AUD) — `packages/domain/test/audit.test.ts`, `apps/api/test/*.test.ts`

| ID         | Description                                                                                               | Level | Pri |
| ---------- | --------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-AUD-001 | Event hash = SHA-256 over canonical JSON incl. previous hash; chain verifies end to end                   | L1    | P1  |
| TC-AUD-002 | Altered, deleted or reordered event fails verification and reports the first broken index                 | L1    | P1  |
| TC-AUD-003 | Canonical JSON stable across key order, Unicode normalisation and number formatting                       | L1    | P1  |
| TC-AUD-004 | Every state-changing route emits its expected audit action in the same transaction (route × action table) | L2    | P1  |
| TC-AUD-005 | Stored snapshot re-hashes to its recorded hash                                                            | L1/L2 | P1  |

### 3.13 PDF output (PDF) — `apps/api/test/*.test.ts` (PDF, invoice, email)

| ID         | Description                                                                                                                     | Level | Pri |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-PDF-001 | Same snapshot rendered twice gives identical bytes and SHA-256                                                                  | L8    | P1  |
| TC-PDF-002 | Issued PDF re-rendered from its snapshot with the recorded renderer version matches the issued hash                             | L8    | P1  |
| TC-PDF-003 | Rendering does no network I/O, embeds all fonts and takes metadata times from the snapshot, not the wall clock                  | L8    | P1  |
| TC-PDF-004 | Draft watermark on non-issued output; issued output carries report ID/version; included sections match resolved requirements    | L8    | P1  |
| TC-PDF-005 | Visual golden images per template section; working sketches excluded from client report but retained in audit record            | L8    | P2  |
| TC-PDF-006 | Invoice and email-delivery records regenerate from the snapshot; email only to approved recipients; delivery updates idempotent | L2    | P1  |

### 3.14 Connector policy (CONN) — `packages/domain/test/connector*.test.ts`, adapter contract suites

| ID          | Description                                                                                                                                                          | Level | Pri |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-CONN-001 | Per-connector timeout enforced                                                                                                                                       | L1/L5 | P1  |
| TC-CONN-002 | Retries with exponential backoff and jitter for idempotent calls only, capped attempts; `429` honours `Retry-After`                                                  | L1/L5 | P1  |
| TC-CONN-003 | Circuit opens at threshold, short-circuits, half-open probe closes on success                                                                                        | L1    | P1  |
| TC-CONN-004 | Planning adapter contract suite on fixtures (found, not found, multiple parcels, schema drift) returns typed results with full provenance; `datasource.used` emitted | L5    | P1  |
| TC-CONN-005 | Connector with missing or expired licence basis disabled and makes no call; manual fallback records `manual` provenance, unverified `[REVIEW: DATA_LICENSING]`       | L1/L2 | P1  |

### 3.15 Jobs, map and migrations (JOB, MIG)

| ID         | Description                                                                                                                                                                                                        | Level | Pri |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | --- |
| TC-JOB-001 | `SINGLE` job with one asset and `PORTFOLIO` job with 1,000 assets created (`job.created`, `asset.created`); map feed returns only assets the caller may see, with coordinates, geocode confidence, status and risk | L2    | P1  |
| TC-JOB-002 | Map UI clusters pins, shows status by colour and shape/label, filters, searches, opens asset from pin, hands off navigation; current location shown only after OS permission                                       | L6/L7 | P1  |
| TC-MIG-001 | Migrations apply from empty on PGlite and PostgreSQL 16; re-run is a no-op; edited applied migration detected as checksum drift and stops startup                                                                  | L3    | P1  |
| TC-MIG-002 | Append-only triggers reject `UPDATE`/`DELETE` on audit-event and issued-snapshot tables; application role cannot `TRUNCATE` them or run DDL                                                                        | L3    | P1  |

## 4. Test data and environments

### 4.1 Synthetic data and fixtures

| Rule           | Detail                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic only | Fictitious addresses, lot/plan identifiers, parties, clients and tenants; coordinates within configured test bounding boxes; no real owner, tenant or court data.                                                    |
| Market data    | Generated sales, rentals and cost rates; nothing copied from licensed datasets `[REVIEW: DATA_LICENSING]`.                                                                                                           |
| Images         | Generated or licensed stock images with no identifiable people, plates or documents, except purpose-built synthetic privacy-test images, labelled as such.                                                           |
| Plans          | Synthetic floor plans and PDF pages with known ground-truth areas and dimensions for calibration and geometry tests.                                                                                                 |
| Factories      | Valid-by-default builders with overrides (job, asset, selection, sale, rental, lease, polygon, calibration, photo, actor by role, fixed clock at `2026-06-30`, seeded ID generator), shared by domain and API tests. |
| Scenario jobs  | One end-to-end synthetic job per MVP product (D3) reused by L2, L8 golden files, L6/L7 and UAT.                                                                                                                      |

### 4.2 Anonymised pilot data `[REVIEW: PRIVACY]`

1. Pilot and production data stay in their environments; any copy needs written approval from the
   privacy officer and the data-owning firm, with stated purpose, expiry (proposed 90 days) and
   logged access and deletion.
2. Anonymisation removes or replaces names, contacts, signatures, client, tenant and party names,
   proceeding numbers and ABNs; replaces addresses and title identifiers; shifts coordinates
   beyond a configured radius; drops photos, plans and documents by default; strips EXIF/GPS;
   bands or perturbs prices and rents to resist re-identification via public sales records.
3. A re-identification risk assessment precedes use. Anonymised copies are not valid audit records.
4. `FAMILY_LAW` matters are excluded from all copies `[REVIEW: FAMILY_LAW]`.

### 4.3 Environments

| Env        | Purpose                                         | Data                                | Database                          | Integrations                            | Auth                             |
| ---------- | ----------------------------------------------- | ----------------------------------- | --------------------------------- | --------------------------------------- | -------------------------------- |
| local      | Development                                     | Synthetic                           | PGlite or local PG16              | Stubs, fixture server                   | Dev headers allowed              |
| CI         | Automated gates                                 | Synthetic                           | PGlite (ephemeral)                | Fixtures only; outbound network blocked | Dev headers (test)               |
| staging    | Integration, PG16 suite, performance, DAST, UAT | Synthetic; approved anonymised sets | PostgreSQL 16, AU region          | Provider sandboxes; licensed canaries   | OIDC + MFA; dev headers disabled |
| pilot      | Real jobs, pilot firm                           | Real                                | PostgreSQL 16, AU region, backups | Live licensed providers                 | OIDC + MFA                       |
| production | General availability                            | Real                                | PostgreSQL 16, AU region, HA, DR  | Live licensed providers                 | OIDC/SSO + MFA                   |

### 4.4 Entry and exit criteria per release

| Release    | Entry                                                                                                                                                                                                                                                             | Exit                                                                                                                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP        | Iteration 1 suites green in CI; D1–D6 recorded or explicitly stubbed; MVP products (D3) chosen; local/CI/staging available                                                                                                                                        | AC-01…AC-09 each traced to passing P1 tests; all P1 and P2 pass in CI and nightly PG16; 0 open S1/S2; TC-SYNC-007 passes on iOS and Android; PERF-01…05 measured; 0 serious/critical axe issues; manual screen-reader pass on critical journeys; no unresolved critical/high scan findings; UAT executed (§1.9) |
| Pilot      | MVP exit met; pilot environment AU-hosted with tested backup/restore; PIA completed `[REVIEW: PRIVACY]`; pilot templates reviewed for pilot use `[REVIEW: API_STANDARDS]`; pen test with no open critical/high `[REVIEW: SECURITY]`; incident and breach runbooks | §1.10 thresholds met; PERF targets confirmed and met; resilience scenarios (§1.7) pass in staging; sign-offs for each enabled purpose                                                                                                                                                                           |
| Production | Pilot exit met; all enabled templates, rule sets and clauses in approved `reviewStatus` with specialist sign-off; external accessibility audit; pen-test retest; DR test meeting D6 RPO/RTO                                                                       | Full regression green; 0 open S1/S2; S3 on critical journeys resolved or accepted by product owner; monitoring, alerting and audit-chain verification jobs live; store-release builds pass L6 on device farm                                                                                                    |

### 4.5 Defect severity

| Sev         | Definition                                                                                                                           | Examples                                                                                                                                                                      | Gate                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| S1 Critical | Wrong or unauthorised professional output, data loss/corruption, security or privacy breach, or guardrail bypass; no safe workaround | Issue without certification or QA; wrong area or rate in issued output; lost/duplicated photos; cross-client exposure; AI writes accepted fact; tampered audit event verifies | Blocks every release; immediate fix or rollback in pilot/production; incident logged |
| S2 Major    | Core journey blocked or materially wrong; safe workaround exists                                                                     | Blocking rule not raised but caught by QA checklist; conflict UI unusable; appendix missing from draft PDF; any error in certification wording (S1 once issued)               | Blocks release                                                                       |
| S3 Moderate | Non-core function impaired or core function degraded with easy workaround; accessibility issue with an equivalent alternative path   | Filter not persisted; slow but successful sync; unclear validation message                                                                                                    | Release allowed with owner and target date                                           |
| S4 Minor    | Cosmetic, no functional impact                                                                                                       | Spacing, non-certification typo                                                                                                                                               | Backlog                                                                              |
