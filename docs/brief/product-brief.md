# Claude Build Brief: Australian Property Valuation Inspection & Reporting App

*Product requirements and master prompt — initial draft (source document, preserved as supplied).*

## 1. Purpose and non-negotiable guardrails

Build a mobile-first inspection, valuation workflow and report-generation application for qualified Australian property professionals. It must support iOS and Android, responsive web administration, single-property and portfolio jobs, configurable templates, evidence capture, review, approval, PDF issue and invoicing.

Correction: financial-reporting valuations should reference AASB 13 Fair Value Measurement, not "AASB 113". AASB 13 defines fair value and addresses the measurement framework, valuation techniques, inputs, fair-value hierarchy and disclosures.

- Do not claim automatic "API compliance". Build controlled templates that a nominated Australian Property Institute (API) standards owner can map to the current API Rules, Code of Ethics, adopted IVS, Guidance Papers and protocols. API states that its valuer members must comply with adopted IVS and that guidance is not a substitute for professional judgement. See API Standards and API Guidance Papers.
- All valuations, certifications and final conclusions require an appropriately qualified human valuer. AI may extract, suggest and flag; it must never silently determine or certify value.
- Every external datum must store source, retrieval time, effective date, licence/usage basis and verification status. Never scrape or republish restricted data without permission.
- Templates, rules and certification wording must be versioned by jurisdiction, purpose, client and effective date. Changes require approval and an audit trail.
- Retain professional judgement, assumptions, special assumptions, limitations, conflicts, independence, material uncertainty, reliance, confidentiality and intended-use controls.

## 2. Report-purpose selector and dynamic requirements

The first workflow step must select jurisdiction, report purpose, property type, inspection scope and single-asset or portfolio mode. That selection drives required fields, warnings, calculations, evidence tests, certification wording and report sections.

| Purpose | Required additions and validation |
|---|---|
| Market value | Basis of value; valuation date; interest valued; highest and best use; market approach and any income/cost cross-check; comparable-sales analysis; reconciliation; marketability, assumptions and risk commentary. |
| Capital gains tax / retrospective | Tax provision or event nominated by instructing adviser; retrospective date; information known or reasonably foreseeable at that date only; contemporaneous sales and market context; chronology; source archive; objective and supportable methodology. Align the output checklist to the ATO minimum report content: purpose, scope, asset, valuation date, inspection date if applicable, records supporting the basis and value. |
| Family law | Court, proceeding number, parties, orders/questions, single-expert status, expert code acknowledgement, instructions and documents relied on, independence, assumptions, methodology, opinion, reasons, limitations and declaration. Support expert conferences and joint statements where ordered; reflect current Part 7.1 processes described by the Federal Circuit and Family Court. Require legal review of template wording. |
| Financial reporting | Applicable accounting standard and reporting entity; unit of account; principal or most advantageous market; market-participant assumptions; highest and best use; valuation premise; approach and technique; significant inputs; observable/unobservable status; fair-value hierarchy level; sensitivity and disclosure-support schedule. AASB 13 alignment must be configurable rather than hard-coded. |
| Rental assessment | Rent basis (gross/net), review date and mechanism, lease area, permitted use, incentives, outgoings, term/options, vacancy, face/effective rent, rental comparables, rate per m² and adopted market rent. |
| Insurance / replacement cost | Replacement or reinstatement basis, building areas and construction, quality, services, demolition/debris, professional fees, escalation, lead time, code-upgrade allowances, regional/location factors, GST treatment, exclusions and sum insured. Licensed Rawlinsons or AIQS data may inform inputs but must record edition, locality, date and adjustments; AIQS cautions that its indices are indicative and project-specific judgement is required. |
| Desktop | No physical inspection; data-source register; imagery dates; information gaps; confidence/limitation statement; mandatory escalation triggers where risk or data quality makes desktop scope unsuitable. |
| Restricted access / kerbside | Areas inspected/not inspected, access attempts, obstruction and visibility notes, external-only evidence, assumptions about internal condition, risk flags and escalation to full inspection. |

## 3. Property-type selector

| Type | Conditional fields and analytics |
|---|---|
| Vacant land | Title/parcel, dimensions, frontage, topography, access, services, easements, contamination/flood/bushfire constraints, planning controls, development potential, site-value sales and $/m² land analysis. |
| Residential | Dwelling type, accommodation, floor areas, age/effective age, construction, condition, renovations, fixtures/finishes, parking, outdoor improvements, occupancy/tenancy and sales comparison. |
| Commercial / office / retail | NLA/GLA, floor-by-floor areas, fitout, services, grade, parking, tenancy schedule, WALE, lease terms, incentives, outgoings, occupancy, passing/market income, cap rate, discount rate, terminal yield, sales and leasing evidence. Retail adds trade area, frontage, footfall and centre metrics where authorised. |
| Industrial | Warehouse/office areas, site coverage, clearance, loading/access, hardstand, cranes, power, fire services, zoning/use compliance, functional obsolescence, rents, yields and $/m² building/land analysis. |
| Specialised or mixed use | Component schedule, allocation methodology, specialised licences/operations, going-concern boundary, highest and best use, and specialist-review triggers. |

## 4. Core job and property data

- Instruction: client/entity, instructing party, intended users, intended use, basis of value, interest valued, ownership, fee basis, conflicts, responsible valuer, reviewer, due date and engagement documents.
- Key dates: instruction, inspection, valuation, research cut-off, review, issue and retrospective-data cut-off.
- Location: validated address, lot/plan/title identifiers, local government area, state/territory, latitude/longitude, geocode confidence and map pin.
- Planning: zone, overlays, scheme/instrument, permissible/prohibited uses, source, effective/retrieval dates and uploaded planning report. Use jurisdiction adapters; for Victoria, VicPlan can query property, zone and overlay information and generate a planning property report.
- Land: area and source, dimensions/frontage, shape, topography, access, services, easements/encumbrances and environmental hazards.
- Improvements: use, year built, construction, areas and measurement basis, accommodation, condition, quality, services, defects, functional utility and estimated remaining life where relevant.
- Occupancy: owner occupied/vacant/leased, lease facts, occupancy evidence and privacy controls.
- Evidence: sales and rentals in separate tabs with address, transaction date, price/rent, interest, areas, zoning, source, verification, comparability, adjustments and adjusted indications. Calculate $/m² land, $/m² improvements, yield and other applicable units while preserving raw inputs and formula version.
- Market commentary: national, state and local modules with date, source and author. Adapt by property type and purpose; prevent commentary dated after a retrospective valuation date.

## 5. Mobile inspection, maps and photo intelligence

- Provide guided room/area checklists, offline capture, autosave, voice-to-text, barcode/document capture, device-camera integration, timestamp, optional GPS, photo sequence, captions, annotations and privacy/redaction workflow.
- Show the user's current location only with explicit permission. Display single and portfolio assets on an Esri or Google map, cluster pins, colour by status/risk, filter, search, open an asset from a pin and support navigation handoff.
- For each photo, offer AI-assisted classification such as kitchen, bathroom, façade or plant room and suggest visible attributes such as induction cooktop, oven, rangehood and stone benchtop.
- AI suggestions must display confidence, source photo and "accept/edit/reject". Do not infer concealed construction, operational condition, brand, compliance, dimensions or defects from an image alone. Accepted facts must retain author, time and photo provenance.
- Detect duplicate, blurry or low-light images; require consent/redaction for people, personal documents, number plates and other sensitive content.

## 6. 2D improvement sketch and area measurement

Add an Areas & Sketch workspace for calculating the square metres of improvements from an attached floor-plan image, PDF page, aerial/site image or a simple in-app 2D sketch. The feature should work on phone, tablet and web and remain usable offline during an inspection.

- Import or capture: attach an existing plan, take a photograph of a plan, import a PDF page or start a blank 2D canvas. Preserve the original file and its source.
- Scale calibration: require at least one known dimension or a verified scale before calculating area from an image. Allow two-point calibration, metric units and recalibration. Clearly label outputs as unverified until the valuer confirms the scale.
- Sketch tools: draw connected wall lines or closed polygons; enter exact lengths; snap to corners, grids and right angles; undo/redo; zoom; pan; duplicate; add internal partitions; and label rooms, floors and improvement types. A basic 2D platform is sufficient for the MVP.
- Area calculation: automatically calculate each closed polygon in m² and show perimeter where useful. Support floor-by-floor totals and classifications such as living area, garage, warehouse, office, retail, mezzanine, verandah, carport, hardstand, ancillary improvements and excluded voids.
- Measurement basis: record whether the area is gross floor area, gross lettable area, net lettable area, building area, site coverage or another nominated basis. Store the applicable measurement convention, inclusion/exclusion rules and whether dimensions were measured, supplied, scaled or estimated.
- Deductions and checks: allow voids, courtyards and excluded areas to be deducted; prevent overlapping polygons from being double-counted; flag open shapes, missing scales, implausible dimensions, inconsistent floor totals and differences from supplied plans or online area data.
- Image assistance: AI may suggest wall edges, corners, room labels and a preliminary outline, but the user must review and accept every boundary and scale before an area becomes reportable. Perspective correction may assist photographed plans, but must not be presented as a surveyed measurement.
- Schedule and evidence: generate an improvement-area schedule containing level, component, use, measurement basis, gross area, deductions, net area, source, confidence, person who measured it and date. Link each row to the sketch or source image.
- Report output: include the approved 2D sketch, legend, north point where known, scale status, area schedule, total improvement area and a configurable disclaimer in the PDF appendix. Permit the valuer to exclude working sketches from the client report while retaining them in the audit record.
- Versioning: retain each revision, calibration change, manual override and approval. Once the report is issued, preserve an immutable copy of the sketch and area schedule used in the valuation.

## 7. Workflow, QA, certification and outputs

1. Create job and capture engagement acceptance.
2. Select purpose, property type, scope, jurisdiction and template version.
3. Import or enter authoritative property data; mark provenance and verification.
4. Plan inspection route; capture inspection evidence offline if necessary.
5. Analyse sales/rental/cost evidence; record adjustments and reconciliation.
6. Run validation: missing mandatory fields, inconsistent dates/areas, stale data, unsupported conclusions, outlier rates, inadequate evidence and unresolved limitations.
7. Valuer completes certification and locks the submission for QA.
8. Independent reviewer receives a checklist, raises findings, records severity and disposition, and approves or returns the job. Prevent self-approval unless an authorised exception is documented.
9. On approval, generate a versioned, watermarked final PDF with appendices, photographs, maps, evidence tables, certification and audit metadata. Generate invoice separately, email only to approved recipients, record delivery status and retain an immutable issued copy.

Certification must be template-driven and include valuer identity/credentials, role, inspection scope, valuation date, basis and amount, independence/conflicts, assumptions/special assumptions, limitations, standards relied on, signature and signing date. Never let software or AI sign for the valuer.

## 8. Platform, security and integration requirements

- Cross-platform iOS/Android app plus web portal; offline-first encrypted local store with conflict-aware synchronisation.
- Role-based access: administrator, allocator, valuer, field inspector, QA reviewer, finance and read-only client. Apply least privilege and portfolio-level segregation.
- Australian-hosted deployment option; encryption in transit/at rest; MFA/SSO; audit logs; backups; retention/legal-hold controls; secure deletion; breach and incident logging.
- Consent and permissions for camera, location and contacts; Australian Privacy Principles review; data-processing agreements; configurable retention.
- API-adapter layer for geocoding, land/title/planning, hazards, maps, sales/rental data, construction-cost sources, PDF, e-signature, email and accounting. Each connector needs licence, rate-limit, outage, freshness and manual-fallback handling.
- Do not use public map tiles or government portals as if they grant bulk-data rights. Keep provider attribution and licence rules configurable.

## 9. Minimum data model

Organisation, User, Role, Client, Job, Portfolio, Asset, Instruction, PropertyInterest, Address, Parcel, PlanningControl, Hazard, Inspection, Area/Room, Improvement, MeasurementProject, SourcePlan, ScaleCalibration, Sketch, SketchVersion, Boundary, AreaComponent, AreaDeduction, AreaSchedule, MeasurementApproval, Photo, Document, DataSource, SaleComparable, RentalComparable, Adjustment, Lease, ValuationMethod, ValuationCalculation, MarketCommentary, Assumption, Limitation, RiskFlag, Certification, QAReview, QAFinding, Template, TemplateVersion, Report, Invoice, EmailDelivery and AuditEvent.

Every material record should support status, owner, created/modified identity and time, source, effective date, verification state, confidence where machine-generated, and immutable history after issue.

## 10. MVP acceptance criteria

- A user can create one job containing one or many assets and see them on a permission-aware map.
- Changing purpose, property type, jurisdiction or inspection scope immediately changes required fields and report sections without losing prior data.
- The app works offline during inspection and synchronises without duplicate assets/photos.
- All calculated rates can be traced to inputs, units, formula and version; the valuer can override only with a reason.
- AI photo extraction never writes accepted improvement facts without human confirmation.
- A report cannot be issued with unresolved blocking validations, absent certification or incomplete QA.
- The issued PDF, invoice and email delivery record are reproducible from an immutable audit snapshot.
- A user can import or photograph a plan, calibrate it from a known dimension, draw or confirm closed 2D boundaries, calculate component and total improvement areas in m², select the measurement basis, and trace every reported area to its source, sketch version and approver.
- Automated tests cover field rules, date logic, unit conversions, valuation calculations, role separation, offline sync, jurisdiction adapters, PDF output and audit integrity.

## 11. Prompt to give Claude

Act as a senior Australian proptech product architect, mobile engineer, security engineer and valuation-workflow analyst. Convert this brief into an implementation-ready product specification and then build the application iteratively. First produce: (1) assumptions and questions requiring a decision; (2) personas and permission matrix; (3) report-purpose × property-type × inspection-scope field matrix; (4) state/territory planning-data adapter plan; (5) user journeys and screen inventory; (6) normalised data model and audit model; (7) API contracts; (8) validation/rules catalogue; (9) PDF template schema; (10) a phone/tablet/web 2D improvement-sketch and m² measurement specification covering plan/image import, scale calibration, polygon drawing, area schedules, human approval and audit history; (11) threat model, privacy impact checklist and data-retention model; (12) test plan; and (13) phased backlog with MVP, pilot and production releases.

Use a cross-platform mobile architecture with offline-first capture and a secure web administration/QA portal. Keep valuation standards, certification clauses, templates, jurisdiction rules, calculations and integrations configuration-driven and versioned. Treat API/IVS/AASB 13/court/tax alignment as expert-reviewed requirements, not marketing claims. Do not reproduce proprietary API templates, Rawlinsons data or AIQS publications unless licensed. Clearly label every unresolved legal, professional-standard, data-licensing and accounting interpretation as requiring review by the relevant qualified specialist.

For each proposed feature, provide user story, acceptance criteria, data fields, validation, permissions, audit events, offline behaviour, error states and tests. For generated code, use typed interfaces, migration-controlled schemas, automated tests, accessibility, observability, secure secrets management and environment-specific configuration. Never allow AI to certify a valuation, silently alter evidence, or publish a report without human valuer approval and QA.

## 12. Decisions required before build

1. Initial users and licensing model: internal firm, multi-tenant SaaS or white-label.
2. First jurisdictions and authorised data providers.
3. Exact report products for MVP and which API/professional templates the business is licensed to use.
4. Valuation calculation scope: evidence capture only, practitioner-controlled calculators, or full modelling.
5. Preferred map, accounting, email, identity, e-signature and document-storage providers.
6. Required PDF branding, invoice logic, retention period and Australian hosting/security obligations.
7. Who will act as API/IVS, AASB 13, family-law, tax, privacy and cyber-security reviewers.
