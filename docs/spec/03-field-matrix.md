# 03 — Report purpose × property type × inspection scope field matrix

> Status: **Draft for review** · Owner: Standards owner (configuration) / Product architecture · Applies to: rule sets, forms, validation, report sections · `[REVIEW: API_STANDARDS]`

The first workflow step selects **jurisdiction, report purpose, property type, inspection scope and
asset mode** (brief §2). That selection drives the required fields, warnings, calculations, evidence
tests, certification wording and report sections. This section explains how; the authoritative tables
are generated from the rule set that the software enforces:

| Generated table                                                                          | Content                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`generated/field-matrix.md`](generated/field-matrix.md)                                 | Required-field counts per purpose × type; field-by-field matrices per purpose; scope, jurisdiction and mode deltas; fields required for every job              |
| [`generated/requirement-rules.md`](generated/requirement-rules.md)                       | Every requirement rule and selection rule with its conditions, fields, sections, warnings and specialist reviewers                                             |
| [`generated/field-catalogue.md`](generated/field-catalogue.md)                           | The input tabs, then all 188 catalogued fields with tab, section, level (job/asset), type, options, entry (`system`), personal-information flag and review tag |
| [`generated/formulas-conventions-clauses.md`](generated/formulas-conventions-clauses.md) | Formulas made available by the rules, measurement conventions and clause seeds                                                                                 |

## 1. How the matrix is expressed

The matrix is **configuration, not code**. A rule set (`packages/domain/src/config/rule-set.ts`) is a
versioned document of rules of the form:

```ts
{
  id: 'REQ-RETRO-001',
  when: { retrospective: true },        // any of: purposes, propertyTypes, scopes, jurisdictions,
                                        // modes, fields (value conditions), retrospective (derived)
  require: ['retro.evidenceBasis'],
  recommend: ['dates.retrospectiveDataCutOff', 'retro.chronology'],
  sections: ['retrospective'],
  warnings: [{ code: 'W-RETRO-HINDSIGHT', message: '…', review: 'API_STANDARDS' }],
  specialistReview: ['API_STANDARDS'],
  formulas: [...],
}
```

`resolveRequirements(selection, ruleSet, values)` unions every matching rule:

- **required beats recommended**, and the result records which rules produced each requirement
  (traceability to the rule set version);
- **field-value conditions** (`when.fields`) are evaluated per asset, so a requirement can apply to
  some assets in a portfolio and not others (e.g. lease facts only for leased assets);
- **`retrospective`** is derived from the dates, never selected: a valuation of any purpose is
  retrospective when `dates.valuation` is earlier than `dates.inspection` (or `dates.instruction`
  when there is no inspection). The resolver returns it as `retrospective` and matches rules on it
  (01 D8) `[REVIEW: API_STANDARDS]`;
- **selection rules** add blocking or warning issues for combinations (e.g. `SEL-001` blocks
  insurance replacement cost for vacant land; `SEL-006` warns that WA family-law matters are generally
  heard by the Family Court of Western Australia `[REVIEW: FAMILY_LAW]`);
- **sections** are returned in report order, so the PDF template renders only what applies.

The same pure function runs on the device (offline), in the web portal and in the API, so all three
always agree.

The resolved fields are presented on **input tabs** (`INPUT_TABS`, 01 D10): Job, Property,
Inspection, Sales & market, Valuation and Review. Every report section belongs to exactly one tab,
so a job shows only the fields its requirements switch on, grouped where the valuer works on them.
Fields marked `entry: 'system'` (responsible valuer, QA reviewer, due date, instruction date,
coordinates) are filled by the platform and shown read-only. The tab of every field is listed in
[`generated/field-catalogue.md`](generated/field-catalogue.md).

## 2. Layers of the matrix

| Layer                     | Rules                                                                                         | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base (every job)          | `REQ-BASE-001/002`                                                                            | Required: client, intended users and use, basis of value, interest valued, conflict check, responsible valuer, engagement documents, instruction and valuation dates, address, title reference. Recommended: due date, QA reviewer, registered proprietor, council, coordinates, assumptions and limitations. The client is the instructing party; reliance, confidentiality and standard limitations come from approved template clauses (01 D9)                                                                                                                                                                                                                                                                                                                                                      |
| Inspection scope          | `REQ-SCOPE-*`                                                                                 | FULL: inspection date and areas inspected. KERBSIDE/RESTRICTED: areas not inspected, obstruction notes, internal-condition assumption, access attempts, escalation decision. DESKTOP: data-source register, imagery dates, information gaps, confidence statement, escalation decision; inspection date not required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Report purpose            | `REQ-PUR-*`                                                                                   | Market value; CGT (the CGT event, aligned to ATO minimum report content `[REVIEW: TAX]`); family law (expert matters `[REVIEW: FAMILY_LAW]`); financial reporting (AASB 13 inputs, configurable `[REVIEW: ACCOUNTING]`); rental assessment; insurance replacement cost `[REVIEW: QUANTITY_SURVEYOR]`. National, state and local market commentary (`market.national`, `market.state`, `market.local`) are required for market value, CGT, family law, financial reporting and rental assessment, and recommended (with the `market` section) for insurance replacement cost. The firm's approved library offers them by property type and location: national and state as at the valuation date, local as at the day the report is prepared for a current valuation (01 D17) `[REVIEW: API_STANDARDS]` |
| Retrospective (derived)   | `REQ-RETRO-001`, `SEL-007`                                                                    | Any purpose with a valuation date before the inspection (or instruction) date: how the property and market at the valuation date were established; information cut-off date and key events since (recommended); `retrospective` section; hindsight warning `[REVIEW: API_STANDARDS]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Property type — physical  | `REQ-PT-*-001`                                                                                | Description and areas for vacant land, residential (building area entered directly; the sketch is working notes, 01 D11), commercial (office/retail), industrial, specialised; apply to every purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Property type — analytics | `REQ-PT-VAL-LAND-001`, `REQ-PT-*-002`                                                         | Site/planning/occupancy, income analytics (tenancy schedule, WALE, cap rate, leasing evidence) only for value purposes, so an insurance assessment of an office does not demand a WALE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Captured values           | `REQ-OCC-001`, `REQ-INT-001`, `REQ-APP-*`, `REQ-UNC-001`, `REQ-BASE-002`, `REQ-SCOPE-ESC-001` | Leased → lease facts; DCF selected → discount rate and terminal yield; capitalisation → market income and cap rate; disclosed conflict → disclosure; proceeding without escalation → justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Asset mode                | `REQ-MODE-PF-001`                                                                             | Portfolio aggregation basis and summary schedule `[REVIEW: API_STANDARDS]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Jurisdiction              | `REQ-JUR-*`, `SEL-005`, `SEL-006`                                                             | VIC planning property report and NSW planning certificate recommended; QLD planning scheme; ACT Crown leasehold check; WA family-law court check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## 3. Changing the selection without losing data

Changing purpose, property type, jurisdiction, scope or mode (`PATCH /v1/jobs/{id}/selection`):

1. never deletes a captured value;
2. returns a diff: newly required fields, fields no longer required, sections added/removed, and
   **retained values** — data captured for the previous selection that is now outside the
   requirements;
3. retained values are excluded from the report (the composer renders only fields that the current
   requirements switch on), and re-appear automatically if the selection changes back;
4. is audited as `job.selection_changed` with the reason, before/after selection and the diff summary;
5. re-selects the most specific approved template for the new selection.

This satisfies the MVP criterion "changing purpose, property type, jurisdiction or inspection scope
immediately changes required fields and report sections without losing prior data" and is covered by
`packages/domain/test/requirements.test.ts` and `apps/api/test/jobs-and-sync.test.ts`.

## 4. Versioning and approval

- Rule sets are versioned (`id`, `version`, `status`, `effectiveFrom`, `effectiveTo`). `selectRuleSet`
  picks the approved version effective on the date; drafts are usable only outside production
  (`ALLOW_DRAFT_CONFIG`), and issue is blocked unless the rule set is approved (`VAL-TPL-001`).
- The job pins the rule-set version at creation; the pinned version is part of the certified snapshot.
- Approval requires the `ruleset.approve` permission (standards owner), a human actor with MFA, and a
  different person from the author; lint (`lintRuleSet`) must pass. Approval is audited
  (`ruleset.version_approved`).
- The seed rule set `au-core 2026.1` (seeded with status `draft`) was authored from the brief. **It is a starting point for
  the standards owner, not a mapping to the API Rules, IVS or any guidance paper.**
  `[REVIEW: API_STANDARDS]`

## 5. Open questions for the standards owner

| #    | Question                                                                                                           | Default in the seed                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FM-1 | Minimum evidence counts per purpose/type (currently 3 sales or rentals where evidence is required)                 | 3, warning only (`VAL-EVID-001`)                                                                                                                                                                                                                                                                                                                                                              |
| FM-2 | Sale staleness windows (12 months residential, 24 months commercial)                                               | Warning only (`VAL-STALE-001`)                                                                                                                                                                                                                                                                                                                                                                |
| FM-3 | Whether FAMILY_LAW and FINANCIAL_REPORTING at DESKTOP scope should be blocked rather than warned                   | Warning (`SEL-003`, `SEL-004`)                                                                                                                                                                                                                                                                                                                                                                |
| FM-4 | Whether specialised assets need a mandatory specialist-review attachment                                           | Field `specialised.specialistReview` required                                                                                                                                                                                                                                                                                                                                                 |
| FM-5 | Portfolio-level fields for financial reporting unit of account                                                     | `fr.unitOfAccount` per asset; portfolio aggregation basis per job `[REVIEW: ACCOUNTING]`                                                                                                                                                                                                                                                                                                      |
| FM-6 | Mortgage-security client variants (lender panel requirements)                                                      | Modelled as client-specific templates on `MARKET_VALUE`                                                                                                                                                                                                                                                                                                                                       |
| FM-7 | What market commentary should cover per level and property type, its minimum length and how old it may be (01 D17) | Topics per level and property type (`commentaryTopics`); 300 characters (`VAL-MKT-001`); 1 month national, state and local (`COMMENTARY_STALE_MONTHS`): national and state against the valuation date (`VAL-STALE-003`), local against the day the report is prepared for a current valuation (`VAL-MKT-002`) and the valuation date for a retrospective one (`VAL-STALE-003`); warnings only |
