# 09 — PDF template schema

> Status: **Draft for review** · Owner: Product architecture (with the standards owner) · Applies to: `packages/domain/src/report`, `apps/api/src/services/pdf.ts`, `apps/api/src/services/invoice.ts`, `apps/api/src/routes/reports.ts`, template routes in `apps/api/src/routes/admin.ts`, screens W-14, W-15, W-16, W-18

This section specifies the report template model, its JSON Schema, the placeholder language,
template governance, how a report is composed from a job and a template, the PDF rendering
contract, the invoice document, and change control. Vocabulary follows `00`. Templates are
firm-authored (01 D3). The platform ships no proprietary API template text, Rawlinsons data or
AIQS publications, and nothing here claims compliance with any standard (G1).

Status markers: **Implemented** means it is in the Iteration 1 code. **Planned — MVP · Web portal**,
**Planned — MVP · Mobile app**, **Planned — Pilot** and **Planned — Production** refer to the
releases in `13-backlog.md`, with story IDs. Gaps found in the current code are listed in §9.

```
JobAggregate ─reportDataOf()─▶ ReportData ─composeReport(template, audience)─▶ ReportModel ─renderReportPdf(assets, at)─▶ PDF bytes
     └─renderAssetsOf()─▶ RenderAssets ────────────────────────────────────────────────────────────▲   (pdf-renderer@3)
Issue: ReportData, TemplateVersion and RenderAssets are JSON round-tripped, rendered, and stored in an IssueSnapshot (issue-snapshot@1).
```

## 1. Template model (`packages/domain/src/report/template.ts`)

### 1.1 `TemplateVersion`

| Field                            | Type                                                                 | Rules                                                                                             |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `templateId`                     | string                                                               | Family id, e.g. `au-generic`. `(org_id, template_id, version)` is unique in `template_version`.   |
| `version`                        | integer                                                              | Assigned by the server on create (`max + 1`). Any client value is ignored.                        |
| `name`                           | string                                                               | Display name shown in W-18 and M-03.                                                              |
| `status`                         | `draft` · `in_review` · `approved` · `retired`                       | The DB `status` column is authoritative and overrides `content.status` on load (`loadAggregate`). |
| `appliesTo`                      | `{ purposes?, propertyTypes?, jurisdictions?, scopes?, clientIds? }` | An omitted list matches every value. `clientIds` matches only when the job's client is listed.    |
| `effectiveFrom` / `effectiveTo?` | `LocalDate`                                                          | Both inclusive.                                                                                   |
| `branding`                       | object (§1.6)                                                        | Copied into every version, so a re-render uses the branding of that version.                      |
| `watermarks`                     | `{ draft, final }` (§1.7)                                            |                                                                                                   |
| `sections`                       | `TemplateSection[]`                                                  | **Rendered in list order.** The seed template follows `REPORT_SECTIONS` order.                    |
| `clauses`                        | `ClauseVersion[]`                                                    | Clause versions pinned into the template, so the template is self-contained.                      |
| `requiredReviews`                | `SpecialistReviewer[]`                                               | Roles whose latest review must be `approved` (§4.3).                                              |
| `reviews`                        | `SpecialistReview[]`                                                 | Append-only, recorded by `POST …/reviews`.                                                        |
| `authoredBy`, `createdAt`        | string, `Instant`                                                    | Set by the server from the creating principal.                                                    |
| `approvedBy?`, `approvedAt?`     | string, `Instant`                                                    | Set on approval.                                                                                  |

### 1.2 Status lifecycle

```
draft ──record review──▶ in_review ──approve (≠ author, human, MFA, no blockers)──▶ approved ──retire (Planned)──▶ retired
```

| Transition                        | Endpoint                                                           | Guard                                                                                                                                                                                                                                                                | Audit                                 |
| --------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| → `draft` (create)                | `POST /v1/admin/templates`                                         | `template.edit`. `templateId`, `sections` and `clauses` present. `lintTemplate` returns no problems. Incoming clause statuses are normalised: `placeholder` stays `placeholder`; every other status becomes `draft`, so a client cannot submit pre-approved clauses. | `template.version_created`            |
| `draft`/`in_review` → `in_review` | `POST /v1/admin/templates/{templateId}/versions/{version}/reviews` | `template.approve`. Version is not `approved` or `retired`. Body: `reviewer`, `outcome`, `notes` (5 characters or more).                                                                                                                                             | `template.review_recorded`            |
| `draft`/`in_review` → `approved`  | `POST /v1/admin/templates/{templateId}/versions/{version}/approve` | `template.approve`: human actor, MFA, actor ≠ `authoredBy` (SoD-03). Each non-approved clause goes through `approveClause` in the same transaction. `templateApprovalBlockers` must be empty.                                                                        | `template.version_approved`           |
| `approved` → `retired`            | —                                                                  | **Planned — MVP · Web portal (S-059).** No endpoint yet. `selectTemplate` never selects retired versions.                                                                                                                                                            | `template.version_retired` (proposed) |

Approved and retired versions are immutable in the application (`IMMUTABLE_RECORD`). The database
does not yet enforce this (gap G09-08). A change always means a new version (J-12 E4).

### 1.3 `TemplateSection`

| Field       | Values                                                      | Behaviour                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sectionId` | One of the 35 ids in `config/sections.ts` (§2, `SectionId`) | Unknown ids and duplicates are rejected by lint.                                                                                                                                                 |
| `title?`    | string                                                      | Overrides `sectionTitle(sectionId)`. Not placeholder-resolved.                                                                                                                                   |
| `include`   | `always`                                                    | Rendered whatever the requirements (seed: `certification`, `audit_metadata`).                                                                                                                    |
|             | `when_required`                                             | Rendered only if `requirements.sections` (the requirement resolver output) contains the id.                                                                                                      |
| `audience`  | `client`                                                    | Rendered in client and internal outputs.                                                                                                                                                         |
|             | `internal`                                                  | Skipped when composing for `client`. Kept for the audit and QA copy. Draft preview and issue both compose for `client`; storing an internal rendering is **Planned — MVP · Web portal (S-056)**. |
| `blocks`    | `TemplateBlock[]`                                           | A section whose blocks all render empty is left out entirely (no empty heading).                                                                                                                 |

### 1.4 `TemplateBlock` types and rendering

| `type`              | Parameters                                    | Renders as (`RenderBlock`)                                                                                                                                                                                                                                                                                                                                                                                               | When empty                                                                                                                               | Problem (final only)      |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `heading`           | `text`, `level?` (1–3, default 2)             | `heading`; placeholders resolved                                                                                                                                                                                                                                                                                                                                                                                         | —                                                                                                                                        | —                         |
| `paragraph`         | `text`                                        | `paragraph` style `normal`; placeholders resolved                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                        | —                         |
| `clause`            | `clauseId`                                    | `paragraph`, style `normal` if the clause is approved, otherwise `placeholder` (italic grey)                                                                                                                                                                                                                                                                                                                             | Nothing if the clause is not pinned, or if its `appliesTo.purposes`/`jurisdictions` exclude the job                                      | `TPL-UNAPPROVED-CLAUSE`   |
| `field_table`       | `fields[]`, `omitEmpty?`                      | `key_value` rows of label and formatted value. Asset-level fields give one row per required asset, labelled `<asset> — <label>` when there is more than one asset.                                                                                                                                                                                                                                                       | Fields not in the resolved requirements are skipped. An empty optional field is skipped. An empty required field shows `[Not provided]`. | `TPL-MISSING-REQUIRED`    |
| `sales_table`       | —                                             | `table`: Address, Contract date, Price, Land, Building, Land rate, Building rate, Adjusted, Comparability, Status (Verified/Unverified), plus a note pointing to the calculation trace. Most recent contract date first, ties by sale id                                                                                                                                                                                 | Note "No sales evidence recorded."                                                                                                       | —                         |
| `rental_table`      | —                                             | `table`: Address, Lease start, Face rent p.a., Basis, Area, Rate (face rent ÷ area), Incentive, Comparability. Most recent lease start first, ties by rental id                                                                                                                                                                                                                                                          | Note "No rental evidence recorded."                                                                                                      | —                         |
| `market_commentary` | —                                             | For each of national, state and local commentary switched on by the requirements: a level-3 `heading` ("National market", "State market — <state>", "Local market — <suburb>"; with several assets, the asset label), one `paragraph` per paragraph of the field text, then a `note` "Commentary as at <date>. Sources: <sources>." from the job's current commentary record for that level, where there is one (01 D17) | Required but missing: heading plus `[Not provided]` placeholder, and `TPL-MISSING-REQUIRED` on a final report                            | —                         |
| `calculation_trace` | `formulaIds?` (all calculations when omitted) | `table` "Calculation trace": Formula (`id@version: expression`), Inputs (`name = value unit`, with `(default)` where defaulted), Result, Override (`effective value — reason`)                                                                                                                                                                                                                                           | Nothing                                                                                                                                  | —                         |
| `area_schedule`     | —                                             | One `table` per reporting schedule (§5.4)                                                                                                                                                                                                                                                                                                                                                                                | Nothing                                                                                                                                  | `TPL-AREA-NOT-REPORTABLE` |
| `sketch`            | —                                             | `image` ref `sketch` per reporting sketch version, if `includeInClientReport` is set (API default `false`) or the audience is `internal` (§5.5). Not used by the seed template: the sketch is working notes (01 D11)                                                                                                                                                                                                     | Nothing                                                                                                                                  | —                         |
| `photo_grid`        | `columns?` (2 or 3)                           | `image` ref `photo` per eligible photo, sorted by `sequence` (§5.6)                                                                                                                                                                                                                                                                                                                                                      | Nothing                                                                                                                                  | —                         |
| `map`               | —                                             | One `image` ref `map` (job id) if the job has at least one asset                                                                                                                                                                                                                                                                                                                                                         | Nothing                                                                                                                                  | —                         |
| `certification`     | —                                             | `key_value` (§5.7)                                                                                                                                                                                                                                                                                                                                                                                                       | Placeholder paragraph `[Certification not yet signed]`                                                                                   | `TPL-NO-CERTIFICATION`    |
| `audit_metadata`    | —                                             | `key_value`: Report (`id vN (status)`), Job reference, Template (`id vN`), Rule set, Snapshot hash (`[draft — not snapshotted]` for drafts)                                                                                                                                                                                                                                                                              | —                                                                                                                                        | —                         |
| `page_break`        | —                                             | `page_break`                                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                                                        | —                         |

Value formatting (`formatValue`): `money` → AUD (`$1,150,000`); `area` → `n m²` (2 dp, rounded
half away from zero); `ratio` → percentage (2 dp); `length` → `n m`; `integer` → plain digits
without thousands separators (`1998`, not `1,998`); `area_schedule_ref` → `Sketch v<N>: <total> m²
total (<basis>)` from the reporting sketch version and its schedule (`See area schedule` if that
schedule is not in the report data); `date` → long date (`30 September 2026`); `boolean` → Yes/No;
`user_ref` → display name (from `userNames`, otherwise the raw id); `enum`/`multi_enum` →
humanised code; `calculation_ref` → effective value (an override wins) with unit (`$/m²`, `p.a.`,
`%`, `years`); `document_refs`/`datasource_refs` → `n documents on file` / `n sources on file`;
`coordinates` → `lat, lng` to 6 dp; other objects → their `formatted` property, otherwise their
scalar values joined with commas.

### 1.5 `ClauseVersion`

| Field                                  | Rules                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clauseId`, `version`, `title`, `text` | Text may contain placeholders (§3).                                                                                                                                                                                                                                      |
| `status`                               | `placeholder`: seed wording starting `PLACEHOLDER —`; renders as "under review" styling; never approvable. `draft`: firm-authored wording awaiting approval. `approved`: approved by a standards owner; immutable. `retired`: not used in new versions (Planned, S-059). |
| `review`                               | Specialist roles that must review this wording before approval.                                                                                                                                                                                                          |
| `appliesTo?`                           | `{ purposes?, jurisdictions? }`. A clause outside its scope renders nothing.                                                                                                                                                                                             |
| `approvedBy?`, `approvedAt?`           | Set by `approveClause`: human actor; refuses text containing `PLACEHOLDER` (`GUARD_FAILED`) and clauses that are already approved.                                                                                                                                       |

Seed library (`SEED_CLAUSES`, all `placeholder`; see `generated/formulas-conventions-clauses.md`):

| Clause                  | Reviewers                                   | Clause                  | Reviewers                                       |
| ----------------------- | ------------------------------------------- | ----------------------- | ----------------------------------------------- |
| `certification-core`    | `[REVIEW: API_STANDARDS]` `[REVIEW: LEGAL]` | `expert-declaration`    | `[REVIEW: FAMILY_LAW]`                          |
| `reliance-core`         | `[REVIEW: LEGAL]`                           | `fair-value-disclosure` | `[REVIEW: ACCOUNTING]`                          |
| `limitations-core`      | `[REVIEW: API_STANDARDS]` `[REVIEW: LEGAL]` | `insurance-cost-data`   | `[REVIEW: QUANTITY_SURVEYOR]`                   |
| `restricted-limitation` | `[REVIEW: API_STANDARDS]`                   | `area-disclaimer`       | `[REVIEW: API_STANDARDS]` (used by spec 10 §10) |
| `desktop-limitation`    | `[REVIEW: API_STANDARDS]`                   | `ai-assistance`         | `[REVIEW: API_STANDARDS]` `[REVIEW: PRIVACY]`   |
| `retrospective-cutoff`  | `[REVIEW: TAX]` `[REVIEW: API_STANDARDS]`   |                         |                                                 |

### 1.6 Branding

| Field                                      | Used for                                                                               | Status                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firmName`                                 | Cover, running header (every page except the cover), PDF Author, invoice supplier name | Implemented                                                                                                                                                     |
| `primaryColour`                            | `#RRGGBB` (lint): headings, level-1 rules, watermark colour                            | Implemented                                                                                                                                                     |
| `footerText`                               | First segment of the footer on every page                                              | Implemented                                                                                                                                                     |
| `logoAssetId?`                             | Cover logo                                                                             | Accepted but not rendered. **Planned — MVP · Web portal (S-034, S-056).**                                                                                       |
| Fonts, cover layout, colour tokens (01 D6) | —                                                                                      | Not configurable: Helvetica family. Embedded, pinned fonts per template version are **Planned — MVP (S-056)**. White-label is **Planned — Production (S-092)**. |

### 1.7 Watermarks

| Key     | Placeholders                    | Example (seed)                                                                                 | Rendered                     |
| ------- | ------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------- |
| `draft` | **Not resolved** (literal text) | `DRAFT — NOT FOR RELIANCE`                                                                     | When `report.status = draft` |
| `final` | Resolved (§3)                   | `FINAL v{{report.version}} — issued {{report.issueDate}}` → `FINAL v1 — issued 2 October 2026` | When `report.status = final` |

The J-10 example "Issued to <client> — v1" cannot be written today because the client name is not
in the allow-list. `client.name` is proposed (gap G09-04).

## 2. JSON Schema for `TemplateVersion` (draft 2020-12)

This schema mirrors the TypeScript types exactly. There are three deliberate refinements: `version`
is an integer of 1 or more (the DB column is an integer); `LocalDate`/`Instant` carry the
patterns used by the API (`InstantSchema` accepts UTC `Z` only); and `primaryColour` carries the
lint pattern. Semantic rules (pinned clauses, catalogue field ids, unique sections, allowed
placeholders, a certification section) are enforced by `lintTemplate` (§3.3), not the schema.
Validating `POST /v1/admin/templates` against this schema is **Planned — MVP · Web portal (S-059)**;
today the route checks only the presence of `templateId`/`sections`/`clauses`, then lints.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.valuation-platform.invalid/template-version.schema.json",
  "title": "TemplateVersion",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "templateId",
    "version",
    "name",
    "status",
    "appliesTo",
    "effectiveFrom",
    "branding",
    "watermarks",
    "sections",
    "clauses",
    "requiredReviews",
    "reviews",
    "authoredBy",
    "createdAt"
  ],
  "properties": {
    "templateId": { "type": "string" },
    "version": { "type": "integer", "minimum": 1 },
    "name": { "type": "string" },
    "status": { "enum": ["draft", "in_review", "approved", "retired"] },
    "appliesTo": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "purposes": { "type": "array", "items": { "$ref": "#/$defs/ReportPurpose" } },
        "propertyTypes": { "type": "array", "items": { "$ref": "#/$defs/PropertyType" } },
        "jurisdictions": { "type": "array", "items": { "$ref": "#/$defs/Jurisdiction" } },
        "scopes": { "type": "array", "items": { "$ref": "#/$defs/InspectionScope" } },
        "clientIds": { "type": "array", "items": { "type": "string" } }
      }
    },
    "effectiveFrom": { "$ref": "#/$defs/LocalDate" },
    "effectiveTo": { "$ref": "#/$defs/LocalDate" },
    "branding": {
      "type": "object",
      "additionalProperties": false,
      "required": ["firmName", "primaryColour", "footerText"],
      "properties": {
        "firmName": { "type": "string" },
        "primaryColour": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
        "footerText": { "type": "string" },
        "logoAssetId": { "type": "string" }
      }
    },
    "watermarks": {
      "type": "object",
      "additionalProperties": false,
      "required": ["draft", "final"],
      "properties": { "draft": { "type": "string" }, "final": { "type": "string" } }
    },
    "sections": { "type": "array", "items": { "$ref": "#/$defs/TemplateSection" } },
    "clauses": { "type": "array", "items": { "$ref": "#/$defs/ClauseVersion" } },
    "requiredReviews": { "type": "array", "items": { "$ref": "#/$defs/SpecialistReviewer" } },
    "reviews": { "type": "array", "items": { "$ref": "#/$defs/SpecialistReview" } },
    "authoredBy": { "type": "string" },
    "createdAt": { "$ref": "#/$defs/Instant" },
    "approvedBy": { "type": "string" },
    "approvedAt": { "$ref": "#/$defs/Instant" }
  },
  "$defs": {
    "LocalDate": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "Instant": {
      "type": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$"
    },
    "Jurisdiction": { "enum": ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] },
    "ReportPurpose": {
      "enum": [
        "MARKET_VALUE",
        "CGT",
        "FAMILY_LAW",
        "FINANCIAL_REPORTING",
        "RENTAL_ASSESSMENT",
        "INSURANCE_REPLACEMENT"
      ]
    },
    "PropertyType": {
      "enum": [
        "VACANT_LAND",
        "RESIDENTIAL",
        "COMMERCIAL_OFFICE",
        "COMMERCIAL_RETAIL",
        "INDUSTRIAL",
        "SPECIALISED_MIXED_USE"
      ]
    },
    "InspectionScope": { "enum": ["FULL", "KERBSIDE", "RESTRICTED", "DESKTOP"] },
    "SpecialistReviewer": {
      "enum": [
        "API_STANDARDS",
        "FAMILY_LAW",
        "TAX",
        "ACCOUNTING",
        "PRIVACY",
        "SECURITY",
        "DATA_LICENSING",
        "QUANTITY_SURVEYOR",
        "LEGAL"
      ]
    },
    "SectionId": {
      "enum": [
        "instructions",
        "scope",
        "restricted_access",
        "desktop_data_register",
        "basis",
        "expert_compliance",
        "tax_context",
        "retrospective",
        "location",
        "planning",
        "land",
        "improvements",
        "areas",
        "occupancy",
        "tenancy_schedule",
        "retail_metrics",
        "specialised",
        "market",
        "hbu",
        "sales_evidence",
        "rental_evidence",
        "valuation_approach",
        "income_approach",
        "cost_approach",
        "rental_determination",
        "insurance",
        "fair_value",
        "reconciliation",
        "portfolio_summary",
        "risk",
        "assumptions",
        "certification",
        "photos",
        "appendices",
        "audit_metadata"
      ]
    },
    "TemplateSection": {
      "type": "object",
      "additionalProperties": false,
      "required": ["sectionId", "include", "audience", "blocks"],
      "properties": {
        "sectionId": { "$ref": "#/$defs/SectionId" },
        "title": { "type": "string" },
        "include": { "enum": ["when_required", "always"] },
        "audience": { "enum": ["client", "internal"] },
        "blocks": { "type": "array", "items": { "$ref": "#/$defs/TemplateBlock" } }
      }
    },
    "TemplateBlock": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "text"],
          "properties": {
            "type": { "const": "heading" },
            "text": { "type": "string" },
            "level": { "enum": [1, 2, 3] }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "text"],
          "properties": { "type": { "const": "paragraph" }, "text": { "type": "string" } }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "clauseId"],
          "properties": { "type": { "const": "clause" }, "clauseId": { "type": "string" } }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "fields"],
          "properties": {
            "type": { "const": "field_table" },
            "fields": { "type": "array", "items": { "type": "string" } },
            "omitEmpty": { "type": "boolean" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type"],
          "properties": {
            "type": { "const": "calculation_trace" },
            "formulaIds": { "type": "array", "items": { "type": "string" } }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type"],
          "properties": { "type": { "const": "photo_grid" }, "columns": { "enum": [2, 3] } }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["type"],
          "properties": {
            "type": {
              "enum": [
                "sales_table",
                "market_commentary",
                "rental_table",
                "area_schedule",
                "sketch",
                "map",
                "certification",
                "audit_metadata",
                "page_break"
              ]
            }
          }
        }
      ]
    },
    "ClauseVersion": {
      "type": "object",
      "additionalProperties": false,
      "required": ["clauseId", "version", "title", "text", "status", "review"],
      "properties": {
        "clauseId": { "type": "string" },
        "version": { "type": "integer", "minimum": 1 },
        "title": { "type": "string" },
        "text": { "type": "string" },
        "status": { "enum": ["placeholder", "draft", "approved", "retired"] },
        "review": { "type": "array", "items": { "$ref": "#/$defs/SpecialistReviewer" } },
        "appliesTo": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "purposes": { "type": "array", "items": { "$ref": "#/$defs/ReportPurpose" } },
            "jurisdictions": { "type": "array", "items": { "$ref": "#/$defs/Jurisdiction" } }
          }
        },
        "approvedBy": { "type": "string" },
        "approvedAt": { "$ref": "#/$defs/Instant" }
      }
    },
    "SpecialistReview": {
      "type": "object",
      "additionalProperties": false,
      "required": ["reviewer", "userId", "at", "outcome", "notes"],
      "properties": {
        "reviewer": { "$ref": "#/$defs/SpecialistReviewer" },
        "userId": { "type": "string" },
        "at": { "$ref": "#/$defs/Instant" },
        "outcome": { "enum": ["approved", "changes_requested"] },
        "notes": { "type": "string" }
      }
    }
  }
}
```

## 3. Placeholder language

### 3.1 Syntax and allow-list

Syntax: `{{ path }}`, matched by `\{\{\s*([A-Za-z0-9_.]+)\s*\}\}`. A path is a dotted identifier.
There are **no expressions**: no operators, filters, conditionals, loops, function calls, HTML
or script. Conditional content is expressed by sections (`include`) and clause `appliesTo`, never
by template logic.

| Placeholder                                                        | Resolves to                                                                                                                                  | Missing value                                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `field.<fieldId>`                                                  | Job-level value of a field-catalogue field, formatted per §1.4, **only if the field is in the current requirements** (`requirements.fields`) | `[not provided]`; `[not applicable]` when the field is not in the current requirements |
| `job.reference`                                                    | Job reference                                                                                                                                | —                                                                                      |
| `job.purpose`, `job.propertyType`, `job.jurisdiction`, `job.scope` | Display labels from `config/codes.ts`                                                                                                        | —                                                                                      |
| `report.version`                                                   | Report version number                                                                                                                        | —                                                                                      |
| `report.issueDate`                                                 | Long issue date                                                                                                                              | `[not issued]` (drafts)                                                                |
| `firm.name`                                                        | `ReportData.firmName` (the template's `branding.firmName`)                                                                                   | —                                                                                      |
| `valuer.name`                                                      | Responsible valuer's display name                                                                                                            | empty string                                                                           |

An unknown path resolves to `[unknown]`. Only unlinted text can reach that branch (§3.2).

### 3.2 Where placeholders are resolved and linted

| Location                                                   | Resolved     | Linted by `lintTemplate` |
| ---------------------------------------------------------- | ------------ | ------------------------ |
| `heading.text`, `paragraph.text`                           | Yes          | Yes                      |
| `ClauseVersion.text`                                       | Yes          | **No** (gap G09-03)      |
| `watermarks.final`                                         | Yes          | **No** (gap G09-03)      |
| `watermarks.draft`, `branding.footerText`, `section.title` | No (literal) | No                       |

### 3.3 Lint rules (`lintTemplate`) and approval blockers (`templateApprovalBlockers`)

| #   | Problem message                                                                     | Stage           |
| --- | ----------------------------------------------------------------------------------- | --------------- |
| L1  | `branding colour must be #RRGGBB`                                                   | create, approve |
| L2  | `unknown section <id>`                                                              | create, approve |
| L3  | `duplicate section <id>`                                                            | create, approve |
| L4  | `<section>: clause <id> is not pinned`                                              | create, approve |
| L5  | `<section>: unknown field <id>` (not in the field catalogue)                        | create, approve |
| L6  | `<section>: placeholder {{<path>}} not allowed`                                     | create, approve |
| L7  | `a certification section is required`                                               | create, approve |
| B1  | `clause <id>@<v> is <status>` (any clause not `approved`)                           | approve         |
| B2  | `<ROLE> review not recorded as approved` (latest review per `requiredReviews` role) | approve         |

## 4. Governance

### 4.1 Selection (`selectTemplate`)

| Step               | Rule                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Candidate status | `approved` only. With `allowDraft` (`ALLOW_DRAFT_CONFIG`, default on outside production, refused at start-up in production) any status except `retired`.                                                                                       |
| 2 Effective dates  | `effectiveFrom ≤ date ≤ effectiveTo`. The date is the UTC date at job creation and the jurisdiction date on a selection change (gap G09-11).                                                                                                   |
| 3 Scope match      | Every present `appliesTo` list contains the job's value; `clientIds` needs the job's client.                                                                                                                                                   |
| 4 Precedence       | Highest specificity wins: client 16, jurisdiction 8, purpose 4, property type 2, scope 1. A client template therefore beats any non-client template, and so on down the list.                                                                  |
| 5 Tie-break        | Later `effectiveFrom`, then higher `version`.                                                                                                                                                                                                  |
| 6 Pinning          | The chosen version is stored on the job (`template_version_id`) at creation and again on a selection change. Jobs in progress stay pinned (J-12 step 6). A manual version picker in M-03 is **Planned — MVP · Mobile app/Web portal (S-037)**. |

Example (`report.test.ts`): for a VIC job, from generic, VIC-scoped and client-`c1` templates, VIC
is chosen; for client `c1` the client template wins; the draft seed is chosen only with `allowDraft`.

### 4.2 Approval controls

| Control                    | Enforced by                                                                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author ≠ approver (SoD-03) | `authorize('template.approve', { authorId })` → `SEPARATION_OF_DUTIES`. Re-checked in `approveTemplateVersion`.                                                                                                                                           |
| Human actor with MFA       | `template.approve` is in `HUMAN_ONLY_PERMISSIONS` and `MFA_PERMISSIONS`.                                                                                                                                                                                  |
| No PLACEHOLDER wording     | `approveClause` throws `GUARD_FAILED` when the text contains `PLACEHOLDER`, so the seed template can never be approved as shipped.                                                                                                                        |
| Required reviews           | Latest review per `requiredReviews` role is `approved` (B2).                                                                                                                                                                                              |
| Production use             | Only approved versions are selectable. At issue, `VAL-TPL-002` (approved template) and the compose problems `TPL-TEMPLATE-NOT-APPROVED`/`TPL-UNAPPROVED-CLAUSE` block issue **in every environment**: a draft template can be previewed but never issued. |
| Content provenance         | Clause wording is authored by the firm. No API template text, Rawlinsons data or AIQS publication text is reproduced unless the firm holds a licence recorded against the clause `[REVIEW: API_STANDARDS]` `[REVIEW: DATA_LICENSING]`.                    |

### 4.3 Specialist reviews by purpose

`requiredReviews` is set per template version by its author. The rule set's purpose rules name the
specialists who must clear content for each purpose (`specialistReview` on `REQ-PUR-*`). A template
whose `appliesTo.purposes` includes a purpose below must list these roles. This is not yet derived
automatically (gap G09-01).

| Purpose / content                                                                              | Required review roles                                                | Seed clause                                               |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| Every template                                                                                 | `[REVIEW: API_STANDARDS]` `[REVIEW: LEGAL]` (seed `requiredReviews`) | `certification-core`, `limitations-core`, `reliance-core` |
| `MARKET_VALUE`, `RENTAL_ASSESSMENT`                                                            | `[REVIEW: API_STANDARDS]`                                            | —                                                         |
| `CGT`                                                                                          | `[REVIEW: TAX]` `[REVIEW: API_STANDARDS]`                            | —                                                         |
| Retrospective valuations (any purpose; derived from the dates, 01 D8; `retrospective` section) | `[REVIEW: API_STANDARDS]`; the clause also lists `[REVIEW: TAX]`     | `retrospective-cutoff`                                    |
| `FAMILY_LAW`                                                                                   | `[REVIEW: FAMILY_LAW]` `[REVIEW: API_STANDARDS]`                     | `expert-declaration`                                      |
| `FINANCIAL_REPORTING`                                                                          | `[REVIEW: ACCOUNTING]` `[REVIEW: API_STANDARDS]`                     | `fair-value-disclosure`                                   |
| `INSURANCE_REPLACEMENT`                                                                        | `[REVIEW: QUANTITY_SURVEYOR]`                                        | `insurance-cost-data`                                     |
| AI-assistance disclosure                                                                       | `[REVIEW: PRIVACY]`                                                  | `ai-assistance`                                           |
| Map, planning and third-party data attribution text                                            | `[REVIEW: DATA_LICENSING]`                                           | —                                                         |

## 5. Composition rules (`composeReport`)

### 5.1 Inputs and outputs

`ReportData` = report (`id`, `version`, `status` draft/final, `issueDate?`), `firmName`, job
(`id`, `reference`, `selection`, `clientName`), `valuerName`, resolved `requirements`, field
`values`, `assets`, sales and sale analyses, rentals, `calculations`, `areaSchedules`, `sketches`,
eligible `photos`, `certification?`, `userNames` (names of the people the report refers to only:
responsible valuer, reviewer, certifying valuer, `user_ref` field values and boundary measurers),
`snapshotHash?`. `ReportModel` = `meta`
(title `<Purpose label> report`, subtitle `<asset labels> — <property type>, <jurisdiction>`,
watermark, footer, branding, template id/version, `ruleSet` as `id@version`, snapshot hash,
status), `sections`, `problems`. Composition is pure and deterministic.

### 5.2 Field rules

1. Only fields in `requirements.fields` (level `required` or `recommended`) can render. Values
   kept from an earlier selection (brief §10 AC-02) therefore never appear in a report for another
   purpose (`report.test.ts` "never renders data retained from a previous selection"). The same
   filter applies to `{{field.*}}` placeholders, which resolve to `[not applicable]` for a field
   outside the current requirements (fixed in iteration 1; see G09-02).
2. A required field with no value renders `[Not provided]` and, in a final report, raises
   `TPL-MISSING-REQUIRED` (`<label> is required`).
3. Every required `calculation_ref` value must point to an existing calculation, otherwise
   `TPL-MISSING-REQUIRED` (`calculation <id> referenced by <field> is missing`).

### 5.3 Compose problems

Problems are collected **only when `report.status = final`** and are de-duplicated by code and
message. Drafts show the in-document markers instead. `POST /v1/jobs/{jobId}/issue` refuses with
`409 REPORT_NOT_ISSUABLE` and the problem list unless it is empty.

| Code                             | Raised when                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `TPL-TEMPLATE-NOT-APPROVED`      | Template status ≠ `approved`                                                     |
| `TPL-UNAPPROVED-CLAUSE`          | A rendered clause ≠ `approved`                                                   |
| `TPL-MISSING-REQUIRED`           | §5.2 rules 2–3                                                                   |
| `TPL-AREA-NOT-REPORTABLE`        | A rendered area schedule has `reportable = false`                                |
| `TPL-NO-CERTIFICATION`           | A `certification` block renders with no signed certification                     |
| `TPL-SECTION-MISSING` (proposed) | A section in `requirements.sections` has no section in the template (gap G09-05) |

### 5.4 Area schedule table

One table per reporting schedule. Title: `Improvement areas[ — <asset> when multi-asset] (<basis>)`.
Columns: Level, Component, Use, Gross, Deductions, Net, Source, Confidence, Measured by, Date. Rows:
one per component (Use carries ` (excluded)` when not counted by the convention), then one
`Level total` row per level, then a `Total improvement area` row whose Net column is
`totalIncludedM2`. Note: `Scale: <status>. Schedule <first 12 hex of scheduleHash>.` Computation
and approval are in spec 10 §6 and §9.

### 5.5 Sketch images

The seed template (`DEFAULT_TEMPLATE`) has **no `sketch` block**: the valuer's sketch is working
notes (01 D11). Its `areas` section renders the field table, the `area_schedule` table and clause
`area-disclaimer`, and is included only when the requirements switch it on (e.g.
`INSURANCE_REPLACEMENT`, `INDUSTRIAL`, `SPECIALISED_MIXED_USE`; residential reports state
`improvements.buildingArea` in the `improvements` section instead). The `tax_context` section
renders only its field table; clause `retrospective-cutoff` belongs to the `retrospective` section.
A firm template may add a `sketch` block; the rules below then apply.

The reporting sketch for an asset is the **latest version** of the sketch referenced by the asset
field `improvements.areaSchedule`. A sketch with `includeInClientReport = false` (a working sketch)
is omitted from client output, but its version, schedule and approval stay in the database and
in the issue snapshot (`reportData.sketches`). Caption:
`Sketch v<N> — north <bearing>° | — north point not recorded (not to scale; not a survey)`. Render
assets include only `accepted` and `closed` boundaries.

### 5.6 Photos (eligibility, applied in `reportDataOf`)

| Rule              | Detail                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selected          | `includeInReport = true`                                                                                                                                                                       |
| Privacy           | `privacyStatus` is `clear`, `consent_recorded`, or `redacted` with a `redactedPhotoId`. The redacted derivative is what renders. `VAL-PHOTO-001` blocks unresolved photos. `[REVIEW: PRIVACY]` |
| Quality           | Blurry or low-light photos are excluded unless a `qualityOverrideReason` is recorded                                                                                                           |
| Order and caption | By `sequence`; caption = `caption` ?? `roomOrArea` ?? `Photograph`                                                                                                                             |

### 5.7 Certification block

Rows: Valuer; Credentials; API member number (if recorded); the state registration where the
job's state requires one, labelled `Queensland registered valuer number` or `Western Australian
licensed valuer number` (`VALUER_REGISTRATION_RULES`); Role; Inspection scope (statement); Date of
valuation; Basis of value; Value, Market rent or Sum insured (by `amount.kind`, AUD); Independence;
Conflicts; Assumptions; Special assumptions (`None` if empty); Limitations; Standards relied on;
Signed (`<name> (<Typed attestation | E signature>) on <date>`). The identity rows come from the
valuer's profile at the moment of signing (01 D13), not from the request.

Signature block (from `pdf-renderer@3`): when the certification carries `signatureSha256`, the
block is followed by an image block `{ kind: 'image', ref: { type: 'signature', id: <sha256> } }`.
The renderer draws the signature recorded at signing (`renderAssets.signatures[sha256]`): a drawn
signature is embedded as a PNG scaled to fit 180 × 60 pt with its aspect ratio kept; a typed
signature is the typed name in Helvetica-Oblique (up to 22 pt, smaller if needed to fit 180 pt).
Under it: a 0.6 pt grey signature line, the caption `Signature of <name>` (8 pt italic grey) and
`Signature fingerprint (SHA-256) <hash>` (6.5 pt grey). If the signature is missing from the
assets, a grey note says it is recorded with the certification but not available to render. The
signature image shows who signed; it is not a cryptographic e-signature (S-070). Validation rule
`VAL-CERT-003` (blocking at submit and issue) refuses a QLD or WA certification without the
valuer's registration for that state `[REVIEW: API_STANDARDS]`.
Wording around the block comes from `certification-core` `[REVIEW: API_STANDARDS]` `[REVIEW: LEGAL]`.
Validation rule `VAL-CERT-002` (blocking at submit and issue, not acknowledgeable) refuses a
certification whose amount, basis of value or valuation date differs from the report's adopted
figure (`valuation.adoptedValue`, `rent.adoptedMarketRent` or `ins.sumInsured`, summed over assets),
`instruction.basisOfValue` and `dates.valuation`, so the block cannot contradict the body.
Software never signs (G2). Only the latest certification is rendered. Co-signatory statements are
**Planned — MVP (S-054)** (gap G09-06).

## 6. PDF rendering contract (`pdf-renderer@3`, `apps/api/src/services/pdf.ts`)

| Aspect                       | Contract (Implemented unless marked)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page                         | A4 portrait, 595.28 × 841.89 pt. Margins: 50 pt left, right and top; content stops 60 pt above the bottom edge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Typography                   | Standard Helvetica, Helvetica-Bold, Helvetica-Oblique (not embedded). Body 9.5 pt / 1.35 leading. Headings bold in the accent colour: H1 15 pt with a 0.8 pt rule, H2 12.5 pt, H3 10.5 pt. Key-value 9 pt (label column 34 %, bold). Tables 7.2 pt. Notes 7.5–8 pt italic grey.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Cover (page 1)               | Firm name (13 pt, accent), title (24 pt), subtitle (12 pt grey), then Report (`id (version N)`), Status (`Final` / `Draft — not for reliance`), Template, Rule set and Snapshot (content hash, final only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sections                     | The cover is page 1; sections then **flow continuously** from page 2 (renderer v2). Each section opens with an H1 title; a section after the first moves to a new page only when less than 140 pt remains, so a heading is never left at the foot of a page without content. Blocks render in order. `page_break` forces a new page.                                                                                                                                                                                                                                                                                                                                                |
| Paragraph styles             | `normal` regular black; `note` italic 8 pt grey; `placeholder` italic grey (clauses under review, `[Certification not yet signed]`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Tables                       | Column widths (renderer v2): every column first gets the width of its longest word (bold for the header, regular for cells) plus 3 pt padding each side, so words are never split; the remaining width is shared in proportion to how much more text each column holds, with a column's desired width capped at 45 % of the text width. Only if those minimum widths alone exceed the text width are all columns scaled down proportionally (long words can then be hard-broken). The header row is shaded. Rows are separated by 0.3 pt rules. **The header repeats** when a table continues on a new page. Rows are never split; a row taller than a page overflows (gap G09-12). |
| Wrapping                     | Word wrap by measured width; `\n` starts a paragraph; a word longer than the available width (body text, key-value cells, or a table squeezed as above) is hard-broken.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sanitisation                 | WinAnsi only (`makeSanitiser`, shared with the invoice). Replacements: `Σ`→`sum of `, `−` (U+2212)→`-`, `≈`→`~`, `≠`→`!=`, `≥`→`>=`, `≤`→`<=`, `×`→`x`, `÷`→`/`, `→`→`->`, tab → space. Any other character the font cannot encode becomes `?`, so names outside Latin-1 (e.g. `ā`) still degrade (gap G09-07).                                                                                                                                                                                                                                                                                                                                                                     |
| Watermark                    | Every page including the cover: 34 pt bold, accent colour, opacity 0.09, rotated 40°, origin (90, 230). Draft: literal `watermarks.draft`. Final: resolved `watermarks.final`, carrying version and issue date.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Running header               | Firm name, 7 pt grey, top-left of every page after the cover.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Footer                       | `<footerText> · <job reference> · <report id> v<version> · <first 12 hex of content snapshot hash>` (hash for final reports only), 7 pt grey, up to two lines. `Page x of y` right-aligned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sketch drawing               | Box 260 pt high, full text width. Points × `metresPerUnit`, uniform fit-to-box with 24 pt padding (aspect preserved). Fill per level from a four-colour palette. Components: 0.9 pt black outline. Deductions: white fill, 0.6 pt grey **dashed** [3, 2] outline. Label at each polygon centroid (7 pt). North arrow and `N` top-right when `northBearingDeg` is known. Bottom-left: `Scale status: <s>. Levels: <list>. Dashed outlines are deductions.` All levels share one drawing (gap G09-13); details in spec 10 §10.                                                                                                                                                        |
| Photos                       | Placeholder box (110 pt): `Photograph <id> — retained in the evidence store` plus its SHA-256. Image embedding is **Planned — MVP (S-034, S-044)**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Map                          | Box (70 pt) listing the first four assets' coordinates; caption appends "Map imagery is not embedded unless the provider licence permits reproduction." Licensed map rendering with attribution is **Planned — MVP (S-036)** `[REVIEW: DATA_LICENSING]`. Portfolios with more than four assets are truncated (gap G09-14).                                                                                                                                                                                                                                                                                                                                                          |
| Signature (renderer v3)      | §5.7: drawn PNG fitted to 180 × 60 pt, or the typed name in italic; signature line, caption and SHA-256 fingerprint. Drawn PNGs are checked at `PUT /v1/me/profile` (PNG data URL ≤ 200,000 characters that decodes and embeds), so issue does not fail on a bad image.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Metadata                     | Title `<title> — <reportId> v<version>`, Author firm name, Subject subtitle, Producer `pdf-renderer@3` (`RENDERER_VERSION`), Creator `Valuation Platform`, Creation and Modification dates = `renderedAt`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Determinism                  | No clock, randomness or network I/O inside the renderer. `updateMetadata: false`, `useObjectStreams: false`, standard fonts; the only embedded images are drawn signatures, which travel in the snapshot as PNG data URLs and are embedded deterministically. At issue, `ReportData`, `TemplateVersion` and `RenderAssets` are **JSON round-tripped** before rendering, so the PDF comes from exactly what is stored; `renderedAt = issuedAt`. Drafts use the current time and are neither stored nor reproducible.                                                                                                                                                                 |
| Accessibility                | Not tagged; no `/Lang`, no alt text, no PDF/UA. Reading order follows drawing order. Tagged PDF (best effort) is **Planned — Pilot (01 Q-19)**. The renderer makes no accessibility claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Image embedding (when built) | Redacted derivative only. EXIF stripped (A-21). Deterministic re-encoding. Bytes referenced by hash in the snapshot and fetched from object-locked storage. Map tiles only where the data-source licence permits reproduction, with attribution `[REVIEW: DATA_LICENSING]`.                                                                                                                                                                                                                                                                                                                                                                                                         |

## 7. Invoice document (`invoice-renderer@1`, `apps/api/src/services/invoice.ts`)

| Element             | Current behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger             | Built inside the issue transaction from `job.fee_cents` (`422 FEE_REQUIRED` if absent) and only when the organisation ABN is recorded (`422 SUPPLIER_ABN_REQUIRED`). Stored append-only in `invoice` with its PDF and SHA-256. Audit: `invoice.created`.                                                                                                                                                                                          |
| Number              | `INV-<issue year>-<5-digit number>` from the `invoice_counter` row for the organisation and year, incremented atomically in the issue transaction (`INSERT … ON CONFLICT (org_id, year) DO UPDATE … RETURNING`, migration 0003), so concurrent issues get distinct numbers and a rolled-back issue does not consume one. `UNIQUE (org_id, number)` remains as a backstop.                                                                         |
| Parties             | Supplier = template `branding.firmName` with the organisation ABN (required). Bill to = client name with the client ABN when one is recorded. Both ABNs are printed.                                                                                                                                                                                                                                                                              |
| Lines               | One line: `invoiceDescription` (default `Professional valuation services`) for the full fee. Per-asset lines and disbursements (01 D6) are **Planned — MVP · Web portal (S-058)**.                                                                                                                                                                                                                                                                |
| GST                 | `gstCents = roundHalfAwayFromZero(subtotalCents × GST_RATE)` to whole cents. `total = subtotal + GST`. `GST_RATE` comes from the environment (default 0.1, range 0–1). Example (lifecycle test): $880.00 + GST $88.00 = $968.00. GST is applied whether or not the supplier is GST-registered (gap G09-09).                                                                                                                                       |
| Layout              | A4; `TAX INVOICE` heading (20 pt bold); supplier and ABN; invoice number and date; bill-to and ABN; job and report references; line amounts and Subtotal (excl. GST), GST (n %), Total (incl. GST) right-aligned. Fixed metadata as in §6 (Producer `invoice-renderer@1`). All text passes through the report sanitiser (§6), so a non-WinAnsi character degrades instead of failing the issue; the line description is not wrapped (gap G09-10). |
| Tax-invoice content | Which elements are needed, and when (e.g. the words "tax invoice", supplier identity and ABN, date, description, GST amount, recipient identity above the threshold then in force) must be confirmed `[REVIEW: TAX]`. GST rounding at line or invoice level must also be confirmed `[REVIEW: TAX]` `[REVIEW: ACCOUNTING]` (01 D6 says invoice total).                                                                                             |
| Corrections         | Credit notes only, never edits (01 D6). **Planned — Pilot (S-071)**. The table is already append-only.                                                                                                                                                                                                                                                                                                                                            |

## 8. Versioning, change control and tests

| Item             | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer version | `RENDERER_VERSION` (currently `pdf-renderer@3`; v2 introduced continuous section flow and word-preserving table columns; v3 draws the valuer's signature block and adds `renderAssets.signatures`) is bumped whenever output bytes change. It is stored in the snapshot (`renderer`) and in PDF Producer. Issued bytes are the record; a re-render is verification (R-07).                                                                                                                                                                                                        |
| Reproduction     | `POST /v1/reports/{reportId}/reproduce` (needs `job.read` on the job, so client users cannot run it) checks the snapshot hash, re-renders the PDF and invoice from the snapshot at `issuedAt` with the current renderer, and recomputes email payload hashes. It returns `renderer { snapshot, current, match }`, per-artefact `match` and `reproducible`, which is `false` whenever `snapshot.renderer` differs from `RENDERER_VERSION`. Superseded renderer versions are not retained, so after a bump older reports report the mismatch but cannot be re-derived (gap G09-15). |
| Snapshot         | `issue-snapshot@1`: `renderer`, `issuedAt`, `issueDate`, `contentHash` (content snapshot), `reportData`, `template`, `renderAssets` (including the signature image or typed name, keyed by its SHA-256), `invoice`, `emails` (attachment hashes, not bytes). `report.snapshot_hash` = canonical SHA-256 of this object. The PDF footer prints the **content** hash prefix. The DB forbids any change except `issued → superseded`.                                                                                                                                                |
| Template change  | Always a new version, approved through §4.2. Jobs keep their pinned version. Fixture regression diff in W-18 (J-12 step 3) is **Planned — MVP · Web portal (S-059)**.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Amendment        | `issued → active` (`/amend`); a new report version follows the full workflow and supersedes the old one on issue (**Pilot, S-084**).                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Tests. Implemented: `packages/domain/test/report.test.ts` (seed lint-clean but not approvable;
placeholder refusal; author ≠ approver; unknown placeholder and field rejection; selection
precedence; section order; retained-data exclusion; problem codes; draft watermark; missing
required; determinism) and `apps/api/test/lifecycle.test.ts` (unapproved recipients refused;
issue with GST 8 800 / total 96 800 cents; `%PDF-` download; reproduce `match: true`; immutable
report and frozen sketch rows) and `apps/api/test/profile.test.ts` (QLD report: signing refused
without the QLD registration; issued PDF text contains the API member number and registration
number and embeds the drawn signature image; reproduce `match: true`). Planned (12 §TC-PDF-001…006): golden SHA-256 per fixture and
renderer version checked into the repo, where a hash change without a `RENDERER_VERSION` bump
fails CI; per-section visual golden images (TC-PDF-005); text-extraction assertions for watermark,
footer and `Page x of y`; table header repetition over page breaks; sanitisation of non-WinAnsi
input in report and invoice; `{{field.*}}` resolving to `[not applicable]` outside the
requirements; `integer` and `area_schedule_ref` formatting; GST rounding at half-cent boundaries;
JSON Schema conformance of every stored template. TC-PDF-003 says "embeds all fonts", which conflicts with today's
non-embedded standard fonts; reconcile when fonts are pinned (S-056).

## 9. Gaps found in the code

| ID     | Gap                                                                                                                                                                                                                                                                                                                    | Proposed fix                                                                                                        | Release           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- |
| G09-01 | `requiredReviews` is not derived from `appliesTo.purposes` or clause `review` roles, and `approveClause` ignores the clause's own `review` list.                                                                                                                                                                       | Approval blocker: union of purpose roles (§4.3) and clause roles must each have an approved review.                 | MVP (S-059)       |
| G09-02 | **Partly fixed in iteration 1:** `{{field.*}}` now resolves only fields in `requirements.fields` (otherwise `[not applicable]`), so retained data cannot leak. Still open: only job-level fields can be referenced.                                                                                                    | Support `field.<id>@asset` per asset section.                                                                       | MVP (S-056)       |
| G09-03 | Clause text and `watermarks.final` are resolved but not linted.                                                                                                                                                                                                                                                        | Extend `lintTemplate` (L6) to clauses and watermarks.                                                               | MVP               |
| G09-04 | No `client.name` placeholder for the "Issued to <client>" watermark.                                                                                                                                                                                                                                                   | Add `client.name` to the allow-list.                                                                                | MVP               |
| G09-05 | A required section missing from the template is silently not rendered.                                                                                                                                                                                                                                                 | `TPL-SECTION-MISSING` compose problem.                                                                              | MVP               |
| G09-06 | `field_table.omitEmpty` and `photo_grid.columns` are ignored. Co-signatory certifications are not rendered. Audit metadata lacks the QA approver, exception, renderer version and issue-snapshot hash (J-10 step 2). (`area_schedule_ref` fields now render as `Sketch vN: X m² total (basis)`: fixed in iteration 1.) | Implement or remove the options; add the missing rows.                                                              | MVP (S-056/S-057) |
| G09-07 | **Partly fixed in iteration 1:** the replacement map now covers `Σ`, `−`, `≈` and `≠`. Still open: names and text outside Latin-1 (e.g. `ā`) degrade to `?`.                                                                                                                                                           | Embed a pinned Unicode font per template version.                                                                   | MVP (S-056)       |
| G09-08 | No DB trigger keeps `approved`/`retired` template versions immutable.                                                                                                                                                                                                                                                  | Trigger like `sketch_version_guard`.                                                                                | MVP               |
| G09-09 | Invoice: GST applied regardless of registration; single line only. (ABNs: **fixed in iteration 1**: supplier ABN required at issue and printed; client ABN printed when recorded.)                                                                                                                                     | Organisation tax profile (GST-registered); per-asset lines `[REVIEW: TAX]`.                                         | MVP (S-058)       |
| G09-10 | Long invoice descriptions are not wrapped (`invoiceDescription` has no length limit) and can run off the page. (Sanitisation: **fixed in iteration 1**: invoice text uses the report sanitiser, so a non-WinAnsi character no longer makes the issue fail.)                                                            | Reuse the report wrapping; bound the description length.                                                            | MVP               |
| G09-11 | Template date at creation is the UTC date, not the jurisdiction date. No effective-date overlap check at approval (J-12 E2). No retire endpoint.                                                                                                                                                                       | Use `jurisdictionToday`; add an overlap blocker; add retire.                                                        | MVP (S-059)       |
| G09-12 | Table rows and key-value rows taller than a page overflow the bottom margin.                                                                                                                                                                                                                                           | Split rows across pages.                                                                                            | MVP               |
| G09-13 | All sketch levels are drawn overlaid in one box; there is no scale bar or legend table. Affects only firm templates that add a `sketch` block (the seed template has none, 01 D11).                                                                                                                                    | One drawing per level plus a legend (spec 10 §10).                                                                  | MVP (S-056)       |
| G09-14 | Map placeholder lists at most four assets.                                                                                                                                                                                                                                                                             | Paginate the portfolio location table.                                                                              | MVP               |
| G09-15 | **Partly fixed in iteration 1:** reproduce compares `snapshot.renderer` with `RENDERER_VERSION`, reports `renderer.match` and returns `reproducible: false` on a mismatch. Still open: superseded renderer versions are not retained, so older reports cannot be re-rendered byte for byte.                            | Keep every issued renderer version runnable (renderer registry, pinned `pdf-lib`) and dispatch to the recorded one. | MVP (S-057)       |
