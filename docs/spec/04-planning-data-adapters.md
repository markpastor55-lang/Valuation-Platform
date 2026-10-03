# 04 — State/territory planning-data adapter plan

> Status: **Draft for review** · Owner: Integrations lead (with `DATA_LICENSING` reviewer) · Applies to: planning, hazard, title/parcel, geocoding and map connectors; `PlanningControl`, `Hazard`, `Parcel`, `Address`, `DataSource` and `Document` records

This section defines how the platform obtains planning controls and related property data for
each Australian state and territory, what every result must record, and what happens when a
source is unavailable, stale or not licensed for the intended use. Vocabulary (jurisdiction
codes, roles, audit actions, `[REVIEW: …]` tags) follows `00-architecture-and-conventions.md`.

Everything in §3 and §4 about specific providers is written from general knowledge and has **not**
been confirmed against current provider terms. No adapter is enabled in any environment until the
`DATA_LICENSING` reviewer has confirmed the licence record for its data source (§1, P6).

## 1. Purpose and principles

| #   | Principle                                                                     | Engineering consequence                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | One adapter per jurisdiction and source                                       | Adapters are registered by `jurisdiction` + `dataSourceId`; a jurisdiction may have several (e.g. state layer + council scheme). Selection is configuration, not branching code.                                                                                                         |
| P2  | Every result carries provenance (guardrail G3)                                | `PlanningControlResult.provenance` is mandatory: source, retrieval time, effective date, licence/usage basis, verification status. Missing provenance raises `VAL-PROV-001` (blocking).                                                                                                  |
| P3  | Public viewers and portals do not grant bulk-data or republication rights     | Viewing a map in a browser is not a licence to query it programmatically, cache it, or reproduce it in a report. Each source needs a confirmed licence record before an adapter is enabled. No scraping of viewer HTML, rendered tiles or registry search pages.                         |
| P4  | Manual entry plus an uploaded planning certificate/report is always available | `ManualPlanningAdapter` exists for every jurisdiction and is the default when no automated adapter is enabled, licensed or reachable (`manualFallback: true` is a type-level constant).                                                                                                  |
| P5  | Adapters suggest; the valuer verifies                                         | An adapter result is stored as an **unverified candidate**. It becomes reportable only after a human valuer verifies or edits it. Adapters never overwrite manually entered or previously verified values.                                                                               |
| P6  | Attribution and licence rules are configuration                               | Licence terms, attribution text, reproduction rights, raw-payload retention and enablement flags live in the `DataSource` registry (versioned, audited), not in adapter code.                                                                                                            |
| P7  | Source codes are kept verbatim                                                | Zone and overlay codes are stored exactly as published (`GRZ1`, `R2`, `HO123`). No national code translation; any display mapping is a separate, versioned lookup.                                                                                                                       |
| P8  | Retrospective valuations need controls as at the valuation date               | Most live services return **current** controls only. For a retrospective valuation (any purpose; derived from the dates, 01 D8) or any valuation date in the past, an adapter result is flagged "current controls"; the valuer must confirm the controls in force at the valuation date. |
| P9  | Deterministic and testable                                                    | Adapters receive clock, HTTP client, policy and licence via `ConnectorContext`; CI uses recorded fixtures only (§6).                                                                                                                                                                     |

## 2. Adapter contract

### 2.1 Interfaces (normative)

The implementation must use exactly these shapes.

```ts
interface PlanningLookupRequest {
  jurisdiction: Jurisdiction;
  address?: string;
  parcel?: { lot?: string; plan?: string; volumeFolio?: string };
  coordinates?: { lat: number; lng: number };
}
interface PlanningControlResult {
  zone?: { code: string; name: string };
  overlays: { code: string; name: string; schedule?: string }[];
  instrument?: string;
  permissibleUses?: string[];
  prohibitedUses?: string[];
  propertyReport?: { documentRef: string; generatedAt: string };
  provenance: Provenance;
}
interface PlanningAdapter {
  readonly id: string;
  readonly jurisdiction: Jurisdiction;
  readonly dataSourceId: string;
  readonly capabilities: ReadonlyArray<
    'zone' | 'overlays' | 'instrument' | 'uses' | 'property_report'
  >;
  lookup(req: PlanningLookupRequest, ctx: ConnectorContext): Promise<PlanningControlResult>;
}
interface ConnectorPolicy {
  timeoutMs: number;
  maxRetries: number;
  rateLimitPerMinute: number;
  circuitBreaker: { failureThreshold: number; resetAfterMs: number };
  freshnessDays: number;
  manualFallback: true;
}
```

### 2.2 Supporting types (indicative)

`Jurisdiction` is the union in 00 §4. `Provenance` and `ConnectorContext` are shown here for
completeness; the canonical `Provenance` definition lives in `packages/domain/src/core/provenance.ts`
(00 §1, G3) and the data model (06) wins if they differ.

```ts
type VerificationStatus = 'unverified' | 'verified' | 'disputed' | 'superseded';
type AcquisitionMethod = 'adapter' | 'manual_entry' | 'document_upload';
type ReproductionRight = 'permitted' | 'permitted_with_attribution' | 'prohibited' | 'unconfirmed';

interface Provenance {
  dataSourceId: string; // key in the DataSource registry
  sourceName: string; // as configured, e.g. "Vicmap Planning"
  method: AcquisitionMethod;
  adapterId?: string;
  adapterVersion?: string;
  retrievedAt: string; // ISO-8601 UTC instant
  effectiveDate: string | null; // LocalDate the source states the data is current at
  effectiveDateBasis: 'source_stated' | 'document_date' | 'retrieval_date_assumed';
  licence: {
    licenceId: string;
    licenceVersion: string;
    usageBasis: string;
    reproduction: ReproductionRight;
    attributionText?: string;
  }; // snapshot at retrieval
  verification: {
    status: VerificationStatus;
    verifiedBy?: string;
    verifiedAt?: string;
    note?: string;
  };
  rawPayloadRef?: { objectKey: string; sha256: string }; // only if licence permits storage
  documentRef?: string; // uploaded certificate/report (Document id)
  currentControlsOnly?: boolean; // P8: service returns current controls, not historical
}

interface ConnectorContext {
  organisationId: string;
  jobId?: string;
  assetId?: string;
  actor: { type: 'human' | 'system'; userId?: string };
  correlationId: string;
  now(): string; // injected clock (ISO-8601 UTC)
  policy: ConnectorPolicy; // resolved for dataSourceId + organisation
  licence: Provenance['licence']; // resolved licence record; copied into provenance
  http: EgressHttpClient; // host allow-list from DataSource config; no redirects off-list
  signal: AbortSignal; // enforces policy.timeoutMs
  log: StructuredLogger; // PII-free (11 §3)
}
```

### 2.3 Behavioural rules

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | `lookup` resolves with a result (possibly empty `overlays`) when the source answered; it **rejects** with a typed `ConnectorError` (`OUTAGE`, `TIMEOUT`, `RATE_LIMITED`, `AUTH_FAILED`, `CIRCUIT_OPEN`, `NO_MATCH`, `AMBIGUOUS_MATCH`, `INVALID_RESPONSE`, `ADAPTER_DISABLED`, `LICENCE_UNCONFIRMED`) otherwise. "No overlays" and "could not determine overlays" must be distinguishable. |
| B2  | Adapters only populate fields listed in `capabilities`. Missing capabilities create manual-completion tasks; they are never silently left blank.                                                                                                                                                                                                                                           |
| B3  | `AMBIGUOUS_MATCH` returns candidate parcels to the caller; the user picks. Adapters never auto-select between parcels.                                                                                                                                                                                                                                                                     |
| B4  | Responses are schema-validated before mapping. A response that fails validation is quarantined (stored only if the licence permits), and the lookup rejects with `INVALID_RESPONSE`.                                                                                                                                                                                                       |
| B5  | `permissibleUses` / `prohibitedUses` are populated only where the source publishes them as structured data. Deriving uses from scheme text is a manual valuer task; land-use tables are not inferred by code or AI.                                                                                                                                                                        |
| B6  | `propertyReport` is set only when the source itself generated the document (e.g. VIC Planning Property Report). The PDF is stored as a `Document` with its own provenance and checksum.                                                                                                                                                                                                    |
| B7  | The API service is the only caller of adapters. Mobile clients request lookups through the API; no provider credentials on devices.                                                                                                                                                                                                                                                        |
| B8  | Adapters do not accept URLs from users or job data. Endpoints come from the `DataSource` registry and must match the egress allow-list (SSRF control, 11 T-15).                                                                                                                                                                                                                            |
| B9  | Each successful lookup emits `datasource.used` with `dataSourceId`, `adapterId`, `licenceId` and the target field IDs; no field values in the audit payload beyond codes.                                                                                                                                                                                                                  |

### 2.4 Lookup flow

```
request (job/asset, jurisdiction, address | parcel | coordinates)
  │
  ▼
resolve adapters ── DataSource registry: enabled flag? licence confirmed? feature flag on?
  │ no ──────────────────────────────────────────────▶ manual-fallback task (ADAPTER_DISABLED / LICENCE_UNCONFIRMED)
  ▼ yes
rate limiter ─▶ circuit breaker ─▶ adapter.lookup(req, ctx) ── error ─▶ retry per policy ─▶ manual-fallback task (reason)
  │
  ▼
schema validation ─▶ provenance completeness ─▶ store raw payload (only if licence permits)
  │
  ▼
PlanningControl candidate (verification.status = 'unverified')
  │
  ▼
valuer: verify / edit / reject ─▶ field values with provenance ─▶ validations (VAL-PROV-*, VAL-STALE-*) on submit/issue
```

### 2.5 Mapping to job fields (indicative; field catalogue in 03 is authoritative)

| Result property                     | Field ID                                              | Notes                                                                                                         |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `zone.code`, `zone.name`            | `planning.zone`                                       | Verbatim code + published name                                                                                |
| `overlays[]`                        | `planning.overlays`                                   | Includes spatially mapped controls that a jurisdiction does not call "overlays" (see §3.2)                    |
| `instrument`                        | `planning.instrument`                                 | Name and, where available, amendment/version identifier                                                       |
| `permissibleUses`, `prohibitedUses` | `planning.permissibleUses`, `planning.prohibitedUses` | Usually manual (B5)                                                                                           |
| `propertyReport`                    | `planning.reportDocument`                             | `Document` reference                                                                                          |
| `provenance`                        | `planning.source`                                     | Effective date and retrieval time are held in each field value's provenance record (`field_value.provenance`) |

### 2.6 Permissions (proposed additions to `permissions.ts`; iteration 1 implements only `datasource.manage` for the registry)

| Permission             | Granted to                               | Notes                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `datasource.lookup`    | `VALUER`, `FIELD_INSPECTOR`, `ALLOCATOR` | Within jobs they can access                                                                                                                                                                              |
| `datasource.verify`    | `VALUER`                                 | Marks a candidate `verified`; human actor only                                                                                                                                                           |
| `datasource.configure` | `ADMINISTRATOR`                          | Proposed split of the implemented `datasource.manage`. Edits `DataSource` registry; enabling an adapter also requires a licence record approved by a different user (`DATA_LICENSING` sign-off recorded) |

## 3. Jurisdiction plan

### 3.1 Sources, capabilities, access and phase

Capability codes refer to `PlanningAdapter.capabilities`. "Fallback" is always available in
addition to any adapter (P4).

| Jur.  | Likely authoritative sources / services                                                                                                                                                                                        | Likely capabilities                                                                                                                                                                                                                                                                                                        | Likely access mode                                                                                                                                                              | Licence considerations                                                                                                                                                                                                                                       | Phase                                                        | Fallback                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `NSW` | NSW Planning Portal (ePlanning spatial viewer and published planning APIs/web services); Local Environmental Plans (LEPs) and State Environmental Planning Policies (SEPPs); council-issued planning certificates              | `zone` (LEP land zoning); `overlays` (LEP map layers such as heritage, height of buildings, floor space ratio, minimum lot size, flood planning; bush fire prone land); `instrument` (LEP name); `property_report`: no state-issued per-property certificate — council planning certificate is the authoritative statement | Spatial web services / portal APIs; registration or keys may be required                                                                                                        | Distinguish open spatial layers from portal content; planning certificates are council documents purchased per property — store with the job, do not redistribute. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution` | Pilot                                                        | Manual entry + upload of council planning certificate or viewer printout              |
| `VIC` | VicPlan (map viewer that generates the Planning Property Report); Vicmap Planning (zone and overlay datasets); Planning Schemes Online (scheme ordinance text)                                                                 | `zone` (e.g. `GRZ1`), `overlays` with schedule (e.g. `HO`, `DDO` + schedule number), `instrument` (council planning scheme), `property_report` (Planning Property Report PDF)                                                                                                                                              | Vicmap Planning via dataset subscription or spatial web services; property report via VicPlan — confirm whether automated generation is permitted or a supported service exists | Vicmap datasets are understood to be published as open data with an attribution licence; VicPlan report generation and reproduction terms may differ. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`              | MVP (feature flag, only if licence confirmed) → Pilot        | Manual entry + upload of Planning Property Report                                     |
| `QLD` | Local government planning schemes and their online scheme mapping (e.g. Brisbane City Plan); State Planning Policy interactive mapping; state development assessment mapping for state interests; Queensland open spatial data | `zone` and `overlays` from each council scheme (codes and names differ by council); state-interest layers from SPP mapping; `instrument` (scheme name/version); `property_report` from some councils only                                                                                                                  | Per-council web services where published; state layers via open-data downloads or web services                                                                                  | Terms vary per council and per layer; some council outputs are fee-based. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                                                          | Production (per-council adapters, prioritised by job volume) | Manual entry + council planning and development certificate or property report upload |
| `WA`  | PlanWA (Department of Planning, Lands and Heritage mapping); Landgate SLIP; region schemes (e.g. Metropolitan Region Scheme) and local planning schemes; Residential Design Codes density coding                               | `zone` (region scheme zone/reservation + local scheme zone), `overlays` (special control areas, heritage, bushfire-prone areas, R-Code density coding), `instrument` (region + local scheme)                                                                                                                               | SLIP web services (registration/subscription may apply); PlanWA viewer                                                                                                          | SLIP mixes open and subscription/licensed datasets; Landgate commercial licensing for some products. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                               | Production                                                   | Manual entry + local government zoning advice/certificate upload                      |
| `SA`  | SA Property and Planning Atlas (SAPPA); PlanSA portal; Planning and Design Code (single statewide code)                                                                                                                        | `zone`, subzone, `overlays`, Technical and Numeric Variations (as overlay schedule values), `instrument` (Code version / consolidation date)                                                                                                                                                                               | SAPPA viewer; spatial layers possibly via state open-data or location services                                                                                                  | Verify reuse and reproduction terms for Code layers and Atlas outputs. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                                                             | Production (early candidate: one statewide code)             | Manual entry + Atlas printout / Code extract upload                                   |
| `TAS` | LISTmap (theLIST); Tasmanian Planning Scheme — State Planning Provisions + Local Provisions Schedules (some councils may remain on interim schemes); iplan                                                                     | `zone`, `overlays` (codes, specific area plans), `instrument` (TPS + LPS, or interim scheme)                                                                                                                                                                                                                               | theLIST web services (mix of open and licensed/fee-based layers)                                                                                                                | Some LIST datasets are licensed or fee-based. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                                                                                      | Production                                                   | Manual entry + council-issued certificate upload                                      |
| `ACT` | ACTmapi; Territory Plan (rewritten under the Planning Act 2023); National Capital Plan for Designated Areas                                                                                                                    | `zone` (Territory Plan zone), `overlays` (district/precinct policy areas), `instrument` (Territory Plan or National Capital Plan)                                                                                                                                                                                          | ACTmapi web services; ACT open-data portal                                                                                                                                      | Verify reuse terms; Crown lease documents come from the land titles registry (licensed). `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                                           | Production                                                   | Manual entry + Crown lease (purpose clause) and zoning extract upload                 |
| `NT`  | NT Atlas; NT Planning Scheme 2020 (Planning Act 1999 (NT)); area plans                                                                                                                                                         | `zone`, `overlays`, `instrument`                                                                                                                                                                                                                                                                                           | NT Atlas viewer; NT open spatial data where available                                                                                                                           | Verify reuse terms; coverage gaps outside scheme areas. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                                                                            | Production                                                   | Manual entry + zoning extract upload                                                  |

### 3.2 Jurisdiction quirks the adapters and UI must handle

| Jur.  | Quirk                                                                                                                                                                                                                                                         | Handling                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QLD` | Planning is largely council-scheme based; each local government publishes its own scheme, zone codes and overlay mapping. State interests sit in separate SPP/state mapping.                                                                                  | Adapter per council (or per council group sharing a platform); `instrument` must name the council scheme and version; state-interest layers returned as overlays with a `SPP:` code prefix.                          |
| `VIC` | Overlays carry numbered schedules (e.g. `DDO5`) that change the control's meaning. The Planning Property Report can include designations beyond zones/overlays (e.g. bushfire prone area).                                                                    | Populate `schedule`; map non-planning designations to `Hazard` records, not overlays. Store the report PDF as `propertyReport`.                                                                                      |
| `NSW` | Controls are expressed as LEP zones plus LEP map layers and SEPPs; the term "overlay" is not used. Some SEPPs apply statewide or by criteria that are not spatially resolvable. The council planning certificate is the authoritative per-property statement. | Map spatial LEP layers into `overlays` (`code` = layer identifier, `schedule` = published category/value). Never infer SEPP applicability; list only spatially mapped instruments and prompt for certificate upload. |
| `ACT` | Land is generally Crown leasehold. Permitted use depends on both the Territory Plan zone and the lease purpose clause. Designated Areas fall under the National Capital Plan.                                                                                 | Show a mandatory "lease purpose clause" field for ACT; uses are valuer-entered. `instrument` distinguishes Territory Plan vs National Capital Plan. `[REVIEW: API_STANDARDS]` on how lease purpose is reported.      |
| `WA`  | Two tiers: region scheme plus local planning scheme; residential density coding (R-Codes) is a key control.                                                                                                                                                   | Return both instruments; R-Code density as an overlay entry.                                                                                                                                                         |
| `SA`  | Single statewide Code amended frequently; zones have subzones and TNVs.                                                                                                                                                                                       | Record Code version/consolidation date as `instrument`; subzones and TNVs as overlays with `schedule`.                                                                                                               |
| `TAS` | Transition from interim schemes to the Tasmanian Planning Scheme happened council by council.                                                                                                                                                                 | `instrument` must state which scheme applies; mismatch with a supplied certificate is flagged for the valuer.                                                                                                        |
| `NT`  | Some land lies outside planning-scheme coverage or is subject to Aboriginal land or native title arrangements.                                                                                                                                                | Adapter returns `NO_MATCH` (not an empty zone) where uncovered; manual entry with a mandatory note. `[REVIEW: LEGAL]`                                                                                                |
| All   | Exhibited/draft amendments and historical controls are rarely returned by live services.                                                                                                                                                                      | `currentControlsOnly = true` on adapter results; for retrospective valuation dates the valuer must confirm controls as at that date (P8). Draft amendments are a valuer commentary item.                             |

## 4. Related adapters

Same contract pattern (`<Family>Adapter` with `dataSourceId`, `capabilities`, `lookup(req, ctx)`),
same `Provenance`, same `ConnectorPolicy`, same fallback rule.

| Family                  | Typical sources (examples)                                                                                                                       | Provides                                                                                   | Access and licence notes                                                                                                                                                                                                                                                                                                                | Phase                                                     | Fallback                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Hazards — flood         | State flood data portals, council flood studies, planning overlays (e.g. VIC flood overlays, NSW flood planning layers)                          | `Hazard` records (type, category, source layer)                                            | Mixed open/licensed; council studies may restrict reuse. Absence of a mapped hazard is not evidence of no hazard — report wording must say so. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                                                                | Pilot (VIC, NSW); Production others                       | Manual entry + uploaded flood certificate/council advice              |
| Hazards — bushfire      | State bushfire-prone-area mapping (e.g. WA map of bush fire prone areas, NSW bush fire prone land, VIC bushfire prone area / management overlay) | `Hazard` records; BAL is **not** derivable from mapping                                    | As above. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                                                                                                                                                                                                     | Pilot (VIC, NSW); Production others                       | Manual entry + uploaded assessment                                    |
| Hazards — contamination | State EPA registers and notified-site lists; some states charge per search                                                                       | `Hazard` records (listed / not listed on a named register as at a date)                    | Paid or restricted registers must be ordered through the authorised channel; results stored as documents. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                                                                                                     | Production                                                | Manual entry + uploaded register search                               |
| Title / parcel          | State land registries and their authorised information brokers; cadastre geometry datasets (some open)                                           | `Parcel` (lot/plan, volume/folio, area), title search documents, encumbrances              | Registries are typically licensed and paid per search. **Never scrape** registry or broker sites. Title documents contain personal information (11 §4). `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                                                       | MVP: upload only; Production: licensed broker integration | Upload of title search supplied by client or ordered manually         |
| Geocoding               | G-NAF (open dataset published by Geoscape Australia under its own end-user licence); commercial geocoders (e.g. Esri, Google)                    | `Address` (normalised address, coordinates, geocode confidence, match method)              | G-NAF is open but the licence and release version must still be recorded. Commercial geocoder terms may restrict storing results or using them with other providers' maps. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution`                                                                    | MVP (G-NAF-based, if licence confirmed)                   | Manual address + map-pin placement (`geocode confidence = manual`)    |
| Maps and imagery        | Esri or Google basemaps (decision D5); commercial aerial imagery                                                                                 | Display tiles; static map images for reports only where terms permit; imagery capture date | Tiles are **display-only** under provider terms: no bulk caching, no derived datasets, attribution always shown. Static images in PDFs only via a provider-permitted export path with attribution. Imagery date recorded for `DESKTOP` scope. `[REVIEW: DATA_LICENSING] verify current availability, API access, terms and attribution` | MVP (display)                                             | Report map omitted or replaced by user-supplied image with provenance |

Sales/rental evidence, construction-cost data (Rawlinsons/AIQS), e-signature, email and accounting
connectors follow the same policy model and are specified with the API contracts (07).

## 5. Connector policy and error behaviour

### 5.1 Default `ConnectorPolicy` values

Defaults are per connector family and overridable per `DataSource` and organisation (never above a
provider's published limit). Freshness thresholds are a professional-practice question
`[REVIEW: API_STANDARDS]`.

| Family                                | `timeoutMs`               | `maxRetries` (backoff)                                               | `rateLimitPerMinute` (per org, per source) | `circuitBreaker`                               | `freshnessDays`  | `manualFallback`  |
| ------------------------------------- | ------------------------- | -------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- | ---------------- | ----------------- |
| Planning — controls                   | 10 000                    | 2 (exponential, 500 ms base, full jitter, cap 4 s)                   | 30                                         | `failureThreshold: 5`, `resetAfterMs: 120 000` | 30               | `true`            |
| Planning — property report generation | 30 000                    | 1                                                                    | 10                                         | `3` / `300 000`                                | 30               | `true`            |
| Hazards                               | 10 000                    | 2                                                                    | 30                                         | `5` / `120 000`                                | 90               | `true`            |
| Title / parcel (chargeable)           | 20 000                    | 0 (no automatic retry of chargeable calls; idempotency key required) | 10                                         | `3` / `300 000`                                | 30               | `true`            |
| Geocoding                             | 5 000                     | 2                                                                    | 60                                         | `5` / `60 000`                                 | 365              | `true`            |
| Maps / tiles                          | client-side, provider SDK | provider SDK                                                         | provider quota                             | n/a                                            | n/a (not stored) | `true` (omit map) |

Retry rules: retry only on network error, timeout, HTTP 408/429/502/503/504; honour `Retry-After`
up to the backoff cap; never retry other 4xx; total elapsed time ≤ `timeoutMs × (maxRetries + 1)`.
Circuit breaker state is per `dataSourceId` per deployment; a half-open state allows one probe.

Freshness: age = reference date − `effectiveDate` (or the retrieval date when
`effectiveDateBasis = 'retrieval_date_assumed'`). Reference date = the job's research cut-off date
if set, otherwise the valuation date. For past valuation dates, see P8.

### 5.2 Error and outage behaviour

| Condition                                                          | Detection                                                                                                   | System behaviour                                                                                                                                                        | Validation                                                                                                                                               | Audit                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Provider outage, timeout, 5xx, circuit open, rate limited          | `ConnectorError` after retries                                                                              | Manual-fallback task created on the asset, assigned to the responsible valuer, with reason code and correlation ID; no partial field writes; lookup can be re-run later | None by itself; empty mandatory planning fields fail the field rules (08)                                                                                | `datasource.lookup_failed`, `datasource.fallback_task_created` (proposed) |
| Credentials rejected / expired                                     | `AUTH_FAILED`                                                                                               | Circuit opened immediately; administrators alerted; fallback task created                                                                                               | —                                                                                                                                                        | as above                                                                  |
| Adapter disabled or licence unconfirmed                            | Registry check before call                                                                                  | No call made; fallback task with reason `ADAPTER_DISABLED` / `LICENCE_UNCONFIRMED`                                                                                      | —                                                                                                                                                        | `datasource.fallback_task_created`                                        |
| No match / ambiguous match                                         | `NO_MATCH` / `AMBIGUOUS_MATCH`                                                                              | Ambiguous: user chooses parcel from candidates. No match: fallback task                                                                                                 | —                                                                                                                                                        | `datasource.lookup_failed`                                                |
| Response fails schema validation                                   | B4                                                                                                          | Payload quarantined (if licence permits storage); treated as failure                                                                                                    | —                                                                                                                                                        | `datasource.lookup_failed`                                                |
| Data older than `freshnessDays`                                    | §5.1 freshness rule                                                                                         | Datum usable; stale badge shown; re-lookup offered                                                                                                                      | `VAL-STALE-002` (warning; acknowledgeable via `validation.acknowledged`)                                                                                 | `validation.run`                                                          |
| Provenance incomplete                                              | Any P2 element missing or `effectiveDate` null without a basis                                              | Datum cannot be verified                                                                                                                                                | `VAL-PROV-001` (blocking)                                                                                                                                | `validation.run`                                                          |
| Licence prohibits reproduction                                     | `provenance.licence.reproduction = 'prohibited'` (or `'unconfirmed'`) on a datum mapped to a report section | Datum may stay in working papers if internal use is licensed; excluded from client-facing outputs                                                                       | `VAL-PROV-003` (blocking for report inclusion; resolve by excluding from report, replacing with a reproducible source, or recording a confirmed licence) | `validation.run`                                                          |
| Adapter result conflicts with manual entry or uploaded certificate | Value comparison on candidate creation                                                                      | Both retained; conflict flagged for valuer; nothing overwritten                                                                                                         | Rule in 08                                                                                                                                               | `datasource.used`                                                         |
| Partial capability (e.g. zone but no overlays)                     | Capability vs request                                                                                       | Missing parts become manual-completion tasks                                                                                                                            | Field rules (08)                                                                                                                                         | —                                                                         |

### 5.3 Offline behaviour

Lookups need connectivity and run server-side (B7). Offline, the mobile app allows manual planning
entry and photographing or attaching a certificate; queued lookup requests run after sync. A later
adapter result is stored as a separate candidate and never replaces offline manual values.

### 5.4 Audit events

Existing (00 §8): `datasource.used`, `validation.run`, `validation.acknowledged`, `field.updated`,
`ai.suggestion_*` (when a certificate is AI-extracted). Proposed additions to 00 §8:
`datasource.lookup_failed`, `datasource.fallback_task_created`, `datasource.verified`,
`datasource.config_changed` (registry/licence/flag changes, with before/after hashes).

### 5.5 `DataSource` registry entry (illustrative)

```yaml
id: ds.vic.vicmap_planning # placeholder identifier
jurisdiction: VIC
name: 'Vicmap Planning'
adapterId: vic.vicmap_planning
enabled: false # feature flag; true only after licence.status = confirmed
egressAllowList: ['<confirm host>'] # no user-supplied URLs (B8)
licence:
  licenceId: '<confirm>'
  licenceVersion: '<confirm>'
  status: unconfirmed # unconfirmed | confirmed | expired
  usageBasis: '<confirm: internal use / report reproduction / both>'
  reproduction: unconfirmed # permitted | permitted_with_attribution | prohibited | unconfirmed
  attributionText: '<confirm>'
  rawPayloadRetentionDays: null # null = do not store raw payloads
  confirmedBy: null # DATA_LICENSING reviewer; must differ from the editor
policy:
  {
    timeoutMs: 10000,
    maxRetries: 2,
    rateLimitPerMinute: 30,
    circuitBreaker: { failureThreshold: 5, resetAfterMs: 120000 },
    freshnessDays: 30,
    manualFallback: true,
  }
```

## 6. Adapter contract tests

A shared suite (`describePlanningAdapterContract(factory, fixtures)`) runs against every adapter,
including `ManualPlanningAdapter`. Test plan details are in 12.

| #     | Test                       | Checks                                                                                                                                                     | Method                                                                                                                                        |
| ----- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| CT-01 | Recorded fixtures          | Mapping from provider response to `PlanningControlResult` for representative parcels (zone only, many overlays, scheduled overlays, no coverage)           | Fixtures replayed through an injected HTTP client; fixtures are synthetic or stored only where the licence permits `[REVIEW: DATA_LICENSING]` |
| CT-02 | No live calls in CI        | Test runner has no egress; any unmocked request fails the test                                                                                             | Network-deny in CI; HTTP client throws on unknown host                                                                                        |
| CT-03 | Response schema validation | Malformed, truncated or unexpected-type responses reject with `INVALID_RESPONSE`; no partial result                                                        | Mutated fixtures                                                                                                                              |
| CT-04 | Provenance completeness    | Every resolved result has all P2 elements, `licence` snapshot equals registry at call time, `verification.status = 'unverified'`                           | Assertion helper over all fixtures                                                                                                            |
| CT-05 | Freshness tagging          | `effectiveDate`/basis set; `VAL-STALE-002` fires at `freshnessDays + 1` and not at `freshnessDays`                                                         | Injected clock                                                                                                                                |
| CT-06 | Outage simulation          | Timeout, 5xx, 429 with `Retry-After`, connection reset, auth failure → correct retries, circuit opens at threshold, half-open probe, fallback task created | Fault-injecting HTTP client, fake timers                                                                                                      |
| CT-07 | Licence-flag enforcement   | Disabled/unconfirmed source makes no call; `prohibited` reproduction triggers `VAL-PROV-003` on report inclusion; attribution text rendered when required  | Registry fixtures + report-section mapping                                                                                                    |
| CT-08 | Capability honesty         | Adapter never populates fields outside `capabilities`; empty vs undetermined overlays distinguished                                                        | Property-based checks                                                                                                                         |
| CT-09 | Ambiguity                  | Multiple candidate parcels → `AMBIGUOUS_MATCH`, never auto-selected                                                                                        | Fixtures                                                                                                                                      |
| CT-10 | No overwrite               | Adapter result does not change verified/manual values; creates a candidate                                                                                 | Domain test                                                                                                                                   |
| CT-11 | Egress allow-list          | Redirects to non-allow-listed hosts, private IP ranges and metadata addresses are refused                                                                  | HTTP client unit tests                                                                                                                        |
| CT-12 | Log hygiene                | No address, owner or payload content in logs; correlation ID present                                                                                       | Log capture assertion                                                                                                                         |

An optional scheduled canary may call live providers from a non-CI environment with production-like
credentials; it records availability only and stores no payloads unless the licence permits.

## 7. Phasing

| Release    | Scope                                                                                                                                                                                                                                                                                       | Exit criteria                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| MVP        | Manual entry + document upload for all eight jurisdictions (`ManualPlanningAdapter`); VIC adapter (Vicmap Planning and, if permitted, Planning Property Report) behind a feature flag, enabled only if the licence is confirmed; G-NAF geocoding if licence confirmed; display-only basemap | Contract suite green for manual and VIC adapters; `VAL-PROV-001`, `VAL-PROV-003`, `VAL-STALE-002` enforced; licence records reviewed |
| Pilot      | VIC + NSW planning adapters; VIC/NSW flood and bushfire hazard adapters where licensed                                                                                                                                                                                                      | Pilot users complete jobs with adapter data; fallback rate and outage handling measured; attribution checked in issued PDFs          |
| Production | Remaining states/territories (QLD per council, WA, SA, TAS, ACT, NT) as each licence is confirmed; licensed title/parcel integration; contamination registers                                                                                                                               | Per-jurisdiction licence sign-off; per-adapter contract suite; operational runbook and monitoring                                    |

## 8. Open decisions

| #   | Decision                                                                                                           | Owner                                         |
| --- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 1   | First jurisdictions and authorised data providers (brief §12, decision D2)                                         | Product + `[REVIEW: DATA_LICENSING]`          |
| 2   | Whether automated generation and storage of the VIC Planning Property Report is permitted                          | `[REVIEW: DATA_LICENSING]`                    |
| 3   | Freshness thresholds per family and per purpose                                                                    | `[REVIEW: API_STANDARDS]`                     |
| 4   | Report wording for adapter-sourced planning data, hazard "not mapped" statements and current-controls-only caveats | `[REVIEW: API_STANDARDS]`, `[REVIEW: LEGAL]`  |
| 5   | QLD council adapter priority list                                                                                  | Product, based on job volume                  |
| 6   | Retention of raw provider payloads per licence (see 11 §5, RC-15)                                                  | `[REVIEW: DATA_LICENSING]`, `[REVIEW: LEGAL]` |
