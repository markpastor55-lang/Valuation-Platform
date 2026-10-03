# 14 — Feature specifications

> Status: **Draft for review** · Owner: Product architecture (with Quality engineering) · Applies to: every feature in the MVP, Pilot and Production releases — `packages/domain`, `apps/api`, mobile app, web portal

This section answers brief §11: for each proposed feature it gives the user story, acceptance criteria, data fields, validation, permissions, audit events, offline behaviour, error states and tests. Vocabulary is fixed in `00-architecture-and-conventions.md`. Journeys (J-xx) and screens (M-xx, W-xx) are in `05-user-journeys-and-screens.md`, epics (E-xx) and stories (S-xxx) in `13-backlog.md`, and test IDs (TC-…, PERF-…) in `12-test-plan.md`. Field ids, permissions, validation codes, endpoints and requirement rules come from the generated tables in `generated/`, which are authoritative. Anything a feature needs that is missing from those tables is listed in §3. It is not used as if it already existed.

Acceptance criteria describe what the software must do. Meeting them does not establish that any template, clause, rule set or calculation meets API/IVS, AASB 13, ATO, court or privacy requirements. Those are specialist sign-offs, tagged `[REVIEW: …]`.

## 1. How to read

### 1.1 Conventions

- Each feature starts with a one-line **Status**: implementation status in this repository, then epic, stories, journeys and screens. Nine sub-headings follow in a fixed order: User story, Acceptance criteria, Data fields, Validation, Permissions, Audit events, Offline behaviour, Error states, Tests.
- Implementation status:
  - **Implemented in domain/API**: the rules and endpoints exist and are tested.
  - **Partially implemented**: some rules or endpoints exist; the missing parts are named.
  - **Planned (mobile/web)**: no code yet.
  - Every mobile and web screen is still **Planned (mobile/web)** (S-032, S-033), whatever the feature's domain/API status.
- Acceptance criteria marked _(planned)_ describe behaviour that has no code yet. All other criteria are met by the current domain/API code and must stay met.
- Data fields:
  - Field ids (`group.name`) come from `generated/field-catalogue.md`.
  - Record attributes that are not catalogue fields are written as "record `name`: attribute, …". They come from the API request schemas (`apps/api/src/routes/*.ts`) and the migrations (`apps/api/migrations/`). The normative data model is `06-data-model-and-audit.md`.
- Validation codes:
  - `VAL-*` codes come from `generated/validation-catalogue.md`, which gives their severity and stages.
  - `GEO-*` codes come from `packages/domain/src/geometry/area-schedule.ts`.
  - `REQ-*` and `SEL-*` rules come from `generated/requirement-rules.md`.
- Permissions: names and role grants come from `generated/permission-matrix.md`. SoD-01…SoD-07 refer to `02-personas-and-permissions.md` §3.
- Audit events:
  - Every name without a marker was confirmed as emitted in `apps/api/src` and `packages/domain/src/workflow/job-workflow.ts`.
  - _(planned)_ marks a name that appears in the 00 §8 planned list or the 05 §4 proposals but is not emitted yet.
  - Names that appear in neither list are proposed in §3.4 only.
- Error states: the HTTP status and `error.code` returned by the API (`apps/api/src/http/errors.ts` and the route handlers). A failed workflow guard returns `409 GUARD_FAILED`, with `details.failures` listing each failed guard message.
- Tests:
  - Existing tests are cited as `file` › "test title".
  - TC and PERF IDs come from 12.
  - **Gap** lists behaviour that is not tested yet.
  - Existing test titles do not carry TC IDs yet (12 §1.1 P2), so the mapping is by content.

### 1.2 Common error states

These apply to every API-backed feature. Each feature lists only its own additional errors.

| HTTP | Code                                                                                                      | When                                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `BAD_REQUEST`                                                                                             | Body, params or query fail schema validation (`details` lists the paths)                                                                                                                                                                                    |
| 401  | `UNAUTHENTICATED`                                                                                         | Missing or invalid token                                                                                                                                                                                                                                    |
| 403  | `ACCOUNT_SUSPENDED`                                                                                       | User account not active                                                                                                                                                                                                                                     |
| 403  | `NO_ROLE_GRANT`, `NOT_ASSIGNED`, `CLIENT_SCOPE`, `SEPARATION_OF_DUTIES`, `HUMAN_REQUIRED`, `MFA_REQUIRED` | Authorisation denied. Recorded as `auth.denied` in the organisation security stream (F-22)                                                                                                                                                                  |
| 403  | `ACTOR_NOT_PERMITTED`                                                                                     | Route not open to the caller's actor kind. Routes accept human actors only, except AI suggestion ingestion (`ai`) and the email delivery callback (`system`). Recorded as `auth.denied`                                                                     |
| 403  | `HUMAN_ACTOR_REQUIRED`                                                                                    | Domain refusal of a non-human actor (sign, approve, decide)                                                                                                                                                                                                 |
| 404  | `NOT_FOUND`                                                                                               | Unknown id, another organisation's record, or a restricted portfolio without membership (no existence leak). A denial from the permission check (`WRONG_ORGANISATION`, `RESTRICTED_PORTFOLIO`) is still recorded as `auth.denied`, with the underlying code |
| 409  | `RECORD_LOCKED`                                                                                           | Content change while the job is not `draft`, `active` or `returned`                                                                                                                                                                                         |
| 409  | `INVALID_TRANSITION`, `GUARD_FAILED`                                                                      | Workflow action from the wrong state, or a guard not met                                                                                                                                                                                                    |
| 409  | `IMMUTABLE_RECORD`                                                                                        | Update or delete of an append-only or issued record (database trigger)                                                                                                                                                                                      |
| 409  | `CONFLICT`                                                                                                | Duplicate record (unique key)                                                                                                                                                                                                                               |
| 422  | `INVALID_REFERENCE`, `INVALID_ARGUMENT`                                                                   | Referenced record does not exist / domain argument invalid                                                                                                                                                                                                  |
| 500  | `INTERNAL`                                                                                                | Unexpected error. No stack trace or SQL is returned                                                                                                                                                                                                         |

### 1.3 Feature index

| ID   | Feature                                                                           | Epic             | Stories                                                              | Release                                                      | Status in this repository |
| ---- | --------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------- |
| F-01 | Job creation and allocation (single and portfolio)                                | E-01             | S-025, S-035, S-039, S-082                                           | MVP (bulk import Pilot)                                      | Partially implemented     |
| F-02 | Engagement acceptance and conflict check                                          | E-01             | S-015, S-035                                                         | MVP                                                          | Partially implemented     |
| F-03 | Selection and dynamic requirements                                                | E-02             | S-002, S-003, S-004, S-037, S-085, S-086                             | MVP (FL, CGT products Pilot)                                 | Implemented in domain/API |
| F-04 | Property data capture, provenance and data-source licensing                       | E-03             | S-005, S-038, S-039, S-075                                           | MVP (licensed imports Pilot)                                 | Partially implemented     |
| F-05 | Planning and hazard adapters with manual fallback                                 | E-04             | S-022, S-040, S-073, S-074, S-093                                    | MVP planning; Pilot hazards                                  | Partially implemented     |
| F-06 | Permission-aware map                                                              | E-01             | S-036, S-083                                                         | MVP                                                          | Partially implemented     |
| F-07 | Mobile offline inspection and sync                                                | E-05             | S-020, S-032, S-041, S-042, S-043, S-066, S-083                      | MVP (route planning Pilot)                                   | Partially implemented     |
| F-08 | Photo capture, quality checks and privacy redaction                               | E-06             | S-019, S-044, S-045, S-046                                           | MVP                                                          | Partially implemented     |
| F-09 | AI photo suggestions (accept / edit / reject)                                     | E-06             | S-018, S-068, S-069                                                  | Pilot                                                        | Implemented in domain/API |
| F-10 | Areas & Sketch (import, calibrate, draw, schedule, approve)                       | E-07             | S-011, S-012, S-013, S-026, S-047, S-048, S-049, S-069               | MVP (AI outlines Pilot)                                      | Implemented in domain/API |
| F-11 | Sales evidence and adjustments                                                    | E-08             | S-007, S-026, S-050, S-075                                           | MVP                                                          | Implemented in domain/API |
| F-12 | Rental evidence                                                                   | E-08             | S-008, S-050                                                         | MVP                                                          | Implemented in domain/API |
| F-13 | Traced calculations and overrides                                                 | E-08             | S-005, S-006, S-051                                                  | MVP                                                          | Implemented in domain/API |
| F-14 | Replacement cost (insurance)                                                      | E-08             | S-009, S-076, S-098                                                  | MVP if in D3; Pilot; Production                              | Partially implemented     |
| F-15 | Fair value (AASB 13) support                                                      | E-08             | S-010, S-097                                                         | MVP if in D3; Production export                              | Partially implemented     |
| F-16 | Market commentary library by property type and location, with date guards         | E-09             | S-052, S-109, S-110, S-111, S-112                                    | MVP (the firm's own library content Pilot)                   | Implemented in domain/API |
| F-17 | Validation and acknowledgements                                                   | E-10             | S-014, S-053                                                         | MVP                                                          | Implemented in domain/API |
| F-18 | Certification and submission for QA                                               | E-11             | S-054, S-070                                                         | MVP (e-signature Pilot)                                      | Implemented in domain/API |
| F-19 | QA review and self-approval exceptions                                            | E-12             | S-015, S-027, S-055                                                  | MVP                                                          | Implemented in domain/API |
| F-20 | Report issue (PDF, invoice, email) and reproduction                               | E-13, E-14       | S-021, S-028, S-029, S-056, S-057, S-058, S-071, S-072, S-084, S-099 | MVP (amendments, live email Pilot; client portal Production) | Implemented in domain/API |
| F-21 | Template and rule-set governance                                                  | E-02, E-13, E-15 | S-003, S-021, S-056, S-059, S-092                                    | MVP                                                          | Partially implemented     |
| F-22 | Audit trail and security events                                                   | E-15             | S-017, S-063, S-095                                                  | MVP (SIEM Production)                                        | Implemented in domain/API |
| F-23 | Legal hold and retention                                                          | E-15             | S-077, S-080                                                         | Pilot                                                        | Partially implemented     |
| F-24 | Work in progress and job/property search                                          | E-01             | S-102, S-106                                                         | MVP                                                          |
| F-25 | Licensed property data (CoreLogic / Cotality), sample mode and state map services | E-03, E-01       | S-103, S-104, S-105, S-106, S-107                                    | MVP (live data when keys and licence are supplied)           |

## 2. Feature specifications

### F-01 — Job creation and allocation (single and portfolio)

**Status:** Partially implemented. Job, asset and assignment endpoints exist. W-01/W-02 UI, CSV/XLSX import, geocoding, duplicate detection, credential eligibility and appointment booking are planned. · E-01 · S-025 (Done), S-035, S-039, S-082 · J-01 · W-01, W-02, M-02

**User story**
As an allocator, I want to create a job with one or many assets and assign a responsible valuer and an independent QA reviewer (and field inspectors, where the firm uses them; optional, 01 D12), so that each instruction is recorded once and the work is allocated accountably.

**Acceptance criteria**

1. Given an allocator holding `job.create`, when they `POST /v1/jobs` with `selection.mode = SINGLE` and exactly one asset, then: the job is created in `draft`; the approved rule-set and template versions effective today are pinned to the job; `job.created`, `asset.created` and `field.updated` (`location.address`, `location.coordinates`) are recorded.
2. Given `mode = SINGLE` and zero or more than one asset, then `422 SINGLE_ASSET_MODE` is returned and nothing is created.
3. Given `mode = PORTFOLIO`, when 1–500 assets are submitted, or added later with `POST /v1/jobs/{jobId}/assets`, then each asset gets its own `asset.created`. Adding an asset to a `SINGLE` job returns `422 SINGLE_ASSET_MODE`.
4. Given a restricted portfolio, then the creator must be a member (`404` otherwise). After creation, only members can see the job (SoD-05).
5. Given job creation or `POST /assign`: when the reviewer equals the responsible valuer, `403 SEPARATION_OF_DUTIES` is returned and `auth.denied` is recorded; when an assignee is not an active user of the organisation holding the required role (e.g. VALUER for the responsible valuer), `422 UNKNOWN_USER` or `422 ROLE_REQUIRED` is returned; when the client belongs to another organisation, `422 UNKNOWN_CLIENT` is returned; otherwise `job.assigned` records the assignees, and `instruction.responsibleValuer` and `instruction.reviewer` are written with `field.updated`.
6. Given no approved rule set is effective today, then `409 NO_RULE_SET` is returned. Draft configuration is allowed only where `allowDraftConfig` is set (local/test).
7. The job view returns the available transitions with their guard failures, so that the UI can explain why an action is disabled.
8. _(planned)_ CSV/XLSX import validates each row: required columns, jurisdiction, duplicates within the file, and duplicates against existing assets (normalised address or parcel). Only accepted rows create assets, and the rejected rows can be downloaded (J-01 E4).
9. _(planned)_ When `location.geocodeConfidence` is below the configured threshold or there is no match, the asset is listed as "Needs pin". A manually placed pin is stored with `manual_entry` provenance (J-01 E1) `[REVIEW: DATA_LICENSING]` (geocoder terms on storing results).
10. _(planned)_ Beyond the role check in criterion 5, only eligible valuers are offered: current credentials for the asset's jurisdiction, availability and workload. If no valuer is eligible, the job stays in the unallocated queue (J-01 E3).
11. _(planned)_ Appointment booking (date, window, site contact, access notes) puts the job in assignees' M-01 lists and offline packs.

**Data fields**

- Catalogue (REQ-BASE-001, 01 D9): `instruction.clientEntity` (the client is the instructing party), `instruction.intendedUsers`, `instruction.intendedUse`, `instruction.basisOfValue`, `instruction.interestValued`, `instruction.engagementDocuments`, `location.address`, `location.titleReference`, `location.lga` (council; recommended), `location.geocodeConfidence`, `portfolio.aggregationBasis`, `portfolio.summarySchedule`. System-filled (`entry: 'system'`, read-only for the valuer): `instruction.responsibleValuer`, `instruction.reviewer`, `instruction.dueDate`, `dates.instruction`, `location.coordinates`. Still catalogued but no longer requested per job: `instruction.instructingParty` (personal), `instruction.feeBasis` (the fee is the job's `feeCents`).
- Record `job`: `reference` (3–40 characters), `clientId`, `portfolioId`; `selection` {`jurisdiction`, `purpose`, `propertyType`, `scope`, `mode`}; `responsibleValuerId`, `reviewerId`, `inspectorIds`, `feeCents` (integer ≥ 0).
- Record `asset`: `id` (client UUID), `label` (1–200 characters), `address.formatted`, `latitude`, `longitude`, `geocodeConfidence` (0–1).

**Validation**
`VAL-REQ-001` covers the REQ-BASE-001 instruction fields and the REQ-MODE-PF-001 portfolio fields. `VAL-REQ-002` covers the recommended fields (`instruction.dueDate`, `instruction.reviewer`, `instruction.ownership`, `location.lga`, `location.coordinates`, `assumptions.general`, `assumptions.limitations`). `VAL-SEL-001` and `VAL-SEL-002` apply SEL-001…SEL-009 to the initial selection. `VAL-PROV-001` applies when geocoded location data lacks provenance. Proposed: `VAL-LOC-001` and `VAL-ASSET-001` (§3.2).

**Permissions**

- `job.create` and `job.allocate`: ALLOCATOR.
- `asset.edit` (to add assets): ALLOCATOR, VALUER, FIELD_INSPECTOR.
- `job.read` to view. `job.cancel` (ADMINISTRATOR, ALLOCATOR) to withdraw an unallocatable job.
- Separation of duties: the reviewer must not be the responsible valuer at assignment, which enforces SoD-02 early; restricted portfolios require membership (SoD-05); excluding co-signatories from QA (SoD-07) is proposed only.

**Audit events**
`job.created`, `asset.created`, `field.updated`, `job.assigned`. Planned: `datasource.used` _(planned)_ for geocoder results, `asset.updated` _(planned)_ for manual pins, and `user.membership_changed` _(planned)_.

**Offline behaviour**
W-01 and W-02 are online only (web). Once assigned, the job appears in M-01 and in offline packs. On a portfolio job, assets created offline reach the server through `/v1/sync` (F-07).

**Error states**
Common errors (§1.2), plus `422 SINGLE_ASSET_MODE`; `403 SEPARATION_OF_DUTIES` (reviewer is the valuer; recorded); `422 UNKNOWN_USER`, `422 ROLE_REQUIRED` (assignee); `422 UNKNOWN_CLIENT`; `409 NO_RULE_SET`; `404 NOT_FOUND` (portfolio in another organisation, or restricted); `409 CONFLICT` (duplicate asset id); `409 RECORD_LOCKED` (assignment after submission).

UI states _(planned)_: no geocode match, duplicate asset, import row errors, no eligible valuer.

**Tests**

- `apps/api/test/lifecycle.test.ts` › "allocator creates a job with requirements resolved from the selection".
- `apps/api/test/jobs-and-sync.test.ts` › "enforces single-asset mode and supports portfolio jobs"; "hides restricted-portfolio jobs from non-members".
- `apps/api/test/security.test.ts` › "allocators cannot make the reviewer the responsible valuer".
- `packages/domain/test/permissions.test.ts` › "assignment-scoped roles need an assignment or portfolio membership"; "restricted portfolios require membership even for organisation-wide roles".
- TC-JOB-001, TC-ROLE-001, TC-ROLE-008, TC-AUD-004, PERF-04. **Gap:** 1,000-asset portfolio (TC-JOB-001 scale); import row validation; duplicate detection; eligibility filter; W-01/W-02 E2E (L7). Job creation sets `dates.instruction` (`instructedOn`, default today in the jurisdiction) and `instruction.dueDate` (`dueDate`); changing them after creation has no endpoint yet.

### F-02 — Engagement acceptance and conflict check

**Status:** Partially implemented. The `acceptEngagement` guard checks the responsible valuer, `instruction.conflictCheck` and the engagement documents. Server-side conflict search, the versioned independence declaration, engagement-letter generation and client acceptance are planned. · E-01 · S-015 (Done), S-035 · J-02 · W-03

**User story**
As a responsible valuer, I want to check for conflicts, declare my independence and accept the engagement on recorded terms, so that no work starts on a conflicted or undocumented instruction.

**Acceptance criteria**

1. Given a job in `draft` with all of the following, when a user with `engagement.accept` calls `POST /engagement/accept`, then the job moves `draft → active` and `job.engagement_accepted` is recorded: a responsible valuer; `instruction.conflictCheck` recorded and not `conflict_declined`; at least one engagement document, either in `instruction.engagementDocuments` or as a `document` row of kind `engagement`.
2. Given any of those preconditions is missing, then `409 GUARD_FAILED` is returned. `details.failures` lists each of: "a responsible valuer must be allocated", "conflict-of-interest check has not been recorded", "engagement declined because of a conflict", "engagement documents must be attached".
3. Given `instruction.conflictCheck = conflict_disclosed_managed`, then `instruction.conflictDisclosure` becomes required (REQ-BASE-002).
4. Given `conflict_declined`, then `VAL-INDEP-001` blocks at every stage. The job can be cancelled with a reason of at least 10 characters (`job.cancelled`).
5. Given an AI or system actor, the transition is refused ("workflow transitions require a person").
6. _(planned)_ The conflict search covers the organisation's jobs within a configurable look-back period. It matches address or parcel, client entity, instructing party and named parties. Each match takes an outcome: `not_relevant`, `disclosed_and_managed` (note mandatory) or `conflict`. Any `conflict` disables acceptance. `[REVIEW: LEGAL]` `[REVIEW: API_STANDARDS]` (look-back period and match criteria).
7. _(planned)_ The independence and competence declaration is stored as a first-class record with the version of its wording (G5).
8. _(planned)_ The engagement letter is rendered from the pinned template. Client acceptance is recorded as an uploaded signed letter, or as a date and method. Whether a missing client acceptance blocks acceptance is set by firm policy `[REVIEW: LEGAL]`.
9. _(planned)_ If purpose, intended users or instructing party change after acceptance, the conflict check must be re-run before submission (proposed `VAL-INDEP-002`).

**Data fields**

- Catalogue: `instruction.conflictCheck` (`no_conflict`, `conflict_disclosed_managed`, `conflict_declined`), `instruction.conflictDisclosure`, `instruction.responsibleValuer`, `instruction.engagementDocuments`, `instruction.intendedUsers`, `instruction.intendedUse`, `instruction.dueDate`, `fl.independenceDeclaration` (`FAMILY_LAW` only). Reliance, confidentiality and standard limitations come from the firm's approved template clauses (seed `reliance-core`, `limitations-core`) `[REVIEW: LEGAL]`, not per-job fields; `instruction.reliance`, `instruction.confidentiality` and `instruction.feeBasis` stay in the catalogue but are no longer requested (01 D9).
- Record `document`: `kind` (`engagement`), `filename`, `sha256`, `size_bytes`, `storage_key`, `uploaded_by`, `uploaded_at`.
- Proposed (§3.3): `instruction.independenceDeclaration`, `instruction.competenceConfirmed`, `instruction.clientAcceptance`.

**Validation**
`VAL-INDEP-001`. `VAL-REQ-001` for REQ-BASE-001 and REQ-BASE-002. Proposed: `VAL-INDEP-002`.

**Permissions**
`engagement.accept` (ALLOCATOR, VALUER; human only; VALUER scoped to assignment). `job.update` to record the instruction fields. `job.cancel` (ADMINISTRATOR, ALLOCATOR).

**Audit events**
`job.engagement_accepted`, `field.updated`, `job.cancelled`, and `job.conflict_declared` _(planned)_.

**Offline behaviour**
W-03 is online only, because the conflict search runs on the server. Mobile shows the engagement status read-only.

**Error states**
Common errors, plus `409 GUARD_FAILED` (the failures listed in criterion 2) and `409 INVALID_TRANSITION` (job not in `draft`). A cancel reason shorter than 10 characters returns `400 BAD_REQUEST`.

**Tests**

- `packages/domain/test/workflow.test.ts` › "accepts an engagement only after conflict check, allocation and documents"; "cancel and amendment require reasons".
- `apps/api/test/lifecycle.test.ts` › "cannot accept the engagement before the conflict check and documents"; "accepts the engagement".
- `packages/domain/test/validation.test.ts` › "blocks when the conflict check declines the engagement".
- `packages/domain/test/requirements.test.ts` › "requires a conflict disclosure when a conflict is disclosed and managed".
- TC-WF-001. **Gap:** conflict search, declaration versioning and the re-check after a change have no TC IDs (proposed TC-ENG-001…003, §3.7).

### F-03 — Selection and dynamic requirements

**Status:** Implemented in domain/API: requirement resolver, diff, rule-set versioning and `PATCH /selection`. Per-asset purpose/scope overrides, the audited rule-set re-pin and the M-03/M-04 UI are planned. · E-02 · S-002, S-003, S-004 (Done), S-037, S-085, S-086 · J-03 · M-03, M-04

**User story**
As a responsible valuer, I want my choice of jurisdiction, purpose, property type, scope and asset mode to update the required fields, warnings and report sections immediately, without losing any data, so that the job asks for exactly what the engagement needs (AC-02).

**Acceptance criteria**

1. Given rule set `au-core 2026.1-draft`, the resolver returns a requirement set for all 1,152 purpose × type × scope × jurisdiction combinations, and per asset in `PORTFOLIO` mode.
2. Purpose rules add their fields: REQ-PUR-MV-001: the valuation core, `valuation.marketability`, `market.local` and `evidence.sales`; REQ-PUR-CGT-001: the valuation core, `cgt.taxEvent`, `market.local` and `evidence.sales` (no tax-agent field: the client instructs); REQ-PUR-FL-001: the `fl.*` fields; REQ-PUR-FR-001: the `fr.*` fields; REQ-PUR-RENT-001: the `rent.*` fields; REQ-PUR-INS-001: the `ins.*` fields; property-type rules REQ-PT-* add theirs the same way.
3. Scope rules: `DESKTOP` (REQ-SCOPE-DESK-001) requires the `desktop.*` fields and `scope.escalationDecision`, and no longer requires `dates.inspection`; `KERBSIDE` and `RESTRICTED` add `scope.areasNotInspected`, `scope.obstructionNotes`, `scope.internalConditionAssumption` and the escalation decision; `proceed_with_justification` adds `scope.escalationJustification` (REQ-SCOPE-ESC-001).
4. Conditional rules apply from captured values: REQ-OCC-001, REQ-INT-001, REQ-APP-CAP-001, REQ-APP-DCF-001, REQ-APP-SUM-001 and REQ-BASE-002.
5. When `PATCH /selection` is called with a reason of at least 5 characters, then: the response returns the `diff` {`newlyRequired`, `noLongerRequired`, `retainedValues`}, the new `sections` and the `selectionIssues`; the template is re-selected for the new selection; `job.selection_changed` records before, after and the diff counts.
6. Values for fields that are no longer required are retained. They are excluded from the report and from validation, and are restored if the selection reverts (A-17). Round trip A → B → A gives an identical requirement set.
7. Blocking selection rule SEL-001 appears in `selectionIssues`, and `VAL-SEL-001` blocks submission. Warnings SEL-002…SEL-009 surface as `VAL-SEL-002` and must be acknowledged. Per J-03 E1, a blocked selection should not be saved at all; see §3.6.
8. A job stays pinned to its rule-set version. A newly approved version changes nothing until an explicit, audited re-pin _(planned)_.
9. `PORTFOLIO → SINGLE` with more than one asset returns `422 SINGLE_ASSET_MODE`. From `submitted` onward, selection is read-only (`409 RECORD_LOCKED`).
10. _(planned)_ Purpose and scope can be overridden per asset (A-16). A jurisdiction change needs a reason.
11. _(planned)_ Offline, the resolver runs from a cached rule-set version. If that version is not cached, the change is blocked with "Rule set not available offline".
12. Specialist wording attached to purposes stays under review: `FAMILY_LAW` `[REVIEW: FAMILY_LAW]`, `CGT` `[REVIEW: TAX]`, `FINANCIAL_REPORTING` `[REVIEW: ACCOUNTING]`, `INSURANCE_REPLACEMENT` `[REVIEW: QUANTITY_SURVEYOR]`; retrospective valuations `[REVIEW: API_STANDARDS]`.
13. Retrospective is derived from the dates, never selected (01 D8) `[REVIEW: API_STANDARDS]`: when `dates.valuation` is earlier than `dates.inspection` (or `dates.instruction` without an inspection), for any purpose, the resolver returns `retrospective: true` and REQ-RETRO-001 requires `retro.evidenceBasis`, recommends `dates.retrospectiveDataCutOff` and `retro.chronology`, and adds the `retrospective` section and `W-RETRO-HINDSIGHT`. SEL-007 warns when a retrospective job has a physical inspection. Changing a date can therefore change the requirements without a selection change.
14. The resolved fields are grouped on input tabs (`INPUT_TABS`: Job, Property, Inspection, Sales & market, Valuation, Review; 01 D10). Every report section belongs to exactly one tab; `inputTabForField` gives a field's tab.

**Data fields**

- Record `job` selection: `jurisdiction` (NSW…NT), `purpose` (6 codes), `propertyType` (6 codes), `scope` (4 codes), `mode` (`SINGLE`, `PORTFOLIO`), `rule_set_version_id`, `template_version_id`; request `reason`.
- Catalogue: every field referenced by a REQ-* rule, notably `scope.escalationDecision`, `scope.escalationJustification`, `cgt.taxEvent`, `retro.evidenceBasis`, `retro.chronology`, `retro.sourceArchive` and `dates.retrospectiveDataCutOff`.

**Validation**
`VAL-SEL-001`, `VAL-SEL-002`, `VAL-REQ-001`, `VAL-REQ-002`, `VAL-SCOPE-001` `[REVIEW: API_STANDARDS]`, `VAL-TPL-001` (at issue).

**Permissions**
`job.update` (ALLOCATOR, VALUER) to change the selection. `job.read` for requirements. Rule content is governed by F-21 (`ruleset.edit`, `ruleset.approve`).

**Audit events**
`job.selection_changed`, `field.updated`. The re-pin event is proposed in §3.4.

**Offline behaviour**
Full on mobile, using cached rule sets (M-03, M-04). A selection change made on two devices is never auto-merged: it raises `sync.conflict_detected`. Web is online only.

**Error states**
Common errors, plus `422 SINGLE_ASSET_MODE`, `409 NO_RULE_SET` (no effective approved configuration) and `409 RECORD_LOCKED`.

**Tests**

- `packages/domain/test/requirements.test.ts` › "resolves every purpose × property type × scope × jurisdiction combination"; the "purpose drives requirements", "scope drives requirements", "selection rules" and "conditional requirements" groups; "changing purpose updates requirements and sections without losing captured data"; "selects the approved version effective on the date".
- `apps/api/test/jobs-and-sync.test.ts` › "changing purpose updates requirements and sections without losing captured data".
- `packages/domain/test/report.test.ts` › "never renders data retained from a previous selection".
- `packages/domain/test/validation.test.ts` › "blocks incompatible selections"; "treats a CGT valuation dated at inspection as current"; "treats a family law valuation dated before inspection as retrospective".
- `packages/domain/test/requirements.test.ts` › "CGT adds the CGT event; the client instructs, so there is no tax-agent field"; "derives a retrospective valuation from the dates, for any purpose".
- `packages/domain/test/input-tabs.test.ts` › "places every report section in exactly one tab"; "gives every catalogued field a tab".
- TC-FLD-001…010, TC-DATE-008. **Gap:** an explicit A → B → A round-trip test (TC-FLD-005); the re-pin audit (TC-FLD-006 at L2); `VAL-SEL-002` has no test that references the code; M-03 E2E.

### F-04 — Property data capture with provenance and data-source licensing

**Status:** Partially implemented. Batch field capture with type checks, provenance and append-only history exists; provenance and licence checks exist in the domain. The data-source registry API and W-19, human verification, document upload and confirmation of inspector-captured facts are planned. · E-03 · S-005, S-038, S-039, S-075 · J-03, J-07 · M-05, W-19

**User story**
As a valuer, I want every datum I capture or import to carry its source, retrieval time, effective date, licence basis and verification status, so that each figure in the report is attributable and lawfully used (G3).

**Acceptance criteria**

1. When `PUT /fields` is called with 1–200 values, then each value is type-checked against its catalogue definition. Job-level fields need `job.update`; asset-level fields need `asset.edit`.
2. Each change: writes `field_value` with version + 1; appends `field_value_history` (append-only) with the reason; emits `field.updated` with before, after and provenance. An unchanged value is a no-op.
3. Provenance `origin` is one of `manual_entry`, `external_source`, `client_supplied`, `calculated` or `measured`. Verification defaults to `unverified`. A `verified` value records `verifiedBy` and `verifiedAt` from the capturing user.
4. External or client-supplied data missing `sourceId`, `retrievedAt`, `effectiveDate` or `licenceBasis` triggers `VAL-PROV-001`, which is blocking at every stage.
5. Unverified comparable evidence triggers `VAL-PROV-002` (warning).
6. A source whose licence prohibits reproduction, or has expired, triggers `VAL-PROV-003`: the data is blocked from the report `[REVIEW: DATA_LICENSING]`. Data past the source's `freshnessDays` triggers `VAL-STALE-002`.
7. Personal-information fields are masked in logs and restricted in exports: `instruction.instructingParty`, `instruction.ownership`, `occupancy.evidence`, `occupancy.leaseSummary`, `tenancy.schedule`, `fl.parties`, `fl.proceedingNumber` `[REVIEW: PRIVACY]`.
8. Areas entered in other units convert to m², and the original value and unit are kept (A-07). Composite acres-roods-perches are accepted.
9. _(planned)_ Data-source registry. Each source records: kind; licence basis (`licensed`, `open_licence`, `client_supplied`, `public_view_only`, `internal`); `permitsStorage`, `permitsReportReproduction`, `permitsBulkUse`, `expiresOn`, attribution; `freshnessDays` and status. A source without a licence record cannot be enabled (W-19). Public tiles and portals are never treated as granting bulk-data rights (brief §8).
10. _(planned)_ A person (never AI) marks a value verified (`datasource.verified`). Where a firm uses a separate Field Inspector (optional, 01 D12), values they capture stay "inspector-captured" until the valuer confirms them (A-25).
11. Fields marked `entry: 'system'` in the catalogue (responsible valuer, QA reviewer, due date, instruction date, coordinates) are filled by the platform and shown read-only; clients never offer them as inputs (01 D9). The preview refuses a typed value and `PUT /fields` returns `422 SYSTEM_FIELD`; job creation and assignment set them.
12. Values looked up from the property data provider arrive as suggestions with provenance and are saved only when the valuer accepts them through `PUT /fields` (F-25, 01 D15).

**Data fields**

- Catalogue groups: `instruction.*`, `dates.*`, `location.*`, `planning.*`, `land.*`, `improvements.*`, `occupancy.*`, `tenancy.*`, `retail.*`, `specialised.*`, `assumptions.*`.
- Record `provenance`: `origin`, `sourceId`, `sourceRef`, `retrievedAt`, `effectiveDate`, `licenceBasis`, `verification` (`unverified`, `verified`, `disputed`; `superseded` is domain-only), `verifiedBy`, `verifiedAt`, `confidence`, `capturedBy`, `capturedAt`.
- Record `field_value_history`: `version`, `value`, `provenance`, `changed_by`, `changed_at`, `reason`.
- Record `data_source`: as domain `DataSource`.

**Validation**
`VAL-PROV-001`, `VAL-PROV-002`, `VAL-PROV-003`, `VAL-STALE-002`, `VAL-REQ-001`, `VAL-REQ-002`, `VAL-AREA-004` (footprint against `land.area`). Date rules: `VAL-DATE-001`, `VAL-DATE-002`, `VAL-DATE-003`, `VAL-DATE-009` (`VAL-DATE-008` was withdrawn, 01 D8).

**Permissions**
`job.update` for job-level fields. `asset.edit` (ALLOCATOR, VALUER, FIELD_INSPECTOR) for asset-level fields. `datasource.manage` (ADMINISTRATOR) for the registry. Proposed: `datasource.lookup`, `datasource.verify`, `datasource.configure` and `fact.confirm` (§3.1).

**Audit events**
`field.updated`. Planned: `asset.updated` _(planned)_, `datasource.used` _(planned)_, `datasource.verified` _(planned)_ and `datasource.config_changed` _(planned)_.

**Offline behaviour**
Field edits work in full on mobile (M-05) and are autosaved and queued, with a field-level merge on sync (F-07). Adapter lookups and registry administration are online only.

**Error states**
Common errors, plus `422 UNKNOWN_FIELD`; `422 ASSET_REQUIRED` (asset-level field without `assetId`); `422 JOB_LEVEL_FIELD` (job-level field sent with an `assetId`); `422 INVALID_FIELD_VALUE` (type or format, e.g. date `30/09/2026`); `422 UNKNOWN_ASSET`; `409 RECORD_LOCKED`.

**Tests**

- `apps/api/test/lifecycle.test.ts` › "valuer captures field values with type checking".
- `apps/api/test/persistence.test.ts` › "keeps field history append-only".
- `packages/domain/test/core.test.ts` › "requires source, retrieval time, effective date and licence for external data"; "requires verifier identity when verified"; "flags reproduction prohibited and staleness"; "treats expired licences as unusable".
- `packages/domain/test/validation.test.ts` › "blocks incomplete provenance and warns on unverified evidence"; "blocks data whose licence does not permit reproduction"; "warns on stale external data".
- `packages/domain/test/requirements.test.ts` › "validates values against field definitions".
- `packages/domain/test/units.test.ts` › "converts old-title acres-roods-perches".
- TC-VAL-002, TC-DATE-004, TC-DATE-007, TC-UNIT-001…006, TC-MIG-002. **Gap:** registry endpoints; personal-information masking in logs (11 T-30); verification by a human only; `VAL-DATE-009` has no test that references the code.

### F-05 — Planning and hazard adapters with manual fallback

**Status:** Partially implemented. The domain has the adapter interface, connector policy (timeout, retry with backoff, circuit breaker, rate limiter), planning lookup with provenance check, manual fallback and a per-jurisdiction adapter plan. There is no API route and no live adapter. Hazard adapters are Pilot. · E-04 · S-022 (Done), S-040, S-073, S-074, S-093 · J-03, J-07 · M-05, W-19 · spec 04

**User story**
As a valuer, I want zone, overlays and hazards fetched from a licensed jurisdiction adapter, or entered manually from an uploaded planning report when no adapter is available, so that planning data is sourced and dated either way.

**Acceptance criteria**

1. Given a licensed, enabled adapter for the asset's jurisdiction, when a lookup succeeds, then the result carries complete provenance with verification `unverified`. Its values are offered as candidates for `planning.zone`, `planning.overlays`, `planning.instrument`, `planning.permissibleUses`, `planning.prohibitedUses` and `planning.reportDocument`. A person accepts them.
2. On timeout, 5xx, rate limit or an open circuit, retries apply only to idempotent calls, with exponential backoff and jitter; `429` honours `Retry-After`. Once the policy is exhausted, the outcome is `manual_fallback` with the reason, and nothing is partially written.
3. A result with incomplete provenance becomes `manual_fallback` ("incomplete provenance: …"). It is never stored as data.
4. An adapter for a different jurisdiction from the request is refused (`INVALID_ARGUMENT`).
5. _(planned)_ If the adapter is disabled, or its licence is missing or expired, no call is made and a fallback task is created with reason `ADAPTER_DISABLED` or `LICENCE_UNCONFIRMED` (04 §5.2) `[REVIEW: DATA_LICENSING]`.
6. Manual entry requires the source document. The result is recorded as `client_supplied` and `unverified`.
7. _(planned)_ When an adapter result conflicts with a manual entry or uploaded certificate, both are kept, a conflict is flagged for the valuer and nothing is overwritten.
8. Jurisdiction recommendations: REQ-JUR-VIC-001 (planning property report), REQ-JUR-NSW-001 (council planning certificate) and REQ-JUR-QLD-001 (local planning scheme). The NSW source is open (Q-17).
9. _(planned)_ Hazards (flood, bushfire, coastal, contamination) are captured with provenance, and a hazard needing escalation raises a risk flag (F-07). Today hazards are recorded only in `land.environmental`; structured fields are proposed in §3.3.

**Data fields**

- Catalogue: `planning.zone`, `planning.overlays`, `planning.instrument`, `planning.permissibleUses`, `planning.prohibitedUses`, `planning.source`, `planning.reportDocument`, `planning.useCompliance`, `land.environmental`, `location.titleReference`, `location.coordinates`.
- Domain `PlanningLookupRequest`: `jurisdiction`, `address`, `parcel` {`lot`, `plan`, `volumeFolio`}, `coordinates`.
- Domain `PlanningControlResult`: `zone`, `overlays[]`, `instrument`, uses, `propertyReport`, `provenance`.
- `ConnectorPolicy`: per-connector timeout, retries, circuit-breaker threshold and reset, rate limit.

**Validation**
`VAL-PROV-001`, `VAL-PROV-003`, `VAL-STALE-002`. `VAL-REQ-001` for `planning.zone` and `planning.source` (REQ-PT-VL-001, REQ-PT-VAL-LAND-001). `VAL-REQ-002` for the jurisdiction recommendations. `VAL-RISK-001` for hazard escalations.

**Permissions**
`asset.edit` to accept candidates or enter planning data manually. `datasource.manage` (ADMINISTRATOR) for adapter registry entries. Proposed: `datasource.lookup`, `datasource.verify`, and `datasource.configure` with a different-user licence approval (§3.1).

**Audit events**
`field.updated` for accepted values. Planned: `datasource.used` _(planned)_, `datasource.lookup_failed` _(planned)_, `datasource.fallback_task_created` _(planned)_, `datasource.verified` _(planned)_ and `datasource.config_changed` _(planned)_.

**Offline behaviour**
Lookups are online only. Manual entry and document capture work offline, and the fallback task is created on sync (04 §5.3). Data is cached on the device only where the licence grants caching rights.

**Error states**
Planned API: a lookup that ends in `manual_fallback` returns 200 with the fallback reason, not an error. Reason codes (04 §5.2): `timeout`, `circuit_open`, `rate_limited`, `failed`, `ADAPTER_DISABLED`, `LICENCE_UNCONFIRMED`, `NO_MATCH`, `AMBIGUOUS_MATCH`, `AUTH_FAILED`. `422 INVALID_ARGUMENT` covers the wrong jurisdiction and manual entry without a source document.

**Tests**

- `packages/domain/test/integration.test.ts` › "retries transient failures with exponential backoff"; "does not retry permanent errors and returns a manual fallback"; "times out slow calls"; "opens the circuit after repeated failures and half-opens after the reset period"; "rate-limits within a sliding minute"; "returns a provenance-complete result"; "falls back to manual entry on outage or incomplete provenance"; "refuses to use an adapter for another jurisdiction"; "builds manual results from an uploaded planning document"; "has a plan for every jurisdiction".
- TC-CONN-001…005. **Gap:** the L5 adapter contract suite (04 §6) is not implemented; `datasource.used` emission (TC-CONN-004); API route; hazard adapters; L12 resilience runs.

### F-06 — Permission-aware map

**Status:** Partially implemented. The GeoJSON feed `/v1/map/assets` exists, filtered by `job.read`. The M-01 map UI (clusters, filters, search, open from pin, navigation handoff, current location) is planned. · E-01 · S-036, S-083 · J-01, J-04 · M-01

**User story**
As a valuer or allocator, I want to see the single and portfolio assets I may access on a map, with their status and risk, so that I can plan work and open an asset from its pin (AC-01).

**Acceptance criteria**

1. Given `GET /v1/map/assets` (optionally with `?jobId=`), then the feed returns only assets of jobs the caller may read: same organisation, assigned, or a portfolio member, with restricted portfolios applied. Each asset is a GeoJSON `Point` with `assetId`, `label`, `jobId`, `jobReference`, `status`, `risk` and `purpose`.
2. Assets without coordinates are omitted from the feed. The UI lists them in a "Not mapped" group.
3. A caller with no access gets an empty collection, not an error, so nothing about other jobs is revealed.
4. _(planned)_ The map: clusters pins; styles pins by status or risk with a glyph and ring pattern, so colour is never the only cue (UX-05); filters by status, due date, purpose, risk and assignee; searches by address, reference and client; opens an asset from its pin; gives every pin a list equivalent (UX-04).
5. _(planned)_ The current-location dot appears only after OS permission and the in-app opt-in. The device location is never sent to the server, except as photo GPS under A-21 `[REVIEW: PRIVACY]`.
6. _(planned)_ Navigation handoff passes only the destination address or coordinates to the device's maps app.
7. _(planned)_ Provider attribution is shown. Tile caching follows the provider licence (Q-09, Q-10, R-02) `[REVIEW: DATA_LICENSING]`.
8. PERF-02: for 1,000 assets, feed p95 < 500 ms and first clustered render < 2 s (proposed targets).
9. `GET /v1/jobs/{jobId}/map` gives one job's map: its state government map service (viewer link and, where published, a basemap with attribution), the subject properties and any sales with coordinates (F-25).

**Data fields**
Catalogue: `location.coordinates`, `location.address`, `location.geocodeConfidence`. Record `asset`: `latitude`, `longitude`, `risk_level`. Record `job`: `status`, `purpose`, `reference`.

**Validation**
None at read time. Proposed: `VAL-LOC-001` for unverified locations (§3.2).

**Permissions**
`job.read` (ADMINISTRATOR, ALLOCATOR, VALUER, FIELD_INSPECTOR, QA_REVIEWER, FINANCE; assignment- or portfolio-scoped for non-organisation-wide roles). CLIENT_READONLY has no map. SoD-05 applies.

**Audit events**
None. Map reads are not audited, and filtering is silent, so no `auth.denied` is raised.

**Offline behaviour**
The list and map are cached read-only on mobile. Base-map tiles are online only unless the licence allows caching. If the provider is down, the list is shown instead.

**Error states**
Common errors (401, 400 for a malformed `jobId`). UI states _(planned)_: location denied (map works, no dot), provider down (list fallback), asset not geocoded.

**Tests**

- `apps/api/test/lifecycle.test.ts` › "shows the asset on the permission-aware map only to authorised users".
- TC-JOB-001, TC-JOB-002, TC-ROLE-008, PERF-02. **Gap:** map filtering for restricted portfolios; the `jobId` filter; L6/L7 map UI and accessibility (axe, list equivalent).

### F-07 — Mobile offline inspection and sync

**Status:** Partially implemented. The domain sync planner exists (idempotency, field-level merge, photo de-duplication, lock check), with `/v1/sync` for asset and photo operations and the risk-flag endpoint. The mobile app (M-01, M-06, M-07, M-13), checklists, dictation, conflict resolution and sync of other entities are planned. · E-05 · S-020 (Done), S-032, S-041, S-042, S-043, S-066, S-083 · J-04 · M-01, M-06, M-13

**User story**
As a valuer inspecting on site (or a field inspector, where the firm uses one; optional, 01 D12), I want to inspect with no connectivity and have my work sync later without duplicates or silent overwrites, so that nothing is lost or doubled (AC-03).

**Acceptance criteria**

1. _(planned)_ **Prepare offline** downloads the job package to the encrypted SQLCipher store: asset data, selection, rule-set and template versions, checklists, prior thumbnails and plans. The job is then marked "Available offline".
2. _(planned)_ The M-06 checklist is generated from the rule set for the scope. Every change is autosaved locally (UX-08), required items are marked, and `KERBSIDE` disables internal areas.
3. Given `POST /v1/sync` with `deviceId` and 1–500 operations, then each operation returns an outcome: `applied`; `duplicate_op`; `deduplicated` (with `existingId`); `conflict` (with `conflicts`); `rejected` (with `reason`).
4. Replaying an operation with the same `opId` returns `duplicate_op` and creates no duplicate asset (AC-03).
5. A photo create with a `contentHash` that already exists for the same asset returns `deduplicated` with the existing id.
6. Concurrent edits to different fields merge. A same-field edit under the `manual` policy, or a delete against an update, returns `conflict`: `sync.conflict_detected` is recorded and both values are kept in `sync_conflict` until resolved.
7. Operations against a job that is not `draft`, `active` or `returned` are `rejected` with a reason and stay on the device. For a locked record, the local value is saved as a note (M-13).
8. _(planned)_ **Finish inspection** lists the required gaps. Finishing with gaps needs a reason per gap, and each gap becomes a warning for the valuer (proposed `VAL-INSP-001`).
9. `KERBSIDE` and `RESTRICTED` inspections record the areas not inspected and the access attempts (`scope.*`). If access is refused, a scope change is suggested, but only the responsible valuer can change scope (F-03).
10. `POST /risk-flags` records `category`, `severity` (low, medium, high), `requiresEscalation` and `status`. Closing a flag needs a `resolutionNote`. An open escalation blocks submission (`VAL-RISK-001`). A limited scope with high-severity flags triggers `VAL-SCOPE-001` `[REVIEW: API_STANDARDS]`.
11. _(planned)_ Unresolved sync conflicts block submission for QA (UX-10, proposed `VAL-SYNC-001`). Every resolution is recorded with `sync.conflict_resolved`.
12. _(planned)_ When a device is deprovisioned, local data is wiped as soon as its token is rejected (A-19). Unsynced data is never evicted when storage runs low. Dictation keeps the transcript only (Q-22) `[REVIEW: PRIVACY]`.

**Data fields**

- Catalogue: `dates.inspection`, `scope.areasInspected`, `scope.areasNotInspected`, `scope.accessAttempts`, `scope.obstructionNotes`, `scope.internalConditionAssumption`, `scope.escalationDecision`, `scope.escalationJustification`, `improvements.condition`, `improvements.fixturesFinishes`, `improvements.defects`, `improvements.accommodation`.
- Sync operation: `opId` (8–100 characters), `jobId`, `entityType` (`asset`, `photo`), `entityId`, `kind` (`create`, `update`, `delete`), `baseVersion`, `changes`, `clientTimestamp`, `contentHash`, `parentId`.
- Syncable asset fields: `label`, `address`, `latitude`, `longitude`.
- Syncable photo metadata: `caption`, `roomOrArea`, `sequence`, `capturedAt`, `gps`, `quality`, `qualityOverrideReason`, `includeInReport`, `dHash`. Privacy status, flags, redaction and content identity change only through the privacy endpoint (F-08), never through sync.
- Record `risk_flag`: `assetId`, `category`, `description`, `severity`, `requiresEscalation`, `status` (`open`, `resolved`, `accepted`), `resolutionNote`.
- Records `sync_operation` and `sync_conflict` (`status` `open` or `resolved`).
- Proposed: `inspection.startedAt`, `inspection.finishedAt`, `inspection.gapReasons` (§3.3).

**Validation**
`VAL-RISK-001`, `VAL-SCOPE-001`, `VAL-REQ-001` (scope fields), `VAL-DATE-002`. Proposed: `VAL-INSP-001`, `VAL-SYNC-001`.

**Permissions**
`inspection.capture` (VALUER, FIELD_INSPECTOR) for the checklist and risk flags. Sync checks `asset.edit` or `photo.capture` per operation. Resolving a conflict needs edit permission on the record. Offline editing is limited to assigned jobs (R-06). Deprovisioning a device needs `user.manage` (ADMINISTRATOR, MFA).

**Audit events**
`sync.operation_applied`, `sync.conflict_detected`, `risk.flag_recorded`. Planned: `sync.conflict_resolved` _(planned)_, `inspection.started` _(planned)_ and `inspection.completed` _(planned)_. Assets and photos created through sync currently emit only `sync.operation_applied` (§3.6).

**Offline behaviour**
Offline is the core of this feature. All capture works offline. The server is the authority and re-validates at submission (A-28). Location and camera permissions are optional: without them, there is no GPS or capture, but everything else works.

**Error states**
Common errors, plus `422 WRONG_JOB` (entity belongs to another job); `422 ASSET_INCOMPLETE` (create without `label` or `address`); `422 PHOTO_INCOMPLETE` (create without `contentHash` or `parentId`); `422 UNKNOWN_FIELD` (asset field that cannot be synced); `422 RESOLUTION_NOTE_REQUIRED` (closing a risk flag without a note); `422 UNKNOWN_RISK_FLAG` (updating another job's flag); `409 RECORD_LOCKED` (risk flag on a locked job).

A rejected sync operation is reported per operation in a 200 response, not as an HTTP error.

**Tests**

- `packages/domain/test/sync.test.ts` › "replaying the same operation is idempotent (no duplicate assets)"; "de-duplicates photos by content hash within an asset"; "merges concurrent edits to different fields"; "surfaces conflicting edits to the same field instead of overwriting"; "detects update-after-delete and delete-after-update conflicts"; "rejects edits to locked jobs and unknown or future versions".
- `apps/api/test/jobs-and-sync.test.ts` › "replays offline operations without duplicate assets or photos"; "merges concurrent edits to different fields and surfaces same-field conflicts"; "rejects sync changes once the job is locked".
- `packages/domain/test/validation.test.ts` › "blocks open escalations and unsuitable limited scope".
- TC-SYNC-001…006, PERF-01. **Gap:** TC-SYNC-007 airplane-mode E2E (L6); TC-SYNC-006 causal ordering at L2; the conflict-resolution endpoint; SQLCipher store tests (12 §1.4); sync of fields, sketches, AI decisions and risk flags; API test for the risk-flag route.

### F-08 — Photo capture, quality checks and privacy redaction

**Status:** Partially implemented. Implemented: photo registration with SHA-256 de-duplication per asset; client-reported quality flags; the privacy endpoint (flag, redact, consent, exclude); report-eligibility rules; domain quality metrics (blur, low light, dHash). Planned: camera UI (M-07), redaction editor (M-08), unredacted-view logging, object storage and EXIF stripping. · E-06 · S-019 (Done), S-044, S-045, S-046 · J-04 · M-07, M-08

**User story**
As a valuer inspecting on site (or a field inspector, where the firm uses one; optional, 01 D12), I want to capture sequenced, captioned photos with quality warnings, and to flag and redact sensitive content, so that report photos are usable and personal information is protected.

**Acceptance criteria**

1. When `POST /photos` is called with: `assetId`, `sha256`, `sequence`, `capturedAt` (UTC); optionally `dHash`, `gps` {`lat`, `lng`, `accuracyM`}, `caption` (≤ 200), `roomOrArea` (≤ 80), `quality` {`isBlurry`, `isLowLight`}, `qualityOverrideReason`; `includeInReport` (default false), then the photo is stored with `capturedBy` and `privacyStatus = clear`, and `photo.captured` is recorded.
2. The same `sha256` for the same asset returns the existing id with `deduplicated: true` and emits no new event.
3. Domain quality checks: blur: Laplacian variance below `minSharpness` (60); low light: mean luminance below `minLuminance` (50); near-duplicates: dHash Hamming distance. The device warns, and the user keeps or discards the photo (M-07).
4. A blurry or low-light photo selected for the report without `qualityOverrideReason` triggers `VAL-PHOTO-002` (warning).
5. GPS is stored only with OS permission and the in-app setting on (A-21). It is device-reported and never "verified" (T-27).
6. The `flag` action takes `flags` ⊆ {`person`, `child`, `personal_document`, `number_plate`, `screen_or_display`, `personal_effects`, `other_sensitive`}. It sets `privacyStatus = requires_action` and records `photo.privacy_flagged`.
7. A photo in `requires_action` that is selected for the report triggers `VAL-PHOTO-001` (blocking) until one of: `redact` with `redactedPhotoId`; `consent` with `consentRef` (≥ 3 characters); `exclude`. `[REVIEW: PRIVACY]`
8. A photo flagged `child` can never be released on consent alone (`409 GUARD_FAILED`). `redact` on a photo that does not need redaction also returns `409 GUARD_FAILED`.
9. Only redacted derivatives are rendered into PDFs and client outputs. EXIF and GPS are stripped from derivatives _(planned, T-20)_.
10. _(planned)_ Viewing an unredacted original needs `photo.view_unredacted` and an explicit tap, and is logged (`photo.unredacted_viewed`). Originals follow RC-06 (90 days after issue unless kept as evidence) `[REVIEW: PRIVACY]` (Q-06).
11. _(planned)_ If camera permission is denied, capture is disabled with a link to settings, and notes and the checklist still work. Documents and barcodes are captured in document mode as Documents. The `site_capture` origin is proposed in §3.3.

**Data fields**
Record `photo`: `id`, `assetId`, `sha256`, `dHash`, `sequence`, `capturedAt`, `gps`, `caption`, `roomOrArea`, `quality`, `qualityOverrideReason`, `includeInReport`, `capturedBy`, `privacyFlags`, `privacyStatus` (`clear`, `requires_action`, `redacted`, `consent_recorded`, `excluded`), `redactedPhotoId`, `consentRef`. There are no catalogue fields; photos support `improvements.*` evidence through F-09.

**Validation**
`VAL-PHOTO-001` `[REVIEW: PRIVACY]`, `VAL-PHOTO-002`.

**Permissions**
`photo.capture` (VALUER, FIELD_INSPECTOR). `photo.redact` (VALUER, FIELD_INSPECTOR). `photo.view_unredacted` (VALUER, QA_REVIEWER). All of these are assignment-scoped.

**Audit events**
`photo.captured`, `photo.privacy_flagged`, `photo.redacted`, `photo.consent_recorded`, `photo.excluded`. `photo.unredacted_viewed` is _(planned)_.

**Offline behaviour**
Full on mobile: capture, flag and redact are queued. Uploads resume in the background, and the server de-duplicates by UUID and content hash (F-07).

**Error states**
Common errors, plus `409 GUARD_FAILED` (consent for a child; redaction not required); `422 INVALID_REDACTION` (the redacted derivative must be a separate image); `422 UNKNOWN_PHOTO` (the derivative is not a photo of this job); `422 INVALID_ARGUMENT` (consent reference missing); `404 NOT_FOUND` (photo); `409 RECORD_LOCKED`; `400 BAD_REQUEST` (`sha256` or `dHash` format, caption length).

**Tests**

- `packages/domain/test/photo.test.ts` › "detects blur by Laplacian variance"; "detects low light"; "groups exact and near duplicates"; "blocks flagged photos until redacted or consented"; "never releases photos of children on consent alone"; "requires a reason to include blurry or low-light photos".
- `packages/domain/test/validation.test.ts` › "blocks unredacted sensitive photos selected for the report".
- TC-PHOTO-001…003, TC-SYNC-002. **Gap:** API tests for `/photos` de-duplication and `/privacy`; unredacted-view logging; EXIF stripping; L6 camera; the PDF using the redacted derivative (TC-PDF-005); `VAL-PHOTO-002` has no test that references the code.

### F-09 — AI photo suggestions (accept / edit / reject)

**Status:** Implemented in domain/API, governance only. Implemented: suggestion ingestion restricted to AI service principals; allowlists and the prohibited-inference filter; human decisions that create facts with provenance. Planned (Pilot, behind a feature flag): model integration, the M-09 UI, valuer confirmation of inspector-accepted facts, and invalidation on redaction. · E-06, E-07 · S-018 (Done), S-068, S-069 · J-05 · M-09

**User story**
As a valuer, I want AI to suggest room types and visible attributes from my photos, showing confidence and source, and to accept, edit or reject each suggestion, so that capture is faster and no unconfirmed fact reaches the report (AC-05).

**Acceptance criteria**

1. Only a principal of kind `ai` may call `POST /ai-suggestions`. Any other caller gets `403 ACTOR_NOT_PERMITTED` or `AI_SERVICE_ONLY`, and `auth.denied` is recorded. A suggestion has: `kind`: `room_classification`, `visible_attribute`, `sketch_outline` or `room_label`; `label`: from the `ROOM_TYPES` or `VISIBLE_ATTRIBUTES` allowlist; `confidence`: 0–1; `model` {`provider`, `model`, `version`}; a source `photoId` (for photo kinds) or `sourcePlanId` (for outlines), belonging to this job (`422 UNKNOWN_PHOTO`, `422 UNKNOWN_SOURCE_PLAN`). It is stored as `pending` with `ai.suggestion_created`, and no field changes.
2. A label outside the allowlist, or one implying concealed construction, operational condition, brand, compliance, dimensions or defects, returns `422 AI_INFERENCE_PROHIBITED` and is never shown.
3. **Accept** writes an `accepted_fact`. It records the deciding person as author, the time, the photo id, the suggestion id, the model version, and origin `ai_suggestion_accepted`. `ai.suggestion_accepted` is recorded.
4. **Edit** writes a fact with `editedLabel` or `editedValue`, which must stay within the taxonomy and change something. It records origin `ai_suggestion_edited` and `ai.suggestion_edited`.
5. **Reject** (optional reason) writes no fact and records `ai.suggestion_rejected`. Decisions are final: deciding again returns `409 GUARD_FAILED`.
6. Confidence never auto-accepts (A-11). AI and system actors cannot decide: the route accepts human actors only (`ACTOR_NOT_PERMITTED`), and the domain enforces SoD-06 (`HUMAN_ACTOR_REQUIRED`). There is no "accept all" (UX-12).
7. Pending suggestions never appear in the report, in totals or in validation inputs. `VAL-AI-001` blocks submission and issue while any suggestion is undecided.
8. _(planned)_ Where a firm uses a separate FIELD_INSPECTOR (optional, 01 D12), a fact they accept stays "inspector-captured" until the valuer confirms it (A-25; proposed `fact.confirm`, `VAL-AI-003`).
9. _(planned)_ If the source photo is redacted or excluded, pending suggestions are invalidated and accepted facts are flagged for re-check. Facts that conflict across photos raise a conflict for the valuer (proposed `VAL-AI-002`).
10. _(planned)_ The feature stays off until the PIA and the processor's data-processing agreement cover AI processing location and retention (Q-16, R-08) `[REVIEW: PRIVACY]` `[REVIEW: LEGAL]`. Use of AI is disclosed through clause `ai-assistance`, currently a placeholder `[REVIEW: API_STANDARDS]`.

**Data fields**

- Record `ai_suggestion`: `assetId`, `kind`, `photoId`, `sourcePlanId`, `label`, `value`, `confidence`, `model`, `status` (`pending`, `accepted`, `edited`, `rejected`), `createdAt`.
- Decision request: `decision`, `editedLabel`, `editedValue`, `reason`.
- Record `accepted_fact`: `id`, `assetId`, `suggestionId`, `label`, `value`, `provenance`.
- Facts are candidates for `improvements.fixturesFinishes` and `improvements.accommodation`; that mapping is planned.

**Validation**
`VAL-AI-001`. `GEO-PENDING-REVIEW` for undecided outline suggestions (F-10). Proposed: `VAL-AI-002`, `VAL-AI-003`, `VAL-AI-004`.

**Permissions**
`ai.decide` (VALUER, FIELD_INSPECTOR; human only). Ingestion checks `inspection.capture` and the principal kind `ai`. There is no AI service role in the matrix (§3.1). SoD-06 applies.

**Audit events**
`ai.suggestion_created`, `ai.suggestion_accepted`, `ai.suggestion_edited`, `ai.suggestion_rejected`.

**Offline behaviour**
Decisions work offline on mobile and are queued (planned sync operation type). Generation is online only. AI being unavailable blocks nothing (J-05 E1).

**Error states**
Common errors, plus `403 AI_SERVICE_ONLY`, `403 ACTOR_NOT_PERMITTED` (both recorded); `422 UNKNOWN_PHOTO`, `422 UNKNOWN_SOURCE_PLAN`; `422 AI_INFERENCE_PROHIBITED`; `422 INVALID_ARGUMENT` (missing source, confidence out of range, edit that changes nothing); `403 HUMAN_ACTOR_REQUIRED`; `409 GUARD_FAILED` (already decided); `404 NOT_FOUND` (suggestion).

**Tests**

- `packages/domain/test/ai.test.ts` › "accepts allowlisted room types and visible attributes as pending suggestions"; "refuses labels outside the allowlist"; "requires source evidence and a valid confidence"; "produces a fact with author, time, photo provenance and model only on acceptance"; "never accepts on confidence alone or by an AI/system actor"; "edits keep within the taxonomy and record the edit"; "rejection produces no fact and decisions are final".
- `apps/api/test/lifecycle.test.ts` › "keeps AI suggestions pending until a person decides".
- `packages/domain/test/validation.test.ts` › "blocks submission with undecided AI suggestions".
- `packages/domain/test/permissions.test.ts` › "AI actors can never take professional decisions".
- TC-AI-001…004, TC-ROLE-005. **Gap:** invalidation on redaction; inspector-fact confirmation; monitoring log for discarded labels; M-09 accessibility.

### F-10 — Areas & Sketch: import, calibrate, draw, schedule, approve

**Status:** Implemented in domain/API. Implemented: sketch versions with boundaries; two-point and stated-scale calibration; human scale confirmation; the area schedule with deductions, overlap and plausibility checks; approval bound to the schedule hash; freezing at issue; the sketch as working notes by default, with area checks only for schedules the report relies on (01 D11; the preview implements the notes sketch and "Use as building area"). Planned: the M-10–M-12 canvas UI, source-plan upload, AI outlines and the perspective-correction UI. · E-07 · S-011, S-012, S-013, S-026 (Done), S-047, S-048, S-049, S-069 · J-06 · M-10, M-11, M-12

**User story**
As a valuer, I want to sketch the improvements as working notes and state the building area, and, where the report relies on a measured schedule, to import or photograph a plan, calibrate it, draw or confirm closed boundaries, choose the measurement basis and approve the area schedule, so that every reported m² traces to its source, sketch version and approver (AC-08).

**Acceptance criteria**

1. `POST /assets/{assetId}/sketches` without `sketchId` creates version 1. It requires `units` (`metres` or `plan_units`), `basis`, `conventionId`, `boundaries` and a `changeSummary` of at least 3 characters (`422 SKETCH_INCOMPLETE` otherwise). With a `sketchId`, it creates the next version with lineage. Both record `sketch.version_created`.
2. Each boundary has: `level`, `label`; `role` (`component` or `deduction`), `componentType`; `points` (2–500), `closed`; `dimensionSource` (`measured`, `supplied`, `scaled`, `estimated`); `origin` (`drawn`, `traced`, `imported`).
3. Calibration is either `two_point` (`p1`, `p2`, `knownDistanceM` from 0.5 to 2,000 m, span of at least 50 units) or `stated_scale` (`ratio`, `dpi`). It needs a source plan (`422 SOURCE_PLAN_REQUIRED`), starts `unverified` (`GEO-SCALE-UNVERIFIED`), and records `calibration.created`. Recalibration supersedes the previous calibration and recomputes all dependent areas, keeping the history.
4. `POST /sketch-versions/{id}/confirm-scale` (human, `measurement.approve`, `checkNote` of at least 5 characters, latest version only) creates a new confirmed version and records `calibration.confirmed`. A check dimension that deviates beyond tolerance (default 2 %) must be recalibrated or justified (proposed `VAL-AREA-005`).
5. The schedule for each version contains: one row per component: level, label, `componentType`, basis, gross, deductions, net, perimeter, `dimensionSource`, confidence (high, medium, low), included in total, measured by and at, sketch version and calibration ids; level totals, `totalNetM2`, `totalIncludedM2`; issues, `reportable` and `scheduleHash`. The schedule is deterministic.
6. Geometry checks: overlaps are counted once, using the union, and raise `GEO-OVERLAP`; deductions are subtracted from their parent, and `GEO-DEDUCTION-OUTSIDE` and `GEO-DEDUCTION-PARTIAL` flag problems; other checks: `GEO-OPEN-SHAPE`, `GEO-INVALID-POLYGON`, `GEO-SCALE-MISSING`, `GEO-PENDING-REVIEW`, `GEO-IMPLAUSIBLE-DIMENSION`, `GEO-IMPLAUSIBLE-AREA`, `GEO-SUPPLIED-VARIANCE` (over 5 %), `GEO-FLOOR-TOTAL-MISMATCH`, `GEO-CONVENTION-BASIS-MISMATCH`, `GEO-NO-COMPONENTS`.
7. `POST /sketch-versions/{id}/approve` works only on the latest version (`409 STALE_VERSION` otherwise), only for a human, and only for a reportable schedule (`409 GUARD_FAILED` lists the blocking GEO codes otherwise). The approval is bound to `scheduleHash` and records `measurement.approved`.
8. Any edit after approval creates a new version. For a schedule the report relies on, areas show "Unverified", and `VAL-AREA-002` blocks until the new version is approved.
9. The sketch is working notes by default (01 D11). The seed template has no `sketch` block, and `includeInClientReport` defaults to `false`. Where the `areas` section is required, the report shows the schedule table and clause `area-disclaimer` (placeholder) `[REVIEW: API_STANDARDS]`. A firm template may add a `sketch` block; the drawing (legend, north point from `northBearingDeg`, scale status) then appears only for versions with `includeInClientReport = true`, and excluded sketches stay in the audit record.
10. At issue, the sketch version and schedule used are frozen (`guard_sketch_update` trigger) and stored in the issue snapshot.
11. Perspective correction (homography) is labelled "Assistive — not a surveyed measurement" and is never presented as surveyed.
12. Measurement conventions (`res-living`, `res-under-main-roof`, `comm-nla`, `retail-gla`, `ind-gba`, `gfa`) are firm-nominated drafts (A-26) `[REVIEW: API_STANDARDS]`. Third-party method text is referenced, not reproduced `[REVIEW: DATA_LICENSING]`.
13. `VAL-AREA-001`…`004` apply only to schedules the report relies on: the asset's `improvements.areaSchedule` names the sketch (`useForReport`), or the rules require `improvements.areaSchedule` for the asset (e.g. `INSURANCE_REPLACEMENT`, `INDUSTRIAL`, `SPECIALISED_MIXED_USE`). A sketch kept as notes is not checked and needs no approval.
14. Residential jobs require `improvements.buildingArea` (m², Inspection tab) instead of an area schedule (REQ-PT-RES-001; REQ-APP-SUM-001 for summation). The valuer can copy the sketch total into it ("Use as building area").

**Data fields**

- Catalogue: `improvements.buildingArea` (m²), `improvements.areaSchedule`, `improvements.measurementBasis` (GFA, GBA, GLA, NLA, BUILDING_AREA, SITE_COVERAGE, OTHER), `improvements.floorAreas`, `improvements.lettableArea`, `improvements.warehouseArea`, `improvements.officeArea`, `improvements.siteCoverage`, `improvements.hardstand`, `land.area`.
- Sketch request: `sketchId`, `units`, `sourcePlanId`, `calibration`, `boundaries`, `basis`, `conventionId`, `northBearingDeg`, `suppliedAreas` {`label`, `areaM2`, `level`, `source`}, `includeInClientReport`, `changeSummary`, `useForReport`.
- Records `sketch_version`, `scale_calibration` and `measurement_approval` (append-only).

**Validation**
`VAL-AREA-001`, `VAL-AREA-002`, `VAL-AREA-003`, `VAL-AREA-004`, and the GEO codes above. Proposed: `VAL-AREA-005`.

**Permissions**
`sketch.edit` (VALUER; FIELD_INSPECTOR where the firm uses one) to draw and calibrate. `measurement.approve` (VALUER, human) to confirm the scale and approve. FIELD_INSPECTOR cannot approve.

**Audit events**
`sketch.version_created`, `calibration.created`, `calibration.confirmed`, `measurement.approved`, and `ai.suggestion_*` for outlines. A void-on-edit event is proposed in §3.4.

**Offline behaviour**
Full on mobile: drawing, calibration and the schedule are computed by `@vp/domain`. An approval made offline is queued, re-validated on sync and voided with a notice if rejected (J-06 E3). `/v1/sync` does not carry sketch operations yet (§3.5).

**Error states**
Common errors, plus `422 SKETCH_INCOMPLETE`; `422 SOURCE_PLAN_REQUIRED`; `422 UNKNOWN_SOURCE_PLAN` (the plan must be a photo or document of this job); `422 INVALID_COMPONENT_TYPE` (`componentType` not valid for the boundary role); `422 SKETCH_ASSET_MISMATCH`; `422 UNKNOWN_CONVENTION`; `422 NO_CALIBRATION`; `422 CALIBRATION_INVALID`; `422 GEOMETRY_INVALID`; `409 STALE_VERSION`; `409 GUARD_FAILED` (not reportable); `409 CONFLICT` (schedule computed for another version); `409 IMMUTABLE_RECORD` (frozen or approved version); `403 HUMAN_REQUIRED` (recorded).

**Tests**

- `packages/domain/test/geometry.test.ts` › "computes area with the shoelace formula regardless of winding"; "measures overlap, unions and coverage without double counting"; "calibrates from two points and a known dimension"; "calibrates from a stated drawing scale"; "checks a second known dimension and confirms"; "maps a photographed quadrilateral onto a rectangle"; "builds a closed polygon from wall lengths entered on site".
- `packages/domain/test/area-schedule.test.ts` › "flags overlapping components and never double-counts them"; "requires a scale for traced plans and labels areas unverified until confirmed"; "approves a reportable schedule, binding the approval to its hash"; "refuses approval by non-humans, of non-reportable schedules or mismatched versions"; "creates new versions with lineage and requires a change summary".
- `apps/api/test/lifecycle.test.ts` › "draws, measures and approves the improvement areas".
- `packages/domain/test/validation.test.ts` › "requires an approved schedule matching the current hash"; "blocks non-reportable schedules and implausible site coverage".
- `packages/domain/test/report.test.ts` › "reports measured areas but never the sketch drawing where the rules need a schedule".
- `apps/preview/test/journey.test.ts` › "keeps the sketch as notes: not checked, not reported, total copied on request".
- TC-GEO-001…012, TC-UNIT-005. **Gap:** recalibration history at L2 (TC-GEO-007); sketch frozen after issue (TC-WF-005); `includeInClientReport` exclusion with a template that has a `sketch` block (TC-PDF-005); a domain-level test for an unlinked notes sketch (TC-GEO-012); `VAL-AREA-003` has no test that references the code; L6/L7 canvas, including the non-dragging alternative (UX-02).

### F-11 — Sales evidence and adjustments

**Status:** Implemented in domain/API. Implemented: sale capture with provenance; traced land, building and adjusted rates; outlier detection; the adopted-value range check; retrospective hindsight controls. Planned: the W-04 grid and comparables map, licensed import, and edit or soft-delete of sales. · E-08 · S-007, S-026 (Done), S-050, S-075 · J-07 · W-04, W-06, W-07

**User story**
As a valuer, I want to record comparable sales with provenance, comparability and reasoned adjustments, and see traced unit rates and adjusted indications, so that my reconciliation rests on transparent evidence.

**Acceptance criteria**

1. When `POST /sales` is called with: `assetId` (of this job), `address`, `contractDate`, optional `settlementDate`, `price` > 0, `interest`, `propertyType`; optional `landAreaM2`, `buildingAreaM2`, `zoning`; `provenance` (origin `external_source`, `client_supplied` or `manual_entry`), `comparability` (superior, comparable, inferior); `adjustments[]` {`factor`, `kind` (percent or absolute), `value`, `rationale` ≥ 3 characters}; `analysisBasis` (`land_rate`, `building_rate`, `price`), optional `postValuationDateUse` {`reason` ≥ 5}. then the sale is stored, and the land, building and adjusted rates are computed with `land.rate_per_m2@1`, `improvements.rate_per_m2@1`, `improvements.added_value_rate@1`, `comparison.adjusted_rate@1` and `comparison.adjusted_price@1`. Each calculation is stored with its trace hash, and `evidence.sale_added` and `calculation.run` are recorded.
2. Adjustments never change the raw inputs. Gross and net adjustment totals are shown.
3. Evidence warnings: outlier rates (Tukey fences): `VAL-CALC-001`; adopted value outside the adjusted indications: `VAL-CALC-002`; fewer comparables than the configured minimum: `VAL-EVID-001`; sale older than the configured window: `VAL-STALE-001`; unverified evidence: `VAL-PROV-002`. Incomplete provenance is blocking (`VAL-PROV-001`).
4. For a retrospective valuation (any purpose; derived from the dates, 01 D8), a sale after the information cut-off (`dates.retrospectiveDataCutOff`, or the valuation date when none is recorded): without `postValuationDateUse` triggers `VAL-DATE-005` (blocking); with a stated check-only use triggers `VAL-DATE-006` (warning). `[REVIEW: TAX]` `[REVIEW: API_STANDARDS]`
5. A licence that prohibits reproduction allows the sale in analysis only. It reaches the report only in the permitted form (`VAL-PROV-003`) `[REVIEW: DATA_LICENSING]`.
6. _(planned)_ The comparables map has a table equivalent. Licensed import records attribution (S-075). Edit and soft-delete are audited (UX-20).

**Data fields**

- Catalogue: `evidence.sales`, `valuation.landRate`, `valuation.approaches`, `valuation.primaryApproach`, `valuation.crossCheckApproach`, `valuation.reconciliation`, `valuation.adoptedValue`, `dates.valuation`, `dates.retrospectiveDataCutOff`.
- Record `sale_comparable`: the attributes in criterion 1. Linked `calculation` rows carry `sale_id`.

**Validation**
`VAL-PROV-001`, `VAL-PROV-002`, `VAL-PROV-003`, `VAL-CALC-001`, `VAL-CALC-002`, `VAL-EVID-001`, `VAL-STALE-001`, `VAL-DATE-005`, `VAL-DATE-006`, and `VAL-REQ-001` (`evidence.sales` under REQ-PUR-MV-001, CGT-001, FL-001).

**Permissions**
`evidence.edit` (VALUER only). `job.read` to view. FIELD_INSPECTOR is excluded (TC-ROLE-006).

**Audit events**
`evidence.sale_added`, `calculation.run`, and `datasource.used` _(planned)_ for licensed import.

**Offline behaviour**
Full on tablet (W-04), with the sync operation type planned. Web is online only.

**Error states**
Common errors, plus `422 UNKNOWN_ASSET`, `422 INVALID_ARGUMENT` / `INVALID_UNIT` (from rate calculations) and `409 RECORD_LOCKED`.

**Tests**

- `packages/domain/test/calculations.test.ts` › "produces traced land, building and adjusted rates"; "flags outlier rates with Tukey fences"; "summarises rates and checks the adopted figure against indications".
- `packages/domain/test/validation.test.ts` › "warns on too few comparables and outlier rates"; "warns when the adopted value is outside adjusted price indications"; "blocks hindsight sales unless used as a stated check"; "passes with contemporaneous evidence"; "warns on dated sales".
- `apps/api/test/lifecycle.test.ts` › "records sales evidence with traced rates".
- TC-CALC-001, TC-CALC-002, TC-DATE-001, TC-VAL-002. **Gap:** licensed-import attribution; edit and soft-delete audit; W-04 E2E.

### F-12 — Rental evidence

**Status:** Implemented in domain/API: rental comparables with rent basis, incentive ratio, lease area and term, plus traced effective-rent and rate calculations through `/calculations`. The W-05 UI is planned. · E-08 · S-008 (Done), S-050 · J-07 · W-05

**User story**
As a valuer, I want to record rental comparables with rent basis, incentives, lease area and term, so that effective rents and $/m² are computed consistently and support market-rent and income approaches.

**Acceptance criteria**

1. When `POST /rentals` is called with `assetId`, `address`, `leaseStartDate`, `faceRentPa` > 0, `rentBasis` (`gross`, `semi_gross`, `net`), `leaseAreaM2` > 0, optional `incentiveRatio` (0–1), optional `termYears`, `provenance`, `comparability`, `adjustments` and optional `postValuationDateUse`, then the comparable is stored with provenance and `evidence.rental_added` is recorded.
2. Effective rent and rent per m² are computed through `POST /calculations` with `income.effective_rent@1` or `income.effective_rent_rent_free@1`, and `income.rent_rate_per_m2@1`. Each is traced (F-13).
3. An incentive outside 0–100 %, or an effective rent above the face rent, triggers `VAL-RENT-001` (blocking).
4. `RENTAL_ASSESSMENT` (REQ-PUR-RENT-001) requires `rent.*` and `evidence.rentals`. Commercial and industrial valuation analytics (REQ-PT-COM-002, REQ-PT-IND-002) also require `evidence.rentals`.
5. SEL-002 warns for `RENTAL_ASSESSMENT` on `VACANT_LAND` (ground rent methodology).
6. Retrospective rules (`VAL-DATE-005`, `VAL-DATE-006`) and provenance rules apply as in F-11 `[REVIEW: TAX]`.
7. The rent review mechanism wording is under review `[REVIEW: LEGAL]`. The effective-rent method is under review `[REVIEW: API_STANDARDS]`.
8. _(planned)_ An area-basis mismatch between a comparable and the subject (e.g. NLA against GLA) is flagged in W-05.

**Data fields**

- Catalogue: `evidence.rentals`, `rent.basis`, `rent.reviewDate`, `rent.reviewMechanism`, `rent.leaseArea`, `rent.permittedUse`, `rent.incentives`, `rent.outgoings`, `rent.termAndOptions`, `rent.vacancy`, `rent.faceRent`, `rent.effectiveRent`, `rent.ratePerM2`, `rent.adoptedMarketRent`, `tenancy.incentives`, `tenancy.outgoings`.
- Record `rental_comparable`: the attributes in criterion 1.

**Validation**
`VAL-RENT-001`, `VAL-PROV-001`, `VAL-PROV-002`, `VAL-PROV-003`, `VAL-DATE-005`, `VAL-DATE-006`, `VAL-EVID-001`, `VAL-REQ-001`, and `VAL-SEL-002` (SEL-002).

**Permissions**
`evidence.edit` (VALUER). `calculation.run` (VALUER). `job.read` to view.

**Audit events**
`evidence.rental_added`, `calculation.run`.

**Offline behaviour**
Full on tablet (W-05). Web is online only.

**Error states**
Common errors, plus `422 UNKNOWN_ASSET`, `400 BAD_REQUEST` (`incentiveRatio` outside 0–1) and `409 RECORD_LOCKED`.

**Tests**

- `packages/domain/test/calculations.test.ts` › "computes yields, capitalised values and effective rents".
- `packages/domain/test/requirements.test.ts` › "rental assessment requires face/effective rent and rental evidence".
- TC-CALC-003, TC-CALC-004. **Gap:** no API test for `/rentals`; `VAL-RENT-001` has no test that references the code; area-basis mismatch.

### F-13 — Traced calculations and overrides

**Status:** Implemented in domain/API. Implemented: formula registry (14 formulas, all version 1); traced runs with unit conversion; trace-hash verification; reasoned overrides that keep the computed value. Planned: the W-06 trace drawer and W-07 reconciliation UI. · E-08 · S-005, S-006 (Done), S-051 · J-07 · W-06, W-07

**User story**
As a valuer, I want every calculated rate to show its inputs, units, formula and version, and to override a result only with a reason, so that every figure is traceable and defensible (AC-04).

**Acceptance criteria**

1. `POST /calculations` {`assetId`?, `formulaId`, `formulaVersion`?, `inputs[]` {`name`, `value`, `unit`, `sourceRef`?}} stores a record with: formula id and version; each input's raw value, unit and converted value; intermediate values; output and unit; computed time; and trace hash. `calculation.run` is recorded.
2. Errors: an unknown formula or version returns `422 UNKNOWN_FORMULA`. A unit of the wrong dimension returns `422 INVALID_UNIT`. A missing, zero, negative, NaN or infinite input returns `422 INVALID_ARGUMENT`. No NaN is ever persisted.
3. Formula versions are immutable. A new version never alters earlier results.
4. `POST /calculations/{calcId}/override` {`value`, `reason`} needs a substantive reason (`422 OVERRIDE_REASON_REQUIRED` otherwise). The computed value is kept, the override records actor, time and reason, and `calculation.overridden` is recorded. The figure carries an "Overridden" badge wherever it appears.
5. A stored record that no longer reproduces from its inputs triggers `VAL-CALC-003` (possible tampering; blocking). An override without a reason triggers `VAL-CALC-004`.
6. Money is stored as integer cents and rounded half away from zero. Rounding happens only at presentation. Template rounding of the adopted value is a separate recorded step (Q-11) `[REVIEW: API_STANDARDS]`.
7. The reconciliation rationale (`valuation.reconciliation`) is mandatory under the purpose rules. An adopted value outside the range of indications triggers `VAL-CALC-002`.
8. Scope is limited to practitioner-controlled calculators pending D4. There is no automated valuation model, and AI never determines value (G2).

**Data fields**

- Catalogue: `valuation.landRate`, `valuation.adoptedValue`, `valuation.reconciliation`, `valuation.approaches`, `valuation.primaryApproach`, `valuation.crossCheckApproach`, `income.marketIncome`, `income.capRate`, `income.discountRate`, `income.terminalYield`, `tenancy.wale`, `tenancy.passingIncome`, `rent.effectiveRent`, `rent.ratePerM2`.
- Record `calculation`: `formula_id`, `formula_version`, `record` (trace), `trace_hash`, `asset_id`, `sale_id`, override {value, reason, by, at}.

**Validation**
`VAL-CALC-001`, `VAL-CALC-002`, `VAL-CALC-003`, `VAL-CALC-004`.

**Permissions**
`calculation.run` (VALUER). `calculation.override` (VALUER, human only). FIELD_INSPECTOR is denied both (TC-ROLE-006).

**Audit events**
`calculation.run`, `calculation.overridden`.

**Offline behaviour**
Full on device: the domain library calculates and W-06 and W-07 work on tablet. The server re-verifies trace hashes at submission (A-28).

**Error states**
Common errors, plus `422 UNKNOWN_FORMULA`; `422 INVALID_UNIT`; `422 INVALID_ARGUMENT`; `422 OVERRIDE_REASON_REQUIRED`; `404 NOT_FOUND` (calculation); `403 HUMAN_REQUIRED` (override by a non-human); `409 RECORD_LOCKED`.

**Tests**

- `packages/domain/test/calculations.test.ts` › "has unique id@version pairs and declared outputs"; "computes a land rate and records a full trace"; "converts input units and preserves the raw input"; "rejects invalid inputs"; "computes WALE by income"; "requires a substantive reason and keeps the computed output"; "detects tampering with a stored output".
- `packages/domain/test/units.test.ts` › "converts imperial and metric areas exactly"; "rounds half away from zero, including binary edge cases"; "converts dollars to integer cents".
- `apps/api/test/lifecycle.test.ts` › "rejects overrides without a reason and records them with one".
- `packages/domain/test/validation.test.ts` › "blocks tampered calculations and overrides without reasons".
- TC-CALC-001…005, TC-CALC-008, TC-CALC-009, TC-UNIT-001…006. **Gap:** integer-cents database round trip at L2 (TC-CALC-008); formula-version regression; WALE by area (TC-CALC-005, which the registry lacks; §3.6).

### F-14 — Replacement cost (insurance)

**Status:** Partially implemented. Implemented: the `cost.replacement@1` build-up, `VAL-INS-001`, the REQ-PUR-INS-001 requirements and SEL-001/SEL-009. Planned: licensed cost-guide input capture (S-076) and portfolio scale (S-098). · E-08, E-02 · S-009 (Done), S-076, S-098 · J-07 · W-06, W-07

**User story**
As a valuer, I want to build up a replacement or reinstatement cost from measured areas and sourced rates, with every allowance shown, so that the recommended sum insured is explained and its data sources are recorded.

**Acceptance criteria**

1. Given purpose `INSURANCE_REPLACEMENT`, REQ-PUR-INS-001 requires `ins.basis`, `improvements.areaSchedule`, `improvements.measurementBasis`, `ins.constructionType`, `ins.quality`, `ins.services`, `ins.costDataSource`, `ins.demolitionDebris`, `ins.professionalFees`, `ins.escalation`, `ins.leadTimeMonths`, `ins.codeUpgradeAllowance`, `ins.locationFactor`, `ins.gstTreatment`, `ins.exclusions` and `ins.sumInsured`.
2. SEL-001 blocks `INSURANCE_REPLACEMENT` with `VACANT_LAND` (`VAL-SEL-001`). SEL-009 warns on `DESKTOP` scope.
3. `cost.replacement@1` computes: construction = Σ(area × rate) × location factor; fees = (construction + code upgrade) × fee ratio; escalation, demolition and GST treatment. Defaults are recorded in the trace.
4. Areas come from the approved area schedule (F-10). If the schedule is not approved, `VAL-AREA-002` blocks.
5. The cost data source must record its edition or reference, locality and date (`VAL-INS-001`, blocking) `[REVIEW: QUANTITY_SURVEYOR]`. Rawlinsons and AIQS data are used only under licence and never reproduced (A-29) `[REVIEW: DATA_LICENSING]`.
6. GST treatment (`inclusive` or `exclusive`) is recorded and shown with the sum insured (A-32) `[REVIEW: TAX]`.
7. The certified amount kind is `sum_insured` (F-18). Clause `insurance-cost-data` (placeholder) discloses that indices are indicative `[REVIEW: QUANTITY_SURVEYOR]`.
8. _(planned)_ Cost-guide inputs are captured as structured rows (edition, locality, date, adjustments). A portfolio schedule of sums insured is produced (S-098).

**Data fields**
The catalogue fields in criterion 1, plus `improvements.construction`, `improvements.quality`, `improvements.services`. Data source kind `construction_cost`. Proposed: a structured cost-rate schedule field (§3.3).

**Validation**
`VAL-INS-001`, `VAL-AREA-002`, `VAL-SEL-001`, `VAL-SEL-002`, `VAL-REQ-001`, `VAL-PROV-001`, `VAL-PROV-003`.

**Permissions**
`asset.edit` for the `ins.*` fields. `calculation.run` and `calculation.override` (VALUER). `datasource.manage` for registering cost sources.

**Audit events**
`field.updated`, `calculation.run`, `calculation.overridden`, and `datasource.used` _(planned)_.

**Offline behaviour**
Field capture and the calculation work offline on tablet. Licensed cost data is cached only where the licence permits.

**Error states**
Common errors, plus the F-04 field errors and the F-13 calculation errors.

**Tests**

- `packages/domain/test/calculations.test.ts` › "builds up replacement cost with defaults recorded in the trace".
- `packages/domain/test/requirements.test.ts` › "insurance requires cost build-up fields but not income analytics"; "blocks insurance replacement cost for vacant land".
- TC-CALC-006, TC-FLD-003. **Gap:** `VAL-INS-001` has no test that references the code (TC-CALC-006 requires it); GST presentation; portfolio scale.

### F-15 — Fair value (AASB 13) support

**Status:** Partially implemented. Implemented: the REQ-PUR-FR-001 requirements, `deriveFairValueLevel` and `capitalisationSensitivity` in the domain, and `VAL-FR-001`. There is no API endpoint for the derivation or sensitivity; values are captured as fields. The disclosure-support export (S-097) is Production. · E-08 · S-010 (Done), S-097 · J-07

**User story**
As a valuer preparing a financial-reporting valuation, I want to record AASB 13 inputs, see the fair-value hierarchy level derived from the significant inputs, and produce a sensitivity table, so that the entity's disclosures are supported without the platform drawing accounting conclusions.

**Acceptance criteria**

1. `FINANCIAL_REPORTING` requires `fr.accountingStandard`, `fr.reportingEntity`, `fr.reportingDate`, `fr.unitOfAccount`, `fr.principalMarket`, `fr.marketParticipantAssumptions`, `fr.valuationPremise`, `fr.valuationTechnique`, `fr.significantInputs`, `fr.fairValueHierarchyLevel`, `fr.sensitivityAnalysis` and `fr.disclosureSchedule`, plus the common valuation fields (REQ-PUR-FR-001).
2. The derived level is the lowest level of any significant input. If the recorded level differs, `VAL-FR-001` (warning) must be acknowledged with a reason `[REVIEW: ACCOUNTING]`.
3. The capitalisation sensitivity grid (shifts in cap rate and rent) is monotonic and is referenced from `fr.sensitivityAnalysis`.
4. SEL-004 warns on `DESKTOP` scope. Confirming it against the entity's revaluation policy is `[REVIEW: ACCOUNTING]`.
5. The rule set and clause `fair-value-disclosure` (placeholder) refer to "AASB 13 Fair Value Measurement", never "AASB 113" (G6). Alignment is configurable, not hard-coded.
6. Basis of value `fair_value`; the certified amount kind is `value`.
7. _(planned)_ A portfolio disclosure-support schedule export lists the hierarchy level, technique, significant unobservable inputs and sensitivity (S-097) `[REVIEW: ACCOUNTING]`.
8. The output only supports disclosures. Unit of account, principal market and premise remain judgements of the valuer and the entity `[REVIEW: ACCOUNTING]`.

**Data fields**
The `fr.*` fields above, `instruction.basisOfValue`, `valuation.highestAndBestUse`, `income.capRate`, `income.marketIncome`. Domain `FairValueInput`: significant inputs, each with a level and a significance flag.

**Validation**
`VAL-FR-001`, `VAL-REQ-001`, and `VAL-SEL-002` (SEL-004).

**Permissions**
`job.update` for the job-level `fr.*` fields. `asset.edit` for the asset-level `fr.*` fields. `calculation.run` for sensitivity. `validation.acknowledge` for `VAL-FR-001`.

**Audit events**
`field.updated`, `calculation.run`, `validation.acknowledged`.

**Offline behaviour**
Field capture works offline on tablet. The derivation runs in the domain library on the device.

**Error states**
The F-04 field errors. Planned endpoints return `422 INVALID_ARGUMENT` for invalid sensitivity inputs.

**Tests**

- `packages/domain/test/calculations.test.ts` › "categorises at the lowest level of any significant input"; "builds a capitalisation sensitivity table".
- `packages/domain/test/requirements.test.ts` › "financial reporting requires AASB 13 inputs including hierarchy level and sensitivity".
- TC-CALC-007, TC-FLD-002. **Gap:** `VAL-FR-001` has no test that references the code; no API route; disclosure export.

### F-16 — Market commentary library by property type and location, with date guards

**Status:** Implemented in domain/API: the library and matching (`packages/domain/src/evidence/commentary-library.ts`), the demonstration library (`sample-commentary-library.ts`), `VAL-MKT-001`, `VAL-STALE-003` and the `VAL-DATE-004` retrospective guard, the `market_commentary` report block, the `commentary_module` table (migration 0007) and the library and job commentary endpoints (07 §6.6). The browser preview has the Market commentary card. Planned: the card in the web portal and mobile app (S-052), a library screen with draft edit and withdrawal (S-110), retiring versions (S-111), the firm's own commentary (S-112) and a research cut-off guard for every purpose. · E-09 · S-052, S-109, S-110, S-111, S-112 · J-07, J-12 · W-08, W-18

**User story**
As a valuer, I want national, state and local market commentary from the firm's approved library, matched to the property type and location as at the valuation date, that I use with one tap and then tailor, so that every report has consistent commentary with its date, sources and author, and retrospective work never relies on hindsight (01 D17).

As a standards owner, I want to write dated library paragraphs that a second standards owner approves, so that valuers are offered only reviewed commentary.

**Acceptance criteria**

1. `MARKET_VALUE`, `CGT` and `FAMILY_LAW` require `market.national`, `market.state` and `market.local`. `FINANCIAL_REPORTING` and `RENTAL_ASSESSMENT` recommend them. Other purposes do not request them (01 D17, which replaces the D9 position that only local commentary was required).
2. A standards owner writes a library paragraph with `POST /v1/commentary-library` (`template.edit`): level; title; state (state and local paragraphs); suburbs, towns or councils (local only); property types (omitted for an overview); as-at date; text (at least 80 characters); and at least one source with full provenance from a registered data source. It is saved as a `draft` and as the paragraph's next version, and keeps the level and state of earlier versions. Problems return `422 INVALID_COMMENTARY` with the list. Audited `commentary.version_created`.
3. A different standards owner approves the draft with MFA (`template.approve`). The author is refused (`403 SEPARATION_OF_DUTIES`). Only a draft can be approved (`409 IMMUTABLE_RECORD`). An approved version cannot be edited or deleted, only retired, and a retired version is frozen (database trigger); a new view is a new version. Audited `commentary.version_approved`.
4. `GET /v1/jobs/{jobId}/commentary/suggestions` offers, for each level, the latest approved version of each paragraph that matches the property type, the state, and the asset's suburb or council, dated on or before the valuation date (else the inspection date, else today). The overview comes first, then paragraphs written for the property type. Each level has a heading, the text, the as-at date (the oldest paragraph's), its age in months, the topics to cover and notes for gaps, dated commentary or a missing property-type paragraph. Nothing is saved.
5. `POST /v1/jobs/{jobId}/commentary/apply` {`assetId`, `levels`} (`evidence.edit`, editable job) recomputes the suggestions on the server. In one transaction it writes each level's text to its field with library provenance (`ds-commentary-library`, a `sourceRef` naming the paragraph versions, verified by the valuer), and adds a dated `market_commentary` record with the paragraphs' sources and `library[]` refs. If a chosen level has no paragraph, the request fails with `422 NO_LIBRARY_COMMENTARY` and nothing is written.
6. `POST /v1/jobs/{jobId}/commentary` {`level`, `assetId`?, `asAtDate`, `text` (≥ 10 characters), `sources[]`} still records commentary the valuer writes, with `authoredBy` and `authoredAt`, and `evidence.commentary_added`.
7. The current record is the latest for each level (and asset, for local commentary); earlier records stay on file. For a retrospective valuation (any purpose; 01 D8), a current record dated after the valuation date or information cut-off triggers `VAL-DATE-004` (blocking at draft, submit and issue). A record dated on the valuation date is accepted `[REVIEW: TAX]`.
8. `VAL-STALE-003` warns when the current record is dated more than 6 months (national, state) or 4 months (local) before the valuation date. `VAL-MKT-001` warns when commentary is under 300 characters and lists the topics for the level and property type. Both can be acknowledged with a reason `[REVIEW: API_STANDARDS]`.
9. The `market_commentary` template block prints each level under its own heading ("National market", "State market — <state>", "Local market — <suburb>"), one paragraph per paragraph of text, then "Commentary as at <date>. Sources: <sources>." from the current record. Missing required commentary prints `[Not provided]` and blocks a final report (`TPL-MISSING-REQUIRED`) (09 §1.4).
10. Sources of external origin need full provenance (`VAL-PROV-001`). Sources whose licence restricts reproduction trigger `VAL-PROV-003`; quoting provider figures needs a licence that permits it `[REVIEW: DATA_LICENSING]`.
11. The preview's Market commentary card on the Sales & market tab shows each level with **Use**, **Use all** or **Replace my text**, the paragraph titles and as-at date, notes, "Read the firm's text" and the "Cover:" topics. _(planned)_ The same card in the web portal and mobile app (S-052).
12. _(planned)_ A library screen to list, write, edit, withdraw and approve versions (S-110); retiring a version (S-111); the firm's own commentary replacing the demonstration library, which is placeholder text (S-112).
13. _(planned)_ For any purpose, commentary dated after `dates.researchCutOff` is blocked (proposed `VAL-DATE-010`). The research cut-off is no longer requested per job (01 D9), so this applies only where it is recorded.

**Data fields**
Catalogue: `market.national`, `market.state`, `market.local`, `dates.valuation`, `dates.inspection`, `dates.retrospectiveDataCutOff`, `dates.researchCutOff`, `location.address`, `location.lga`, `retro.evidenceBasis`. Record `market_commentary`: `level`, `assetId`, `asAtDate`, `text`, `authoredBy`, `authoredAt`, `sources`, `library[{ moduleId, version }]`. Record `commentary_module`: `moduleId`, `version`, `level`, `title`, `jurisdiction`, `localities`, `propertyTypes`, `asAtDate`, `text`, `sources`, `status` (draft, approved, retired), `authoredBy`, `authoredAt`, `approvedBy`, `approvedAt`. Data sources: `ds-commentary-library` (every organisation); `ds-demo-research` and `ds-public-releases` (demonstration only).

**Validation**
`VAL-MKT-001`, `VAL-STALE-003`, `VAL-DATE-004` `[REVIEW: TAX]`, `VAL-PROV-001`, `VAL-PROV-003`, `VAL-REQ-001`, `VAL-REQ-002`; composition `TPL-MISSING-REQUIRED`. Library paragraphs: `commentaryModuleProblems` plus registered sources (`422 INVALID_COMMENTARY`). Proposed: `VAL-DATE-010`.

**Permissions**
`evidence.edit` (VALUER, assigned) to use or write job commentary. `job.read` for suggestions and to list the library. `template.edit` (STANDARDS_OWNER) to list and write the library. `template.approve` (STANDARDS_OWNER, human, MFA, never the author) to approve it.

**Audit events**
`commentary.version_created` and `commentary.version_approved` (organisation stream); `evidence.commentary_added`, with the level, as-at date and `library[]` in its metadata when taken from the library; `field.updated` for the `market.*` text; `auth.denied` for refusals.

**Offline behaviour**
Suggestions and the library are online only. The `market.*` text can be edited offline on tablet as job fields. The dated record is created online, when the library commentary is used.

**Error states**
Common errors, plus `422 INVALID_COMMENTARY`, `422 NO_LIBRARY_COMMENTARY`, `422 UNKNOWN_ASSET`, `409 IMMUTABLE_RECORD` (approving a version that is not a draft), `409 CONFLICT` (two drafts of one paragraph saved at once), `409 RECORD_LOCKED` and `400 BAD_REQUEST` (text too long, date not ISO). `POST /commentary` also returns `422 INVALID_REFERENCE` (unknown `assetId`) and `400 BAD_REQUEST` (text under 10 characters).

**Tests**

- `packages/domain/test/commentary.test.ts` › "matches national, state and local paragraphs to the property type and suburb"; "gives a retrospective valuation the commentary of its day, never later"; "flags commentary that is dated for the valuation date"; "reports gaps instead of guessing when nothing fits"; "offers only approved paragraphs"; "keeps the demonstration library valid and full enough for every demo suburb"; "finds the suburb and council for an address"; "requires national, state and local commentary for value reports"; "asks for brief commentary to be expanded, naming the topics for the property type"; "flags dated commentary and ignores superseded records"; "prints each level under its own heading with the as-at date and sources"; "marks missing required commentary and blocks a final report".
- `apps/api/test/commentary.test.ts` › "is seeded with the approved demonstration library"; "a standards owner writes a draft; another standards owner approves it"; "refuses paragraphs with problems and lists them"; "never changes an approved version (database guard)"; "only standards owners write the library; clients cannot read it"; "suggests the approved paragraphs for the property type, state and suburb"; "applies the library commentary: fields, dated records, audit and the report"; "gives a retrospective valuation only the commentary of its day"; "refuses a level the library has no commentary for, and changes nothing"; "applies only for the assigned valuer on an editable job".
- `apps/preview/test/journey.test.ts` › "offers national, state and local commentary for the property type and suburb"; "gives the retrospective CGT job the commentary of its valuation date"; "puts the firm commentary into the seeded issued report".
- `packages/domain/test/validation.test.ts` › "blocks commentary dated after the cut-off".
- TC-DATE-002, TC-COM-001…015. **Gap:** an API test for the manual `POST /commentary` route and its audit event (TC-COM-001); the research cut-off guard; W-08 in the web portal and mobile app, with accessibility checks.

### F-17 — Validation and acknowledgements

**Status:** Implemented in domain/API: a 40-rule catalogue across the draft, submit and issue stages, persisted validation runs, and warning acknowledgement with a reason. The W-10 panel is planned. · E-10 · S-014 (Done), S-053 · J-08 · W-10

**User story**
As a valuer, I want to run validation at any time, see blocking issues and warnings with codes and field links, and acknowledge warnings with a reason, so that I resolve problems before submission and my reasons are recorded.

**Acceptance criteria**

1. `POST /validate` {`stage`: draft, submit or issue; default submit} returns findings with `code`, `severity`, `message`, `path` (field and asset) and rule version, plus `blockingCount` and `unacknowledgedWarningCount`. The run is stored as `validation_run`, and `validation.run` is recorded.
2. Results for one snapshot are identical in content and order.
3. `POST /acknowledgements` {`code`, `path`, `reason`} acknowledges a current, acknowledgeable warning. There is one acknowledgement per job, code and path; re-acknowledging replaces the reason. `validation.acknowledged` is recorded.
4. Blocking findings cannot be acknowledged (`409 GUARD_FAILED`). A missing reason returns `422 INVALID_ARGUMENT`.
5. Submit, approve and issue require zero blocking findings and zero unacknowledged warnings (F-18 to F-20).
6. The server re-runs validation at submit, approve and issue (A-28). Results computed on the client are advisory.
7. Stage rules: `VAL-CERT-001`, `VAL-QA-001`, `VAL-TPL-001` and `VAL-TPL-002` run only at issue; `VAL-AI-001`, `VAL-AREA-002`, `VAL-CERT-002` and `VAL-REQ-002` run at submit and issue; the rest run at every stage.
8. "Today" is the calendar date in the jurisdiction's time zone, taken from an injected clock.
9. Rules tagged for review (`VAL-DATE-004`…`VAL-DATE-007`, `VAL-FR-001`, `VAL-INS-001`, `VAL-PHOTO-001`, `VAL-PROV-003`, `VAL-SCOPE-001`, `VAL-TPL-001`, `VAL-TPL-002`) stay draft configuration until signed off by the tagged reviewer.

**Data fields**
Record `validation_run`: `stage`, `result`, `ran_by`, `ran_at`. Record `validation_acknowledgement`: `code`, `path`, `reason`, `ack_by`, `ack_at`. Every catalogue field can be referenced by `path`.

**Validation**
All `VAL-*` codes in `generated/validation-catalogue.md`.

**Permissions**
`job.read` to run validation. `validation.acknowledge` (VALUER, human only).

**Audit events**
`validation.run`, `validation.acknowledged`.

**Offline behaviour**
Full on phone and tablet through `@vp/domain`. W-10 prompts a re-run when results are stale, and the server re-runs validation at submission.

**Error states**
Common errors, plus `404 NOT_FOUND` (no current finding for that code and path), `409 GUARD_FAILED` (blocking finding), `422 INVALID_ARGUMENT` (no reason) and `409 RECORD_LOCKED`.

**Tests**

- `packages/domain/test/validation.test.ts` › "has unique, well-formed codes"; "never makes blocking rules acknowledgeable"; "has no findings at submit stage"; "flags certification and QA only at issue stage"; "blocks on missing mandatory fields and warns on recommended ones"; "uses the jurisdiction calendar date for \"today\""; "lets a valuer acknowledge warnings with a reason, never blocking findings".
- `apps/api/test/lifecycle.test.ts` › "validates cleanly once warnings are acknowledged with reasons".
- TC-VAL-001…004, TC-DATE-004…006. **Gap:** TC-VAL-004 asks for a pass and a fail fixture per rule, but no test references `VAL-AREA-003`, `VAL-DATE-009`, `VAL-FR-001`, `VAL-INS-001`, `VAL-PHOTO-002`, `VAL-RENT-001` or `VAL-SEL-002` by code; TZ matrix (TC-DATE-006); W-10 E2E.

### F-18 — Certification and submission for QA

**Status:** Implemented in domain/API: template-driven certification content and a typed attestation by the responsible valuer (human, MFA), bound to the content snapshot hash, followed by locked submission; the valuer's own profile (sign-off signature, API member number, QLD registration / WA licence, 01 D13), printed on the certification. Planned: e-signature (S-070, Pilot), co-signatory statements, verification of membership and registration numbers, and the W-11 UI. · E-11 · S-015 (Done), S-054, S-070 · J-08 · W-11

**User story**
As the responsible valuer, I want to sign a template-driven certification for exactly the content I have reviewed, and then submit it for QA, so that only I can certify my valuation and later changes invalidate my signature.

**Acceptance criteria**

1. `POST /certification` takes: `inspectionScopeStatement`, `valuationDate`, `basisOfValue`; `amount` {`value` > 0, `kind`: value, market_rent or sum_insured}; `independenceStatement`, `conflictsStatement`, `assumptions`, `specialAssumptions`; `limitations` (at least one), `standardsReliedOn` (at least one); `attestationText` (≥ 20 characters). It stores a certification with the current snapshot hash, the attestation hash and the clause version ids from the template's `certification-core` clauses, and records `certification.signed`. The valuer identity (full name, designations, API member number, the registration for the job's state where one is needed, signature fingerprint) is copied from the signer's saved profile; a `valuer` object in the request is ignored.
2. Only the job's responsible valuer, as a human actor with the MFA claim, can sign. Anyone else gets `403` (`SEPARATION_OF_DUTIES`, `HUMAN_REQUIRED` or `MFA_REQUIRED`) and `auth.denied` is recorded (SoD-01).
3. If `valuationDate` differs from `dates.valuation`, `422 CERTIFICATION_MISMATCH` is returned. At submit and issue, `VAL-CERT-002` blocks if the certified amount, basis of value or valuation date no longer matches the adopted figures and dates in the report.
4. Incomplete content returns `409 GUARD_FAILED` listing the issues. Examples: no approved clause versions, no limitations, a non-positive amount.
5. Any content change after signing makes the certification stale ("content changed after certification; re-certify"). Certification rows are append-only; re-certifying adds a row.
6. `POST /submit` (`certification.sign`, responsible valuer) requires zero blocking findings, zero unacknowledged warnings and a current certification. On success: the job moves `active`/`returned` → `submitted`; the snapshot hash is recorded and content is locked; `job.submitted` is recorded.
7. Placeholder or draft clauses block production issue (G1, `VAL-TPL-002`). Certification wording is `[REVIEW: API_STANDARDS]` `[REVIEW: LEGAL]`; the family-law declaration is `[REVIEW: FAMILY_LAW]`.
8. Software and AI never sign (SoD-06). _(planned)_ E-signature records method `e_signature` and a `providerRef` `[REVIEW: LEGAL]`.
9. Signing is refused with `422 PROFILE_INCOMPLETE` (`details.problems`) while the signer's profile has problems, no signature, or, for a QLD or WA job, no registration for that state or one that has expired on the state's current date. `VAL-CERT-003` blocks submit and issue of a QLD or WA certification without that registration. _(planned)_ Co-signatories sign their own statements (A-12, Q-03).
10. Issuing without a certification is blocked by `VAL-CERT-001`. A prospective valuation date needs a special assumption (`VAL-DATE-001`).
11. On the Review tab the valuer has one action, **Sign and send to QA**, which signs the certification and submits in one step (01 D12; implemented in the preview, planned for mobile/web). The API keeps the two calls (`POST /certification`, `POST /submit`), so each guard above still applies.
12. Valuer profile (01 D13): `GET /v1/me/profile` returns the caller's own profile (defaulting to their display name and credentials before the first save), its problems, whether it is ready to sign, and for QLD and WA whether the registration is in order. `PUT /v1/me/profile` saves it: only for the caller (there is no user id in the path), only for holders of `certification.sign` (valuers), human, with MFA. Name and at least one designation are required; the API member number is 3–20 letters, digits or hyphens; registrations are recorded only for QLD and WA, one each, with an optional expiry date. Problems return `422 INVALID_PROFILE` with `details.problems`.
13. The sign-off signature is drawn or uploaded as a PNG (`data:image/png;base64,`, at most 200,000 characters, bytes must decode as a PNG that can be embedded in a PDF) or typed. Leaving it out of `PUT` keeps the saved one; `null` removes it. The audit event `profile.updated` records the signature's kind and SHA-256, never the image.
14. The issued PDF shows the API member number and the state registration (labelled e.g. "Queensland registered valuer number") in the certification block, then the signature: the drawn image scaled to fit 180 × 60 pt, or the typed name in italics, with a signature line, "Signature of <name>" and the SHA-256 fingerprint. The signature used at signing is kept by its hash (`valuer_signature`, append-only), so changing the profile later does not change a signed certification or an issued report, and the issue snapshot carries the image so reproduction stays byte for byte.

**Data fields**

- Catalogue: `dates.valuation`, `instruction.basisOfValue`, `valuation.adoptedValue`, `rent.adoptedMarketRent`, `ins.sumInsured`, `assumptions.general`, `assumptions.special`, `assumptions.limitations`, `assumptions.materialUncertainty`, `instruction.conflictCheck`.
- Record `certification`: the content above, plus `signedAt`, `snapshotHash` and `signature` {`method`, `attestationText`, `attestationHash`, `providerRef`}; `valuer` {`userId`, `fullName`, `credentials`, `apiMemberNumber`?, `registration`? {`jurisdiction`, `number`}, `signatureSha256`?}.
- Record `valuer_profile`: `fullName`, `credentials`, `apiMemberNumber`, `registrations` [{`jurisdiction` QLD or WA, `number`, `expiresOn`?}], `signature` {`kind` drawn or typed, `value`, `updatedAt`}. Record `valuer_signature`: `userId`, `sha256`, `kind`, `value`.

**Validation**
`VAL-CERT-001`, `VAL-CERT-002`, `VAL-CERT-003`, `VAL-TPL-002`, `VAL-DATE-001`, and every submit-stage rule. Profile checks: `profileProblems` and `signingProblems` (`packages/domain/src/workflow/valuer-profile.ts`).

**Permissions**
`certification.sign` (VALUER; human only; MFA; responsible valuer only). It also gates `submitForQa` and, without a job scope, `PUT /v1/me/profile` (own profile only). `GET /v1/me/profile` needs only an authenticated person.

**Audit events**
`certification.signed` (with the signature fingerprint and the registration printed), `job.submitted`, `profile.updated` (**org** stream), `auth.denied`.

**Offline behaviour**
Online only, because MFA step-up is required. W-11 is disabled offline with the reason (UX-09). Submission requires no pending sync operations or conflicts.

**Error states**
Common errors, plus `403 SEPARATION_OF_DUTIES`, `HUMAN_REQUIRED`, `MFA_REQUIRED`; `422 CERTIFICATION_MISMATCH`; `422 PROFILE_INCOMPLETE` (signing); `422 INVALID_PROFILE` (profile update); `409 GUARD_FAILED`, with submit failures such as "N blocking validation(s) unresolved", "N warning(s) not acknowledged", "certification has not been signed", "content changed after certification; re-certify"; `409 INVALID_TRANSITION`; `409 RECORD_LOCKED`.

**Tests**

- `packages/domain/test/workflow.test.ts` › "is signed by the responsible valuer with MFA and binds to the snapshot"; "can never be signed by software, AI, another user or without MFA"; "rejects incomplete certification content"; "cannot submit with blocking validations, unacknowledged warnings or no certification"; "requires re-certification when content changes after signing"; "locks content once submitted".
- `apps/api/test/lifecycle.test.ts` › "only the responsible valuer, with MFA, can certify; then submit locks the job".
- `apps/api/test/profile.test.ts` › "returns the caller’s own profile with registration status per state"; "only valuers update a profile, with MFA, and only their own"; "refuses incomplete profiles and signatures that are not PNG images"; "saves a drawn signature and audits its fingerprint, not the image"; "refuses to sign until the valuer’s profile has their QLD registration"; "issues a PDF showing the API member number, registration and signature"; "reproduces the issued PDF from the snapshot".
- `packages/domain/test/wip-profile-integrations.test.ts` › valuer profile and state registration.
- `packages/domain/test/permissions.test.ts` › "allows the responsible valuer to sign and denies other valuers"; "requires MFA and a human for certification".
- `packages/domain/test/validation.test.ts` › "passes when the certificate matches the report"; "blocks a certified amount, date or basis that differs from the report".
- `apps/api/test/security.test.ts` › "verifies tokens against the issuer keys and maps amr to MFA".
- TC-ROLE-004, TC-WF-002, TC-VAL-001. **Gap:** co-signatories; e-signature; expired designations other than QLD/WA registrations (J-08 E6); placeholder clauses blocking signing in production (J-08 E4); late sync between validation and signing (J-08 E1).

### F-19 — QA review and self-approval exceptions

**Status:** Implemented in domain/API. Implemented: review started on the submitted snapshot; checklist (default QA-01…QA-13); findings with severity; valuer responses; closure by the reviewer; return; approval with MFA; documented self-approval exception. Planned: the W-12/W-13 UI, round diff, exception request, reviewer reassignment and escalation. · E-12 · S-015, S-027 (Done), S-055 · J-09 · W-12, W-13

**User story**
As an independent QA reviewer, I want to work through a checklist, raise findings with severity, and return or approve the job against the exact submitted snapshot, so that no report is issued without a recorded independent review.

**Acceptance criteria**

QA starts only after the responsible valuer signs and sends the job to QA (`submitted`). The QA view is not an input tab and appears only from then on (05 §2.1, 01 D12).

1. `POST /qa/start` by an assigned user with `qa.review` first checks that current content equals the submitted snapshot (`409 SNAPSHOT_MISMATCH` otherwise). It then moves `submitted → in_review`, records the reviewed snapshot hash and `qa.started`. Findings from a previous returned round carry forward.
2. `POST /qa/checklist` {`itemId`, `response` (yes, no, na), `note`?} records `qa.checklist_answered`. A "no" needs a note and blocks approval. Only the assigned reviewer may answer (`403 NOT_REVIEWER`).
3. `POST /qa/findings` {`severity` (critical, major, minor, observation), `category`, `description` (≥ 5 characters), `ref` (anchor to a field, section or photo)} records `qa.finding_raised`.
4. The responsible valuer responds with `POST /qa/findings/{id}/respond` (`job.update`), only while the job is `returned`. Anyone else gets `403 NOT_RESPONSIBLE_VALUER`; at any other time the response is `409 INVALID_TRANSITION` ("findings are answered after the job is returned"). The status becomes `responded` and `qa.finding_responded` is recorded.
5. The reviewer closes a finding with `POST /qa/findings/{id}/close` {`status` (resolved, accepted, withdrawn), `note`} and `qa.finding_closed` is recorded. Critical findings must be resolved, not accepted. Only the reviewer can close a finding.
6. `POST /qa/return` is made by the reviewer conducting the review (`403 NOT_REVIEWER` otherwise). It requires an open major or critical finding, or a reason of at least 10 characters. The job moves `in_review → returned`, content unlocks, the certification goes stale, and `qa.returned` is recorded.
7. `POST /qa/approve` (human, MFA) requires all of the following. On success the job moves to `approved`, the approval snapshot is recorded, `qa.approved` is recorded, and the review becomes immutable. the checklist is complete with no "no" answers; no critical or major finding is open or responded; the actor is the assigned reviewer; the reviewed snapshot equals the current snapshot; validation is clean; the certification is current.
8. The responsible valuer cannot `qa.review` or `qa.approve` their own job (`403 SEPARATION_OF_DUTIES`) unless an exception exists. An exception is recorded by a different user holding `qa.self_approval_exception` (human, MFA) through `POST /qa/self-approval-exception` with a reason of at least 20 characters, and `qa.self_approval_exception_authorised` is recorded. The exception carries into the review and the issued report's audit metadata `[REVIEW: API_STANDARDS]` (Q-04).
9. A valuer cannot authorise their own exception (`403 SEPARATION_OF_DUTIES`).
10. If the snapshot hash does not match, approval is blocked with `409 GUARD_FAILED` ("content changed during review"). _(planned)_ A security incident is also recorded (`incident.recorded`).
11. _(planned)_ The valuer requests an exception; reviewers can be reassigned (findings are kept); round diffs are shown; unresolved disagreement escalates to STANDARDS_OWNER; co-signatories are excluded from QA (SoD-07).

**Data fields**

- Record `qa_review`: `reviewerId`, `startedAt`, `reviewedSnapshotHash`, `checklist[]` {`id`, `label`, `response`, `note`}, `findings[]` {`id`, `severity`, `category`, `description`, `ref`, `status`, `valuerResponse`, `closureNote`, with actors and times}, `outcome`, `completedAt`, `selfApprovalException` {`authorisedBy`, `reason`, `at`}.
- Record `self_approval_exception`.
- Catalogue: `instruction.reviewer`, `dates.review`.

**Validation**
`VAL-QA-001` at issue. Every submit-stage rule is re-run at approval.

**Permissions**
`qa.review` (QA_REVIEWER, human only). `qa.approve` (QA_REVIEWER, human, MFA). `qa.self_approval_exception` (ADMINISTRATOR, human, MFA). `job.update` to respond. `audit.read` and `photo.view_unredacted` (QA_REVIEWER) for review evidence. SoD-02 applies; SoD-07 is proposed.

**Audit events**
`qa.started`, `qa.checklist_answered`, `qa.finding_raised`, `qa.finding_responded`, `qa.finding_closed`, `qa.returned`, `qa.approved`, `qa.self_approval_exception_authorised`, `auth.denied`.

**Offline behaviour**
Online only (W-12, W-13). Valuer responses are made online.

**Error states**
Common errors, plus `403 NOT_REVIEWER`, `NOT_RESPONSIBLE_VALUER`, `SEPARATION_OF_DUTIES`, `MFA_REQUIRED` (all recorded as `auth.denied`); `409 SNAPSHOT_MISMATCH` (QA start on changed content); `409 NO_QA_REVIEW` ("QA review has not been started"); `409 INVALID_TRANSITION` (responding before the job is returned); `409 GUARD_FAILED` (approval blockers; return without a reason; closing an already closed finding; accepting a critical finding); `409 IMMUTABLE_RECORD` (completed review); `409 CONFLICT` (duplicate finding); `422 INVALID_ARGUMENT` ("no" without a note; empty response); `404 NOT_FOUND` (finding or checklist item).

**Tests**

- `packages/domain/test/workflow.test.ts` › "approves only with a complete review of the current snapshot"; "returning requires a major finding or a reason"; "critical findings must be resolved, not accepted"; "only the reviewer closes findings; valuer responds"; "a \"no\" checklist answer needs a note and blocks approval"; "completed reviews are immutable".
- `packages/domain/test/permissions.test.ts` › "prevents self-approval in QA unless an authorised exception exists"; "the valuer cannot authorise their own self-approval exception".
- `apps/api/test/security.test.ts` › "prevents self-review unless another person authorises a documented exception".
- `apps/api/test/lifecycle.test.ts` › "independent QA review approves after the checklist is complete".
- TC-ROLE-003, TC-WF-001, TC-WF-004. **Gap:** return → resubmit → second round at L2; snapshot mismatch at approval (TC-WF-004 L2); exception shown in the issued PDF metadata.

### F-20 — Report issue (PDF, invoice, email) and reproduction

**Status:** Implemented in domain/API. Implemented: draft PDF with watermark; deterministic final PDF rendered from a stored snapshot; versioning with supersession; separate tax invoice; approved-recipient email records over a stub transport; delivery callbacks; the reproduction check; client read access; amendment transition. Planned: object-lock storage (S-034), live email (S-072), accounting export (S-071), invoice management, and the W-14…W-17 UI. · E-13, E-14 · S-021, S-028, S-029 (Done), S-056, S-057, S-058, S-071, S-072, S-084, S-099 · J-10, J-11 · W-14, W-15, W-16, W-17

**User story**
As the responsible valuer, I want to issue an approved job as a versioned, watermarked PDF with a separate invoice, delivered only to approved recipients and reproducible from an immutable snapshot, so that what the client receives can always be proven (AC-06, AC-07).

**Acceptance criteria**

1. `GET /report/draft.pdf` (`report.generate_draft`) renders a PDF watermarked DRAFT. It is not stored and not for reliance. `report.draft_generated` is recorded with the PDF hash.
2. `POST /issue` {`recipients` (1–20 emails), `invoiceDescription`} (`report.issue`; human; MFA; a VALUER only as the responsible valuer) requires all of the following: the job is `approved`, content is unchanged since approval, and the QA outcome is approved; issue-stage validation is clean; the certification is current; a template is selected (`409 NO_TEMPLATE`); a fee is recorded (`422 FEE_REQUIRED`); the organisation's ABN is recorded for the tax invoice (`422 SUPPLIER_ABN_REQUIRED`) `[REVIEW: TAX]`; every recipient is on the client's approved list (`422 UNAPPROVED_RECIPIENTS`, with `details.unapproved`); the composed report has no problems, such as placeholder clauses or a draft template (`409 REPORT_NOT_ISSUABLE`, with `problems`).
3. In one transaction: report version n + 1 is stored: snapshot `issue-snapshot@1` (renderer version, issue time and date, content hash, report data, template, render assets, invoice, email payloads), snapshot hash, PDF bytes and PDF SHA-256; the previous issued version is marked `superseded`; an invoice is created (GST rate from configuration, integer cents); one `email_delivery` per recipient is queued with its payload hash; the job moves to `issued`; `report.issued`, `invoice.created` and one `email.queued` per recipient are recorded.
4. The PDF carries the report ID and version watermark. It includes the certification, redacted photos only, maps with provider attribution, evidence tables, the area schedule where the report relies on one (the sketch drawing only if the template has a `sketch` block and the version is marked for the client report), and audit metadata (snapshot hash, template and rule-set versions, QA approver, any exception).
5. Rendering does no network I/O, embeds all fonts and takes metadata times from the snapshot. The same snapshot gives identical bytes (ADR-007).
6. `POST /reports/{id}/reproduce` (`job.read`) re-renders the PDF, invoice and email payloads from the stored snapshot and returns the stored and reproduced hashes with a match flag for each.
7. The delivery callback `POST /email-deliveries/{id}/status` accepts only a system principal (`403 SYSTEM_ONLY`). Status `sent` records `email.sent`; any other status records `email.delivery_updated`. Updates are idempotent. _(planned)_ Signed webhooks (T-23).
8. `GET /reports/{id}/pdf` serves the stored bytes unchanged and records `report.accessed`. CLIENT_READONLY reads only issued reports and invoices for its own client entities and gets `404` for anything else (SoD-04). The reliance notice is `[REVIEW: LEGAL]`.
9. Recipients are approved with `POST /admin/clients/{clientId}/recipients` (`job.allocate`), which records `recipient.approved`. An ad hoc address must be approved before issue (A-23).
10. Two concurrent issues: exactly one succeeds, enforced by a row lock (TC-WF-006). A renderer or database failure rolls back the transaction; the job stays `approved` and a retry is idempotent.
11. `POST /amend` (reason ≥ 10 characters, `job.update`) moves `issued → active` and records `job.amendment_opened`. The issued snapshot, PDF, sketch and schedule are unchanged; the next issue supersedes them (Q-18).
12. Report rows are guarded (`guard_report_update`) and invoices are append-only.
13. Invoice timing and per-asset lines for portfolios depend on D6 and Q-14. GST treatment is `[REVIEW: TAX]`.

**Data fields**

- Catalogue: `dates.issue`, `instruction.clientEntity`, `instruction.intendedUsers`. (`instruction.feeBasis` is no longer requested per job; the invoice uses `feeCents`, 01 D9.)
- Record `job`: `feeCents`.
- Record `report`: `id`, `version`, `status` (issued, superseded), `snapshot`, `snapshot_hash`, `pdf`, `pdf_sha256`, `template_version_id`, `issued_by`, `issued_at`.
- Records `invoice`, `email_delivery` (`recipient`, `payload_hash`, `status`) and `approved_recipient` (`client_id`, `email`, `revoked_at`).

**Validation**
`VAL-CERT-001`, `VAL-QA-001`, `VAL-TPL-001`, `VAL-TPL-002`, `VAL-PHOTO-001`, `VAL-PROV-003`, plus every rule re-run at the issue stage.

**Permissions**
`report.generate_draft` (VALUER, QA_REVIEWER). `report.issue` (ADMINISTRATOR, VALUER; human; MFA). `report.read_issued` (all roles except STANDARDS_OWNER and FIELD_INSPECTOR). `invoice.read` (ADMINISTRATOR, ALLOCATOR, FINANCE, CLIENT_READONLY). `invoice.manage` (FINANCE; no endpoint yet). `email.send` (system callback). `job.allocate` (approve recipients). `job.update` (amend).

**Audit events**
`report.draft_generated`, `report.issued`, `invoice.created`, `email.queued`, `email.sent`, `email.delivery_updated`, `report.accessed`, `recipient.approved`, `job.amendment_opened`. Planned: `invoice.sent` _(planned)_ and `invoice.credited` _(planned)_. A reproduction-check event is proposed in §3.4.

**Offline behaviour**
Online only. The last draft is cached read-only on tablet.

**Error states**
Common errors, plus `409 NO_TEMPLATE`; `409 REPORT_NOT_ISSUABLE`; `409 GUARD_FAILED` (issue guards); `409 INVALID_TRANSITION`; `422 FEE_REQUIRED`; `422 SUPPLIER_ABN_REQUIRED`; `422 UNAPPROVED_RECIPIENTS`; `403 SYSTEM_ONLY`, `403 ACTOR_NOT_PERMITTED` (recorded); `403 SEPARATION_OF_DUTIES` (another valuer); `404 NOT_FOUND` (report, invoice or delivery, including another client's).

**Tests**

- `apps/api/test/lifecycle.test.ts` › "refuses unapproved recipients and issues the final report, invoice and deliveries"; "reproduces the issued PDF, invoice and email records from the immutable snapshot"; "lets the client read the issued report but not the job".
- `apps/api/test/persistence.test.ts` › "renders identical PDF bytes for identical inputs"; "calculates GST to the cent and renders the invoice deterministically".
- `packages/domain/test/report.test.ts` › "renders required sections in order with field tables, evidence, areas and certification"; "drafts carry the draft watermark and no problems list"; "lists problems for a final report on a draft template, placeholder clauses or no certification"; "is deterministic".
- `packages/domain/test/workflow.test.ts` › "cannot issue without approval, or after content changed post-approval".
- `packages/domain/test/permissions.test.ts` › "only the responsible valuer or an administrator can issue"; "clients read only issued reports for their own entities".
- TC-PDF-001…006, TC-WF-003, TC-WF-005, TC-WF-006, TC-ROLE-007, TC-AUD-005, PERF-03. **Gap:** TC-WF-006 on PG16; amendment end-to-end at L2 (TC-WF-005); golden page images (TC-PDF-005); webhook signature; recipient revocation; 200-page performance (PERF-03).

### F-21 — Template and rule-set governance

**Status:** Partially implemented. Implemented: template draft creation with lint; specialist review records; approval of templates and rule sets by a standards owner other than the author (MFA); selection of the most specific approved version. Planned: a rule-set authoring endpoint, regression diff, effective-date overlap check and the W-18 UI. · E-02, E-13, E-15 · S-003, S-021 (Done), S-056, S-059, S-092 · J-12 · W-18

**User story**
As a standards owner, I want to author versioned templates and rule sets, record specialist reviews, and have a different standards owner approve them, so that report wording and requirements change only under control (G1, G4).

**Acceptance criteria**

1. `POST /admin/templates` {`template`} (`template.edit`) validates the structure: sections, clauses, and placeholders limited to known fields. It creates a `draft` version and records `template.version_created`. Problems return `422 INVALID_TEMPLATE` with `problems`.
2. `POST /admin/templates/{id}/versions/{v}/reviews` {`reviewer` (a 00 §6 role), `outcome` (approved, changes_requested), `notes` (≥ 5 characters)} records a specialist review and `template.review_recorded`. Approved and retired versions are immutable (`409 IMMUTABLE_RECORD`).
3. `POST /admin/templates/{id}/versions/{v}/approve` (`template.approve`, human, MFA) must be made by someone other than the author (`403 SEPARATION_OF_DUTIES`, SoD-03). Approval is blocked while clauses are placeholders or required reviews are missing. On approval the version becomes immutable and `template.version_approved` is recorded.
4. `POST /admin/rulesets/{id}/versions/{v}/approve` {`notes`} (`ruleset.approve`, not the author, MFA) checks integrity: only catalogued fields and unique rule ids. Problems return `422 INVALID_RULE_SET` with `problems`. Success records `ruleset.version_approved`.
5. `selectTemplate` picks the most specific approved version by jurisdiction, purpose, property type, client and effective date. `selectRuleSet` picks the approved version effective on the date. Drafts are allowed only under `allowDraftConfig` (local/test).
6. Production configuration refuses draft and placeholder content (G1). Issue is blocked by `VAL-TPL-001` and `VAL-TPL-002` `[REVIEW: API_STANDARDS]`.
7. Jobs stay pinned to their versions, and newer versions are shown as available (F-03).
8. _(planned)_ Rule-set draft authoring (`ruleset.edit`, with `ruleset.version_created`); a regression run on fixture jobs with a diff of fields, sections, wording and validation outcomes; overlapping effective dates block approval; withdrawal works by creating a superseding version.
9. No proprietary API template, Rawlinsons or AIQS text is used unless licensed (R-04) `[REVIEW: DATA_LICENSING]`. The UI never says "compliant" (UX-15).

**Data fields**
Record `template_version`: content (`templateId`, `version`, scope, effective dates, sections, clauses with `ClauseStatus` placeholder, draft, approved or retired, specialist reviews, branding), `status` (draft, in_review, approved, retired), author, approver. Record `rule_set_version`: content (requirement and selection rules), `status`, author, approver. Clause library seed: `certification-core` … `ai-assistance`.

**Validation**
`VAL-TPL-001`, `VAL-TPL-002`. Template lint problems and rule-set integrity problems.

**Permissions**
`template.edit`, `template.approve`, `ruleset.edit`, `ruleset.approve` (STANDARDS_OWNER; approval is human only with MFA). SoD-03 applies.

**Audit events**
`template.version_created`, `template.review_recorded`, `template.version_approved`, `ruleset.version_approved`, and `ruleset.version_created` _(planned)_.

**Offline behaviour**
W-18 is online only. Approved versions are cached on devices so that requirements resolve offline.

**Error states**
Common errors, plus `422 INVALID_TEMPLATE`, `422 INVALID_RULE_SET`, `409 IMMUTABLE_RECORD`, `403 SEPARATION_OF_DUTIES` and `403 MFA_REQUIRED`.

**Tests**

- `packages/domain/test/report.test.ts` › "the seed template is structurally valid but not approvable (placeholder clauses, no reviews)"; "placeholder clause wording cannot be approved"; "authors cannot approve their own template"; "rejects unknown placeholders and fields"; "selects the most specific approved template".
- `packages/domain/test/requirements.test.ts` › "references only catalogued fields and has unique rule ids"; "ignores drafts unless explicitly allowed"; "respects effectiveTo".
- `apps/api/test/security.test.ts` › "template authors cannot approve their own versions"; "refuses development auth, embedded databases and draft configuration in production".
- `packages/domain/test/validation.test.ts` › "blocks draft rule sets and templates at issue when configured".
- TC-FLD-006, TC-FLD-007, TC-ROLE-003. **Gap:** rule-set author ≠ approver at L2; effective-date overlap; regression diff.

### F-22 — Audit trail and security events

**Status:** Implemented in domain/API. Implemented: per-stream SHA-256 hash chain over canonical JSON; append-only tables enforced by database triggers; job audit and verification endpoints; organisation security stream with `auth.denied`. Planned: SIEM forwarding (S-095), the W-21 viewer, a scheduled verification job and incident events. · E-15 · S-017 (Done), S-063, S-095 · W-21

**User story**
As an administrator or QA reviewer, I want every material action recorded in a tamper-evident chain and authorisation failures captured in a security stream, so that any issued output can be traced and tampering is detectable.

**Acceptance criteria**

1. Every state-changing route appends its audit event in the same transaction (TC-AUD-004). An event records the action (`<entity>.<past_tense_verb>`), the actor (`userId`, kind human, system or ai, roles), entity type and id, before and after values, reason, metadata, time, previous hash and hash.
2. The hash is SHA-256 over canonical JSON, including the previous hash. `GET /jobs/{id}/audit/verify` returns OK or the index of the first broken event.
3. An edited, deleted or reordered event fails verification. Malformed actions and appends across streams are rejected.
4. `audit_event`, `field_value_history`, `certification`, `measurement_approval` and `invoice` are append-only: `UPDATE` and `DELETE` are rejected by triggers (`409 IMMUTABLE_RECORD`). Report and sketch-version updates are guarded.
5. Authorisation denials are recorded as `auth.denied` in the organisation stream after the failed transaction rolls back, with the permission and denial code. This covers: permission-check denials, including hidden 404s, which are recorded with the underlying code; actor-kind refusals (`ACTOR_NOT_PERMITTED`); route-level checks: `NOT_REVIEWER`, `NOT_RESPONSIBLE_VALUER`, `SEPARATION_OF_DUTIES`, `HUMAN_REQUIRED`, `AI_SERVICE_ONLY`, `SYSTEM_ONLY`, `ADMIN_ONLY`. Payloads hold IDs and codes, not personal values (T-30) `[REVIEW: PRIVACY]`.
6. `GET /admin/security-events` (`audit.read`) is restricted to ADMINISTRATOR (`403 ADMIN_ONLY` otherwise, recorded). `GET /jobs/{id}/audit` lists the job stream.
7. Stored snapshots re-hash to their recorded hash (TC-AUD-005).
8. _(planned)_ A verification failure raises a security alert and an incident (`incident.recorded`). Audit and security events are forwarded to a SIEM. MFA failures are logged `[REVIEW: SECURITY]`.
9. _(planned)_ Retention follows RC-03 (job streams) and RC-04 (security and administration streams). Whole-stream purges leave checkpoints so that the remaining chains still verify (F-23).

**Data fields**
Record `audit_event`: `stream_id`, `seq`, `at`, `event` (the canonical hashed event), `action`, `entity_type`, `entity_id`, `actor_id`, `prev_hash`, `hash`. Streams: one per job and one per organisation.

**Validation**
None in the catalogue. Chain verification is a structural check.

**Permissions**
`audit.read` (ADMINISTRATOR, QA_REVIEWER; job-scoped for QA_REVIEWER). The security stream is for ADMINISTRATOR only.

**Audit events**
Every action in 00 §8 that is emitted, including `auth.denied`. Proposed: an event for verification failures (§3.4), `incident.*` _(planned)_.

**Offline behaviour**
Devices queue operations, and the server writes the authoritative audit when it applies them (`sync.operation_applied`). W-21 is online only.

**Error states**
Common errors, plus `403 ADMIN_ONLY` and `409 IMMUTABLE_RECORD` (trigger).

**Tests**

- `packages/domain/test/audit.test.ts` › "links events from the genesis hash"; "detects edited content"; "detects deletion and re-ordering"; "detects a recomputed hash that breaks the next back-link"; "rejects malformed actions and cross-stream appends"; "hashes canonical content and detects modification".
- `packages/domain/test/core.test.ts` › "sorts keys recursively and omits undefined properties"; "is independent of key insertion order".
- `apps/api/test/lifecycle.test.ts` › "keeps an intact, append-only audit chain"; "records authorisation denials in the security stream".
- `apps/api/test/persistence.test.ts` › "apply from empty, are idempotent and detect drift".
- `apps/api/test/security.test.ts` › "documents every route with its permission".
- TC-AUD-001…005, TC-MIG-001, TC-MIG-002, TC-ROLE-001. **Gap:** complete route × action table (TC-AUD-004); `TRUNCATE` and DDL denial for the application role (TC-MIG-002); Unicode normalisation (TC-AUD-003); scheduled verification.

### F-23 — Legal hold and retention

**Status:** Partially implemented. Implemented: the legal-hold apply endpoint (job, client and portfolio scopes) and a database guard against deleting held jobs. Planned (Pilot): hold release, hold metadata, retention policies, deletion schedule, object-lock holds and secure deletion. · E-15 · S-077, S-080 · J-13 · W-22 · spec 11 §5

**User story**
As an administrator, I want to place and release legal holds and run retention under approved policies, so that records needed for claims or proceedings are never deleted and everything else is destroyed on time.

**Acceptance criteria**

1. `POST /admin/legal-holds` {`scopeType` (job, client, portfolio), `scopeId`, `reason` (≥ 10 characters)} (`legal_hold.manage`, ADMINISTRATOR, MFA) records the hold with `applied_by` and `applied_at`, and records `legal_hold.applied` in the organisation stream.
2. Deleting a job under hold is refused by a database trigger (`409 IMMUTABLE_RECORD`).
3. A non-administrator gets `403` (`NO_ROLE_GRANT`) and `auth.denied` is recorded.
4. _(planned)_ The matter reference, requesting party and review date are mandatory (J-13). A reminder is sent on the review date.
5. _(planned)_ A hold takes effect across its scope: retention runs skip every record in scope; object-lock legal hold is set on stored files, including issued artefacts; data-key destruction is blocked and scheduled deletions are cancelled; affected jobs show a hold badge; edits continue, are versioned, and nothing is deleted.
6. _(planned)_ A hold is released with a reason, by a different user from the one who applied it (proposed SoD), recording `legal_hold.released`. A record is released only when all its holds are released. The retention clock then resumes after a notice period.
7. _(planned)_ Retention policies per record class RC-01…RC-18 (for example RC-02, issued reports, 7 years; RC-06, unredacted originals, 90 days after issue) are configured with `retention.manage`, versioned, and approved by a different user `[REVIEW: LEGAL]` `[REVIEW: PRIVACY]`. Periods for family law and matters involving minors are open (Q-05) `[REVIEW: FAMILY_LAW]`.
8. _(planned)_ A retention run is a dry run, then approval (step-up MFA for RC-01, RC-02 and RC-08), then execution and verification. Purged audit streams leave checkpoints. Deleted records are listed with their deletion audit reference and cannot be restored.
9. _(planned)_ Breach handling applies holds to affected records during containment (11 §4.6) `[REVIEW: LEGAL]`.

**Data fields**
Record `legal_hold`: `scope_type`, `scope_id`, `reason`, `applied_by`, `applied_at`, `released_by`, `released_at`. Proposed attributes: `matterReference`, `requestingParty`, `reviewDate`, `releaseReason` (§3.3). Retention policy record: planned.

**Validation**
API schema only (reason ≥ 10 characters). There are no catalogue rules.

**Permissions**
`legal_hold.manage` and `retention.manage` (ADMINISTRATOR, MFA). The split into `legal_hold.apply` and `legal_hold.release` is proposed (§3.1).

**Audit events**
`legal_hold.applied`. Planned: `legal_hold.released` _(planned)_ and the `retention.*` events _(planned)_ (11 §5.5: `retention.run_started`, `retention.dry_run_completed`, `retention.purge_approved`, `retention.record_purged`, `retention.stream_purged`, `retention.run_completed`, `retention.run_failed`, `retention.policy_changed`).

**Offline behaviour**
W-22 is online only. Device caches are purged under RC-13 whether or not a hold exists, because the server copy is preserved.

**Error states**
Common errors, plus `409 IMMUTABLE_RECORD` (deletion under hold) and `400 BAD_REQUEST` (reason too short, unsupported scope).

**Tests**

- `apps/api/test/persistence.test.ts` › "blocks deleting a job under legal hold"; "only administrators can apply legal holds".
- **Gap:** release; overlapping holds; object-lock; retention dry run and purge; there are no TC IDs for retention in 12 (proposed TC-RET-001…005, §3.7).

### F-24 — Work in progress and job/property search

**Status:** Implemented in domain/API: WIP stages and due states (`packages/domain/src/workflow/wip.ts`), `GET /v1/jobs` with search, stage, valuer and status filters, and `GET /v1/property-search`. The W-23 screen is planned (mobile/web). · E-01 · S-102, S-106 · J-14 · W-23, M-01

**User story**
As a valuer or allocator, I want to see every job I can work on with its stage and due state, most urgent first, and find any job or property with one search, so that nothing is missed and I do not hunt through lists (01 D14).

**Acceptance criteria**

1. `GET /v1/jobs` returns, for every job the caller may read, the original fields (`id`, `reference`, `status`, `selection`, `responsibleValuerId`) plus `stage`, `due`, `clientName`, `addresses`, `valuerName`, `dueDate` and `inspectionDate`, with top-level `today`, `counts` (per stage) and `overdue`.
2. The stage is derived, never set by hand: `draft` → New instructions; `active` → To inspect, or In progress once the inspection date is today or earlier; `returned` → Returned by QA; `submitted`/`in_review` → With QA; `approved` → Ready to issue; `issued` → Issued; `cancelled` → Cancelled.
3. The due state is overdue, due today, due soon (within 2 days), on track, done (issued or cancelled) or none (no due date). Jobs are sorted overdue first, then by due date, then by reference.
4. `q` matches when every word appears in the reference, client, addresses, valuer, purpose, property type, state or stage. `stage`, `valuerId` and `status` filter the list. Counts are taken after the search and before the stage filter.
5. "Today" is the date in Australia/Sydney (no per-organisation time zone yet; the product owner may change this).
6. Visibility is unchanged: restricted-portfolio jobs are hidden from non-members (in the list, the counts and search); non-organisation-wide roles see only jobs they are assigned to or whose portfolio they belong to; clients see no unissued jobs.
7. `GET /v1/property-search?q=` (2–200 characters) returns the caller's matching jobs (up to 25, as in the list) and the provider's property matches (F-25). With property data off it returns jobs only plus the status; a provider problem is returned as `propertyDataProblem` and never hides the jobs.
8. _(planned)_ W-23 shows stage chips with counts, the overdue count, filters and one search box (05 J-14).

**Data fields**
Record `job`: `reference`, `status`, `responsible_valuer_id`, selection. Catalogue: `instruction.dueDate`, `dates.inspection`, `location.address` (formatted addresses). Record `client`: `name`. Record `app_user`: `display_name`.

**Validation**
Query schema only: `q` ≤ 200 characters; `stage` one of the eight stages; `valuerId` a UUID.

**Permissions**
`job.read`, applied per job (same rules as job detail). `GET /v1/property-search` also checks `job.read` for the organisation, so CLIENT_READONLY gets `403`.

**Audit events**
None. Reads are not audited; filtering is silent.

**Offline behaviour**
_(planned)_ The WIP list is cached read-only on mobile; search of the provider is online only.

**Error states**
Common errors, plus `400 BAD_REQUEST` (unknown stage, query too short or too long).

**Tests**

- `apps/api/test/wip.test.ts` › "lists jobs with stage, due state and WIP fields, most urgent first"; "searches by address, reference, client and state"; "filters by stage, status and responsible valuer"; "hides restricted-portfolio jobs from non-members, in the list and in search".
- `apps/api/test/property-data.test.ts` › "property search returns provider matches and existing jobs".
- `packages/domain/test/wip-profile-integrations.test.ts` › WIP stages, due states and search.
- **Gap:** W-23 UI and accessibility; pagination beyond the newest 500 jobs (07 §7).

### F-25 — Licensed property data (CoreLogic / Cotality), sample mode and state map services

**Status:** Implemented in domain/API: the provider-neutral contract and suggestions (`integration/property-data.ts`), sample data (`integration/sample-property-data.ts`), state map services (`integration/state-maps.ts`), the CoreLogic connector (`apps/api/src/integrations/corelogic.ts`) and the property data, comparable search, status and job map endpoints. **CoreLogic API keys have not been supplied**, so live data is not configured anywhere; development and test use sample data. M-14 and M-15 are planned (mobile/web). · E-03, E-01 · S-103, S-104, S-105, S-106, S-107 · J-14 · M-14, M-15, W-04

**User story**
As a valuer, I want property facts, sales history and nearby sales from the licensed property data provider offered as suggestions I check and accept, an automated estimate as a cross-check, and my state's government map for the property, so that I spend less time typing without losing attribution or control (01 D15).

**Acceptance criteria**

1. The provider is chosen from configuration: CoreLogic when `CORELOGIC_CLIENT_ID` and `CORELOGIC_CLIENT_SECRET` are both supplied; otherwise sample data in development and test, or off in production. `PROPERTY_DATA_MODE` (`corelogic`, `sample`, `off`) overrides; `sample` is refused in production. `GET /v1/integrations/status` returns the state (`connected`, `sample`, `not_configured`) with the reason ("CoreLogic API keys not supplied") and the state map services.
2. `POST /v1/jobs/{jobId}/assets/{assetId}/property-data` (`asset.edit`; the asset must belong to the job) matches the asset's address (or uses the given `propertyId`) and returns the attributes, field suggestions, sales history and, for callers with `valuation.edit` when the estimate's source is active, the automated estimate with the notice "a cross-check only, never the valuation".
3. Each suggestion carries provenance: `origin: external_source`, `sourceId`, `sourceRef`, `retrievedAt`, `effectiveDate`, `licenceBasis`, `verification: unverified`, `capturedBy`. Judgement values (condition, quality) are never suggested.
4. Lookups and searches write nothing to the job. The valuer accepts a suggestion through `PUT /fields` with its provenance marked `verified` (F-04), and adds a candidate sale through `POST /sales` (F-11).
5. `POST /v1/jobs/{jobId}/assets/{assetId}/comparables/search` (`evidence.edit`) takes `radiusKm` 0.5–10 (default 2), `months` 3–36 (default 12) and `limit` 1–20 (default 10), and returns candidates within the radius and period, each with an unverified `SaleComparable`.
6. Every lookup and search records `property_data.retrieved` in the job stream with the provider, source, property id and counts, never data values.
7. The provider's data source must be registered and active for the organisation, else `409 DATA_SOURCE_NOT_REGISTERED` before any provider call. The seed registers `ds-corelogic`, `ds-corelogic-avm`, `ds-sample-property-data` and `ds-sample-avm`.
8. Sample data and automated estimates have `permitsReportReproduction: false`; once relied on, `VAL-PROV-003` blocks issue `[REVIEW: DATA_LICENSING]`.
9. Every CoreLogic call goes through the connector policy (timeout, retries, rate limit, circuit breaker). The token (OAuth 2.0 client credentials) is cached until shortly before expiry and refreshed once on a `401`. Failures return `502 PROPERTY_DATA_UNAVAILABLE` with `failure` and `fallback: manual_entry`. Keys and response bodies are never logged or returned.
10. `GET /v1/jobs/{jobId}/map` (`job.read`) returns the state's map service, the subject properties with coordinates, sales with coordinates (none yet: sales do not store them, and a note says so) and notes.
11. _(planned)_ M-14 and M-15 (05 J-14); sale coordinates (S-107); live data once the licence is confirmed, the endpoint paths are checked and keys are supplied (S-105).

**Data fields**
Suggested catalogue fields: `land.area`, `land.areaSource`, `location.titleReference`, `location.lga`, `planning.zone`, `improvements.yearBuilt`, `improvements.dwellingType`, `improvements.accommodation`, `improvements.buildingArea`. Record `data_source` (registry). Domain types `PropertyMatch`, `PropertyAttributes`, `ProviderSale`, `AutomatedEstimate`, `FieldSuggestion`, `StateMapService`.

**Validation**
`VAL-PROV-001` (incomplete provenance on accepted values), `VAL-PROV-002` (unverified evidence), `VAL-PROV-003` (sample data or estimates relied on), `VAL-STALE-002` (past the source's freshness). Request schemas: `propertyId` 1–64 characters; search bounds above.

**Permissions**
`job.read` (status, search, map); `asset.edit` (lookup); `valuation.edit` additionally to see the automated estimate; `evidence.edit` (comparable search). Proposed `datasource.lookup` (§3.1) would replace `asset.edit` for lookups.

**Audit events**
`property_data.retrieved`; accepting values and sales emits `field.updated` and `evidence.sale_added`.

**Offline behaviour**
Online only. Accepted values and sales sync like any other edit.

**Error states**
Common errors, plus `503 PROPERTY_DATA_NOT_CONFIGURED`; `502 PROPERTY_DATA_UNAVAILABLE`; `409 DATA_SOURCE_NOT_REGISTERED`; `422 NO_PROPERTY_MATCH`; `422 SUBJECT_LOCATION_REQUIRED`; `422 UNKNOWN_ASSET`.

**Tests**

- `apps/api/test/property-data.test.ts` › CoreLogic provider with a stubbed fetch: "requests a client-credentials token and sends it as a bearer token"; "caches the token until shortly before it expires"; "refreshes the token once and retries when the API answers 401"; "retries a 500 and then succeeds"; "does not retry rejected credentials and never puts secrets in the error"; "maps attributes, sales, comparables and the automated estimate defensively"; "maps a timeout to 502 with the manual-entry fallback and no secrets"; "requires the CoreLogic data source to be registered for the organisation".
- `apps/api/test/property-data.test.ts` › "answers 503 with the reason and still searches jobs"; "suggests fields with provenance and saves nothing until the valuer accepts"; "withholds the automated estimate from people without valuation rights"; "finds comparable sales, adds one as evidence, and VAL-PROV-003 then blocks issue"; "shows the job on its state map service"; "defaults to CoreLogic only when both keys are supplied".
- `packages/domain/test/wip-profile-integrations.test.ts` › suggestions, sample provider and state map services.
- **Gap:** live CoreLogic responses (no keys; paths unverified); circuit-breaker half-open probe through the API; M-14/M-15 UI.

## 3. Gaps and proposed additions

Each item below needs a change to the named source: the code (then `pnpm docs:generate`), 00, or 12. Until that change is made, the item must not be used as an existing name.

### 3.1 Permissions

| Proposed                                    | Roles                                          | Needed by  | Note                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `datasource.lookup`                         | VALUER, FIELD_INSPECTOR, ALLOCATOR             | F-04, F-05 | From 04 §2.6. Lookups within accessible jobs.                                                                                                   |
| `datasource.verify`                         | VALUER (human)                                 | F-04, F-05 | From 04 §2.6. Marks a candidate `verified`.                                                                                                     |
| `datasource.configure`                      | ADMINISTRATOR                                  | F-04, F-05 | From 04 §2.6. Split of `datasource.manage`. Enabling an adapter needs a licence record approved by a different user `[REVIEW: DATA_LICENSING]`. |
| `legal_hold.apply`, `legal_hold.release`    | ADMINISTRATOR (MFA)                            | F-23       | From 11 §5.3. Release by a different user from the applier.                                                                                     |
| `fact.confirm`                              | VALUER (human)                                 | F-04, F-09 | Valuer confirmation of inspector-captured facts (A-25).                                                                                         |
| `recipient.approve`                         | ALLOCATOR, VALUER                              | F-20       | Today recipients are approved under `job.allocate`, which VALUER lacks. T-21 says valuer or allocator.                                          |
| AI service principal grant                  | AI service account                             | F-09       | Ingestion is gated by principal kind `ai` plus `inspection.capture`. Define an explicit role or grant so the matrix shows it.                   |
| Decide `qa.self_approval_exception` holders | ADMINISTRATOR (matrix) vs STANDARDS_OWNER (02) | F-19       | 02 lists a sole-practitioner set-up that uses STANDARDS_OWNER. Q-04 `[REVIEW: API_STANDARDS]`.                                                  |
| Decide `report.issue` for ALLOCATOR         | ALLOCATOR                                      | F-20       | J-10 names the allocator as a possible issuer. The matrix does not grant it.                                                                    |

### 3.2 Validation rules

| Proposed code   | Severity · stages               | Rule                                                                                                                                                 | Feature    |
| --------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `VAL-INDEP-002` | blocking · submit, issue        | The conflict check predates a change to purpose, intended users or instructing party (J-02 E4) `[REVIEW: API_STANDARDS]`                             | F-02       |
| `VAL-SYNC-001`  | blocking · submit               | Unresolved sync conflicts exist on the job (UX-10)                                                                                                   | F-07       |
| `VAL-INSP-001`  | warning · submit, issue         | Inspection finished with checklist gaps; a reason is recorded per gap (J-04 step 11)                                                                 | F-07       |
| `VAL-AREA-005`  | blocking · draft, submit, issue | Calibration check dimension deviates beyond tolerance (default 2 %) without recalibration or reason (J-06 E2). Matching code `GEO-CALIBRATION-CHECK` | F-10       |
| `VAL-DATE-010`  | blocking · draft, submit, issue | Commentary or evidence dated after `dates.researchCutOff` (any purpose; J-07 E6)                                                                     | F-16       |
| `VAL-AI-002`    | blocking · submit, issue        | Accepted facts conflict within one area (J-05 E4)                                                                                                    | F-09       |
| `VAL-AI-003`    | warning · submit, issue         | An inspector-accepted fact has not been confirmed by the valuer (A-25)                                                                               | F-09       |
| `VAL-AI-004`    | warning · submit, issue         | An accepted fact's source photo was later redacted or excluded (J-05 E3)                                                                             | F-09       |
| `VAL-LOC-001`   | warning · draft, submit, issue  | Asset location unverified, or geocode confidence below threshold (J-01 E1)                                                                           | F-01, F-06 |
| `VAL-ASSET-001` | warning · draft, submit         | Possible duplicate asset (normalised address or parcel) not confirmed as distinct (J-01 E2)                                                          | F-01       |

### 3.3 Field ids and record attributes

| Proposed                                                                                                               | Type                          | Feature    | Reason                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- | ------------------------------------------------------------------------------ |
| `instruction.independenceDeclaration`, `instruction.competenceConfirmed`                                               | longtext, boolean             | F-02       | J-02 step 3 for every purpose. Today only `fl.independenceDeclaration` exists. |
| `instruction.clientAcceptance`                                                                                         | document_refs + date + method | F-02       | J-02 step 4 `[REVIEW: LEGAL]`                                                  |
| `instruction.coSignatories`                                                                                            | user_refs                     | F-18       | A-12, SoD-07                                                                   |
| `inspection.startedAt`, `inspection.finishedAt`, `inspection.gapReasons`                                               | instant, instant, list        | F-07       | J-04 chronology and gaps                                                       |
| `hazard.flood`, `hazard.bushfire`, `hazard.coastal`, `hazard.contamination`                                            | longtext with provenance      | F-05       | Structured hazards for S-073. Today only `land.environmental` exists.          |
| `valuation.unroundedValue`, `valuation.roundingIncrement`, `valuation.weighting`                                       | money, money, list            | F-13       | Records the rounding step and reconciliation weights (J-07 step 7, Q-11)       |
| `ins.costRateSchedule`                                                                                                 | list                          | F-14       | Component area × rate rows with edition, locality and date (S-076)             |
| Provenance origin `site_capture`                                                                                       | `DataOrigin` value            | F-08       | Used in 05 J-04 step 9; missing from `core/provenance.ts`                      |
| Legal hold `matterReference`, `requestingParty`, `reviewDate`, `releaseReason`; scopes `asset`, `user`, `organisation` | record attributes             | F-23       | J-13 and 11 §5.3                                                               |
| Data-source `rateLimit`, `cachingRights`, `rawPayloadRetentionDays`                                                    | record attributes             | F-04, F-05 | 04 §5.5, RC-15                                                                 |

### 3.4 Audit actions

The following names are in the 00 §8 planned list or 05 §4 and are **not yet emitted**: `asset.updated`, `datasource.used`, `datasource.lookup_failed`, `datasource.fallback_task_created`, `datasource.verified`, `datasource.config_changed`, `ruleset.version_created`, `legal_hold.released`, `sync.conflict_resolved`, `user.membership_changed`, `job.conflict_declared`, `inspection.started`, `inspection.completed`, `photo.unredacted_viewed`, `invoice.sent`, `invoice.credited`, `retention.*`, `incident.*`.

The following are new proposals, not in 00 §8. Each needs a 00 revision before use.

| Proposed                                                         | Feature | Reason                                                           |
| ---------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `report.reproduced`                                              | F-20    | The reproduction check (with its result) is not audited          |
| `qa.self_approval_exception_requested`, `qa.reviewer_reassigned` | F-19    | J-09 step 9 and E2                                               |
| `measurement.approval_voided`                                    | F-10    | J-06 E1 (edit after approval) and E3 (approval rejected on sync) |
| `fact.confirmed`                                                 | F-09    | A-25 valuer confirmation                                         |
| `recipient.revoked`                                              | F-20    | `approved_recipient.revoked_at` exists but nothing sets it       |
| `job.ruleset_repinned`                                           | F-03    | TC-FLD-006 requires an audited re-pin                            |
| `audit.verification_failed`, `auth.step_up_failed`               | F-22    | Security alerting (S-095); J-08 E3                               |

### 3.5 API endpoints not yet present

- **F-01:** CSV/XLSX portfolio import, duplicate check and appointment booking.
- **F-02, F-05, F-10:** document and source-plan upload, with a type allow-list and malware scan (T-24). Engagement documents, planning reports and plans currently arrive only as field references.
- **F-02:** conflict search and the declaration record.
- **F-03:** per-asset selection overrides; rule-set re-pin.
- **F-04, F-05:** data-source registry CRUD; planning and hazard lookup; fallback tasks; human verification.
- **F-07:** sync conflict resolution; sync operation types for fields, sketches, AI decisions, risk flags and checklist items.
- **F-08:** an online photo metadata update route (today metadata changes arrive only through `/v1/sync` photo updates), soft delete, and unredacted-original access.
- **F-09:** fact confirmation.
- **F-11, F-12:** edit and soft-delete of sales and rentals.
- **F-15:** fair-value derivation and sensitivity.
- **F-16:** edit or withdraw a commentary library draft, and retire an approved version (S-110, S-111).
- **F-19:** self-approval exception request; reviewer reassignment.
- **F-20:** invoice management (send, credit note, accounting export); recipient revocation.
- **F-21:** rule-set version creation.
- **F-23:** legal-hold release and listing; retention policies and runs.
- **W-20:** user, role, credential, membership and device administration (`org.manage`, `user.manage`).

### 3.6 Inconsistencies to resolve

1. **AI suggestion severity.** `VAL-AI-001` is blocking at submit and issue (catalogue), but J-05 step 7 calls it a non-blocking warning. The catalogue governs; update 05.
2. **QA severity and disposition names.** The code uses severities `critical`, `major`, `minor`, `observation` and dispositions `resolved`, `accepted`, `withdrawn`. J-09 proposes `CRITICAL`, `MAJOR`, `MINOR`, `ADVISORY` and `ACCEPTED_AS_IS`, with the final list deferred to spec 06. Align 05 with the code values (also used in 07).
3. **Blocked selections.** J-03 E1 says a blocked combination saves nothing. `PATCH /selection` saves it, returns `selectionIssues`, and relies on `VAL-SEL-001` to block later.
4. **Issue permissions.** J-10 says an allocator with `report.issue` and `email.send` can issue. The matrix grants `report.issue` only to ADMINISTRATOR and VALUER, and the issue route does not check `email.send`.
5. **Commentary permission.** Fixed: W-08 now lists `evidence.edit`, which the API uses (05 §2.2).
6. **Sync audit events.** Assets and photos created through `/v1/sync` emit only `sync.operation_applied`, not `asset.created` or `photo.captured`. Decide whether to emit both.
7. **Legal hold scopes.** The API supports job, client and portfolio. 11 §5.3 also lists organisation, asset and user.
8. **Record attributes.** Record attributes here are cited from the API schemas and migrations. `06-data-model-and-audit.md` is the normative data model; any difference should be resolved there.
9. **Test naming.** No existing test title carries a TC ID yet, so the P2 traceability report would find none. Prefixing titles (e.g. `it('TC-GEO-003 …')`) is the follow-up.
10. **WALE by area.** TC-CALC-005 includes WALE by area; the registry has only `income.wale@1` (by income).
11. **Provenance name.** TC-CONN-005 and 12 §1.7 say `manual` provenance; the code uses `manual_entry`, or `client_supplied` for document-based fallback.
12. **Co-signatories.** SoD-07 (co-signatory exclusion) cannot be enforced, because the code has no co-signatory model.
13. **Sketch default.** Fixed: `includeInClientReport` and `useForReport` both default to `false`, so a sketch is working notes unless the valuer links it to the report (01 D11, 10 G10-13).
14. **System-filled fields.** Fixed: the API writes the responsible valuer and QA reviewer on create and assign, `location.coordinates` from the asset location, and `dates.instruction` and `instruction.dueDate` from the create request (`instructedOn`, `dueDate`); `PUT /fields` rejects all of them with `422 SYSTEM_FIELD`. Remaining gap: no endpoint changes the instruction or due date after creation (F-01, F-04).

### 3.7 Test catalogue additions (proposed for 12)

| Proposed ID    | Description                                                                                                                                                                                              | Level | Pri |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- |
| TC-ENG-001…003 | Conflict search matching; outcome rules disable acceptance; re-check required after instruction change                                                                                                   | L1/L2 | P1  |
| TC-RET-001…005 | Hold blocks deletion and retention; overlapping holds; release by a different user; dry-run → approval → purge; stream checkpoint keeps chain verifiable                                                 | L2/L3 | P1  |
| TC-PHOTO-004   | API de-duplication by hash; privacy actions audited; redacted derivative used in PDF                                                                                                                     | L2/L8 | P1  |
| TC-VAL-005     | One passing and one failing fixture for each catalogue code not referenced by a test today (`VAL-AREA-003`, `VAL-DATE-009`, `VAL-FR-001`, `VAL-INS-001`, `VAL-PHOTO-002`, `VAL-RENT-001`, `VAL-SEL-002`) | L1    | P1  |

TC-COM-001 (the manual commentary route) has moved into 12 §3.16 with the other market commentary
tests.
