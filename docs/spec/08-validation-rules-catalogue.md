# 08 — Validation and rules catalogue

> Status: **Draft for review** · Owner: Product architecture with the standards owner · Applies to: validation engine (`packages/domain/src/validation`), workflow guards, report composition

The authoritative list of rules is generated from code: **[`generated/validation-catalogue.md`](generated/validation-catalogue.md)**.
This section explains how the rules work, how they combine with workflow guards and composition checks,
and which interpretations still need specialist review.

## 1. Engine

```ts
runValidation(ctx: ValidationContext): ValidationResult
// ctx: stage, now, jurisdiction time zone, selection, resolved requirements, captured values,
//      provenance, data sources, sales/rentals + analyses, calculations, commentary,
//      area schedules + approvals, photos, AI suggestions, risk flags, certification, QA review,
//      rule-set/template status, acknowledgements, thresholds
```

- Rules are pure functions over a fully loaded job (`apps/api/src/services/aggregate.ts` builds the
  context; the mobile app will build the same context from its local store).
- Each rule has a stable **code** (`VAL-<CATEGORY>-NNN`), **severity** (`blocking` | `warning`),
  **stages** (`draft`, `submit`, `issue`), and is **acknowledgeable** only if it is a warning.
- A **finding** carries the rule code, a stable **path** (`job/field:dates.valuation`,
  `asset:<id>/sale:<id>`, `calc:<id>` …) and a message.
- **Acknowledgements** (`POST /v1/jobs/{id}/acknowledgements`) record who accepted a warning, when and
  why (≥ 10 characters). They are keyed by code + path and are part of the certified content snapshot.
  Blocking findings can never be acknowledged — they must be fixed.
- Each run is stored (`validation_run`) and audited (`validation.run`).

## 2. Stage gates

| Gate                          | Requires                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submit for QA (`submitForQa`) | Stage `submit`: 0 blocking findings, 0 unacknowledged warnings; certification signed by the responsible valuer for the current snapshot                                                                                 |
| QA approve (`approve`)        | As above, plus checklist complete, no open findings, review of the current snapshot by the assigned reviewer                                                                                                            |
| Issue (`issue`)               | Stage `issue`: adds `VAL-TPL-001` (approved rule set), `VAL-TPL-002` (approved template), `VAL-CERT-001`, `VAL-QA-001`; approved snapshot unchanged; composition problems empty (§4); recipients approved; fee recorded |

The brief's MVP criterion "a report cannot be issued with unresolved blocking validations, absent
certification or incomplete QA" is enforced in three independent places: the validation rules, the
workflow guards (`packages/domain/src/workflow/job-workflow.ts`) and the report composer.

## 3. Coverage of the brief's validation list (brief §7 step 6)

| Brief requirement                   | Rules                                                                                                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing mandatory fields            | `VAL-REQ-001` (blocking), `VAL-REQ-002` (recommended, warning), `VAL-SEL-001/002`                                                                                                                                                                                          |
| Inconsistent dates                  | `VAL-DATE-001` (future valuation date needs a special assumption), `-002` (inspection in future / after issue), `-003` (research cut-off), `-007` (cut-off after valuation date), `-008` (retrospective purpose with current date), `-009` (inspection before instruction) |
| Retrospective information control   | `VAL-DATE-004` (commentary after cut-off, blocking), `-005` (hindsight evidence without a check-only reason, blocking), `-006` (check-only evidence, warning) `[REVIEW: TAX]`                                                                                              |
| Inconsistent areas                  | `VAL-AREA-001` (schedule not reportable), `-002` (not approved or changed since approval), `-003` (geometry warnings incl. supplied/online area variance and floor totals), `-004` (site coverage > 100%)                                                                  |
| Stale data                          | `VAL-STALE-001` (sales older than 12/24 months), `VAL-STALE-002` (external data older than its source freshness period)                                                                                                                                                    |
| Unsupported conclusions             | `VAL-CALC-002` (adopted value or implied rate outside adjusted indications), `VAL-CALC-003` (calculation trace no longer reproduces), `VAL-CALC-004` (override without reason)                                                                                             |
| Outlier rates                       | `VAL-CALC-001` (Tukey fences, k = 1.5, ≥ 4 observations)                                                                                                                                                                                                                   |
| Inadequate evidence                 | `VAL-EVID-001` (fewer than 3 comparables), `VAL-PROV-002` (unverified evidence)                                                                                                                                                                                            |
| Unresolved limitations / escalation | `VAL-RISK-001` (open escalation), `VAL-SCOPE-001` (desktop/kerbside/restricted with high-severity flags and no escalation decision) `[REVIEW: API_STANDARDS]`                                                                                                              |
| Provenance and licensing (brief §1) | `VAL-PROV-001` (source, retrieval time, effective date, licence basis), `VAL-PROV-003` (licence prohibits reproduction or has expired) `[REVIEW: DATA_LICENSING]`                                                                                                          |
| AI governance (brief §5)            | `VAL-AI-001` (undecided suggestions block submission)                                                                                                                                                                                                                      |
| Privacy (brief §5)                  | `VAL-PHOTO-001` (sensitive content unresolved), `VAL-PHOTO-002` (poor-quality photo without reason) `[REVIEW: PRIVACY]`                                                                                                                                                    |
| Independence                        | `VAL-INDEP-001` (conflict check declined the engagement)                                                                                                                                                                                                                   |
| Purpose-specific                    | `VAL-FR-001` (hierarchy level inconsistent with significant inputs) `[REVIEW: ACCOUNTING]`; `VAL-RENT-001` (incentive or effective-rent implausible); `VAL-INS-001` (cost data source lacks edition/locality) `[REVIEW: QUANTITY_SURVEYOR]`                                |

## 4. Other rule families

These are enforced outside the validation engine but follow the same "block, explain, audit" pattern.

| Family        | Codes                                                                                                                                                                                                                                                                                                                                       | Where                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Geometry      | `GEO-SCALE-MISSING`, `GEO-SCALE-UNVERIFIED`, `GEO-OPEN-SHAPE`, `GEO-INVALID-POLYGON`, `GEO-PENDING-REVIEW`, `GEO-OVERLAP`, `GEO-DEDUCTION-OUTSIDE`, `GEO-DEDUCTION-PARTIAL`, `GEO-IMPLAUSIBLE-DIMENSION`, `GEO-IMPLAUSIBLE-AREA`, `GEO-SUPPLIED-VARIANCE`, `GEO-FLOOR-TOTAL-MISMATCH`, `GEO-CONVENTION-BASIS-MISMATCH`, `GEO-NO-COMPONENTS` | `computeAreaSchedule` — see `10-sketch-and-measurement.md` |
| Composition   | `TPL-TEMPLATE-NOT-APPROVED`, `TPL-UNAPPROVED-CLAUSE`, `TPL-MISSING-REQUIRED`, `TPL-AREA-NOT-REPORTABLE`, `TPL-NO-CERTIFICATION`                                                                                                                                                                                                             | `composeReport` — issue is refused unless empty            |
| Selection     | `SEL-001` … `SEL-009`                                                                                                                                                                                                                                                                                                                       | Rule set (`generated/requirement-rules.md`)                |
| Field values  | type checks per field definition (`fieldValueProblem`) → HTTP 422 `INVALID_FIELD_VALUE`                                                                                                                                                                                                                                                     | `PUT /v1/jobs/{id}/fields`                                 |
| Calculations  | input bounds, unit compatibility, override reason ≥ 15 characters                                                                                                                                                                                                                                                                           | `runCalculation`, `overrideCalculation`                    |
| AI            | allow-listed room types and visible attributes; prohibited inference categories (concealed construction, operational condition, brand, compliance, dimensions, defects) → `AI_INFERENCE_PROHIBITED`                                                                                                                                         | `createAiSuggestion`                                       |
| Workflow      | guard failures returned as `details.failures` with HTTP 409                                                                                                                                                                                                                                                                                 | `checkTransition` / `transitionJob`                        |
| Authorisation | `NO_ROLE_GRANT`, `NOT_ASSIGNED`, `RESTRICTED_PORTFOLIO` (404), `CLIENT_SCOPE`, `SEPARATION_OF_DUTIES`, `HUMAN_REQUIRED`, `MFA_REQUIRED`                                                                                                                                                                                                     | `authorize` — denials audited as `auth.denied`             |

## 5. Configuration

Thresholds live in `ValidationConfig` (`DEFAULT_VALIDATION_CONFIG`): minimum comparables (3), sale
staleness (12 / 24 months), outlier k (1.5), adopted-range tolerance (5%), and whether approved rule
sets and templates are required at issue (always true in production). Firms will configure these per
organisation and purpose in a later iteration; changes will be versioned with the rule set.

## 6. Adding or changing a rule

1. Add the rule to `VALIDATION_RULES` with a **new** code (never renumber or reuse codes).
2. Add tests for the passing and failing cases (`packages/domain/test/validation.test.ts`).
3. Run `pnpm docs:generate`; the catalogue table is regenerated and CI checks it is current.
4. If the rule encodes a professional-standard, legal, tax, accounting or licensing interpretation,
   add a `review` tag and record the reviewer's sign-off before release.

## 7. Items requiring specialist review

| Rule                   | Interpretation to confirm                                              | Reviewer                                                  |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `VAL-DATE-004/005/006` | Treatment of post-valuation-date evidence as a check only              | `[REVIEW: TAX]`, `[REVIEW: API_STANDARDS]`                |
| `VAL-SCOPE-001`        | Escalation triggers making limited scope unsuitable                    | `[REVIEW: API_STANDARDS]`                                 |
| `VAL-FR-001`           | Hierarchy categorisation at the lowest significant input level         | `[REVIEW: ACCOUNTING]`                                    |
| `VAL-INS-001`          | Minimum identification of licensed cost data (edition, locality, date) | `[REVIEW: QUANTITY_SURVEYOR]`, `[REVIEW: DATA_LICENSING]` |
| `VAL-PROV-003`         | Which licences permit reproduction in client reports                   | `[REVIEW: DATA_LICENSING]`                                |
| `VAL-PHOTO-001`        | Consent vs redaction policy (children never released on consent alone) | `[REVIEW: PRIVACY]`                                       |
