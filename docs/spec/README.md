# Specification index

> Status: **Draft for review**. Every unresolved legal, professional-standard, data-licensing,
> privacy, tax or accounting interpretation is tagged `[REVIEW: ROLE]` (roles in 00 §6). Nothing in
> this specification is a claim of compliance.

| #   | Section                                                                     | Brief item                                                                                  |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 00  | [Architecture and conventions](00-architecture-and-conventions.md)          | Guardrails, ADRs, identifiers, vocabulary                                                   |
| 01  | [Assumptions and decisions](01-assumptions-and-decisions.md)                | (1) assumptions and questions requiring a decision                                          |
| 02  | [Personas and permissions](02-personas-and-permissions.md)                  | (2) personas and permission matrix                                                          |
| 03  | [Field matrix](03-field-matrix.md)                                          | (3) purpose × property type × inspection scope field matrix                                 |
| 04  | [Planning-data adapters](04-planning-data-adapters.md)                      | (4) state/territory planning-data adapter plan                                              |
| 05  | [User journeys and screens](05-user-journeys-and-screens.md)                | (5) user journeys and screen inventory                                                      |
| 06  | [Data model and audit](06-data-model-and-audit.md)                          | (6) normalised data model and audit model                                                   |
| 07  | [API contracts](07-api-contracts.md)                                        | (7) API contracts                                                                           |
| 08  | [Validation and rules catalogue](08-validation-rules-catalogue.md)          | (8) validation/rules catalogue                                                              |
| 09  | [PDF template schema](09-pdf-template-schema.md)                            | (9) PDF template schema                                                                     |
| 10  | [Sketch and measurement](10-sketch-and-measurement.md)                      | (10) 2D improvement sketch and m² measurement                                               |
| 11  | [Threat model, privacy and retention](11-threat-model-privacy-retention.md) | (11) threat model, privacy impact checklist, retention model                                |
| 12  | [Test plan](12-test-plan.md)                                                | (12) test plan                                                                              |
| 13  | [Backlog](13-backlog.md)                                                    | (13) phased backlog: MVP, pilot, production                                                 |
| 14  | [Feature specifications](14-feature-specifications.md)                      | Per-feature story, criteria, fields, validation, permissions, audit, offline, errors, tests |

## Generated from code

These tables are produced by `pnpm docs:generate` from the code that enforces them and checked in CI:

- [Input tabs and field catalogue](generated/field-catalogue.md)
- [Requirement and selection rules](generated/requirement-rules.md)
- [Field matrix](generated/field-matrix.md)
- [Permission matrix and workflow transitions](generated/permission-matrix.md)
- [Validation catalogue](generated/validation-catalogue.md)
- [Formulas, measurement conventions and clause seeds](generated/formulas-conventions-clauses.md)
- [API endpoints](generated/api-endpoints.md) and [OpenAPI 3.1 contract](generated/openapi.json)

Source requirements: [`../brief/product-brief.md`](../brief/product-brief.md).
