# 02 — Personas and permissions

> Status: **Draft for review** · Owner: Product architecture (with the practice manager) · Applies to: roles, permission checks, UX priorities, test personas

Each persona maps 1:1 to a role in 00 §5. One person may hold several roles (common in small
practices). Separation-of-duties rules are evaluated **per job**, against the person's relationship
to that job (responsible valuer, co-signatory, author, reviewer), not per role.

Permissions listed under "Key tasks" are indicative. The authoritative matrix is defined in
`packages/domain/src/auth/permissions.ts` and is generated into the end of this file. Screen IDs
(M-xx, W-xx) refer to spec 05 §2.

## 1. Persona summary

| Persona            | Role code         | Primary devices                                | Frequency                      | Scope of access                                                               |
| ------------------ | ----------------- | ---------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| Administrator      | `ADMINISTRATOR`   | Web                                            | Weekly; on demand              | Organisation configuration, users, data sources, retention, legal hold, audit |
| Allocator          | `ALLOCATOR`       | Web; phone for notifications                   | Daily, continuous              | Intake and allocation of all jobs not in restricted portfolios                |
| Valuer             | `VALUER`          | Phone and tablet in the field; web at the desk | Daily                          | Jobs where they are the responsible valuer, co-signatory or assigned          |
| Field Inspector    | `FIELD_INSPECTOR` | Phone; tablet for sketching                    | Daily, in the field            | Assigned inspections only                                                     |
| QA Reviewer        | `QA_REVIEWER`     | Web (large or dual screen)                     | Daily, queue-driven            | Jobs in `submitted` / `in_review` / `returned` assigned to them               |
| Finance            | `FINANCE`         | Web                                            | Daily / weekly                 | Invoices and the commercial fields of jobs                                    |
| Client (read-only) | `CLIENT_READONLY` | Desktop or mobile browser                      | Occasional                     | Issued reports and invoices for their own client entities                     |
| Standards Owner    | `STANDARDS_OWNER` | Web                                            | Monthly; when standards change | Templates, clauses, rule sets, QA checklists, commentary library              |

### Job relationships used by permission checks

| Relationship                | Set by                                             | Effect                                                                                                                             |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Responsible valuer          | Allocator (`job.allocate`)                         | The only person who can `certification.sign` for the job. Excluded from `qa.approve` on the job unless an exception is authorised. |
| Co-signatory                | Allocator, at the responsible valuer's request     | Signs their own co-signatory statement. Excluded from QA on the job (SoD-07, proposed).                                            |
| Assigned inspector          | Allocator                                          | Field Inspector access to that job's inspection, photos and sketch.                                                                |
| Assigned QA reviewer        | Allocator or QA queue pick-up                      | `qa.review` / `qa.approve` on that job.                                                                                            |
| Version author              | System (creator of a template or rule-set version) | Excluded from `template.approve` / `ruleset.approve` for that version.                                                             |
| Restricted-portfolio member | Administrator (`user.manage`)                      | Required to see any job in a restricted portfolio, whatever the role.                                                              |

## 2. Personas

### P-01 Administrator (`ADMINISTRATOR`)

| Attribute     | Detail                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who           | Practice manager or IT lead. Often not a valuer.                                                                                                                          |
| Goals         | Keep the platform secure, configured and auditable. Onboard and offboard staff quickly. Respond to legal, privacy and security events.                                    |
| Devices       | Web on a desktop.                                                                                                                                                         |
| Frequency     | Weekly configuration; ad hoc for onboarding, incidents and legal holds.                                                                                                   |
| Pain points   | Departed staff still have devices with cached data. Licence terms per data source are hard to track. Audit logs are hard to search. Retention conflicts with legal holds. |
| Accessibility | Keyboard-operable data grids with proper header associations. Filter and sort state announced to screen readers. Audit severity shown by text and icon, not colour alone. |

| Key task                                                                                                    | Permission(s)       | Screen |
| ----------------------------------------------------------------------------------------------------------- | ------------------- | ------ |
| Configure organisation, branding and defaults                                                               | `org.manage`        | W-20   |
| Invite users, assign roles, record credentials, manage restricted-portfolio membership, deprovision devices | `user.manage`       | W-20   |
| Register data sources, licence basis, attribution and rate limits                                           | `datasource.manage` | W-19   |
| Configure retention periods; review deletion schedules                                                      | `retention.manage`  | W-22   |
| Apply and release legal holds                                                                               | `legal_hold.manage` | W-22   |
| Search the audit log and access denials                                                                     | `audit.read`        | W-21   |

Critical controls:

- MFA mandatory. Role and membership changes are audited.
- The Administrator role confers none of `certification.sign`, `qa.approve`, `template.approve` or
  `ruleset.approve`.
- Audit events are append-only. No role can edit or delete them.
- Restricted-portfolio content needs explicit membership even for the Administrator. Adding
  oneself as a member is audited.
- Any break-glass access is time-limited and audited `[REVIEW: SECURITY]`.

### P-02 Allocator (`ALLOCATOR`)

| Attribute     | Detail                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who           | Office coordinator or valuation manager who receives instructions from lenders, accountants, solicitors and private clients.                                                                     |
| Goals         | Turn instructions into correctly set-up jobs quickly. Allocate to a suitably qualified, conflict-free valuer. Meet due dates.                                                                    |
| Devices       | Web; phone for notifications and status checks.                                                                                                                                                  |
| Frequency     | Daily, high volume (many instructions per day for lender work).                                                                                                                                  |
| Pain points   | Re-keying from instruction emails and PDFs. Geocoding failures on rural addresses (lot-only, RMB). Finding a valuer with the right jurisdiction credentials and capacity. Due dates that change. |
| Accessibility | Bulk-import error tables navigable by keyboard and screen reader. Every drag-and-drop allocation has a single-pointer alternative (WCAG 2.5.7).                                                  |

| Key task                                                                                            | Permission(s)                | Screen     |
| --------------------------------------------------------------------------------------------------- | ---------------------------- | ---------- |
| Create a single or portfolio job; import a portfolio list                                           | `job.create`                 | W-01       |
| Edit instruction details (client, intended users, due date, fee basis)                              | `job.update`                 | M-02, W-01 |
| Assign the responsible valuer, inspectors and QA reviewer                                           | `job.allocate`               | W-02       |
| Record engagement acceptance where firm policy delegates it                                         | `engagement.accept`          | W-03       |
| Cancel a job with a reason                                                                          | `job.cancel`                 | M-02       |
| Issue approved reports and send to approved recipients (if firm policy assigns issue to allocators) | `report.issue`, `email.send` | W-15       |

Critical controls:

- Cannot assign the responsible valuer as the QA reviewer for the same job.
- The conflict check must be completed before engagement acceptance (J-02).
- Cannot edit valuation content: evidence, calculations, certification or QA findings.
- No unredacted photo access by default.

### P-03 Valuer — responsible valuer, Certified Practising Valuer (`VALUER`)

| Attribute     | Detail                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who           | API member, typically a Certified Practising Valuer (CPV), with registration where a jurisdiction requires it (01 A-15). Accountable for the opinion of value.                                                                                         |
| Goals         | Produce a defensible, well-evidenced valuation efficiently. Reuse field data without re-keying. Know before QA that nothing blocking is missing. Keep professional judgement visible and attributed.                                                   |
| Devices       | Phone for kerbside and quick capture; tablet for full inspections and sketching; web for analysis, certification and QA responses.                                                                                                                     |
| Frequency     | Daily. Several residential inspections per day, or fewer, longer commercial jobs.                                                                                                                                                                      |
| Pain points   | Double entry between field notes and report. Poor signal on site. Slow photo handling. Not knowing why a field became required after a selection change. Outlier warnings without context. QA findings arriving by email instead of against the field. |
| Accessibility | One-handed phone operation. Outdoor-contrast mode. Dictation for notes. Dynamic type to 200 %. Numeric entry as an alternative to dragging on the sketch canvas.                                                                                       |

| Key task                                                                    | Permission(s)                                                       | Screen      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------- |
| Declare conflicts and independence; accept the engagement                   | `engagement.accept`                                                 | W-03        |
| Set or change purpose, property type, scope, jurisdiction, template version | `job.update`                                                        | M-03        |
| Edit asset data; inspect; capture photos and documents; flag and redact     | `asset.edit`, `inspection.capture`, `photo.capture`, `photo.redact` | M-05 – M-08 |
| Decide AI suggestions                                                       | `ai.decide`                                                         | M-09        |
| Sketch, confirm calibration, approve the area schedule                      | `sketch.edit`, `measurement.approve`                                | M-10 – M-12 |
| Enter sales and rental evidence; run and override calculations; reconcile   | `evidence.edit`, `calculation.run`, `calculation.override`          | W-04 – W-07 |
| Acknowledge non-blocking validations with a reason                          | `validation.acknowledge`                                            | W-10        |
| Sign the certification as responsible valuer (MFA step-up)                  | `certification.sign`                                                | W-11        |
| Generate draft previews; respond to QA findings                             | `report.generate_draft`, `job.update`                               | W-13, W-14  |
| Issue and send, where firm policy allows                                    | `report.issue`, `email.send`                                        | W-15        |

Critical controls:

- `certification.sign` only as the job's responsible valuer, as a human actor, with MFA step-up.
- Cannot `qa.approve` their own job unless a different user has authorised a self-approval exception.
- Every calculation override needs a reason. AI suggestions become facts only through their own
  decision.
- Content is locked from `submitted` onward. Changes need a QA return or `openAmendment`.
- Credentials and their expiry are shown on the certification; expired credentials block signing.

### P-04 Field Inspector (`FIELD_INSPECTOR`)

| Attribute     | Detail                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who           | Trainee valuer, property inspector or contractor collecting evidence for portfolio, kerbside or full inspections. Does not form the opinion of value. |
| Goals         | Capture complete, well-labelled evidence the first time. Never lose work offline. Know what is still required before leaving the site.                |
| Devices       | Phone; tablet for plans and sketching.                                                                                                                |
| Frequency     | Daily in the field. Several inspections per day.                                                                                                      |
| Pain points   | No signal. Glare. Gloves and rain. Occupants present (privacy). Battery. Access refused. Unclear scope: what not to inspect on a `KERBSIDE` job.      |
| Accessibility | Touch targets of at least 48 dp. High-contrast outdoor mode. Haptic confirmation on capture. Voice-to-text. Usable at large dynamic type.             |

| Key task                                                                           | Permission(s)                                       | Screen     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- | ---------- |
| View assigned jobs and the day's route; hand off navigation                        | `job.read`                                          | M-01       |
| Work through the room/area checklist; dictate notes; capture documents             | `inspection.capture`                                | M-06, M-07 |
| Capture photos; flag and redact sensitive content                                  | `photo.capture`, `photo.redact`                     | M-07, M-08 |
| Decide AI room classifications on assigned inspections (the valuer confirms later) | `ai.decide`                                         | M-09       |
| Import a plan, calibrate and draw boundaries                                       | `sketch.edit`                                       | M-10, M-11 |
| Edit inspection-observed asset fields                                              | `asset.edit` (limited to inspection-sourced fields) | M-05       |

Critical controls:

- No `evidence.edit`, `calculation.*`, `measurement.approve`, `certification.sign` or QA permissions.
- Every capture is attributed and marked "inspector-captured" until the valuer confirms it (01 A-25).
- Location is used only with OS permission and the in-app opt-in.
- Device data is encrypted and wiped on deprovisioning (01 A-19).

### P-05 QA Reviewer (`QA_REVIEWER`)

| Attribute     | Detail                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who           | Senior valuer independent of the job.                                                                                                                                            |
| Goals         | Review consistently against a checklist. Raise clear findings with traceable resolution. Approve only complete submissions that have not changed since they were locked.         |
| Devices       | Web on a large or dual screen; tablet occasionally.                                                                                                                              |
| Frequency     | Daily, driven by the queue and its SLA.                                                                                                                                          |
| Pain points   | Hard to see what changed between rounds. Findings lost in email. Reviewing photos at scale. Uncertainty whether the submission changed after locking.                            |
| Accessibility | The round-to-round diff is available as a text list of changes that screen readers can read. Keyboard shortcuts for findings. Zoom to 400 % on the web without loss of function. |

| Key task                                                   | Permission(s)                         | Screen     |
| ---------------------------------------------------------- | ------------------------------------- | ---------- |
| Pick up submitted jobs                                     | `qa.review`                           | W-12       |
| Work the checklist; raise findings with severity           | `qa.review`                           | W-13       |
| Inspect calculation traces, evidence and job audit history | `job.read`, `audit.read` (job-scoped) | W-06, W-21 |
| View unredacted photos where needed (logged)               | `photo.view_unredacted`               | M-08       |
| Preview the draft report                                   | `report.generate_draft`               | W-14       |
| Return to the valuer or approve (MFA step-up)              | `qa.approve`                          | W-13       |

Critical controls:

- Cannot approve a job on which they are the responsible valuer, unless an exception is authorised
  by another user. Cannot review a job on which they are a co-signatory (SoD-07, proposed).
- Cannot edit job content; can only raise findings.
- Approval re-verifies the snapshot hash recorded at submission.

### P-06 Finance (`FINANCE`)

| Attribute     | Detail                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| Who           | Bookkeeper or accounts officer.                                                                              |
| Goals         | Raise accurate invoices promptly at issue. Reconcile with the accounting system. Follow up overdue accounts. |
| Devices       | Web.                                                                                                         |
| Frequency     | Daily or weekly.                                                                                             |
| Pain points   | Unclear fee basis for portfolios. Disbursements. GST errors. Invoices sent before the report is issued.      |
| Accessibility | Keyboard-first data entry. Currency fields formatted in AUD with cents. Errors linked to the field.          |

| Key task                                                       | Permission(s)                  | Screen |
| -------------------------------------------------------------- | ------------------------------ | ------ |
| Review, adjust and send invoices; issue credit notes           | `invoice.manage`, `email.send` | W-16   |
| View the job's commercial fields (client, fee basis, due date) | `job.read` (commercial view)   | M-02   |
| Export to or sync with Xero/MYOB (Pilot)                       | `invoice.manage`               | W-16   |

Critical controls:

- Cannot read draft reports, evidence or unredacted photos, and cannot change valuation content.
- Invoice numbers are sequential and immutable once sent. Corrections are made by credit note
  `[REVIEW: ACCOUNTING]`.

### P-07 Client — read-only (`CLIENT_READONLY`)

| Attribute     | Detail                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who           | Contact at a lender, accountancy, law firm or corporate client named as an approved recipient.                                                                         |
| Goals         | Retrieve issued reports and invoices securely. Know which version is current.                                                                                          |
| Devices       | Desktop or mobile browser.                                                                                                                                             |
| Frequency     | Occasional, per instruction.                                                                                                                                           |
| Pain points   | Lost or oversized email attachments. Not knowing whether a report has been superseded. Too many passwords.                                                             |
| Accessibility | WCAG 2.2 AA portal. Accessible authentication (WCAG 3.3.8): passkeys, password-manager paste, no cognitive puzzles. Accessibility of the PDF is open question 01 Q-19. |

| Key task                                                       | Permission(s)        | Screen |
| -------------------------------------------------------------- | -------------------- | ------ |
| List and download issued reports for their own client entities | `report.read_issued` | W-17   |
| View invoices for their own client entities                    | `invoice.read`       | W-17   |

Critical controls:

- Sees only issued reports and invoices for their own client entities.
- Never sees drafts, working sketches, unredacted photos, internal notes, QA findings or audit.
- Reliance and intended-use statement shown in the portal `[REVIEW: LEGAL]`.
- Access is logged (proposed audit action `report.accessed`, spec 05 §4).

### P-08 Standards Owner (`STANDARDS_OWNER`)

| Attribute     | Detail                                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who           | Nominated senior CPV (01 D7, `API_STANDARDS`) responsible for mapping firm templates to current API Rules, Code of Ethics, adopted IVS and Guidance Papers, as interpreted by qualified reviewers. |
| Goals         | Keep templates, clauses, rule sets and QA checklists current. Roll out changes with effective dates without disrupting jobs in progress. Record specialist sign-offs.                              |
| Devices       | Web.                                                                                                                                                                                               |
| Frequency     | Monthly; on demand when standards or client requirements change.                                                                                                                                   |
| Pain points   | The impact of a change on jobs in progress is unclear. Versions are hard to compare. Hard to track which specialist signed off what. Effective dates overlap.                                      |
| Accessibility | Version diffs are textual (added/removed markers), not colour-only. The rule editor is fully keyboard-operable.                                                                                    |

| Key task                                                         | Permission(s)                         | Screen     |
| ---------------------------------------------------------------- | ------------------------------------- | ---------- |
| Author template, clause and commentary-library versions          | `template.edit`                       | W-18, W-08 |
| Author rule-set versions (requirements, validations, checklists) | `ruleset.edit`                        | W-18       |
| Approve versions authored by someone else                        | `template.approve`, `ruleset.approve` | W-18       |
| Record specialist review references against `[REVIEW: …]` items  | `template.edit`, `ruleset.edit`       | W-18       |
| Authorise a per-job QA self-approval exception                   | `qa.self_approval_exception`          | W-13       |
| Read configuration audit history                                 | `audit.read`                          | W-21       |

Critical controls:

- Cannot approve a version they authored.
- Approved versions are immutable. Changes create a new version.
- Production issue is blocked for content in `placeholder` or `draft` review status (G1).
- Jobs in progress stay pinned to their template and rule-set versions until the valuer re-selects
  (J-03).

## 3. Separation of duties

Rules SoD-01 to SoD-05 restate 00 §5. SoD-06 is derived from G2. SoD-07 is proposed and needs
confirmation. Every rule is enforced in `@vp/domain` (shared by the API and the clients), and the
API rejects violations with `auth.denied`, even if a client presents the action.

| ID     | Rule                                                                                                                                                                                                  | Rationale                                                                                                               | Exception path                                                                                                                                        | Audit events                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SoD-01 | `certification.sign` only by the job's responsible valuer, as a human actor, with MFA step-up.                                                                                                        | Brief §7: software or AI never signs for the valuer. Professional accountability rests with one identified person (G2). | None. Co-signatories sign their own statements, never on behalf of the responsible valuer.                                                            | `certification.signed`, `auth.denied`                                                              |
| SoD-02 | `qa.approve` never by the responsible valuer, unless a documented self-approval exception exists, authorised by a different user holding `qa.self_approval_exception`.                                | Brief §7 step 8: an independent reviewer; self-approval prevented unless an authorised exception is documented.         | Per job, written reason mandatory, step-up MFA for the authoriser, exception printed in the issued report's audit metadata `[REVIEW: API_STANDARDS]`. | `qa.self_approval_exception_authorised`, `qa.approved`, `auth.denied`                              |
| SoD-03 | `template.approve` / `ruleset.approve` never by the author of that version.                                                                                                                           | G4: approval is separate from authorship. Prevents unreviewed wording reaching reports.                                 | None. A firm needs at least two standards owners (01 Q-21).                                                                                           | `template.version_created`, `template.version_approved`, `ruleset.version_approved`, `auth.denied` |
| SoD-04 | `CLIENT_READONLY` sees only issued reports and invoices for their own client entities.                                                                                                                | Confidentiality, intended-use and reliance controls. Drafts are not opinions.                                           | None.                                                                                                                                                 | `auth.denied`                                                                                      |
| SoD-05 | Restricted portfolios require explicit membership even for organisation-wide roles.                                                                                                                   | Brief §8: portfolio-level segregation, e.g. for sensitive clients or related-party work.                                | An Administrator may grant membership, including to themselves. This is audited and visible in W-21.                                                  | `user.membership_changed` (proposed, spec 05 §4), `auth.denied`                                    |
| SoD-06 | AI actors hold no permission that signs, approves, accepts or issues (`certification.sign`, `qa.approve`, `ai.decide`, `measurement.approve`, `report.issue`, `template.approve`, `ruleset.approve`). | Brief §1, §5, §11: AI may extract, suggest and flag only.                                                               | None.                                                                                                                                                 | `ai.suggestion_created` (AI actor), `auth.denied`                                                  |
| SoD-07 | (Proposed) A co-signatory on a job cannot be its QA reviewer, and the authoriser of a self-approval exception cannot be a co-signatory.                                                               | Independence extends to everyone who signs.                                                                             | None once confirmed `[REVIEW: API_STANDARDS]`.                                                                                                        | `auth.denied`                                                                                      |

### Small-practice configurations

| Practice size      | Role assignment that satisfies SoD                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sole practitioner  | `VALUER` + `ALLOCATOR` + `ADMINISTRATOR`. QA needs either an external reviewer account (`QA_REVIEWER`) or a self-approval exception authorised by another user who holds `ADMINISTRATOR` (`qa.self_approval_exception`). SoD-03 needs a second standards owner (01 Q-21). |
| Two valuers        | Each is `VALUER` + `QA_REVIEWER` and reviews the other's jobs. Both are `STANDARDS_OWNER`, so each approves the other's versions.                                                                                                                                         |
| Five or more staff | Separate allocator, finance and administrator. At least two `QA_REVIEWER`s and two `STANDARDS_OWNER`s.                                                                                                                                                                    |

## Permission matrix

The matrix below is generated from `packages/domain/src/auth/permissions.ts` (the code that enforces it) by
`pnpm docs:generate`; CI fails if it is stale. Holding a grant is necessary but not sufficient: `authorize()` also
applies organisation, restricted-portfolio, assignment, client-scope and separation-of-duties rules (SoD-01–SoD-06
above). Persona task tables earlier in this document are indicative; where they differ, this matrix is authoritative.

<!-- PERMISSION-MATRIX:START -->

Organisation-wide roles: ADMINISTRATOR, STANDARDS_OWNER, ALLOCATOR, FINANCE. Other roles act only on jobs they are assigned to or whose portfolio they belong to. Restricted portfolios require membership for every role. 👤 = human actor only; 🔐 = MFA required.

| Permission                   | ADMINISTRATOR | STANDARDS_OWNER | ALLOCATOR | VALUER | FIELD_INSPECTOR | QA_REVIEWER | FINANCE | CLIENT_READONLY | Human only | MFA |
| ---------------------------- | ------------- | --------------- | --------- | ------ | --------------- | ----------- | ------- | --------------- | ---------- | --- |
| `org.manage`                 | ✓             |                 |           |        |                 |             |         |                 |            |     |
| `user.manage`                | ✓             |                 |           |        |                 |             |         |                 |            | 🔐  |
| `datasource.manage`          | ✓             |                 |           |        |                 |             |         |                 |            |     |
| `template.edit`              |               | ✓               |           |        |                 |             |         |                 |            |     |
| `template.approve`           |               | ✓               |           |        |                 |             |         |                 | 👤         | 🔐  |
| `ruleset.edit`               |               | ✓               |           |        |                 |             |         |                 |            |     |
| `ruleset.approve`            |               | ✓               |           |        |                 |             |         |                 | 👤         | 🔐  |
| `job.create`                 |               |                 | ✓         |        |                 |             |         |                 |            |     |
| `job.read`                   | ✓             |                 | ✓         | ✓      | ✓               | ✓           | ✓       |                 |            |     |
| `job.update`                 |               |                 | ✓         | ✓      |                 |             |         |                 |            |     |
| `job.allocate`               |               |                 | ✓         |        |                 |             |         |                 |            |     |
| `job.cancel`                 | ✓             |                 | ✓         |        |                 |             |         |                 |            |     |
| `engagement.accept`          |               |                 | ✓         | ✓      |                 |             |         |                 | 👤         |     |
| `asset.edit`                 |               |                 | ✓         | ✓      | ✓               |             |         |                 |            |     |
| `inspection.capture`         |               |                 |           | ✓      | ✓               |             |         |                 |            |     |
| `photo.capture`              |               |                 |           | ✓      | ✓               |             |         |                 |            |     |
| `photo.redact`               |               |                 |           | ✓      | ✓               |             |         |                 |            |     |
| `photo.view_unredacted`      |               |                 |           | ✓      |                 | ✓           |         |                 |            |     |
| `evidence.edit`              |               |                 |           | ✓      |                 |             |         |                 |            |     |
| `valuation.edit`             |               |                 |           | ✓      |                 |             |         |                 | 👤         |     |
| `calculation.run`            |               |                 |           | ✓      |                 |             |         |                 |            |     |
| `calculation.override`       |               |                 |           | ✓      |                 |             |         |                 | 👤         |     |
| `sketch.edit`                |               |                 |           | ✓      | ✓               |             |         |                 |            |     |
| `measurement.approve`        |               |                 |           | ✓      |                 |             |         |                 | 👤         |     |
| `ai.decide`                  |               |                 |           | ✓      | ✓               |             |         |                 | 👤         |     |
| `validation.acknowledge`     |               |                 |           | ✓      |                 |             |         |                 | 👤         |     |
| `certification.sign`         |               |                 |           | ✓      |                 |             |         |                 | 👤         | 🔐  |
| `qa.review`                  |               |                 |           |        |                 | ✓           |         |                 | 👤         |     |
| `qa.approve`                 |               |                 |           |        |                 | ✓           |         |                 | 👤         | 🔐  |
| `qa.self_approval_exception` | ✓             |                 |           |        |                 |             |         |                 | 👤         | 🔐  |
| `report.generate_draft`      |               |                 |           | ✓      |                 | ✓           |         |                 |            |     |
| `report.issue`               | ✓             |                 |           | ✓      |                 |             |         |                 | 👤         | 🔐  |
| `report.read_issued`         | ✓             |                 | ✓         | ✓      |                 | ✓           | ✓       | ✓               |            |     |
| `invoice.manage`             |               |                 |           |        |                 |             | ✓       |                 |            |     |
| `invoice.read`               | ✓             |                 | ✓         |        |                 |             | ✓       | ✓               |            |     |
| `email.send`                 |               |                 |           | ✓      |                 |             | ✓       |                 |            |     |
| `audit.read`                 | ✓             |                 |           |        |                 | ✓           |         |                 |            |     |
| `legal_hold.manage`          | ✓             |                 |           |        |                 |             |         |                 |            | 🔐  |
| `retention.manage`           | ✓             |                 |           |        |                 |             |         |                 |            | 🔐  |

### Workflow transitions

| Action           | From                    | To        | Permission           | Audit action              |
| ---------------- | ----------------------- | --------- | -------------------- | ------------------------- |
| acceptEngagement | draft                   | active    | `engagement.accept`  | `job.engagement_accepted` |
| submitForQa      | active, returned        | submitted | `certification.sign` | `job.submitted`           |
| startReview      | submitted               | in_review | `qa.review`          | `qa.started`              |
| returnToValuer   | in_review               | returned  | `qa.review`          | `qa.returned`             |
| approve          | in_review               | approved  | `qa.approve`         | `qa.approved`             |
| issue            | approved                | issued    | `report.issue`       | `report.issued`           |
| openAmendment    | issued                  | active    | `job.update`         | `job.amendment_opened`    |
| cancel           | draft, active, returned | cancelled | `job.cancel`         | `job.cancelled`           |

<!-- PERMISSION-MATRIX:END -->
