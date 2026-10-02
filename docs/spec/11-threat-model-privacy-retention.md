# 11 — Threat model, privacy impact checklist and data-retention model

> Status: **Draft for review** · Owner: Security & privacy lead (with `SECURITY`, `PRIVACY` and `LEGAL` reviewers) · Applies to: all components, environments, integrations and record classes

This section identifies threats to the platform and its data, the baseline controls that address
them, a privacy impact checklist against the Australian Privacy Principles (APPs), and the default
retention model. Vocabulary follows `00-architecture-and-conventions.md`. Nothing here is a claim of
compliance with any law, standard or framework; controls are designed to support the customer's
own obligations, and every unresolved interpretation is tagged `[REVIEW: …]`.

Rating scale used below: **L**ikelihood and **I**mpact each `L`/`M`/`H`; residual risk `L`/`M`/`H`
after the listed mitigations.

## 1. System context and trust boundaries

### 1.1 Context diagram

```
┌──────────────────────── TB-1 untrusted: devices, browsers, public networks ────────────────────────┐
│  Mobile app (iOS/Android)                                  Web portal (browser)                     │
│  SQLCipher store · photo cache · sync queue                admin · QA · allocation · finance · client│
└───────────────┬───────────────────────────────────────────────────────┬────────────────────────────┘
                │ TLS 1.2+ · OIDC access token · device ID               │ TLS 1.2+ · OIDC session
                ▼                                                        ▼
┌──────────────────────────── TB-2 platform boundary (AU region) ─────────────────────────────────────┐
│  Edge (WAF, rate limiting) ─▶ API service (REST /v1, sync endpoint, @vp/domain)                     │
│      ├─ TB-3 PDF renderer (sandboxed, no network egress)                                             │
│      ├─ Workers: adapter calls · AI orchestration · email dispatch · retention jobs                  │
│      ├─ TB-4 PostgreSQL (row-level tenant isolation, append-only audit tables)                       │
│      └─ TB-4 Object storage (KMS encryption; object-lock bucket for issued artefacts; audit anchors) │
└──────┬──────────────────┬───────────────────┬──────────────────┬────────────────────────────────────┘
       │ TB-5 egress       │ TB-6               │ TB-7              │ TB-8
       ▼ allow-list        ▼                    ▼                   ▼
  Data providers       AI/ML suggestion     Email provider      Identity provider (OIDC, MFA)
  (planning, hazards,  service (location    (send API, signed
   title, geocode,      per processor        delivery webhooks)
   maps)                register §4.5)
Logical boundaries: TB-9 tenant ↔ tenant, portfolio ↔ portfolio, client wall ↔ client wall
Operational boundary: TB-10 operators, CI/CD and cloud control plane ↔ production
```

### 1.2 Components

| ID | Component | Holds / processes | Trust notes |
|----|-----------|-------------------|-------------|
| C-01 | Mobile app + offline store | Assigned jobs, field values, photos, sketches, sync queue | Device may be lost, rooted or offline for days; SQLCipher key in OS keystore; server re-validates everything |
| C-02 | Web portal | Same data via API; QA, finance, admin, client views | Browser is untrusted; no business rules trusted client-side |
| C-03 | Sync API | Operation batches with client UUIDs and per-device sequence numbers | Idempotent replay (ADR-004); conflict detection |
| C-04 | API service | All business decisions via `@vp/domain`; authN/authZ | Single policy enforcement point |
| C-05 | PostgreSQL | Records, append-only hash-chained audit (ADR-006) | App role has INSERT-only on audit tables |
| C-06 | Object storage | Photos, plans, documents, PDFs, snapshots, audit anchors | Issued artefacts in object-lock bucket (compliance mode) |
| C-07 | PDF renderer | Snapshot → deterministic PDF (ADR-007) | Processes user-entered text; sandboxed |
| C-08 | Integration adapters | Planning, hazard, title, geocode, map calls (04) | Responses are untrusted input; egress allow-list |
| C-09 | AI/ML suggestion service | Photos, uploaded documents → suggestions | Output untrusted; cannot write facts; may be offshore |
| C-10 | Email provider | Recipient addresses, report links/attachments | Processor; delivery webhooks must be authenticated |
| C-11 | Identity provider | Credentials, MFA factors, group/role claims | Source of identity; MFA assurance in token claims |
| C-12 | CI/CD and cloud control plane | Source, build artefacts, deployment credentials | Supply-chain and privileged-access exposure |

### 1.3 Trust boundaries

| ID | Boundary | What crosses it | Primary controls | Threats |
|----|----------|-----------------|------------------|---------|
| TB-1 | Device/browser ↔ platform | Sync batches, uploads, API calls, tokens | TLS, OIDC tokens bound to device, server-side re-validation, rate limits | T-01–T-04, T-27, T-35, T-37 |
| TB-2 | Edge ↔ API service | Authenticated requests | WAF, authentication, deny-by-default authorisation | T-04, T-05, T-32 |
| TB-3 | API ↔ PDF renderer | Snapshot data including user text | Escaping, sandbox, no egress | T-14 |
| TB-4 | API ↔ PostgreSQL / object storage | Records, audit events, files | RLS, INSERT-only audit grants, KMS, object-lock | T-06, T-07, T-11, T-13 |
| TB-5 | Workers ↔ data providers | Lookup requests and untrusted responses | Egress allow-list, schema validation, licence registry | T-15, T-16, T-34 |
| TB-6 | Workers ↔ AI/ML service | Photos, document text; untrusted suggestions | Data minimisation, schema-validated output, no write access | T-08, T-17, T-18 |
| TB-7 | Workers ↔ email provider | Recipients, content/links; delivery webhooks | Approved recipients, signed webhooks, SPF/DKIM/DMARC | T-21–T-23 |
| TB-8 | Platform ↔ identity provider | Authentication, MFA claims, group claims | OIDC validation, MFA claim checks | T-03, T-10, T-26 |
| TB-9 | Tenant / portfolio / client wall | Queries and results within one deployment | Tenant ID from token, RLS, portfolio membership, wall lists | T-05, T-06, T-33 |
| TB-10 | Operators and CI/CD ↔ production | Deployments, privileged access, secrets | Just-in-time access, workload identity, signed artefacts | T-13, T-28, T-29 |

### 1.4 Data classes

| Class | Examples | Notes |
|-------|----------|-------|
| Personal information | Client contacts, occupants and tenants, owners on title, people/number plates/personal documents in photos, user accounts | APP obligations (§4) |
| Confidential client information | Instructions, valuations, leases, rent rolls, financial statements, QA findings | Contractual confidentiality; Chinese walls |
| Licensed third-party data | Planning/title/hazard/sales data, cost guides | Licence terms (04); reproduction limits |
| Integrity-critical records | Certifications, issued snapshots and PDFs, audit events | Tamper evidence; immutability after issue |
| Secrets | Provider credentials, signing keys, KMS grants | Managed secret store only |

## 2. STRIDE threat table

STRIDE: **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of
service, **E**levation of privilege. Verification entries map to the test plan (12) or to an
operational control.

| ID | Component | STRIDE | Threat | L / I | Mitigations | Residual | Verification |
|----|-----------|--------|--------|-------|-------------|----------|--------------|
| T-01 | C-01 | I | Lost or stolen device exposes offline job data and photos | M / H | SQLCipher store with key in hardware-backed keystore; app unlock (biometric/PIN) after inactivity; device passcode required; only assigned jobs cached; photos kept in app sandbox, not the gallery; remote wipe on next contact; offline grace period after which the store locks until online re-authentication; device deregistration revokes refresh tokens | M | Mobile integration tests (wipe, lock after grace period); control: device-loss runbook |
| T-02 | C-03 | T / D | Sync replay or duplication creates duplicate assets/photos or re-applies stale edits | M / M | Client-generated UUIDs; per-operation idempotency keys and server dedupe table; per-device monotonic sequence numbers; photo content hash (SHA-256 at capture) dedupe; field-level conflict detection (`sync.conflict_detected`); tokens bound to device registration | L | Property-based sync tests: replayed/reordered batches converge with no duplicates (brief §10 acceptance) |
| T-03 | C-11, C-02 | S | Account takeover via phishing, credential stuffing or MFA fatigue | M / H | OIDC SSO; MFA for all users, phishing-resistant factors preferred for privileged roles; step-up MFA for certification, QA approval, issue and admin; IdP lockout and anomaly detection; no local passwords in the platform | M | IdP configuration review; API tests reject tokens lacking required MFA claims |
| T-04 | C-04 | I / E | Broken object-level authorisation (IDOR): user reads or edits a job, photo or report by guessing an ID | M / H | Deny-by-default; every handler calls the domain permission check with the resolved resource; tenant ID in every query plus PostgreSQL row-level security as defence in depth; signed, short-lived object-storage URLs scoped to one object | L | Generated authorisation tests per endpoint × role; DAST; penetration test |
| T-05 | C-04 | I | Unauthorised access across clients/portfolios — Chinese-wall breach (e.g. valuer working for two competing clients, client seeing another client's portfolio) | M / H | Restricted portfolios require explicit membership even for organisation-wide roles (00 §5); client-level wall lists block named users; conflict check at instruction; `CLIENT_READONLY` limited to issued reports/invoices of its own client entities; server-side filtering of search, map pins and exports; `auth.denied` audited | L | Permission-matrix unit tests; API tests for walled users on list, search, map and export endpoints |
| T-06 | C-04, C-05 | I | Cross-tenant data exposure in multi-tenant deployment | L / H | Tenant ID from token only (never request body); RLS policies; per-tenant encryption keys; tenant-scoped object prefixes and KMS grants; no shared caches without tenant key | L | RLS tests with cross-tenant fixtures; penetration test |
| T-07 | C-04, C-05, C-06 | T | Evidence tampered with after certification (photo swapped, comparable edited, area changed) | M / H | Records editable only in `draft`/`active`/`returned` (00 §7); submission records the snapshot hash; approval and issue re-verify it; photo originals content-addressed and write-once; DB guards reject updates to locked records; changes after issue only via `openAmendment` creating a new version | L | Domain workflow-guard tests; integration test: post-submission edit rejected; hash mismatch blocks `report.issued` |
| T-08 | C-09, C-04 | T | AI silently alters or creates facts (improvement attributes, areas, planning data) | M / H | AI actor has no permission to write accepted facts; suggestions stored separately with confidence and source; only a human `ai.suggestion_accepted`/`_edited` action writes a fact, retaining author, time and source provenance; no auto-accept setting; AI service credentials scoped to the suggestion store | L | Permission tests (AI actor denied `field.update`, `certification.sign`, `qa.approve`, `report.issue`); integration test end-to-end (brief §10 acceptance) |
| T-09 | C-04 | E / R | Self-approval in QA (valuer approves own job; one person with two accounts) | M / H | `qa.approve` blocked for the responsible valuer; exception needs a different user holding `qa.self_approval_exception` and a recorded reason (`qa.self_approval_exception_authorised`); MFA on approval; IdP-linked identity (one person, one subject) and duplicate-account review | M (collusion) | Domain separation-of-duties tests; control: quarterly review of exceptions and duplicate identities |
| T-10 | C-04, C-11 | S / R | Forged certification signature (another user, an administrator, the system or AI signs for the valuer) | L / H | `certification.sign` only by the job's responsible valuer as a human actor with fresh step-up MFA; certification record binds user ID, credential snapshot, time and snapshot hash and is signed with a platform KMS key; signature image rendered only from that record; no uploaded signature images selectable by other users | L | Domain tests (non-responsible user, system and AI actors denied; stale MFA denied); audit-chain verification test |
| T-11 | C-06, C-07 | T | Issued report or snapshot altered after issue | L / H | Issued PDF and snapshot stored in object-lock bucket (compliance mode) with SHA-256 recorded in the audit chain; deterministic re-render reproduces the PDF from the snapshot; optional PDF digital signature `[REVIEW: LEGAL]` | L | Reproducibility test (re-render byte-equal); object-lock configuration check in deployment tests |
| T-12 | External | S | Forged or edited PDF circulated as a genuine report from the firm | M / M | Report ID and hash printed on each page; recipient verification function (enter report ID / upload file → match against issued hash); watermark; digital signature option | M | Integration test of verification function |
| T-13 | C-05, C-12 | T / R | Insider deletes or rewrites audit events to hide an action | L / H | Append-only tables: INSERT-only grants, triggers reject UPDATE/DELETE/TRUNCATE; per-stream hash chain (ADR-006); periodic chain-head anchoring to object-lock storage in a separate account; daily chain verification with alerting; no standing superuser access (break-glass, audited) | L | Audit-integrity tests (mutation detected); control: break-glass access review |
| T-14 | C-07 | T / E | PDF/HTML injection via user text (script, external resource fetch, layout spoofing); CSV formula injection in exports | M / M | Templating with mandatory escaping; rich text limited to a sanitised subset; renderer runs with JavaScript disabled, no network egress, no local file access, CPU/memory/time limits; assets only from the snapshot; CSV cells beginning with `= + - @` neutralised | L | Renderer tests with injection corpus; export tests |
| T-15 | C-08 | E / I | Server-side request forgery via adapter URLs (user-supplied or redirected URLs reach internal services or cloud metadata) | L / H | Adapters never accept URLs from users or job data; endpoints only from the `DataSource` registry; host allow-list; private, loopback and link-local ranges blocked after DNS resolution; redirects re-validated; adapters run in an egress-restricted network segment | L | HTTP client unit tests (04 CT-11); network policy check |
| T-16 | C-08, C-07 | I | Data-licence breach: restricted data republished in reports, exports or client portal, or bulk-cached | M / H | Licence records with reproduction rights (04 §5.5); `VAL-PROV-003` blocks report inclusion of prohibited data; attribution rendered from config; raw payload storage only where permitted; no bulk export of licensed raw data; adapters disabled until licence confirmed `[REVIEW: DATA_LICENSING]` | M | 04 CT-07; report rendering tests for attribution |
| T-17 | C-09 | T | Prompt injection via uploaded documents (instructions hidden in a lease, certificate or plan) manipulate AI extraction | M / M | Document text treated as data, separated from instructions; structured output validated against a schema; model has no tools or write access; output limited to suggestions on predefined fields, each linked to page/region of source; human accept/edit/reject; adversarial test corpus | M | AI extraction tests with injection corpus; schema-rejection tests |
| T-18 | C-09, C-10 | I | Personal or confidential data processed or retained offshore or used for model training by a processor | M / H | Processor register (§4.5); AU-region processing where available; contractual no-training and minimum/zero retention; organisation switch to disable AI features or offshore processors; redacted derivatives sent where privacy flags exist `[REVIEW: PRIVACY]` | M | Control: DPA review; configuration test that disabled processors receive no calls |
| T-19 | C-01, C-06 | I | Personal information in photos (people, number plates, personal documents, screens, family photos) exposed in reports or client portal | H / M | On-device detection raises `photo.privacy_flagged`; redaction workflow (§4.4) producing `photo.redacted` derivatives; client-facing outputs use redacted derivatives only; unresolved privacy flags block photo inclusion in reports; restricted access to unredacted originals; shorter retention (§5) | M | Redaction workflow tests; report tests confirm only redacted derivatives render |
| T-20 | C-06, C-07 | I | Photo metadata (EXIF GPS, device, timestamps) leaks via client outputs | M / L | Metadata stripped from all derivatives used in PDFs, portal and email; originals retain metadata for internal evidence only; photo GPS optional | L | Derivative-generation tests |
| T-21 | C-10, C-04 | I | Report emailed to unapproved recipients (typo, autocomplete, malicious change) | M / H | Approved-recipient list per job derived from intended users and approved by the valuer or allocator; send only to listed addresses, no free-text recipients at send time; list changes audited; optional client domain allow-list; secure portal link by default rather than attachment (configurable) | L | API tests: unlisted address rejected; `email.queued` records recipient set |
| T-22 | C-10 | S | Attackers spoof the firm's email to send fake reports or invoices (payment redirection) | M / H | SPF, DKIM and DMARC enforcement on sending domain; invoices state that bank details never change by email; links only to the portal domain | M | Control: DNS configuration check |
| T-23 | C-10 | S / R | Forged email delivery-status webhooks falsify `email.delivery_updated` | L / M | Webhook signature verification, timestamp window, idempotency; provider IP allow-list where offered | L | Webhook handler tests |
| T-24 | C-04, C-06 | T / D | Malicious uploads (malware, decompression bombs, polyglot files, oversized media) | M / M | Type allow-list with content sniffing; size and page-count limits; asynchronous malware scan with quarantine; images re-encoded; PDF processing in sandbox | L | Upload tests with malicious corpus |
| T-25 | C-04 | T / E | Unauthorised change to templates, rule sets or certification wording | L / H | Versioned templates/rule sets; `template.approve`/`ruleset.approve` never by the author (00 §5); only approved versions usable in production; `reviewStatus` gate (G1); audited | L | Domain tests for approval separation and status gate |
| T-26 | C-04, C-11 | E | Privilege escalation through role administration (admin grants self or ally certification/QA rights) | L / H | Privileged role grants require a second administrator; role changes audited; IdP group mapping reviewed; quarterly access review | L | Permission tests; control: access review |
| T-27 | C-01 | R / T | Device clock or GPS spoofed to fabricate inspection time or location | M / M | Server receipt time stored alongside device time; skew flagged; GPS stored as "device-reported", never "verified"; mock-location signal recorded where the OS exposes it | M (inherent) | Sync tests for skew flagging |
| T-28 | C-12 | T / E | Dependency or supply-chain compromise (malicious package, compromised build, mobile SDK collecting data) | M / H | Frozen lockfile; dependency scanning and review of new dependencies; install scripts restricted; SBOM per build; signed build artefacts and images; minimal base images; third-party mobile SDK privacy review | M | CI gates (SCA, SBOM, signature verification) |
| T-29 | C-12 | I / E | Secrets leaked from repository, CI logs or environment files | M / H | Managed secret store; workload identity federation from CI (no long-lived cloud keys); secret scanning pre-commit and in CI; masked CI logs; protected production deployment environment | L | CI secret-scan gate; control: rotation schedule |
| T-30 | C-04, C-01 | I | Personal information in logs, traces, crash reports or analytics | M / M | Structured logging with field allow-list (IDs and codes, never values); crash-report scrubbing; telemetry SDKs configured without PI; restricted log access | L | Log-capture tests (04 CT-12 pattern); control: log sampling review |
| T-31 | C-05, C-06 | I | Backup exposure, or deleted data reappearing after restore | L / H | Encrypted backups in separate account, AU region; restricted restore rights; deletion tombstones re-applied after restore; crypto-shredding for tenant offboarding (§5.4) | L | Quarterly restore test including tombstone re-application |
| T-32 | C-03, C-07 | D | Resource exhaustion on sync, upload or PDF rendering | M / M | Per-user/device rate limits; batch and upload size limits; resumable uploads with quotas; render queue with concurrency limits and timeouts; WAF; autoscaling | L | Load tests (12) |
| T-33 | C-04 | I | Authorised insider bulk-exports client data | M / H | Export permission restricted and audited; volume anomaly alerting; exports watermarked; no bulk export for `CLIENT_READONLY` or `FIELD_INSPECTOR` | M | Permission tests; control: alert review |
| T-34 | C-08 | T | Incorrect or poisoned external data accepted as fact | M / M | Schema validation; provenance; adapter results are unverified candidates; conflict flags vs documents; outlier validations (08) | L | 04 CT-03, CT-10 |
| T-35 | C-01 | S / E | Rooted/jailbroken device or tampered app extracts tokens or bypasses client-side checks | M / M | Tokens in OS keystore; app attestation signal on sync where available; root/jailbreak detection as a policy signal (warn or block per organisation); all rules re-run server-side | M | Server tests confirm client-asserted state is re-validated |
| T-36 | Retention service | T / D | Premature deletion, deletion under legal hold, or deletion of issued artefacts | L / H | Retention jobs check holds and object-lock; dry-run and approval for job files and issued artefacts; audited runs (§5.5) | L | Retention job tests (hold blocks purge; locked objects untouched) |
| T-37 | C-02 | S / T | Web session hijack via XSS or CSRF | M / H | Strict Content Security Policy; framework auto-escaping; HttpOnly/Secure/SameSite cookies via backend-for-frontend or short-lived tokens; CSRF protection on state-changing requests | L | DAST; CSP report monitoring |

## 3. Security controls baseline

Posture references: the ASD Essential Eight and the Information Security Manual (ISM) are used as
**reference frameworks** only. The Essential Eight is framed mainly around organisational endpoints;
its mapping to a SaaS platform and its mobile clients needs interpretation `[REVIEW: SECURITY]`.
Parameter values below are proposals `[REVIEW: SECURITY]`.

| ID | Area | Control | Proposed parameters / notes | Posture reference |
|----|------|---------|-----------------------------|-------------------|
| SC-01 | Identity | OIDC SSO (authorisation code + PKCE for mobile and web) with the customer's or platform's IdP | No platform-held passwords | ISM (authentication) |
| SC-02 | MFA | MFA for all users; **mandatory step-up MFA** for `certification.sign`, `qa.approve`, `report.issue`, `qa.self_approval_exception`, legal hold, retention approval and admin actions | Step-up within 10 minutes of the action, verified from token claims; phishing-resistant factors for `ADMINISTRATOR` | E8: multi-factor authentication |
| SC-03 | Sessions | Short-lived access tokens, rotating refresh tokens bound to device registration, server-side revocation | Access ≤ 15 min; offline grace period default 7 days, configurable per organisation | ISM (session management) |
| SC-04 | Authorisation | Least-privilege RBAC (00 §5) with separation of duties; portfolio membership and client walls; deny-by-default; `auth.denied` audited | Permission matrix generated from code | E8: restrict administrative privileges |
| SC-05 | Tenant isolation | Tenant ID from token; PostgreSQL row-level security; per-tenant KMS keys and object prefixes | — | ISM (data segregation) |
| SC-06 | Encryption in transit | TLS 1.2+ (prefer 1.3) everywhere including internal service calls; HSTS on web | Certificate pinning on mobile optional (operational trade-off) | ISM (cryptography) |
| SC-07 | Encryption at rest | KMS-managed keys; envelope encryption with per-tenant key-encryption keys and per-job data keys for object storage | Enables crypto-shredding (§5.4) | ISM (cryptography) |
| SC-08 | Device protection | SQLCipher local store, key in hardware-backed keystore; app unlock; device passcode required; remote wipe of local store on next contact; root/jailbreak signal; minimum OS versions | Optional MDM integration per organisation | E8: patch operating systems (minimum OS) |
| SC-09 | Audit integrity | Append-only, hash-chained audit events (ADR-006); INSERT-only DB grants; chain-head anchoring to object-lock storage in a separate account; daily verification | Anchor interval: hourly | ISM (event logging) |
| SC-10 | Secrets | Managed secret store; never in repository or committed env files; CI uses workload identity federation; rotation | Secret scanning blocks merge | ISM (secrets/credentials) |
| SC-11 | Environments | Separate cloud accounts/subscriptions per environment; environment-specific configuration; no production data in non-production; synthetic test data | — | ISM (system hardening) |
| SC-12 | Supply chain | Frozen lockfile; dependency scanning; SBOM; signed artefacts; dependency update automation with review | Critical vulnerabilities patched within 48 h of available fix | E8: patch applications; application control (signed images) |
| SC-13 | Secure development | SAST and secret scanning on every change; DAST on staging; mandatory code review; threat-model update per major feature; penetration test before production and annually | — | ISM (software development) |
| SC-14 | Egress control | Allow-listed outbound hosts per worker; PDF renderer has no egress; private ranges blocked | — | ISM (network segmentation) |
| SC-15 | Input handling | Upload type/size limits, malware scan, image re-encoding, metadata stripping; templating with escaping | — | E8: user application hardening (web) |
| SC-16 | Logging and observability | Structured logs and traces with correlation IDs; field allow-list (no PI, no field values); security alerting on auth anomalies, chain-verification failures, export volume, circuit-breaker events | Operational logs 90 days; security logs 12 months (§5) | ISM (event logging) |
| SC-17 | Backups | PostgreSQL point-in-time recovery; object storage versioning and AU-region replication; encrypted, separate account; quarterly restore tests | Proposed RPO 15 min, RTO 4 h for production `[REVIEW: SECURITY]` | E8: regular backups |
| SC-18 | Privileged access | No standing production access; just-in-time elevation with approval; break-glass accounts audited and reviewed | — | E8: restrict administrative privileges |
| SC-19 | Incident and breach management | Incident register; runbooks (device loss, credential compromise, data exposure, provider breach); NDB assessment workflow (§4.6) | Incident records retained per §5 | ISM (incident management) |
| SC-20 | Hosting | Australian-hosted deployment option (ADR-008) including backups and logs; processors outside Australia listed in §4.5 | Decision D6 | — |

## 4. Privacy impact checklist

### 4.1 Applicability `[REVIEW: PRIVACY]`

| Question | Working position |
|----------|------------------|
| Who is the APP entity? | Usually the customer valuation firm, which collects personal information during engagements. The platform operator acts as a service provider/processor under contract; in an internal-firm deployment they are the same entity (decision D1). |
| Small business exemption | Some firms may fall under the small business exemption; the platform is designed to the APPs regardless. |
| Public-sector clients | Government clients may impose state/territory or Commonwealth privacy obligations contractually. |
| Recent Privacy Act amendments | 2024 amendments introduced, among other things, transparency requirements for automated decisions in privacy policies. AI here suggests and humans decide; confirm whether disclosure is still required. |
| Privacy impact assessment | A full PIA by the customer privacy officer before production; this checklist is its input. |

### 4.2 APP checklist

Status values: `Open` (not yet designed), `Designed` (specified here or in another section),
`Implemented` (built and tested). No item is `Implemented` at this draft.

| APP | Requirement (summary) | How the platform addresses it | Owner | Status |
|-----|-----------------------|-------------------------------|-------|--------|
| APP 1 | Open and transparent management of personal information | Data inventory (§5 record classes); privacy-by-design reviews per feature; privacy policy template for customers covering inspection photos, AI suggestions, processors and offshore disclosure | Customer privacy officer; Product | Open |
| APP 2 | Anonymity and pseudonymity | Instructing clients must be identified (engagement, conflicts). Occupant and tenant names optional; lease schedules can use entity names; comparables need no individual names | Product | Designed |
| APP 3 | Collection of solicited information; sensitive information | Only fields required by the active rule set; no fields for sensitive information; capture guidance to avoid photographing people, personal documents, medical equipment or religious items; contacts via OS picker only (§4.3) | Product; Customer | Designed |
| APP 4 | Unsolicited personal information | Privacy flags on photos and documents; redact or destroy where not needed for the engagement; audited deletion of non-required uploads | Product | Designed |
| APP 5 | Notification of collection | Collection-notice templates: client engagement terms; occupant/tenant notice provided at inspection (printable or message text) stating purpose, photos, recipients, access and correction | Customer privacy officer | Open |
| APP 6 | Use or disclosure | Job data used only for the engagement; disclosure only to approved recipients and intended users; reliance and confidentiality clauses; no use of customer data for model training or analytics beyond PII-free telemetry without written agreement | Product; `[REVIEW: LEGAL]` | Designed |
| APP 7 | Direct marketing | No direct marketing from job data; no contact export to marketing tools | Customer | Designed |
| APP 8 | Cross-border disclosure | AU-hosted default; processor register with processing locations (§4.5); organisation switch to disable offshore processors; DPAs with APP-equivalent obligations; customer privacy policy lists countries | Product; Legal; Customer | Open |
| APP 9 | Government related identifiers | No platform fields for government identifiers (e.g. driver licence, Medicare, TFN); never used as keys; redaction prompt when detected in photos/documents | Product | Designed |
| APP 10 | Quality of personal information | Verification status and provenance on external data; contact validation; correction workflow | Product | Designed |
| APP 11 | Security; destruction or de-identification | Controls §3; retention and secure deletion §5; destruction when no longer needed unless retention is required by law or contract | Security; Product | Designed |
| APP 12 | Access to personal information | Administrator search across jobs by name/email/phone; export in readable form; exceptions (e.g. confidential valuation reasoning, privilege) decided by customer | Customer privacy officer; Product | Open |
| APP 13 | Correction | Live records corrected by audited edit; issued reports immutable — correction via amendment or an associated correction statement, notified to prior recipients where required | Product; `[REVIEW: LEGAL]` | Designed |

### 4.3 Device permissions and consent

All permissions are requested just-in-time with a purpose string; denial never blocks unrelated
features.

| Permission | When requested | Default | Purpose | If denied |
|------------|----------------|---------|---------|-----------|
| Camera | First photo or document capture | Off until granted | Inspection evidence, plan capture, barcode/document capture | Attach from files |
| Location | Only when the user taps "show my location", enables photo GPS or starts navigation handoff | Foreground ("while using") only; never background by default; photo GPS off unless enabled per organisation/job | Map position, optional photo geotag | Map without user position; no photo GPS |
| Contacts | Only when picking a contact for a job party | OS contact picker returning the selected contact only, without full address-book access where the OS supports it | Prefill a contact | Manual entry |
| Microphone / speech | First voice-to-text use | Off until granted; on-device recognition preferred; cloud recognition listed in §4.5 | Dictation of notes | Keyboard entry |
| Photo library | Import of existing images | Limited/selected-photo access where the OS supports it | Import plans/photos | Camera or files |
| Notifications | After first assignment | Off until granted | Assignment and QA alerts | In-app inbox |

Permission grants and denials are recorded on the device for UX only; location or contact data is
never collected in the background.

### 4.4 Redaction workflow

| Step | Actor | Behaviour | Audit |
|------|-------|-----------|-------|
| 1 Detect | Device model / server check | Flags faces, people, number plates, personal documents, screens, family photos | `photo.privacy_flagged` |
| 2 Decide | Inspector or valuer | Redact, retake, mark "not personal information", or record consent of the individual | `photo.privacy_flagged` (disposition) |
| 3 Redact | Inspector or valuer | Blur/box regions; redacted derivative created; metadata stripped | `photo.redacted` |
| 4 Restrict | System | Unredacted original accessible only to the job's valuer and QA reviewer; never in reports, portal or email | — |
| 5 Gate | System | Unresolved privacy flags block inclusion of that photo in reports (rule in 08) | `validation.run` |
| 6 Retain | Retention service | Unredacted originals follow RC-06 (§5.2) | `retention.record_purged` (proposed) |

Consent wording and whether consent can replace redaction for client-facing outputs `[REVIEW: PRIVACY]`.

### 4.5 Processor register and cross-border disclosure (APP 8) `[REVIEW: PRIVACY]`

| Processor category | Data shared | Expected location | Handling |
|--------------------|-------------|-------------------|----------|
| Cloud hosting (compute, DB, storage, backups) | All | Australian region (ADR-008) | DPA; AU-only replication |
| Identity provider | User identity, MFA factors | Confirm per provider | DPA; customer may bring own IdP |
| AI/ML suggestion service | Photos (redacted where flagged), document text | May be offshore | AU-region option preferred; no-training and minimum/zero retention terms; organisation switch to disable |
| Email provider | Recipient addresses, message content or links | May be offshore | DPA; links rather than attachments by default |
| Speech-to-text (if cloud) | Voice audio | May be offshore | On-device preferred; disable switch |
| Maps / geocoding | Addresses, coordinates | May be offshore | Minimum data; provider terms (04 §4) |
| Crash reporting / telemetry | Device and app diagnostics (no PI) | May be offshore | Scrubbing; disable switch |
| E-signature, accounting (later) | Signer identity, invoice data | Confirm per provider | DPA |

Data-processing agreements must cover at least: purpose limitation; processing location and
onward transfer; security controls; sub-processor approval; breach notification to the customer
within a contracted period (proposed 24–72 hours `[REVIEW: LEGAL]`); assistance with access and
correction requests; deletion or return at end of service; audit rights; no training on customer data.

### 4.6 Notifiable Data Breaches response process

Based on the Notifiable Data Breaches scheme in Part IIIC of the Privacy Act 1988. Procedure and
thresholds `[REVIEW: PRIVACY]` `[REVIEW: LEGAL]`.

| Step | Activity | Timing (proposed) | Record |
|------|----------|-------------------|--------|
| 1 Contain | Revoke tokens, wipe devices, rotate secrets, disable integrations, preserve evidence (legal hold on affected records) | Immediately | Incident register entry; `legal_hold.applied` |
| 2 Notify customer (operator as processor) | Inform affected customer organisations with known facts | Within the DPA period | Incident register |
| 3 Assess | Determine whether an eligible data breach is likely (likely serious harm, remedial action not effective); identify affected individuals using audit and access logs | Promptly; the scheme expects assessment within 30 days | Assessment record with reasoning |
| 4 Notify | If eligible: the APP entity notifies the OAIC and affected individuals (or publishes a statement) as soon as practicable | As soon as practicable | Copies of notifications |
| 5 Review | Root cause, control changes, threat-model update | Within 30 days of closure | Post-incident report |

Proposed audit actions for incident handling (additions to 00 §8): `incident.recorded`,
`incident.assessed`, `incident.notified`, `incident.closed`.

### 4.7 Additional privacy controls

| Item | Control | Status |
|------|---------|--------|
| Children and vulnerable occupants | Capture guidance; redaction prompt; no names recorded | Designed |
| Tenant and lease information | Tenancy schedules visible only to job members; client portal shows issued report only | Designed |
| De-identified analytics | Product analytics use event counts without job content or PI | Designed |
| Staff training | Inspector privacy briefing before first job (customer) | Open |
| Privacy review gate | Each new data field, processor or AI feature requires privacy review before release | Designed |

## 5. Data-retention model `[REVIEW: LEGAL]`

### 5.1 Principles

| # | Principle |
|---|-----------|
| R1 | Retention periods depend on professional indemnity insurer requirements, state and territory limitation periods, tax and financial record-keeping obligations, professional rules (e.g. API rules `[REVIEW: API_STANDARDS]`) and data-licence terms. All periods are **configuration per organisation**; the values below are placeholders for review. |
| R2 | A `RetentionPolicy` is versioned with an effective date, authored and approved by different users, with legal sign-off recorded. A change applies prospectively and can never shorten an object-lock retention date already set. |
| R3 | Each record class has a trigger event that starts its clock; periods are measured from the trigger. |
| R4 | Legal hold overrides every deletion path (§5.3). |
| R5 | Deletion is secure (§5.4) and audited (§5.5); a tombstone (record ID, class, deletion time, policy version, run ID) is kept so restores can re-apply deletions. |
| R6 | Personal information that is no longer needed and not required to be retained is destroyed or de-identified (APP 11). |

### 5.2 Record classes and default retention

| ID | Record class | Includes | Trigger | Proposed default | Deletion method | Legal hold | Review |
|----|--------------|----------|---------|------------------|-----------------|------------|--------|
| RC-01 | Job file and working papers | Field values, inspection notes, comparables, calculations, overrides, QA findings, uploaded documents (engagement letters, leases, certificates, title searches), drafts | Report issue; or cancellation | 7 years after issue; 7 years after cancellation if engagement accepted; 1 year if never left `draft` | Hard delete rows and objects; per-job data key destroyed; tombstone | Overrides | `[REVIEW: LEGAL]` `[REVIEW: API_STANDARDS]` |
| RC-02 | Issued report and snapshot | Issued PDF, canonical snapshot, snapshot hash, issued sketch and area schedule, certification record, amendments and superseded issues | Issue date (latest issue of the job) | 7 years; object-lock retention date set at issue | Object-lock prevents deletion until expiry; lifecycle deletion after expiry if no hold; data key destroyed only after lock expiry | Overrides (object-lock legal hold) | `[REVIEW: LEGAL]`; family-law and financial-reporting work may need longer `[REVIEW: FAMILY_LAW]` `[REVIEW: ACCOUNTING]` |
| RC-03 | Audit events — job streams | `job.*`, `field.updated`, `photo.*`, `ai.*`, `certification.*`, `qa.*`, `report.*`, `email.*` | End of RC-01/RC-02 retention (whichever later) | +1 year | Whole-stream purge recorded as `retention.stream_purged` (stream ID, final hash, event count) in the organisation retention stream | Overrides | `[REVIEW: LEGAL]` |
| RC-04 | Audit events — security and administration | `auth.denied`, role and configuration changes, template/rule-set approvals, legal hold, retention runs | Event time | Authentication/authorisation events 2 years; configuration, approval, legal-hold and retention events 7 years | Time-partition purge with chain checkpoint | Overrides | `[REVIEW: SECURITY]` |
| RC-05 | Photos — redacted derivatives and unflagged photos | Photos without privacy flags, redacted derivatives, captions, annotations | As RC-01 (or RC-02 if in issued report) | As RC-01 / RC-02 | As RC-01 / RC-02 | Overrides | — |
| RC-06 | Photos — unredacted originals with privacy flags | Originals that triggered `photo.privacy_flagged` | Report issue | 90 days after issue, unless the valuer records that the original is required as evidence (then RC-01 with restricted access) | Hard delete; object key destroyed | Overrides | `[REVIEW: PRIVACY]` |
| RC-07 | Sketches and area schedules | Source plans, calibrations, sketch versions, area schedules, measurement approvals | As RC-01; issued versions as RC-02 | As RC-01 / RC-02 | As RC-01 / RC-02 | Overrides | — |
| RC-08 | Invoices and financial records | Invoices, credit notes, payment status, finance exports | End of the financial year of the transaction | 7 years | Hard delete (accounting system of record may retain separately) | Overrides | `[REVIEW: TAX]` `[REVIEW: ACCOUNTING]` |
| RC-09 | Email delivery records | Recipient set, message IDs, status events, content hash, template version | Issue of the related report | As RC-02 | As RC-02 | Overrides | Needed to reproduce the issue record (brief §10) |
| RC-10 | User accounts | Profile, IdP subject, contact details, role history, device registrations | Account deactivation | Contact details and login identifiers deleted 90 days after deactivation; minimal actor record (name, credentials snapshot at signing) kept while referenced by RC-02/RC-03 | Delete or pseudonymise non-required attributes | Overrides | `[REVIEW: PRIVACY]` |
| RC-11 | Client contacts and `CLIENT_READONLY` users | Contact details, portal accounts | Last job for the client entity | Contact copies inside jobs follow RC-01; standalone records 2 years after last activity | Delete or pseudonymise | Overrides | `[REVIEW: PRIVACY]` |
| RC-12 | Application logs and telemetry | Operational logs, traces, metrics (PII-free by design) | Event time | Operational 90 days; security logs 12 months | Time-partition drop | Overrides (incident) | `[REVIEW: SECURITY]` |
| RC-13 | Offline device caches | SQLCipher store, photo cache, sync queue | Job issued, user unassigned, device deregistered, logout, remote wipe | Purged within 7 days of issue or unassignment once all operations are synced; immediately on remote wipe or deregistration | Row and file delete; store key destroyed on wipe | Not applicable — the server copy is the record; unsynced operations are never purged without sync or explicit, audited user confirmation | — |
| RC-14 | AI suggestion records | Suggestion, model and prompt-template version, confidence, source references, disposition | Suggestion and disposition: as RC-01. Raw model requests/responses: disposition | Suggestion + disposition as RC-01; raw payloads 90 days after disposition | Hard delete; provider-side retention configured to minimum/zero where offered | Overrides | `[REVIEW: PRIVACY]` |
| RC-15 | Data-source raw payloads | Adapter responses, quarantined invalid responses (04) | Retrieval | Lesser of licence `rawPayloadRetentionDays` and RC-01; not stored when licence is silent or `null`. Normalised values, provenance and payload hash follow RC-01 | Hard delete | Overrides unless the licence forbids retention — conflict escalated | `[REVIEW: DATA_LICENSING]` `[REVIEW: LEGAL]` |
| RC-16 | Templates, rule sets, clauses, retention policies | All versions with approval records | Superseded | While any retained report references the version, minimum 7 years | Hard delete | Overrides | — |
| RC-17 | Backups | PostgreSQL PITR, snapshots, object versions | Creation | 35-day PITR window; monthly snapshots 12 months | Expiry; deleted records persist only until backup expiry; tenant offboarding uses crypto-shredding | Snapshot pinned under hold | `[REVIEW: SECURITY]` |
| RC-18 | Incident and breach register | Incidents, assessments, notifications | Incident closure | 7 years | Hard delete | Overrides | `[REVIEW: LEGAL]` |

### 5.3 Legal hold

| Aspect | Rule |
|--------|------|
| Scope | Organisation, client entity, portfolio, job, asset or user |
| Who | `ADMINISTRATOR` with proposed permissions `legal_hold.apply` / `legal_hold.release`; release must be by a different user from the one who applied the hold (proposed separation of duties) |
| Required data | Reason, matter reference, scope, requesting party, review date |
| Effects | Retention jobs skip every record in scope; object-lock legal hold set on objects in scope (including issued artefacts); data-key destruction blocked; individual deletion requests paused and the response recorded; access controls unchanged |
| Not affected | Device cache purge (server copy is preserved); redaction for client outputs |
| Review | Reminder to the applier at the review date (default 6 months) |
| Audit | `legal_hold.applied`, `legal_hold.released` with scope, reason, matter reference and actor; holds appear on the job record |

### 5.4 Secure deletion

| Mechanism | Applies to | Detail |
|-----------|------------|--------|
| Hard delete + tombstone | Database records | Rows deleted in a transaction; tombstone kept; storage reclaimed by routine maintenance; backups age out per RC-17; restores re-apply tombstones |
| Crypto-shredding — per job | Object storage (photos, documents, plans) | Per-job data key wrapped by the tenant key; destroying the job key renders objects (including replicas and versions) unreadable. Never applied before an object-lock expiry date |
| Crypto-shredding — per tenant | Tenant offboarding | After export and expiry of any object-lock, destroy the tenant key-encryption key (after the KMS deletion waiting period); renders backups unreadable |
| Object-lock (compliance mode) | Issued PDF, snapshot, audit anchors | Retention date set at issue; cannot be shortened or removed by any user; legal-hold flag independent. Because compliance mode cannot be undone, retention dates require configuration approval `[REVIEW: SECURITY]` |
| Audit-stream purge | RC-03 | Whole streams purged after retention, with a `retention.stream_purged` checkpoint so remaining chains stay verifiable. Design option: encrypt PI-bearing audit payload fields with the per-job key so shredding removes content while hashes remain verifiable `[REVIEW: SECURITY]` |
| Device wipe | RC-13 | Delete store and files; destroy SQLCipher key in keystore |
| Processor deletion | §4.5 processors | Deletion on instruction per DPA; confirmation recorded in the retention run |

### 5.5 Retention jobs

| Stage | Behaviour | Audit (proposed additions to 00 §8) |
|-------|-----------|-------------------------------------|
| Schedule | Daily per organisation; idempotent and resumable | `retention.run_started` |
| Select | Candidates where trigger + period has elapsed, no legal hold, no unexpired object-lock, no unsynced device operations | — |
| Dry run | Report of candidates by record class with counts and IDs | `retention.dry_run_completed` |
| Approve | Batches containing RC-01, RC-02 or RC-08 records require approval by an `ADMINISTRATOR` with step-up MFA; other classes run automatically | `retention.purge_approved` |
| Execute | Delete/shred per §5.4; verify object absence and key destruction | `retention.record_purged` (per batch: class, count, ID list hash), `retention.stream_purged` |
| Complete / fail | Summary with counts, failures and retries; failures alert administrators | `retention.run_completed`, `retention.run_failed` |
| Policy change | New `RetentionPolicy` version approved by a different user | `retention.policy_changed` |

Retention run records follow RC-04 (7 years).

## 6. Open decisions

| # | Decision | Owner |
|---|----------|-------|
| 1 | Deployment model (internal firm vs multi-tenant SaaS) and therefore APP entity/processor roles (D1) | Product + `[REVIEW: LEGAL]` `[REVIEW: PRIVACY]` |
| 2 | Default retention periods per record class; insurer requirements | `[REVIEW: LEGAL]` with customer PI insurer |
| 3 | RPO/RTO, offline grace period, token lifetimes, step-up window | `[REVIEW: SECURITY]` |
| 4 | Permitted AI, email and speech processors and locations; AU-only option | `[REVIEW: PRIVACY]` |
| 5 | Whether issued PDFs carry a digital signature and what it asserts | `[REVIEW: LEGAL]` `[REVIEW: API_STANDARDS]` |
| 6 | Occupant collection-notice and photo-consent wording | `[REVIEW: PRIVACY]` |
| 7 | Breach-notification period in DPAs | `[REVIEW: LEGAL]` |
