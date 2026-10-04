# 13 — Phased backlog

> Status: **Draft for review** · Owner: Product management · Applies to: release planning for
> Iteration 1, MVP, Pilot and Production

This section sequences delivery into four releases, lists the epics and stories, and records the
risks that drive sequencing. Vocabulary is as fixed in `00-architecture-and-conventions.md`; test
IDs (`TC-…`, `PERF-…`) refer to `12-test-plan.md`. Decisions D1–D7 are brief §12 items 1–7.

## 1. Release plan overview

### 1.1 Summary

| Release     | Goal                                                                                                                                                                            | Users                                 | Environment | Status |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------- | ------ |
| Iteration 1 | Specification, shared domain engine and API foundation                                                                                                                          | Engineering, specialist reviewers     | local, CI   | Done   |
| MVP         | End-to-end job (create → inspect offline → measure → analyse → validate → certify → QA → issue → invoice → deliver) for MVP products in the first jurisdiction; AC-01…AC-09 met | Internal test valuers, synthetic data | staging     | To do  |
| Pilot       | Real jobs for one firm, AU-hosted, to prove workflow fit, integrity and reproducibility                                                                                         | Pilot firm (proposed 5–10 users)      | pilot       | To do  |
| Production  | General availability for the customer model chosen in D1                                                                                                                        | Customers per D1                      | production  | To do  |

### 1.2 Decisions required (brief §12)

| ID  | Decision                                                                                 | Needed by                                                            | Blocks                                                               |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| D1  | Initial users and licensing model (internal firm, multi-tenant SaaS, white-label)        | MVP start                                                            | S-087, S-090, S-091, S-092                                           |
| D2  | First jurisdictions and authorised data providers                                        | MVP start                                                            | S-039, S-040, S-073, S-074, S-075, S-093                             |
| D3  | MVP report products; API/professional templates the business is licensed to use          | MVP start                                                            | S-056, S-085, S-086, UAT scripts                                     |
| D4  | Calculation scope: evidence only, practitioner-controlled calculators, or full modelling | MVP start                                                            | S-051 (MVP default assumed: practitioner-controlled calculators)     |
| D5  | Map, accounting, email, identity, e-signature and document-storage providers             | MVP (identity, map, storage, email); Pilot (e-signature, accounting) | S-032, S-033, S-034, S-036, S-039, S-058, S-060, S-070, S-071, S-072 |
| D6  | PDF branding, invoice logic, retention period, Australian hosting/security obligations   | MVP (branding, hosting); Pilot (retention, invoice logic)            | S-034, S-056, S-058, S-064, S-077, S-081, S-089                      |
| D7  | Named API/IVS, AASB 13, family-law, tax, privacy and cyber-security reviewers            | Before MVP exit                                                      | Every `[REVIEW: …]` sign-off                                         |
| —   | AI model provider and processing location (not in brief §12; proposed addition)          | Before Pilot                                                         | S-068, S-069                                                         |

### 1.3 Iteration 1 — Done

- **Goal:** fix vocabulary and architecture, specify the product, and build the shared rules
  engine and API foundation that every client will reuse.
- **Delivered:**
  - Specification sections 00–14 and generated matrices.
  - `@vp/domain`: selection vocabulary and field catalogue; versioned requirement rule set,
    resolver and diff (no data loss); unit conversions incl. acres, roods and perches; formula
    registry with traced, versioned calculations and reasoned overrides; comparable-sales
    analytics and outlier detection; income metrics (yield, capitalisation, effective rent,
    WALE); replacement-cost build-up; AASB 13 fair-value hierarchy derivation and sensitivity;
    geometry (polygon area, perimeter, simplicity, overlap; two-point and stated-scale
    calibration; homography; snapping; wall-entry polygons); area schedule with deductions,
    overlap and plausibility checks; validation engine and rules catalogue; job workflow state
    machine with certification and QA guards; RBAC with separation of duties and portfolio
    segregation; hash-chained audit and snapshots; AI suggestion governance; photo quality
    (blur, low light, perceptual-hash duplicates) and privacy eligibility; offline sync operation
    planning (idempotency, field-level merge, photo dedupe); report template schema and
    composition; planning adapter interface and connector policy (timeout, retry, circuit
    breaker).
  - `@vp/api`: Fastify service; SQL migrations with checksums; PostgreSQL/PGlite; authentication
    (dev headers for local/test only, OIDC JWT for deployed environments); job, asset,
    requirements, field, evidence, sketch, validation, certification, QA, issue, PDF and audit
    endpoints; deterministic PDF rendering; invoice and email-delivery records with stub
    transports; issue-snapshot reproduction endpoint; offline sync endpoint for assets and photos;
    append-only/immutability triggers and legal-hold guard; generated OpenAPI 3.1 contract.
  - CI workflow (format, lint, typecheck, tests, build, generated-docs check, dependency audit).
  - Revisions after product owner review of the browser preview (2026-10-03; 01 D8–D12): purpose `CGT`
    with retrospective rules derived from the dates (migration 0004); fewer per-job inputs and
    system-filled fields; input tabs (`INPUT_TABS`); the sketch as working notes with a building
    area field; one valuer, with QA only after "Sign and send to QA" in the preview.
  - Valuer profiles (01 D13, S-101): each valuer's own sign-off signature (drawn PNG or typed),
    API member number and QLD registration / WA licence, copied onto the certification at signing
    and printed with the signature in the issued PDF (migration 0005; `pdf-renderer@3`).
  - Work in progress and search (01 D14, S-102): stages and due states derived from the workflow
    and dates, stage counts and overdue, search across jobs and provider property matches.
  - Property data (01 D15, S-103, S-104): a CoreLogic (Cotality) connector ready for keys (not
    supplied, so it is not configured), sample data in development and test, property data
    suggestions with provenance, nearby-sales search, and the job map with state government map
    services. Nothing a provider returns is saved until the valuer accepts it.
  - Market commentary by property type and location (01 D17, S-109): national, state and local
    commentary required for value reports; a versioned firm library approved by a second standards
    owner (migration 0007); paragraphs matched to the property type, state, suburb and council as at
    the valuation date; one-step use with library provenance and dated records; `VAL-MKT-001` and
    `VAL-STALE-003`; the `market_commentary` report block; the Market commentary card in the preview.
    The demonstration library is placeholder text.
  - Market commentary cadence (01 D17, S-114): national and state commentary is monthly (a
    one-month limit in `VAL-STALE-003`); local commentary is offered as at the day the report is
    prepared and `VAL-MKT-002` warns before QA if it is not current; commentary is required for
    financial reporting and rental assessments too, and offered for insurance replacement.
  - Fair Market Valuations template (01 D18, S-113): the firm's working name, website and email;
    draft standard clauses in the firm's own plain-English wording for all 11 clauses, with no
    compliance claims and no limited-liability scheme statement; clauses of several paragraphs;
    clause placeholder and logo lint; template branding with logo, website, email, phone and ABN;
    the logo and contact line on the PDF cover (`pdf-renderer@4`). The preview and the API demo
    use it. The clauses stay drafts until approved (S-116), and the logo is still to come (S-115).
- **Not delivered:** mobile app (Expo), web portal, live third-party integrations, e-signature
  provider, AI model integration, object storage, production infrastructure.
- **Exit criteria:** CI gates pass; spec sections in **Draft for review**; L1/L2 tests exist for
  each AC-09 area that does not need a client UI.
- **Decision dependencies:** none resolved. Built with neutral defaults: providers behind
  interfaces; templates and rule sets in `placeholder`/`draft` `reviewStatus`.
- **Sign-offs:** none required to close. Review of sections 00–14 requested from every role in
  00 §6.

### 1.4 MVP

- **Goal:** a valuer and a QA reviewer complete a full job for each MVP product (D3) in the first
  jurisdiction (D2), on staging with synthetic data, meeting AC-01…AC-09.
- **In scope:** mobile app (phone, tablet) with encrypted offline store and sync; web portal
  (allocation, evidence, validation, QA, issue, template admin); AU-region object storage;
  OIDC + MFA; map provider; first planning adapter with manual fallback; Areas & Sketch on
  mobile and web; evidence and calculators; market commentary; certification by in-app signing
  with MFA step-up; QA; MVP templates; PDF issue; invoice; email via provider sandbox;
  observability baseline; staging environment; UAT.
- **Out of scope:** AI model integration (governance only), e-signature provider, accounting
  integration, hazard and sales-data feeds, retention automation, client portal, additional
  jurisdictions.
- **Exit criteria:** `12-test-plan.md` §4.4 MVP exit; UAT completed; open `[REVIEW: …]` items
  listed with owner and date.
- **Decision dependencies:** D1–D6 recorded (S-031); D7 reviewers nominated before exit.
- **Sign-offs:**
  - `[REVIEW: API_STANDARDS]` MVP templates, certification clauses and rule sets cleared for
    pilot use.
  - `[REVIEW: LEGAL]` the firm's standard clauses, also seen by its professional indemnity insurer
    (S-116).
  - `[REVIEW: SECURITY]` threat model and ASVS L2 mapping.
  - `[REVIEW: PRIVACY]` draft PIA and permission prompts.
  - `[REVIEW: DATA_LICENSING]` first planning adapter, geocoder and map terms (incl. offline
    caching); CoreLogic (Cotality) licence and state government map service terms (S-105).
  - Purpose-specific, where the purpose is in D3: `[REVIEW: TAX]`, `[REVIEW: FAMILY_LAW]`,
    `[REVIEW: ACCOUNTING]`, `[REVIEW: QUANTITY_SURVEYOR]`.

### 1.5 Pilot

- **Goal:** run real jobs for one firm in an AU-hosted pilot environment and prove workflow fit,
  data integrity and reproducibility before general availability.
- **In scope:** e-signature; accounting export; live email; AI photo suggestions (feature-flagged,
  off until the PIA covers it); hazard adapters; second jurisdiction; licensed sales/rental
  import; retention and legal hold; backups and restore; penetration test; incident and breach
  logging; portfolio bulk import; amendments; additional purposes per D3; the firm's own market
  commentary library (S-112); pilot acceptance.
- **Exit criteria:** `12-test-plan.md` §1.10 thresholds and §4.4 Pilot exit; go/no-go decision
  recorded.
- **Decision dependencies:** D2 (second jurisdiction, data providers), D5 (e-signature,
  accounting), D6 (retention, invoice logic), D7, AI provider decision.
- **Sign-offs:**
  - `[REVIEW: LEGAL]` pilot terms, reliance wording, e-signature use.
  - `[REVIEW: PRIVACY]` final PIA incl. AI processing and data-processing agreements.
  - `[REVIEW: SECURITY]` penetration-test closure.
  - `[REVIEW: DATA_LICENSING]` each live connector.
  - `[REVIEW: API_STANDARDS]` and purpose-specific reviewers for every enabled product.

### 1.6 Production

- **Goal:** general availability under the D1 model with production SLOs, disaster recovery and
  app-store distribution.
- **In scope:** production environment (HA, DR); SSO federation; tenant isolation hardening (if
  multi-tenant); white-label (if D1); remaining jurisdictions as licensed; app-store release;
  SIEM; SLOs and on-call; client read-only portal; financial-reporting disclosure-support
  export; insurance product at scale; external accessibility audit.
- **Exit criteria:** `12-test-plan.md` §4.4 Production exit; every enabled template, rule set and
  clause in approved `reviewStatus`.
- **Decision dependencies:** D1, D2, D5, D6.
- **Sign-offs:**
  - All applicable `[REVIEW: …]` roles for every enabled product and jurisdiction.
  - `[REVIEW: LEGAL]` customer terms, liability and reliance.
  - `[REVIEW: SECURITY]` penetration-test retest.
  - `[REVIEW: PRIVACY]` APP review and retention schedule.

### 1.7 MVP increments

| Increment | Focus                             | Stories                                                       | Demonstration at exit                                                                                   |
| --------- | --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| M1        | Foundations                       | S-031, S-032, S-033, S-034, S-060, S-061, S-063, S-064, S-065 | MFA login on mobile and web against staging; file stored and retrieved from AU-region storage           |
| M2        | Jobs, selection and property data | S-035, S-036, S-037, S-038, S-039, S-040, S-053, S-059        | Portfolio job on the map; selection change keeps data; planning data with provenance or manual fallback |
| M3        | Inspection and sync               | S-041, S-042, S-043, S-044, S-045, S-046, S-066               | Airplane-mode inspection synchronised without duplicates (TC-SYNC-007)                                  |
| M4        | Measure and analyse               | S-047, S-048, S-049, S-050, S-051, S-052                      | Photographed plan calibrated to an approved area schedule; traced calculation with reasoned override    |
| M5        | Certify, review, issue            | S-054, S-055, S-056, S-057, S-058, S-062, S-067               | Certified, reviewed and issued report re-rendered to the same hash; UAT complete                        |

Critical path: D1–D6 → S-031 → S-032/S-033 → S-042 → S-062 → S-067 → MVP exit. Pilot additionally
depends on D7 and the `[REVIEW: API_STANDARDS]` sign-off of MVP templates.

### 1.8 Acceptance-criteria delivery map

| AC    | Iteration 1 (domain/API)   | MVP stories                                           | Tests (`12-test-plan.md`)        |
| ----- | -------------------------- | ----------------------------------------------------- | -------------------------------- |
| AC-01 | S-016, S-025               | S-035, S-036                                          | TC-JOB-001…002, TC-ROLE-007…008  |
| AC-02 | S-003, S-004               | S-037                                                 | TC-FLD-001…008                   |
| AC-03 | S-020                      | S-032, S-042, S-043                                   | TC-SYNC-001…007, PERF-01         |
| AC-04 | S-005…S-010                | S-050, S-051                                          | TC-CALC-001…009, TC-UNIT-001…006 |
| AC-05 | S-018                      | — (no AI model at MVP; suggestion UI in S-068, Pilot) | TC-AI-001…004                    |
| AC-06 | S-014, S-015, S-027        | S-053, S-054, S-055, S-057                            | TC-WF-001…006, TC-VAL-001…004    |
| AC-07 | S-017, S-028, S-029        | S-034, S-057, S-058                                   | TC-PDF-001…007, TC-AUD-001…005   |
| AC-08 | S-011, S-012, S-013, S-026 | S-047, S-048, S-049                                   | TC-GEO-001…011                   |
| AC-09 | S-030                      | S-061, S-062                                          | All catalogue groups             |

### 1.9 Sign-off register

| Reviewer            | MVP                                                                                                                                                  | Pilot                                                                                    | Production                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `API_STANDARDS`     | MVP templates, certification clauses, rule sets (S-054, S-056); the firm's standard clauses (S-116); commentary topics and thresholds (S-109, S-114) | Each enabled product; pilot reliance with `LEGAL`; the firm's commentary library (S-112) | Approved `reviewStatus` for all enabled content (S-092) |
| `FAMILY_LAW`        | Only if in D3                                                                                                                                        | `FAMILY_LAW` template wording (S-085)                                                    | Template changes                                        |
| `TAX`               | Only if in D3                                                                                                                                        | `CGT` checklist and retrospective cut-off logic (S-086, 01 D8)                           | Template changes                                        |
| `ACCOUNTING`        | Fair-value logic (S-010) if `FINANCIAL_REPORTING` in D3                                                                                              | Enabled financial-reporting templates                                                    | Disclosure-support export (S-097)                       |
| `PRIVACY`           | Draft PIA, permission prompts, redaction (S-046, S-065)                                                                                              | Final PIA, AI processing, retention, breach handling (S-068, S-077, S-080)               | APP review, store privacy labels (S-094)                |
| `SECURITY`          | Threat model, ASVS L2 mapping (S-065)                                                                                                                | Pen-test closure (S-079)                                                                 | Retest, tenant isolation (S-091)                        |
| `DATA_LICENSING`    | Map, geocoder, first planning adapter (S-036, S-039, S-040)                                                                                          | Each live connector (S-073…S-076); sources quoted in commentary (S-112)                  | Remaining adapters (S-093)                              |
| `QUANTITY_SURVEYOR` | Cost build-up (S-009) if `INSURANCE_REPLACEMENT` in D3                                                                                               | Cost-guide inputs (S-076)                                                                | Insurance product at scale (S-098)                      |
| `LEGAL`             | The firm's standard clauses, with the professional indemnity insurer (S-116)                                                                         | Pilot terms, e-signature, breach runbooks (S-070, S-080, S-088)                          | Customer terms, client portal (S-099)                   |

### 1.10 Out of scope for this plan

| Item                                                                                           | Reason                                                                                 |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| AI-determined value, AI certification or AI-issued reports                                     | Prohibited (00 §1 G2)                                                                  |
| Scraping or republishing restricted data; treating public tiles or portals as bulk-data rights | Prohibited (brief §1, §8; G3)                                                          |
| Full valuation modelling (DCF engines, automated valuation models)                             | Pending D4; MVP assumes practitioner-controlled calculators                            |
| Surveyed or certified measurement claims, 3D/BIM measurement                                   | Brief §6 limits MVP to basic 2D; perspective correction is never presented as surveyed |
| Reproduction of proprietary API templates, Rawlinsons data or AIQS publications                | Only with a licence `[REVIEW: DATA_LICENSING]`                                         |

## 2. Epics

| Epic | Name                             | Scope                                                                                                                                                                                 | Brief ref    | Releases               |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- |
| E-01 | Jobs & allocation                | Jobs, single/portfolio assets, engagement acceptance, allocation, conflicts, map, client portal                                                                                       | §4, §5, §7.1 | MVP–Production         |
| E-02 | Selection & requirements         | Selection vocabulary, rule sets, resolver, diff, purpose products                                                                                                                     | §2, §3, §7.2 | Iteration 1–Production |
| E-03 | Property data & provenance       | Instruction, dates, location, land, improvements, occupancy, provenance, geocoding, data imports                                                                                      | §1, §4, §7.3 | MVP–Pilot              |
| E-04 | Planning/hazard adapters         | Adapter interface, connector policy, jurisdiction planning and hazard adapters                                                                                                        | §4, §8       | Iteration 1–Production |
| E-05 | Mobile inspection & offline sync | App shell, checklists, offline store, sync, conflicts, route planning, voice and document capture                                                                                     | §5, §7.4, §8 | Iteration 1–Pilot      |
| E-06 | Photo intelligence & privacy     | Capture, quality checks, AI suggestions, privacy flagging and redaction                                                                                                               | §5           | Iteration 1–Pilot      |
| E-07 | Areas & Sketch                   | Geometry, calibration, sketch workspace, area schedule, approval, AI-assisted outlines                                                                                                | §6           | Iteration 1–Pilot      |
| E-08 | Evidence & calculations          | Comparables, adjustments, formulas, income, cost, fair value, calculators                                                                                                             | §4, §7.5     | Iteration 1–Production |
| E-09 | Market commentary                | Firm library of dated national/state/local paragraphs by property type and location, versioned and approved; date, source and author on each job's commentary; retrospective blocking | §4           | Iteration 1–Pilot      |
| E-10 | Validation                       | Validation engine, rules catalogue, validation panel, acknowledgement                                                                                                                 | §7.6         | Iteration 1–MVP        |
| E-11 | Certification                    | Template-driven certification, MFA signing, e-signature                                                                                                                               | §7.7         | MVP–Pilot              |
| E-12 | QA                               | Checklist, findings, severity, disposition, approve/return, self-approval exception                                                                                                   | §7.8         | Iteration 1–MVP        |
| E-13 | Reporting & PDF                  | Template schema, composition, deterministic PDF, issue, amendments, branding                                                                                                          | §7.9         | Iteration 1–Production |
| E-14 | Invoicing & delivery             | Invoice, approved-recipient email, delivery status, accounting export                                                                                                                 | §7.9         | Iteration 1–Pilot      |
| E-15 | Security, privacy & retention    | Authentication, MFA, RBAC, audit, retention, legal hold, breach handling, pen test, tenant isolation                                                                                  | §8           | Iteration 1–Production |
| E-16 | Platform, DevOps & observability | Monorepo, CI, environments, IaC, OpenAPI, E2E, observability, DR, app-store release, UAT                                                                                              | §8, §11      | Iteration 1–Production |

## 3. Story backlog

Priority is MoSCoW for the story's release. Size: **S** ≤ 3 days · **M** ≤ 1 week · **L** ≤ 3 weeks
· **XL** > 3 weeks (split before sprint planning). Iteration 1 stories count towards the MVP release.

Stories written "as a field inspector" apply to the valuer, who inspects in the default workflow;
a separate field inspector is optional (01 D12). Capture screens follow the input tabs (01 D10).

### 3.1 Iteration 1 (release MVP, Done)

| ID    | Epic | Story                                                                                                                                                                                                                                                                                                                        | Rel | Pri    | Size | Deps                                                       | Status |
| ----- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------ | ---- | ---------------------------------------------------------- | ------ |
| S-001 | E-16 | As a delivery team, I want specification sections 00–14 and generated matrices, so that build and specialist review work from one versioned source.                                                                                                                                                                          | MVP | Must   | L    | —                                                          | Done   |
| S-002 | E-02 | As a valuer, I want a fixed selection vocabulary and field catalogue, so that every job uses the same jurisdiction, purpose, type, scope and field codes.                                                                                                                                                                    | MVP | Must   | M    | S-001                                                      | Done   |
| S-003 | E-02 | As a standards owner, I want a versioned requirement rule set and resolver, so that purpose × type × scope × jurisdiction drives fields, sections and warnings.                                                                                                                                                              | MVP | Must   | L    | S-002                                                      | Done   |
| S-004 | E-02 | As a valuer, I want a requirements diff on selection change, so that I see what changed and lose no entered data.                                                                                                                                                                                                            | MVP | Must   | M    | S-003                                                      | Done   |
| S-005 | E-08 | As a valuer, I want conversions for ha, ft², acres, roods and perches, so that legacy title areas convert to m² with the original kept.                                                                                                                                                                                      | MVP | Must   | S    | —                                                          | Done   |
| S-006 | E-08 | As a valuer, I want a formula registry with traced, versioned calculations and reasoned overrides, so that every rate traces to inputs, units, formula and version.                                                                                                                                                          | MVP | Must   | L    | S-005                                                      | Done   |
| S-007 | E-08 | As a valuer, I want comparable-sales analytics and outlier detection, so that unusual rates are flagged before I rely on them.                                                                                                                                                                                               | MVP | Must   | M    | S-006                                                      | Done   |
| S-008 | E-08 | As a valuer, I want yield, capitalisation, effective rent and WALE metrics, so that income approaches are computed consistently.                                                                                                                                                                                             | MVP | Must   | M    | S-006 · `[REVIEW: API_STANDARDS]`                          | Done   |
| S-009 | E-08 | As a valuer, I want a replacement-cost build-up, so that insurance assessments show every component and its source.                                                                                                                                                                                                          | MVP | Should | M    | S-006 · `[REVIEW: QUANTITY_SURVEYOR]`                      | Done   |
| S-010 | E-08 | As a valuer, I want AASB 13 fair-value hierarchy derivation and sensitivity, so that financial-reporting disclosures are supported.                                                                                                                                                                                          | MVP | Should | M    | S-006 · `[REVIEW: ACCOUNTING]`                             | Done   |
| S-011 | E-07 | As a valuer, I want polygon area, perimeter, simplicity and overlap checks, so that measured areas are correct and never double-counted.                                                                                                                                                                                     | MVP | Must   | L    | —                                                          | Done   |
| S-012 | E-07 | As a valuer, I want two-point and stated-scale calibration, homography, snapping and wall-entry polygons, so that I can measure from plans or by entering lengths.                                                                                                                                                           | MVP | Must   | L    | S-011                                                      | Done   |
| S-013 | E-07 | As a valuer, I want an area schedule with deductions, overlap and plausibility checks, so that reported areas are explained and checked.                                                                                                                                                                                     | MVP | Must   | M    | S-011, S-012                                               | Done   |
| S-014 | E-10 | As a valuer, I want a validation engine and rules catalogue, so that missing, inconsistent or stale data is flagged with a code and severity.                                                                                                                                                                                | MVP | Must   | L    | S-003                                                      | Done   |
| S-015 | E-01 | As a QA reviewer, I want a job workflow state machine with certification and QA guards, so that no report can be issued out of sequence.                                                                                                                                                                                     | MVP | Must   | L    | S-014                                                      | Done   |
| S-016 | E-15 | As an administrator, I want RBAC with separation of duties and portfolio segregation, so that users see and do only what their role allows.                                                                                                                                                                                  | MVP | Must   | M    | —                                                          | Done   |
| S-017 | E-15 | As a QA reviewer, I want hash-chained audit events and snapshots, so that tampering is detectable and issued output is reproducible.                                                                                                                                                                                         | MVP | Must   | M    | —                                                          | Done   |
| S-018 | E-06 | As a valuer, I want AI suggestion governance (accept/edit/reject, prohibited inferences), so that no AI output becomes a fact without my confirmation.                                                                                                                                                                       | MVP | Must   | M    | S-016, S-017                                               | Done   |
| S-019 | E-06 | As a field inspector, I want blur, low-light and duplicate detection and privacy eligibility, so that unusable or sensitive photos are caught.                                                                                                                                                                               | MVP | Should | M    | —                                                          | Done   |
| S-020 | E-05 | As a field inspector, I want sync planning with idempotency, field-level merge and photo dedupe, so that syncing never duplicates or loses work.                                                                                                                                                                             | MVP | Must   | L    | S-017                                                      | Done   |
| S-021 | E-13 | As a standards owner, I want a report template schema and composition, so that report sections follow the resolved requirements and template version.                                                                                                                                                                        | MVP | Must   | M    | S-003                                                      | Done   |
| S-022 | E-04 | As a valuer, I want a planning adapter interface and connector policy (timeout, retry, circuit breaker), so that outages degrade safely to manual entry.                                                                                                                                                                     | MVP | Must   | M    | —                                                          | Done   |
| S-023 | E-16 | As an engineer, I want a Fastify API with checksummed SQL migrations on PostgreSQL/PGlite, so that the schema is migration-controlled and tests use real SQL.                                                                                                                                                                | MVP | Must   | L    | —                                                          | Done   |
| S-024 | E-15 | As a security reviewer, I want dev-header auth limited to local/test and OIDC JWT in deployed environments, so that test shortcuts cannot reach real data.                                                                                                                                                                   | MVP | Must   | M    | S-023                                                      | Done   |
| S-025 | E-01 | As an allocator, I want job, asset, requirements and field endpoints, so that clients can create jobs and record data.                                                                                                                                                                                                       | MVP | Must   | L    | S-003, S-023                                               | Done   |
| S-026 | E-08 | As a valuer, I want evidence and sketch endpoints, so that comparables and measurements persist with provenance.                                                                                                                                                                                                             | MVP | Must   | M    | S-025                                                      | Done   |
| S-027 | E-12 | As a QA reviewer, I want validation, certification, QA, issue and audit endpoints, so that the guarded workflow is enforced server-side.                                                                                                                                                                                     | MVP | Must   | L    | S-015, S-025                                               | Done   |
| S-028 | E-13 | As a valuer, I want deterministic PDF rendering from snapshots, so that an issued report is reproducible byte for byte.                                                                                                                                                                                                      | MVP | Must   | L    | S-017, S-021                                               | Done   |
| S-029 | E-14 | As a finance officer, I want invoice and email-delivery records with stub transports, so that delivery is recorded before providers are chosen.                                                                                                                                                                              | MVP | Must   | M    | S-027                                                      | Done   |
| S-030 | E-16 | As an engineer, I want a CI workflow (format, lint, typecheck, tests), so that every change is gated.                                                                                                                                                                                                                        | MVP | Must   | S    | —                                                          | Done   |
| S-101 | E-11 | As a responsible valuer, I want my own profile with my sign-off signature, API member number and QLD registration / WA licence, copied onto every certification I sign, so that reports show who signed and I cannot sign a QLD or WA report without my registration (01 D13).                                               | MVP | Must   | M    | S-054 · `[REVIEW: API_STANDARDS]` `[REVIEW: LEGAL]`        | Done   |
| S-102 | E-01 | As a valuer or allocator, I want a work-in-progress list with stages, due states, counts and one search box across jobs and properties, so that I see what is due next and find any job quickly (01 D14).                                                                                                                    | MVP | Must   | M    | S-025                                                      | Done   |
| S-103 | E-03 | As a valuer, I want property facts, sales history, nearby sales and an automated cross-check from CoreLogic (Cotality), or clearly labelled sample data until keys are supplied, offered as suggestions with provenance that I accept, so that I enter less by hand without losing attribution (01 D15).                     | MVP | Must   | L    | S-026 · `[REVIEW: DATA_LICENSING]`                         | Done   |
| S-104 | E-01 | As a valuer, I want each job's map with my state's government map service and viewer link, so that I can check planning and title layers for the property (01 D15).                                                                                                                                                          | MVP | Should | S    | S-036 · `[REVIEW: DATA_LICENSING]`                         | Done   |
| S-109 | E-09 | As a valuer, I want national, state and local market commentary from the firm's approved, dated library, matched to the property type, state, suburb and council as at the valuation date, that I use with one tap and then tailor, so that every report has consistent commentary with its as-at date and sources (01 D17). | MVP | Must   | M    | S-014, S-021, S-026 · `[REVIEW: API_STANDARDS]`            | Done   |
| S-113 | E-13 | As a standards owner, I want Fair Market Valuations' own report template, with the firm's name, website and email and draft standard clauses written for the firm in plain English, so that reports carry the firm's letterhead and wording while the final wording is reviewed (01 D18).                                    | MVP | Must   | M    | S-021, S-028 · `[REVIEW: LEGAL]` `[REVIEW: API_STANDARDS]` | Done   |
| S-114 | E-09 | As a valuer, I want national and state commentary held to its monthly edition and local commentary kept current to the day the report is prepared, with a warning before QA when newer local commentary has been approved, so that every report goes out with up-to-date commentary (01 D17).                                | MVP | Must   | S    | S-109 · `[REVIEW: API_STANDARDS]`                          | Done   |

### 3.2 MVP (To do)

| ID    | Epic | Story                                                                                                                                                                                                                                                                                                    | Rel | Pri    | Size | Deps                                                    | Status |
| ----- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------ | ---- | ------------------------------------------------------- | ------ |
| S-031 | E-16 | As a product owner, I want D1–D6 recorded as ADRs (incl. confirming ADR-002 and ADR-008), so that the MVP build does not rest on unconfirmed assumptions.                                                                                                                                                | MVP | Must   | S    | D1–D6                                                   | To do  |
| S-032 | E-05 | As a field inspector, I want an Expo app with SQLCipher store, OIDC (PKCE) login and the shared domain library, so that I can work securely offline.                                                                                                                                                     | MVP | Must   | L    | D5, S-024                                               | To do  |
| S-033 | E-16 | As an allocator, I want a web portal with OIDC login and role-aware navigation, so that office roles work in a browser.                                                                                                                                                                                  | MVP | Must   | L    | D5, S-024                                               | To do  |
| S-034 | E-16 | As a valuer, I want photos, plans and PDFs in AU-region encrypted object storage with object-lock for issued artefacts, so that files are durable and issued copies immutable.                                                                                                                           | MVP | Must   | M    | D5, D6                                                  | To do  |
| S-035 | E-01 | As an allocator, I want to create a job with one or many assets, record engagement acceptance and conflicts, and allocate valuer and reviewer, so that work is assigned accountably.                                                                                                                     | MVP | Must   | M    | S-025, S-033                                            | To do  |
| S-036 | E-01 | As a valuer, I want a permission-aware map with clusters, status/risk styling, filters, search, open-from-pin and navigation handoff, so that I can manage single and portfolio jobs (AC-01).                                                                                                            | MVP | Must   | L    | D5, S-032, S-035 · `[REVIEW: DATA_LICENSING]`           | To do  |
| S-037 | E-02 | As a valuer, I want the selection step to update fields and sections instantly without losing data, so that I can correct scope safely (AC-02).                                                                                                                                                          | MVP | Must   | M    | S-004, S-032, S-033                                     | To do  |
| S-038 | E-03 | As a valuer, I want to capture instruction, key dates, location, land, improvements, occupancy, assumptions and limitations with provenance and verification status, so that every datum is attributable.                                                                                                | MVP | Must   | L    | S-037                                                   | To do  |
| S-039 | E-03 | As a valuer, I want address geocoding with confidence and a manual pin, so that assets map correctly.                                                                                                                                                                                                    | MVP | Should | M    | D2, D5, S-022 · `[REVIEW: DATA_LICENSING]`              | To do  |
| S-040 | E-04 | As a valuer, I want zone and overlays from the first jurisdiction's planning adapter, or manual entry with an uploaded planning report, so that planning data is sourced and dated.                                                                                                                      | MVP | Must   | L    | D2, S-022 · `[REVIEW: DATA_LICENSING]`                  | To do  |
| S-041 | E-05 | As a field inspector, I want guided room/area checklists with offline autosave, so that inspections are complete without connectivity.                                                                                                                                                                   | MVP | Must   | L    | S-032, S-037                                            | To do  |
| S-042 | E-05 | As a field inspector, I want offline work to sync without duplicate assets or photos, so that nothing is lost or doubled (AC-03).                                                                                                                                                                        | MVP | Must   | XL   | S-020, S-032, S-034                                     | To do  |
| S-043 | E-05 | As a valuer, I want to see and resolve sync conflicts field by field, so that concurrent edits are never silently overwritten.                                                                                                                                                                           | MVP | Must   | M    | S-042                                                   | To do  |
| S-044 | E-06 | As a field inspector, I want camera capture with timestamp, optional GPS, sequence, captions and annotations, so that photos are organised evidence.                                                                                                                                                     | MVP | Must   | L    | S-032, S-034                                            | To do  |
| S-045 | E-06 | As a field inspector, I want blur, low-light and duplicate warnings at capture, so that I can retake photos on site.                                                                                                                                                                                     | MVP | Should | M    | S-019, S-044                                            | To do  |
| S-046 | E-06 | As a valuer, I want privacy flagging, consent recording and redaction before photos enter a report, so that personal information is protected.                                                                                                                                                           | MVP | Must   | M    | S-019, S-044 · `[REVIEW: PRIVACY]`                      | To do  |
| S-047 | E-07 | As a valuer on phone or tablet, I want to import or photograph a plan, calibrate, draw or confirm boundaries and choose the measurement basis, so that I can measure on site (AC-08).                                                                                                                    | MVP | Must   | XL   | S-012, S-013, S-032                                     | To do  |
| S-048 | E-07 | As a valuer on web, I want the same Areas & Sketch workspace, so that I can measure from plans in the office.                                                                                                                                                                                            | MVP | Must   | L    | S-033, S-047                                            | To do  |
| S-049 | E-07 | As a valuer, where the report relies on a measured schedule, I want to approve it and trace each area to source, sketch version and approver, so that reported areas are defensible (01 D11).                                                                                                            | MVP | Must   | M    | S-047                                                   | To do  |
| S-050 | E-08 | As a valuer, I want sales and rental evidence tabs with adjustments and adjusted indications, so that comparables are analysed consistently.                                                                                                                                                             | MVP | Must   | L    | S-007, S-026                                            | To do  |
| S-051 | E-08 | As a valuer, I want calculators that show inputs, units, formula and version and accept overrides only with a reason, so that rates are traceable (AC-04).                                                                                                                                               | MVP | Must   | M    | D4, S-006                                               | To do  |
| S-052 | E-09 | As a valuer, I want national, state and local commentary with date, source and author, blocked after a retrospective valuation date, so that commentary fits the valuation date. The rules, library and API are done (S-109); this story is the Market commentary card in the web portal and mobile app. | MVP | Should | M    | S-014, S-033, S-109                                     | To do  |
| S-053 | E-10 | As a valuer, I want a validation panel with blocking and warning results and reasoned acknowledgement, so that I resolve issues before submission.                                                                                                                                                       | MVP | Must   | M    | S-014, S-033                                            | To do  |
| S-054 | E-11 | As a responsible valuer, I want template-driven certification signed by me with MFA step-up, so that only I can certify my valuation.                                                                                                                                                                    | MVP | Must   | M    | S-027, S-060 · `[REVIEW: API_STANDARDS]`                | To do  |
| S-055 | E-12 | As a QA reviewer, I want a checklist, findings with severity and disposition, and approve/return actions, so that independent review is recorded.                                                                                                                                                        | MVP | Must   | L    | S-027, S-033                                            | To do  |
| S-056 | E-13 | As a standards owner, I want MVP report templates (draft `reviewStatus`) with photo, map, evidence and area-schedule content (the sketch drawing is working notes, 01 D11), so that MVP products can be generated.                                                                                       | MVP | Must   | L    | D3, D6, S-021 · `[REVIEW: API_STANDARDS]`               | To do  |
| S-057 | E-13 | As a valuer, I want issue to produce a watermarked final PDF stored immutably and reproducible from its snapshot, so that issued reports cannot drift (AC-06, AC-07).                                                                                                                                    | MVP | Must   | M    | S-028, S-034, S-055                                     | To do  |
| S-058 | E-14 | As a finance officer, I want a separate invoice and email to approved recipients via a provider sandbox with delivery status, so that delivery is controlled and recorded.                                                                                                                               | MVP | Must   | M    | D5, D6, S-029                                           | To do  |
| S-059 | E-15 | As a standards owner, I want template and rule-set authoring and approval in the portal (author ≠ approver), so that changes are controlled and audited.                                                                                                                                                 | MVP | Should | M    | S-033                                                   | To do  |
| S-060 | E-15 | As a security reviewer, I want MFA enforced, session limits, and dev-header auth impossible in deployed environments, so that accounts are protected.                                                                                                                                                    | MVP | Must   | M    | D5, S-024                                               | To do  |
| S-061 | E-16 | As an integrator, I want a published OpenAPI contract with contract tests and breaking-change checks, so that clients and API stay compatible.                                                                                                                                                           | MVP | Must   | M    | S-023                                                   | To do  |
| S-062 | E-16 | As a QA engineer, I want mobile and web E2E suites incl. airplane-mode scenarios, so that AC-01…AC-09 are verified end to end.                                                                                                                                                                           | MVP | Must   | L    | S-032, S-033                                            | To do  |
| S-063 | E-16 | As an operator, I want structured logs without personal information, traces, metrics and error reporting, so that faults are diagnosable.                                                                                                                                                                | MVP | Should | M    | S-023                                                   | To do  |
| S-064 | E-16 | As an operator, I want an AU-region staging environment provisioned by infrastructure-as-code, so that integration, performance and UAT run on production-like infrastructure.                                                                                                                           | MVP | Must   | L    | D6                                                      | To do  |
| S-065 | E-15 | As a security reviewer, I want the threat model, ASVS L2 mapping and draft PIA completed for MVP scope, so that risks are known before real data is used.                                                                                                                                                | MVP | Must   | M    | `[REVIEW: SECURITY]` · `[REVIEW: PRIVACY]`              | To do  |
| S-066 | E-05 | As a field inspector, I want voice-to-text notes and barcode/document capture, so that I can record observations and documents quickly on site.                                                                                                                                                          | MVP | Could  | M    | S-041, S-044                                            | To do  |
| S-067 | E-16 | As a product owner, I want UAT by practising valuers on synthetic jobs, so that workflow fit is confirmed before Pilot.                                                                                                                                                                                  | MVP | Must   | M    | S-062                                                   | To do  |
| S-105 | E-03 | As a data-licensing reviewer, I want the CoreLogic (Cotality) licence confirmed, the endpoint paths and response fields checked on the developer portal, and the API keys placed in the secret store, so that live property data can be switched on (04 §4.1).                                           | MVP | Must   | S    | S-103, D15 · `[REVIEW: DATA_LICENSING]`                 | To do  |
| S-106 | E-01 | As a valuer, I want the WIP home, search, property data card and job map in the web portal and mobile app, so that I can use them in the office and in the field (05 J-14).                                                                                                                              | MVP | Must   | M    | S-032, S-033, S-102–S-104                               | To do  |
| S-107 | E-08 | As a valuer, I want sales evidence to keep its coordinates, so that comparable sales appear on the job map with their distance from the subject.                                                                                                                                                         | MVP | Should | S    | S-103                                                   | To do  |
| S-108 | E-02 | As a valuer, I want units, apartments and townhouses (including strata, community, stratum and company title) to ask the right questions, so that strata lots are valued on internal area with the scheme's levies and defects recorded.                                                                 | MVP | Must   | M    | S-003                                                   | Done   |
| S-110 | E-09 | As a standards owner, I want a library screen in the web portal to list, write, edit, withdraw and approve commentary paragraph versions, so that the firm keeps its commentary current without using the API directly (05 J-12).                                                                        | MVP | Should | M    | S-033, S-109 · `[REVIEW: API_STANDARDS]`                | To do  |
| S-115 | E-13 | As the business owner, I want to supply the firm's logo (PNG or JPEG) and have it added to a new version of the firm template, so that it prints on the report cover (01 D18).                                                                                                                           | MVP | Should | S    | S-113                                                   | To do  |
| S-116 | E-13 | As a standards owner, I want each of the firm's draft standard clauses reviewed by the firm's lawyer, its professional indemnity insurer and the specialists named on the clause, then approved by a second standards owner, so that real reports can be issued on the firm's own wording (01 D18).      | MVP | Must   | M    | S-113, D7 · `[REVIEW: LEGAL]` `[REVIEW: API_STANDARDS]` | To do  |

### 3.3 Pilot (To do)

| ID    | Epic | Story                                                                                                                                                                                                                                                                                                                                   | Rel   | Pri    | Size | Deps                                                               | Status |
| ----- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ---- | ------------------------------------------------------------------ | ------ |
| S-068 | E-06 | As a valuer, I want AI photo classification and attribute suggestions with confidence, source photo and accept/edit/reject, so that capture is faster without unconfirmed facts (AC-05).                                                                                                                                                | Pilot | Should | L    | AI provider decision, S-018, S-044 · `[REVIEW: PRIVACY]`           | To do  |
| S-069 | E-07 | As a valuer, I want AI-suggested edges, corners and room labels and perspective correction for photographed plans, so that sketching is faster while I confirm every boundary.                                                                                                                                                          | Pilot | Could  | L    | S-047, S-068                                                       | To do  |
| S-070 | E-11 | As a responsible valuer, I want to sign certification via the chosen e-signature provider, so that signatures meet the firm's evidentiary requirements.                                                                                                                                                                                 | Pilot | Should | M    | D5, S-054 · `[REVIEW: LEGAL]`                                      | To do  |
| S-071 | E-14 | As a finance officer, I want invoices exported to the chosen accounting system, so that billing is not re-keyed.                                                                                                                                                                                                                        | Pilot | Should | M    | D5, D6, S-058                                                      | To do  |
| S-072 | E-14 | As a finance officer, I want live email delivery with bounce and delivery-status webhooks, so that delivery records are accurate.                                                                                                                                                                                                       | Pilot | Must   | M    | D5, S-058                                                          | To do  |
| S-073 | E-04 | As a valuer, I want flood, bushfire and other hazard data for pilot jurisdictions with provenance, so that risks are sourced and dated.                                                                                                                                                                                                 | Pilot | Should | L    | D2, S-022 · `[REVIEW: DATA_LICENSING]`                             | To do  |
| S-074 | E-04 | As a valuer, I want a planning adapter for a second jurisdiction, so that the pilot firm's main markets are covered.                                                                                                                                                                                                                    | Pilot | Should | L    | D2, S-040 · `[REVIEW: DATA_LICENSING]`                             | To do  |
| S-075 | E-03 | As a valuer, I want licensed sales and rental data imported with licence and attribution controls, so that evidence entry is faster and lawful.                                                                                                                                                                                         | Pilot | Should | L    | D2, D5, S-050 · `[REVIEW: DATA_LICENSING]`                         | To do  |
| S-076 | E-08 | As a valuer, I want to record licensed cost-guide inputs (edition, locality, date, adjustments), so that insurance build-ups are sourced.                                                                                                                                                                                               | Pilot | Could  | M    | S-009 · `[REVIEW: DATA_LICENSING]` · `[REVIEW: QUANTITY_SURVEYOR]` | To do  |
| S-077 | E-15 | As a privacy officer, I want configurable retention, legal hold apply/release and secure deletion, so that records are kept and destroyed per policy.                                                                                                                                                                                   | Pilot | Must   | L    | D6 · `[REVIEW: PRIVACY]` · `[REVIEW: LEGAL]`                       | To do  |
| S-078 | E-15 | As an operator, I want automated backups with point-in-time recovery and rehearsed restores, so that data can be recovered.                                                                                                                                                                                                             | Pilot | Must   | M    | S-064                                                              | To do  |
| S-079 | E-15 | As a security reviewer, I want an independent penetration test with critical/high findings fixed, so that pilot data is protected.                                                                                                                                                                                                      | Pilot | Must   | M    | S-065 · `[REVIEW: SECURITY]`                                       | To do  |
| S-080 | E-15 | As an operator, I want incident and breach logging with notification runbooks, so that eligible data breaches are assessed and handled on time.                                                                                                                                                                                         | Pilot | Must   | M    | S-063 · `[REVIEW: PRIVACY]` · `[REVIEW: LEGAL]`                    | To do  |
| S-081 | E-16 | As an operator, I want an AU-hosted pilot environment with support runbooks, so that real jobs run on controlled infrastructure.                                                                                                                                                                                                        | Pilot | Must   | L    | D6, S-064, S-078                                                   | To do  |
| S-082 | E-01 | As an allocator, I want bulk asset import (CSV) and bulk allocation for portfolios, so that large jobs are set up quickly.                                                                                                                                                                                                              | Pilot | Should | M    | S-035                                                              | To do  |
| S-083 | E-05 | As a field inspector, I want inspection route planning with navigation handoff, so that multi-asset days are efficient.                                                                                                                                                                                                                 | Pilot | Could  | M    | S-036                                                              | To do  |
| S-084 | E-13 | As a valuer, I want to open an amendment and reissue with version lineage, so that corrections never alter the original issued copy.                                                                                                                                                                                                    | Pilot | Should | M    | S-057                                                              | To do  |
| S-085 | E-02 | As a valuer, I want the `FAMILY_LAW` product with expert-code acknowledgement, joint statements and conference support, so that court-ordered reports are supported.                                                                                                                                                                    | Pilot | Should | L    | D3, S-056 · `[REVIEW: FAMILY_LAW]`                                 | To do  |
| S-086 | E-02 | As a valuer, I want the `CGT` product with an ATO minimum-content checklist, and cut-off controls for any valuation the dates make retrospective (01 D8), so that CGT and retrospective reports are complete.                                                                                                                           | Pilot | Should | M    | D3, S-056 · `[REVIEW: TAX]`                                        | To do  |
| S-087 | E-16 | As a firm, I want legacy job data migrated with reconciliation (only if D1 is an internal-firm rollout), so that history is available in one place.                                                                                                                                                                                     | Pilot | Could  | L    | D1 · `[REVIEW: PRIVACY]`                                           | To do  |
| S-088 | E-16 | As a product owner, I want pilot acceptance measured against agreed thresholds, so that the Production go/no-go is evidence-based.                                                                                                                                                                                                      | Pilot | Must   | M    | S-081 · `[REVIEW: LEGAL]`                                          | To do  |
| S-111 | E-09 | As a standards owner, I want to retire a commentary version through the API, with a reason and an audit event, and a rule for which jobs may still be offered it, so that withdrawn views stop being offered without breaking retrospective work (which relies on older approved versions; that is why there is no retire route today). | Pilot | Should | S    | S-109, S-110 · `[REVIEW: API_STANDARDS]`                           | To do  |
| S-112 | E-09 | As a standards owner, I want the firm's own national, state and local commentary loaded into the library and approved, replacing the demonstration paragraphs, so that live reports carry the firm's views with their sources.                                                                                                          | Pilot | Must   | M    | S-109 · `[REVIEW: API_STANDARDS]` · `[REVIEW: DATA_LICENSING]`     | To do  |

### 3.4 Production (To do)

| ID    | Epic | Story                                                                                                                                                           | Rel        | Pri    | Size | Deps                                         | Status |
| ----- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ---- | -------------------------------------------- | ------ |
| S-089 | E-16 | As an operator, I want a production environment with HA, DR and tested RPO/RTO, so that the service meets agreed availability.                                  | Production | Must   | L    | D6, S-081                                    | To do  |
| S-090 | E-15 | As a customer administrator, I want SSO federation with my organisation's identity provider, so that users join and leave centrally.                            | Production | Should | M    | D1, D5                                       | To do  |
| S-091 | E-15 | As a security reviewer, I want hardened tenant isolation (row-level security, per-tenant keys) if multi-tenant, so that customers cannot see each other's data. | Production | Must   | L    | D1 · `[REVIEW: SECURITY]`                    | To do  |
| S-092 | E-13 | As a customer, I want white-label branding and client template variants, so that reports carry the correct brand and wording.                                   | Production | Could  | M    | D1, D6 · `[REVIEW: API_STANDARDS]`           | To do  |
| S-093 | E-04 | As a valuer, I want planning adapters for the remaining jurisdictions as licensed, so that national coverage is available.                                      | Production | Should | XL   | D2, S-074 · `[REVIEW: DATA_LICENSING]`       | To do  |
| S-094 | E-16 | As a field inspector, I want the app distributed via the App Store and Google Play with controlled OTA updates, so that installs and updates are managed.       | Production | Must   | M    | S-032 · `[REVIEW: PRIVACY]`                  | To do  |
| S-095 | E-15 | As a security operator, I want audit and security events in a SIEM with alerts on audit-chain verification failure, so that tampering and attacks are detected. | Production | Must   | M    | S-017, S-063                                 | To do  |
| S-096 | E-16 | As an operator, I want SLOs, on-call and a status page, so that incidents are handled consistently.                                                             | Production | Should | M    | S-089                                        | To do  |
| S-097 | E-08 | As a valuer, I want a financial-reporting portfolio disclosure-support schedule export, so that clients and auditors receive consistent inputs.                 | Production | Should | L    | S-010 · `[REVIEW: ACCOUNTING]`               | To do  |
| S-098 | E-02 | As a valuer, I want the `INSURANCE_REPLACEMENT` product at portfolio scale, so that insurers' schedules can be produced.                                        | Production | Should | M    | S-009, S-076 · `[REVIEW: QUANTITY_SURVEYOR]` | To do  |
| S-099 | E-01 | As a client, I want a read-only portal for my issued reports and invoices, so that I can retrieve them without email.                                           | Production | Should | M    | S-057 · `[REVIEW: LEGAL]`                    | To do  |
| S-100 | E-16 | As a product owner, I want an external WCAG 2.2 AA accessibility audit with fixes, so that accessibility statements are evidence-based.                         | Production | Must   | M    | S-062                                        | To do  |

### 3.5 Story counts

| Release           | Stories | Must | Should | Could | Done |
| ----------------- | ------- | ---- | ------ | ----- | ---- |
| MVP (Iteration 1) | 37      | 33   | 4      | 0     | 37   |
| MVP (remaining)   | 44      | 35   | 8      | 1     | 1    |
| Pilot             | 23      | 8    | 11     | 4     | 0    |
| Production        | 12      | 5    | 6      | 1     | 0    |

## 4. Risks, Definition of Ready and Definition of Done

### 4.1 Risks and mitigations affecting sequencing

| ID   | Risk                                                                                      | Sequencing impact                           | Mitigation                                                                                                                                             | Review                                               |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| R-01 | Licences for planning, hazard, sales and cost data not secured (D2)                       | S-040, S-073–S-076, S-093 blocked           | Ship manual entry + document upload first; synthetic fixtures; connector disabled without licence basis (TC-CONN-005)                                  | `[REVIEW: DATA_LICENSING]`                           |
| R-02 | Map provider terms restrict offline tile caching or storing geocodes                      | Offline map in S-036/S-041 limited          | Offline map optional; cache only where licensed; list view fallback                                                                                    | `[REVIEW: DATA_LICENSING]`                           |
| R-03 | Specialist reviewers not nominated or slow (D7)                                           | Templates stay `draft`; Pilot cannot start  | Nominate before MVP start; booked review windows; `draft` content allowed in staging only (G1)                                                         | All 00 §6 roles                                      |
| R-04 | Licensed professional template content unavailable (D3)                                   | S-056 content blocked                       | Build structure with placeholder clauses; never copy unlicensed API, Rawlinsons or AIQS material                                                       | `[REVIEW: API_STANDARDS]` `[REVIEW: DATA_LICENSING]` |
| R-05 | App-store review rejects permission prompts, privacy labels or OTA practice               | Pilot device distribution and S-094 delayed | Internal testing tracks from MVP; permission rationale copy reviewed early; OTA limited to changes allowed by store rules                              | `[REVIEW: PRIVACY]`                                  |
| R-06 | Offline complexity: conflicts, large photos, device storage, clock skew, token expiry     | S-042/S-043 overrun; AC-03 at risk          | Domain sync planning done in Iteration 1; offline editing limited to assigned jobs; resumable uploads; TC-SYNC-007 and PERF-01 from first mobile build | —                                                    |
| R-07 | PDF fidelity and determinism (fonts, image encoding, renderer upgrades, 200-page reports) | S-056/S-057 rework                          | Pin renderer and fonts; record renderer version in snapshot; golden files; issued bytes kept in object-lock storage, re-render used as verification    | —                                                    |
| R-08 | AI provider processes or retains photos offshore                                          | S-068/S-069 blocked                         | Feature flag off by default; DPA and PIA before enablement; AU-region or on-device option; add provider decision to §12 list                           | `[REVIEW: PRIVACY]` `[REVIEW: LEGAL]`                |
| R-09 | Identity/MFA provider chosen late (D5)                                                    | S-032, S-033, S-054, S-060 blocked          | Standard OIDC claims only; dev auth confined to local/test (TC-ROLE-009)                                                                               | `[REVIEW: SECURITY]`                                 |
| R-10 | Calculation scope creep (D4)                                                              | S-051 grows into full modelling             | MVP limited to practitioner-controlled calculators; modelling a separate decision                                                                      | `[REVIEW: API_STANDARDS]`                            |
| R-11 | Hosting, residency and security obligations unclear (D6)                                  | Staging/pilot environment rework            | AU region from first staging build; IaC parameterised by region                                                                                        | `[REVIEW: SECURITY]` `[REVIEW: PRIVACY]`             |
| R-12 | Practising valuers unavailable for UAT/pilot                                              | MVP exit and Pilot delayed                  | Agree participants and time allocation at MVP start                                                                                                    | —                                                    |
| R-13 | Reliance on reports issued during the pilot                                               | Pilot start blocked pending terms           | Pilot terms; parallel run if required                                                                                                                  | `[REVIEW: LEGAL]` `[REVIEW: API_STANDARDS]`          |

### 4.2 Definition of Ready

A story enters a sprint only when it has:

1. User story and Given/When/Then acceptance criteria, including error states.
2. Data fields named per 00 §3 and added to the field catalogue where new.
3. Validation rules (`VAL-<CATEGORY>-<NNN>`) with severity.
4. Permissions (`<resource>.<verb>`), affected roles and separation-of-duties impact.
5. Audit events (`<entity>.<past_tense_verb>`), new ones added to the 00 §8 vocabulary.
6. Offline behaviour (available offline or not, conflict policy) for any mobile-facing story.
7. Test IDs allocated in `12-test-plan.md` with level and priority.
8. Dependencies on stories and D1–D7 resolved, or a recorded default with the decision owner.
9. `[REVIEW: …]` items identified with a named reviewer; affected content stays placeholder until signed.
10. Designs for phone, tablet and web as applicable, with accessibility notes.
11. Size ≤ L (XL stories split).

### 4.3 Definition of Done

| Area          | Criterion                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code          | Typed; reviewed by another engineer; business rules in `@vp/domain`, not duplicated in clients                                                        |
| Schema        | Changes only via a new checksummed migration; applied migrations never edited                                                                         |
| Tests         | Allocated TC IDs implemented; P1/P2 pass in CI; nightly PG16 green; E2E added for UI stories; proposed ≥ 90 % branch coverage on new domain code      |
| Audit         | Required audit events emitted and asserted (TC-AUD-004 route × action table updated)                                                                  |
| Permissions   | Permission matrix updated and regenerated; route × role tests updated (TC-ROLE-001)                                                                   |
| Accessibility | 0 serious/critical axe issues; screen-reader check of new screens; non-dragging alternatives where drawing is required                                |
| Security      | Threat-model delta reviewed; schema validation on new inputs; no secrets in code; no personal information in logs; no new critical/high scan findings |
| Privacy       | New personal-data fields added to the data inventory and retention model                                                                              |
| API           | OpenAPI updated; contract tests pass; no undeclared breaking change                                                                                   |
| Docs          | Relevant spec section and generated matrices updated; release notes entry                                                                             |
| Observability | Logs and metrics for new flows; failures surfaced to the user with an actionable message                                                              |
| Configuration | Environment-specific configuration; risky features behind flags; no `placeholder`/`draft` content enabled in production                               |
| Review tags   | No `[REVIEW: …]` item resolved without recorded sign-off                                                                                              |
| Acceptance    | Demonstrated on staging and accepted by the product owner                                                                                             |
