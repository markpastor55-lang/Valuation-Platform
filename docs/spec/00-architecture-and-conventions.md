# 00 — Architecture and conventions

> Status: **Draft for review** · Owner: Product architecture · Applies to: all spec sections and code

This document fixes the vocabulary, identifiers and architectural decisions that every other
specification section and every package in this repository uses. If a section disagrees with
this document, this document wins until it is formally changed.

## 1. Guardrails restated as engineering rules

| #   | Guardrail                                   | Engineering rule                                                                                                                                                  | Enforced in                                |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| G1  | No claim of automatic "API compliance"      | Templates, clauses and rule sets carry a `reviewStatus`; nothing ships to production in `placeholder`/`draft` status. UI copy never says "compliant".             | `packages/domain/src/report`, `config`     |
| G2  | Human valuer determines and certifies value | Certification can only be signed by a `human` actor who is the job's responsible valuer, with MFA. AI actors cannot sign, approve, accept or issue.               | `workflow/certification.ts`, `auth`        |
| G3  | External data provenance                    | Every external datum stores source, retrieval time, effective date, licence/usage basis and verification status. Missing provenance is a blocking validation.     | `core/provenance.ts`, `validation`         |
| G4  | Versioned templates and rules               | Rule sets, templates and clauses are versioned by jurisdiction, purpose, client and effective date; approval is separate from authorship and audited.             | `config/rule-set.ts`, `report/template.ts` |
| G5  | Professional judgement retained             | Assumptions, special assumptions, limitations, conflicts, independence, material uncertainty, reliance, confidentiality and intended use are first-class records. | `config/fields.ts`                         |
| G6  | AASB 13 (not "AASB 113")                    | Financial-reporting logic references **AASB 13 Fair Value Measurement** and is configurable.                                                                      | `calc/fair-value.ts`                       |

Unresolved legal, professional-standard, data-licensing and accounting interpretations are marked
in the docs with **`[REVIEW: <role>]`** where `<role>` is one of the specialist reviewer roles in §6.

## 2. Architecture overview

```
┌────────────────────────┐   ┌────────────────────────┐   ┌───────────────────────────┐
│ Mobile app (iOS/Android│   │ Web portal (admin, QA, │   │ Integrations (adapters)   │
│ React Native / Expo)   │   │ allocation, finance)   │   │ geocode, title, planning, │
│ offline-first, SQLCipher│  │ React                  │   │ hazards, sales, cost,     │
│ local store + sync queue│  │                        │   │ PDF, e-sign, email, acctg │
└──────────┬─────────────┘   └──────────┬─────────────┘   └─────────────┬─────────────┘
           │  HTTPS (OIDC JWT, MFA)     │                               │
           ▼                            ▼                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ API service (Node.js, Fastify, TypeScript)                                           │
│  • REST /v1 · sync endpoint · PDF rendering · job orchestration                      │
│  • uses @vp/domain for every rule, calculation, permission and state transition      │
└──────────┬───────────────────────────────────────────────┬───────────────────────────┘
           ▼                                               ▼
┌────────────────────────────┐                 ┌───────────────────────────────────────┐
│ PostgreSQL (AU region)     │                 │ Object storage (AU region, encrypted,  │
│ migration-controlled schema│                 │ object-lock for issued artefacts)      │
│ append-only audit tables   │                 │ photos, plans, PDFs, documents         │
└────────────────────────────┘                 └───────────────────────────────────────┘
```

- **`@vp/domain`** (`packages/domain`) is a pure TypeScript library with no I/O. It is shared by
  the API, the mobile app and the web portal so that requirement resolution, validation,
  calculations, geometry, permission checks and workflow guards behave identically online and
  offline.
- **`@vp/api`** (`apps/api`) persists data, enforces authentication, calls the domain library
  for every decision and renders PDFs deterministically from immutable snapshots.
- **Mobile** and **web** clients are later iterations (see `13-backlog.md`); they consume the same
  domain library.

### Key decisions (ADR summary)

| ADR     | Decision                                                                               | Rationale                                                                                   | Status                            |
| ------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| ADR-001 | TypeScript monorepo (pnpm workspaces)                                                  | One language across mobile, web and API; shared domain library                              | Accepted                          |
| ADR-002 | React Native (Expo, bare workflow if needed) for iOS/Android                           | Single codebase, camera/location/offline support, OTA updates controlled by release process | Proposed — confirm in decision D5 |
| ADR-003 | PostgreSQL 16 + SQL migrations with checksums                                          | Migration-controlled schema, strong constraints, triggers for append-only audit             | Accepted                          |
| ADR-004 | Offline store: SQLite with SQLCipher on device; operation-based sync with client UUIDs | Idempotent replay, conflict-aware field-level merge                                         | Accepted                          |
| ADR-005 | Configuration-driven requirements (rule sets) instead of hard-coded forms              | Purpose × property type × scope × jurisdiction drives fields, sections and warnings         | Accepted                          |
| ADR-006 | Hash-chained audit events (SHA-256 over canonical JSON) per stream                     | Tamper evidence; reproducible issue snapshots                                               | Accepted                          |
| ADR-007 | PDF generated server-side from snapshot with deterministic renderer                    | Issued PDF reproducible byte-for-byte from the audit snapshot                               | Accepted                          |
| ADR-008 | Australian-hosted deployment option (e.g. AWS ap-southeast-2 / Azure Australia East)   | Data residency expectations of clients                                                      | Proposed — confirm in decision D6 |

## 3. Identifier conventions

| Concept               | Convention                                                                         | Examples                                                              |
| --------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Entity IDs            | UUID v4/v7 strings, generated by the client for offline-created records            | `0190f5d2-…`                                                          |
| Field IDs             | `<group>.<camelCaseName>`                                                          | `instruction.basisOfValue`, `land.area`, `fr.fairValueHierarchyLevel` |
| Section IDs           | `snake_case`                                                                       | `sales_evidence`, `fair_value`, `restricted_access`                   |
| Requirement rule IDs  | `REQ-<AREA>-<NNN>`                                                                 | `REQ-PUR-MV-001`, `REQ-PT-IND-001`                                    |
| Selection rule IDs    | `SEL-<NNN>`                                                                        | `SEL-001` (insurance + vacant land)                                   |
| Validation rule codes | `VAL-<CATEGORY>-<NNN>`                                                             | `VAL-DATE-004`, `VAL-AREA-002`, `VAL-MKT-001`, `VAL-MKT-002`          |
| Geometry issue codes  | `GEO-<NAME>`                                                                       | `GEO-OVERLAP`, `GEO-SCALE-UNVERIFIED`                                 |
| Formula IDs           | `<domain>.<name>` + integer version                                                | `land.rate_per_m2@1`                                                  |
| Audit actions         | `<entity>.<past_tense_verb>`                                                       | `job.created`, `certification.signed`, `report.issued`                |
| Permissions           | `<resource>.<verb>`                                                                | `qa.approve`, `calculation.override`                                  |
| Dates                 | Calendar dates as ISO `YYYY-MM-DD` (`LocalDate`); instants as ISO-8601 UTC         | `2026-06-30`, `2026-10-02T03:12:00Z`                                  |
| Money                 | AUD, stored as integer cents in the database; domain uses dollars rounded to cents |                                                                       |
| Areas                 | Square metres (`m2`) canonical; conversions recorded with original unit            |                                                                       |
| Ratios                | Decimal fractions (`0.055` = 5.5 %)                                                | cap rates, yields, incentives                                         |

## 4. Selection vocabulary

### Jurisdictions

`NSW`, `VIC`, `QLD`, `WA`, `SA`, `TAS`, `ACT`, `NT`

### Report purposes

| Code                    | Meaning                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `MARKET_VALUE`          | Market value (mortgage security is a _client template_ variant, not a separate purpose) |
| `CGT`                   | Capital gains tax (CGT) valuation, current or retrospective (was `CGT_RETROSPECTIVE`)   |
| `FAMILY_LAW`            | Expert valuation for family-law proceedings                                             |
| `FINANCIAL_REPORTING`   | Fair value for financial reporting (AASB 13)                                            |
| `RENTAL_ASSESSMENT`     | Market rent assessment / determination                                                  |
| `INSURANCE_REPLACEMENT` | Insurance replacement / reinstatement cost                                              |

### Retrospective valuations (derived, never selected)

"Retrospective" is not a purpose or a scope. A valuation of any purpose is retrospective when its
valuation date (`dates.valuation`) is earlier than the inspection date (`dates.inspection`), or
than the instruction date (`dates.instruction`) when there is no inspection (e.g. `DESKTOP`).
`retrospectiveStatus(values)` in `packages/domain/src/requirements/retrospective.ts` derives it;
rules match it with the `RuleCondition` key `retrospective: true` (e.g. `REQ-RETRO-001`, `SEL-007`)
and the resolver reports it as `ResolvedRequirements.retrospective` `[REVIEW: API_STANDARDS]`.
Migration `0004_cgt_purpose.sql` renamed the stored purpose `CGT_RETROSPECTIVE` to `CGT`.

### Inspection scopes

The brief lists _Desktop_ and _Restricted access / kerbside_ alongside purposes; they are modelled
as **scopes**, because any purpose can (subject to rules) be performed at any scope.

| Code         | Meaning                                             |
| ------------ | --------------------------------------------------- |
| `FULL`       | Full internal and external inspection               |
| `KERBSIDE`   | External-only inspection from the street / boundary |
| `RESTRICTED` | Partial access: some areas not inspected            |
| `DESKTOP`    | No physical inspection                              |

### Property types

`VACANT_LAND`, `RESIDENTIAL`, `RESIDENTIAL_UNIT` (units, apartments and townhouses, including
strata units; 01 D16), `COMMERCIAL_OFFICE`, `COMMERCIAL_RETAIL`, `INDUSTRIAL`,
`SPECIALISED_MIXED_USE`

### Asset mode

`SINGLE`, `PORTFOLIO`

## 5. Roles and permissions

Roles: `ADMINISTRATOR`, `ALLOCATOR`, `VALUER`, `FIELD_INSPECTOR`, `QA_REVIEWER`, `FINANCE`,
`CLIENT_READONLY`, plus `STANDARDS_OWNER` (added: the brief requires a nominated standards owner
to approve templates and rule sets).

The permission matrix is defined in code (`packages/domain/src/auth/permissions.ts`) and the
generated table is in `generated/permission-matrix.md`. Separation-of-duties rules:

- `certification.sign` — only the job's responsible valuer, as a human actor, with MFA.
  The same permission (human, MFA, no job scope) lets a valuer update their own signing profile
  (`PUT /v1/me/profile`); nobody can edit another person's profile (01 D13).
- `valuation.edit` — professional-judgement fields (evidence selection, approaches, rates,
  reconciliation, conclusions) are written only by valuers; field inspectors capture facts. In the
  default workflow the valuer inspects and values; `FIELD_INSPECTOR` is optional, for firms that
  use separate inspectors (01 D12).
- Service and AI accounts can call only the routes that explicitly allow their actor kind (AI:
  suggestion submission; system: email delivery callback).
- `qa.approve` — never the responsible valuer, unless a documented self-approval exception
  authorised by a different user holding `qa.self_approval_exception` exists.
- `template.approve` / `ruleset.approve` — never the author of that version. Market commentary
  library versions are written under `template.edit` and approved under `template.approve`, so the
  same rule applies to them (01 D17).
- `CLIENT_READONLY` sees only issued reports and invoices for its own client entities.
- Restricted portfolios require explicit membership even for organisation-wide roles.

## 6. Specialist reviewer roles (`[REVIEW: …]` tags)

| Tag                 | Reviewer                                                        |
| ------------------- | --------------------------------------------------------------- |
| `API_STANDARDS`     | Nominated API/IVS standards owner (Certified Practising Valuer) |
| `FAMILY_LAW`        | Family-law practitioner (legal review of expert-report wording) |
| `TAX`               | Tax adviser (CGT/ATO alignment)                                 |
| `ACCOUNTING`        | Accounting/AASB 13 specialist                                   |
| `PRIVACY`           | Privacy officer (APPs, PIA)                                     |
| `SECURITY`          | Cyber-security reviewer                                         |
| `DATA_LICENSING`    | Data-licensing / procurement reviewer                           |
| `QUANTITY_SURVEYOR` | Quantity surveyor / insurance-valuation specialist              |
| `LEGAL`             | General legal counsel (terms, liability, reliance wording)      |

## 7. Job lifecycle

```
draft ──acceptEngagement──▶ active ──submitForQa──▶ submitted ──startReview──▶ in_review
  │                           ▲  │                                              │   │
  │                           │  └──cancel──▶ cancelled           returnToValuer│   │approve
  └──cancel──▶ cancelled      └──────────── returned ◀─────────────────────────┘   ▼
                                    │ resubmit ──▶ submitted                       approved
                                                                                   │ issue
                                                                                   ▼
                                                     active ◀──openAmendment── issued
```

Records are editable only in `draft`, `active` and `returned`. Submission locks the content and
records the snapshot hash; approval and issue verify that the snapshot has not changed.

## 8. Audit action vocabulary

Actions emitted by the iteration-1 API (see `06-data-model-and-audit.md` for when each is emitted):

`job.created`, `job.selection_changed`, `job.assigned`, `job.engagement_accepted`, `job.submitted`,
`job.cancelled`, `job.amendment_opened`, `asset.created`, `field.updated`, `evidence.sale_added`,
`evidence.sale_removed` (a sale taken out of the evidence while the job is editable; the event keeps
the removed sale),
`evidence.rental_added`, `evidence.commentary_added`, `risk.flag_recorded`, `calculation.run`,
`calculation.overridden`, `sketch.version_created`, `calibration.created`, `calibration.confirmed`,
`measurement.approved`, `photo.captured`, `photo.privacy_flagged`, `photo.redacted`,
`photo.consent_recorded`, `photo.excluded`,
`ai.suggestion_created`, `ai.suggestion_accepted`, `ai.suggestion_edited`, `ai.suggestion_rejected`,
`validation.run`, `validation.acknowledged`, `certification.signed`, `qa.started`,
`qa.checklist_answered`, `qa.finding_raised`, `qa.finding_responded`, `qa.finding_closed`,
`qa.self_approval_exception_authorised`, `qa.returned`, `qa.approved`, `report.draft_generated`,
`report.issued`, `report.accessed`, `invoice.created`, `email.queued`, `email.sent`,
`email.delivery_updated`, `template.version_created`, `template.review_recorded`,
`template.version_approved`, `ruleset.version_approved`, `recipient.approved`, `legal_hold.applied`,
`sync.operation_applied`, `sync.conflict_detected`, `auth.denied`, `profile.updated` (a valuer
changed their own signing profile, 01 D13), `property_data.retrieved` (property data or comparable
sales were looked up from the property data provider for an asset; metadata holds the provider,
source, property id and counts, never data values; 01 D15), `commentary.version_created` (a
standards owner wrote a draft version of a market commentary library paragraph; organisation
stream; 01 D17), `commentary.version_approved` (a different standards owner approved it, with MFA;
organisation stream; 01 D17). When a valuer uses library commentary on a job, the existing
`evidence.commentary_added` is emitted, with the library paragraphs and versions in its metadata.

Planned (later iterations): `asset.updated`, `datasource.used`, `datasource.lookup_failed`,
`datasource.fallback_task_created`, `datasource.verified`, `datasource.config_changed`,
`ruleset.version_created`, `legal_hold.released`, `sync.conflict_resolved`, `user.membership_changed`,
`retention.*` and `incident.*` events proposed in `04` and `11`.

## 9. Repository layout

```
docs/spec/                 specification sections 00–14 (+ generated tables)
packages/domain/           @vp/domain — pure domain engine (no I/O)
apps/api/                  @vp/api — Fastify service, SQL migrations, PDF renderer
scripts/                   repository tooling (spec table generation)
```
