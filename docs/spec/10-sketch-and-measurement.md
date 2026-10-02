# 10 — Sketch and measurement

> Status: **Draft for review** · Owner: Product architecture (with UX lead and the standards owner) · Applies to: `packages/domain/src/geometry`, sketch routes in `apps/api/src/routes/inspection.ts`, `apps/api/migrations/0002_immutability.sql`, screens M-10, M-11, M-12 (phone, tablet, web), report output (spec 09)

This is the phone/tablet/web specification for the 2D improvement sketch and m² measurement
(brief §6, AC-08). It documents what Iteration 1 implements in the shared domain library and API,
specifies the workspace UI for the MVP mobile app and web portal, and lists gaps (§13). Journey
J-06 and screens M-10/M-11/M-12 are in spec 05. Nothing here makes a measurement a survey or claims
conformity with any method of measurement.

Status markers: **Implemented** (Iteration 1 code); **Planned — MVP · Mobile app** (S-047),
**Planned — MVP · Web portal** (S-048), **Planned — MVP** (S-049, S-034, S-042, S-056),
**Planned — Pilot** (S-069 AI outlines and perspective correction).

## 1. Scope and principles

| #   | Principle             | Rule                                                                                                                                                                                                                                    | Status                                           |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| P1  | Basic 2D              | Straight-edged closed polygons on named levels, plus deductions. No curves (arcs are approximated by vertices), no 3D, no CAD layers.                                                                                                   | Implemented (model)                              |
| P2  | Units                 | Areas in m² and lengths in m, both canonical. Stored values are rounded to 2 dp (half away from zero) only in the schedule.                                                                                                             | Implemented                                      |
| P3  | Same rules everywhere | Geometry, calibration, snapping and schedule code (`polygon.ts`, `calibration.ts`, `snap.ts`, `area-schedule.ts`) lives in `@vp/domain`. It runs on the device offline and on the server, which **recomputes** every schedule on write. | Implemented (domain); device use Planned (S-047) |
| P4  | Human approval        | No area is reportable until a valuer approves the schedule; the approval binds to the schedule hash. Scale confirmation is human-only. AI never approves.                                                                               | Implemented                                      |
| P5  | Not a survey          | UI and PDF copy never say "surveyed", "certified area" or "compliant". The drawing caption reads "not to scale; not a survey". The area disclaimer comes from clause `area-disclaimer` `[REVIEW: API_STANDARDS]`.                       | Implemented (caption, clause slot)               |
| P6  | Provenance            | The original plan file is kept unchanged with its source. Every row links to its sketch version, calibration and measurer.                                                                                                              | Rows implemented; source files Planned (S-034)   |
| P7  | Full history          | Every change is a new immutable version. Issued versions are frozen.                                                                                                                                                                    | Implemented                                      |

## 2. Workspace UX (M-10 workspace, M-11 calibration, M-12 schedule)

### 2.1 Form factors

| Aspect        | Phone (Mobile app, S-047)                                                        | Tablet (Mobile app, S-047)                                                               | Web (Web portal, S-048)                                               |
| ------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Layout        | Full-screen canvas; bottom tool bar; component list and issues in a bottom sheet | Canvas with side panel (components, properties, issues); source plan can be split-viewed | Canvas, left tool rail, right inspector panel, version history drawer |
| Primary input | Tap vertices; numeric keypad for lengths; wall-entry form                        | Stylus or finger; keyboard if attached                                                   | Mouse and keyboard shortcuts; wheel zoom                              |
| Typical use   | On-site wall entry, photographing plans                                          | On-site tracing over a plan                                                              | Office tracing of supplied plans and PDFs; approval                   |
| Offline       | Full (encrypted local store)                                                     | Full                                                                                     | Online only (05 §2)                                                   |
| Targets       | Controls 48 dp / 44 pt or larger; one-handed reach; usable with gloves (UX-06)   | As phone                                                                                 | WCAG 2.2 AA target                                                    |

### 2.2 Import and capture

| Source                | Flow                                                                  | Stored                                                                                         | Scale method                                      | Status                                                       |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Blank canvas          | Choose "Draw from measurements"                                       | `units: metres`; no source plan                                                                | Not applicable (dimension-driven)                 | Implemented (API)                                            |
| Existing plan (image) | Pick a file; enter source (who supplied it, date, title)              | SourcePlan: original bytes, SHA-256, filename, provenance (`document` row, kind `source_plan`) | Two-point or stated scale                         | Planned — MVP (S-034, S-047/S-048)                           |
| PDF page              | Pick the page; the page is rasterised at a recorded dpi (default 300) | Original PDF + page index + dpi + raster hash                                                  | Stated scale (ratio + dpi) or two-point           | Planned — MVP                                                |
| Photo of a plan       | Camera in document mode; optional perspective correction (§4)         | Original photo + rectified derivative + homography                                             | Two-point only (photos are not at a stated scale) | Capture Planned — MVP; rectification Planned — Pilot (S-069) |
| Aerial/site image     | Licensed sources only `[REVIEW: DATA_LICENSING]`                      | As image                                                                                       | Two-point from a known boundary length            | Planned — Pilot                                              |

The original file is never modified. An encrypted or unreadable PDF shows an error with
guidance, and the file is kept (J-06 E4).

### 2.3 Canvas tools

| Tool                  | Behaviour                                                                                                                                                                                                                                             | Domain support                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Wall line             | Tap successive corners. The outline stays `closed: false` until the first vertex is tapped again.                                                                                                                                                     | `Boundary.closed`               |
| Closed polygon        | Rectangle, or vertex-by-vertex; closes on the first vertex                                                                                                                                                                                            | `polygonProblems`               |
| Exact length          | After each vertex, type a length (m, 2 dp) and keep or snap the direction                                                                                                                                                                             | `snapAngle`                     |
| Wall entry by bearing | Form: rows of `{length m, direction}`; direction is N, NE, E, SE, S, SW, W, NW or degrees clockwise from sketch "up". It closes if the misclosure is 0.05 m or less; otherwise it stays open and shows the misclosure.                                | `polygonFromWalls`              |
| Snap to grid          | Grid 0.1 / 0.25 / 0.5 / 1 m (metres) or plan units                                                                                                                                                                                                    | `snapToGrid`                    |
| Snap to right angles  | 90° by default; 45° optional                                                                                                                                                                                                                          | `snapAngle(stepDeg)`            |
| Snap to vertices      | Nearest existing vertex within 12 px on screen, converted to model units                                                                                                                                                                              | `snapToVertex`                  |
| Undo / redo           | Unlimited local stack within a session. **Commit** (explicit save, leaving the workspace, or auto-commit every 5 min with changes) creates a sketch version with a change summary (J-06 step 5). Undo after a commit creates a new reverting version. | `nextSketchVersion`             |
| Zoom / pan            | Pinch or wheel, 10–2 000 %; fit to extent; display only                                                                                                                                                                                               | —                               |
| Duplicate             | Copy a boundary with a new id, offset 1 m; "Copy to level" for repeated floors                                                                                                                                                                        | —                               |
| Internal partitions   | Rooms that **share walls** tile a component without overlap (allowed; `intersectionArea` = 0). A non-area partition line needs a new boundary role (gap G10-07).                                                                                      | —                               |
| Labels                | Level (≤ 40 characters), label (≤ 80), component type (§7.3) or deduction type (`void`, `courtyard`, `lightwell`, `excluded`), dimension source                                                                                                       | `Boundary`                      |
| Deduction             | Draw with role `deduction`; shown dashed and hatched with the word "Deduction"                                                                                                                                                                        | `computeAreaSchedule`           |
| North point           | Rotate the north arrow; stores `northBearingDeg` (0–360, clockwise from sketch up to north)                                                                                                                                                           | `SketchVersion.northBearingDeg` |
| Basis and convention  | Picker filtered to conventions whose basis matches (§7)                                                                                                                                                                                               | `GEO-CONVENTION-BASIS-MISMATCH` |
| Supplied areas        | Label, m², optional level, source (e.g. "Builder plan 2019")                                                                                                                                                                                          | §6.2                            |
| Report inclusion      | Toggle "Include drawing in client report"                                                                                                                                                                                                             | `includeInClientReport`         |

Live feedback: each closed polygon shows m² and perimeter (P2 rounding). The GEO issue list
links each issue to its boundaries. Areas carry an "Unverified" badge until the scale is confirmed
and the schedule approved (UX-11).

Coordinate convention: stored points are **y-up** (shoelace sign positive for counter-clockwise;
the PDF drawing assumes y-up). Image-traced points must be stored as `y = imageHeight − pixelY`,
or traced drawings render mirrored (gap G10-06).

### 2.4 Accessibility

| Requirement                    | Specification                                                                                                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard and numeric entry     | Wall-entry form and a **vertex table** (editable x/y per vertex) are full alternatives to drawing: WCAG 2.2 2.5.7 Dragging Movements (UX-02). Web shortcuts: `L` line, `P` polygon, `D` deduction, `Ctrl+Z`/`Ctrl+Y`, arrow keys nudge a selected vertex by the grid step.                   |
| Screen-reader list view        | The component list (level → components with type, gross, deductions, net, perimeter, issues) is the accessible equivalent of the canvas (UX-04). Every action (create via wall entry, edit, delete, deduct, label) is available from it. Area changes are announced in a polite live region. |
| Not colour alone               | Deductions: dashed, hatched and labelled. AI suggestions: dashed with an "AI suggestion" label. Issues: icon and word (UX-05, UX-12).                                                                                                                                                        |
| Dynamic type, contrast, motion | Tool palettes reachable at 200 % font (UX-03); outdoor-contrast mode thickens strokes (UX-07); no animated zoom with reduce-motion (UX-18).                                                                                                                                                  |

### 2.5 Offline behaviour and sync

**Current:** sketch versions are created only through `POST …/sketches`; the server generates the
`sketchId` and version id. The sync endpoint accepts only `asset` and `photo` entities.

**Planned — MVP (S-042, S-047): sketch versions as sync entities.**

| Rule             | Detail                                                                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client ids       | The device generates UUIDs for sketch, version, boundary and calibration (ADR-004). Replay by `op_id` is idempotent.                                                                                                                                             |
| Append-only      | Each version is a `create`. Version content never conflicts field by field.                                                                                                                                                                                      |
| Branching        | Two devices creating version N+1 from the same parent: the server accepts the first; the second is stored with its `parentVersionId`, flagged `sync.conflict_detected`, and shown in M-13. The user adopts one by creating N+2. Nothing is silently overwritten. |
| Server recompute | The server recomputes the schedule and hash. A device and server hash mismatch is logged and the server result wins.                                                                                                                                             |
| Offline approval | Queued. On sync the server re-validates (latest version, `reportable`, job editable, hash). On rejection the user is notified and the approval does not exist (J-06 E3).                                                                                         |
| Source files     | Resumable upload. Geometry does not need the image, but approval requires the referenced source plan to have been uploaded.                                                                                                                                      |
| Local store      | Encrypted (SQLCipher); every commit is persisted immediately (UX-08).                                                                                                                                                                                            |

### 2.6 Error states

| Condition                                                    | Response                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| No source and no boundaries                                  | Empty state offering the four import options                                                      |
| Calibration points closer than 50 units                      | `CALIBRATION_INVALID` "calibration points are too close (n units); pick a longer known dimension" |
| Known distance outside 0.5–2 000 m                           | `CALIBRATION_INVALID`                                                                             |
| Calibration without a source plan                            | `422 SOURCE_PLAN_REQUIRED`                                                                        |
| Check dimension deviates by more than 2 %                    | Confirm disabled until recalibration or a recorded reason (J-06 E2). Planned (gap G10-02).        |
| Wall entry with fewer than 3 walls, or a non-positive length | `GEOMETRY_INVALID`                                                                                |
| Misclosure over 0.05 m                                       | Shape left open; "Misclosure 0.30 m — correct a wall length"                                      |
| Four perspective points with three collinear                 | `GEOMETRY_INVALID` "reference points are degenerate"                                              |
| New sketch missing units, basis, convention or boundaries    | `422 SKETCH_INCOMPLETE`                                                                           |
| Unknown convention                                           | `422 UNKNOWN_CONVENTION`                                                                          |
| Sketch belongs to another asset                              | `422 SKETCH_ASSET_MISMATCH`                                                                       |
| Confirm or approve on an older version                       | `409 STALE_VERSION`                                                                               |
| Confirm without a calibration                                | `422 NO_CALIBRATION`                                                                              |
| Approve with blocking issues or an unconfirmed scale         | `GUARD_FAILED` listing the blocking GEO codes                                                     |
| Job submitted or locked                                      | Edit refused (`assertEditable`); lock banner (UX-13)                                              |
| Inspector approves                                           | `403` (`measurement.approve` is valuer-only)                                                      |
| Limits                                                       | 300 boundaries per version; 2–500 points per boundary                                             |

## 3. Scale calibration (`calibration.ts`)

| Method          | Inputs                                                                               | Result                                                                                                                                                   | Constraints                                      |
| --------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Two-point       | `p1`, `p2` in plan units (pixels, or points at the recorded dpi); known distance (m) | `metresPerUnit = knownDistanceM / span`; `estimatedRelativeError = 2 / span` (±1 unit picking error at each end)                                         | `span ≥ 50` units; `0.5 ≤ knownDistanceM ≤ 2000` |
| Stated scale    | `ratio` (100 for 1:100), `dpi`                                                       | `metresPerUnit = 0.0254 / dpi × ratio`; `estimatedRelativeError = 0.02` (indicative ±2 %: printed and scanned plans are often not at their stated scale) | Both > 0                                         |
| Check dimension | Second pair of points and expected metres                                            | `checkCalibration` → `measuredM`, signed `deviation`, `withinTolerance` (`                                                                               | deviation                                        | ≤ 0.02`) | —   |

Examples (`geometry.test.ts`): 500 px = 10 m → 0.02 m/px, error 0.4 %. 1:100 at 300 dpi →
0.0084667 m/px. Check 302 px ≈ 6.04 m against 6 m → +0.67 % (within). 330 px ≈ 6.6 m → +10 %
(outside). Because area error is roughly double the linear error, the UI shows
"± ≈ 2 × error" against m².

| Status       | Meaning                                                             | Schedule effect                                         |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------- |
| `unverified` | Created by anyone with `sketch.edit`                                | `GEO-SCALE-UNVERIFIED` (blocking); row confidence `low` |
| `confirmed`  | `confirmCalibration`: human with `measurement.approve` (the valuer) | Reportable if nothing else blocks                       |
| `superseded` | Replaced by a recalibration                                         | Treated as `missing`: `GEO-SCALE-MISSING`, no rows      |

Rules:

1. **Confirmation creates a new version.** `POST …/sketch-versions/{id}/confirm-scale` (latest
   version only, with a `checkNote` of 5 characters or more) builds the next version with the
   confirmed calibration and change summary `Scale confirmed: <note>`. Audit:
   `calibration.confirmed` (reason = note).
2. **Recalibration supersedes.** Posting a new `calibration` on an existing sketch creates a new
   calibration (two-point: `supersedesId` = previous id) in a new version. Boundaries stay in plan
   units, so every dependent area is recomputed. Earlier versions keep their calibration
   unchanged. Audit: `calibration.created`.
3. **Unverified labelling.** Until confirmation, every area on M-10/M-12 and in the draft preview
   shows "Unverified". An unverified schedule cannot be approved, and VAL-AREA-001 and
   `TPL-AREA-NOT-REPORTABLE` keep it out of issued reports.
4. Scale status values: `not_applicable` (units `metres`), `missing`, `unverified`, `confirmed`.

## 4. Perspective correction (assist only)

`computeHomography(src[4], dst[4])` solves the 8-unknown projective transform (Gauss–Jordan,
partial pivoting, `h8 = 1`). Three collinear points fail with `GEOMETRY_INVALID`.
`applyHomography` maps points, and a point mapping to infinity fails.

| Rule      | Detail                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI        | Drag four handles onto the plan's printed border, enter the border's aspect (or known width × height), preview the rectified plan                                                                                                     |
| Storage   | Original photo kept; rectified raster stored as a derivative with the homography matrix and source hash                                                                                                                               |
| Scale     | Calibration is still required on the rectified image (two-point). Rectification never sets a scale.                                                                                                                                   |
| Labelling | Source layer and schedule source: "Perspective-corrected (assistive) — not a surveyed measurement". Rows traced on it are `origin: traced`, `dimensionSource: scaled`, at most `medium` confidence. Lens distortion is not corrected. |
| Status    | Domain Implemented (`geometry.test.ts`); UI and storage Planned — Pilot (S-069)                                                                                                                                                       |

## 5. Geometry rules and issue codes

| Code                            | Severity | Trigger                                                                                                                                             | Message                                                                     | Remediation                                           |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| `GEO-SCALE-MISSING`             | blocking | `units: plan_units` with no calibration, or a superseded one. The schedule has no rows.                                                             | traced plan has no scale: calibrate from a known dimension before measuring | Calibrate (M-11)                                      |
| `GEO-SCALE-UNVERIFIED`          | blocking | Calibration `unverified`                                                                                                                            | scale has not been confirmed by the valuer: areas are unverified            | Check dimension; valuer confirms                      |
| `GEO-OPEN-SHAPE`                | blocking | Accepted boundary with `closed: false`                                                                                                              | `<label>`: shape is not closed                                              | Close it, or fix the misclosure                       |
| `GEO-INVALID-POLYGON`           | blocking | `polygonProblems`: `non_finite`, `too_few_vertices` (< 3), `duplicate_vertex` (consecutive vertices < 1e-9 apart), `zero_area`, `self_intersecting` | `<label>`: `<problems>`                                                     | Remove the duplicate vertex or untangle the shape     |
| `GEO-PENDING-REVIEW`            | blocking | Boundary `reviewStatus: pending` (AI-suggested)                                                                                                     | `<label>`: suggested boundary must be accepted or rejected                  | Accept, edit or reject (§8)                           |
| `GEO-OVERLAP`                   | blocking | Two components on one level intersect by more than 0.01 m²                                                                                          | `<a>` and `<b>` overlap by n m² (not double-counted)                        | Redraw to share walls, or split                       |
| `GEO-CONVENTION-BASIS-MISMATCH` | blocking | `convention.basis ≠ sketch.basis`                                                                                                                   | convention `<name>` measures `<basis>` but the sketch basis is `<basis>`    | Choose a matching convention                          |
| `GEO-NO-COMPONENTS`             | blocking | No accepted, closed, valid component                                                                                                                | the sketch has no accepted, closed components                               | Draw at least one component                           |
| `GEO-DEDUCTION-OUTSIDE`         | warning  | A deduction covers 0.01 m² or less of its level's components                                                                                        | `<label>` does not fall within any component on `<level>`                   | Move to the right level, or delete                    |
| `GEO-DEDUCTION-PARTIAL`         | warning  | Deduction area minus covered area > 0.01 m²                                                                                                         | `<label>`: only x of y m² falls within components                           | Trim the deduction                                    |
| `GEO-IMPLAUSIBLE-DIMENSION`     | warning  | Any edge < 0.1 m or > 1 000 m                                                                                                                       | `<label>`: wall length outside 0.1–1000 m                                   | Check entry; acknowledge with a reason (VAL-AREA-003) |
| `GEO-IMPLAUSIBLE-AREA`          | warning  | Area < 0.5 m² or > 200 000 m²                                                                                                                       | `<label>`: area n m² is implausible                                         | As above                                              |
| `GEO-SUPPLIED-VARIANCE`         | warning  | Supplied area with no level differs from `totalIncludedM2` by more than 5 %                                                                         | Measured total x m² differs from `<label>` (`<source>`) y m² by z%          | Investigate; acknowledge with a reason (J-06 E5)      |
| `GEO-FLOOR-TOTAL-MISMATCH`      | warning  | Supplied area with a level differs from that level's `includedM2` by more than 5 %                                                                  | `<level>` total x m² differs from …                                         | As above                                              |

Rejected boundaries are ignored. A boundary with a blocking issue is excluded from the rows.

| `DEFAULT_TOLERANCES` and constants                     | Value                          | Source             |
| ------------------------------------------------------ | ------------------------------ | ------------------ |
| `overlapM2` (overlap and deduction coverage threshold) | 0.01 m²                        | `area-schedule.ts` |
| `minEdgeM` / `maxEdgeM`                                | 0.1 m / 1 000 m                | `area-schedule.ts` |
| `minAreaM2` / `maxAreaM2`                              | 0.5 m² / 200 000 m²            | `area-schedule.ts` |
| `suppliedVariance`                                     | 0.05 (5 %)                     | `area-schedule.ts` |
| Wall-entry `closeTolerance`                            | 0.05 m                         | `snap.ts`          |
| Calibration span / distance / check tolerance          | ≥ 50 units / 0.5–2 000 m / 2 % | `calibration.ts`   |

These are code defaults. Per-firm configuration through the rule set is Planned — MVP
`[REVIEW: API_STANDARDS]`.

## 6. Area schedule (`computeAreaSchedule`)

### 6.1 Row and totals

| Row field                                  | Meaning                                                                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level`                                    | Level name (free text). Levels are ordered by first appearance.                                                                                                 |
| `label`                                    | Component name (brief "component")                                                                                                                              |
| `componentType`                            | Use (brief "use"), §7.3                                                                                                                                         |
| `basis`                                    | Sketch measurement basis                                                                                                                                        |
| `grossAreaM2`, `deductionsM2`, `netAreaM2` | Gross polygon area; area covered by the union of the level's deductions; net = gross − deductions                                                               |
| `perimeterM`                               | Outline perimeter                                                                                                                                               |
| `dimensionSource`                          | measured / supplied / scaled / estimated (§7.4)                                                                                                                 |
| `confidence`                               | `low` if AI-suggested origin, `estimated` source or unverified scale; `high` if `measured` with a scale that is not applicable or confirmed; otherwise `medium` |
| `includedInTotal`                          | `componentType ∈ convention.includes`                                                                                                                           |
| `measuredBy`, `measuredAt`                 | Principal and time of the write that stored the boundary (gap G10-05)                                                                                           |
| `sketchVersionId`, `calibrationId?`        | Link to the sketch version and calibration. Source plan through `SketchVersion.sourcePlanId`.                                                                   |

`LevelTotal` = `{ level, grossM2, deductionsM2, netM2, includedM2 }`. `totalNetM2` = Σ level net.
`totalIncludedM2` = Σ level included (the **reported total**). Every figure is rounded to 2 dp,
half away from zero.

### 6.2 Rules

1. **No double counting.** A level's included area is Σ net of included components, capped at
   `union(included outlines) − Σ coveredArea(deduction, included outlines)` when there are two or
   more. Overlaps also raise blocking `GEO-OVERLAP`, so a reportable schedule has none.
2. **Deductions by coverage.** Each component deducts only the part of the level's deductions
   that lies inside it (`coveredArea` against the union, so overlapping deductions are not
   deducted twice within a component).
3. **Supplied comparison.** Every supplied area (> 0) is compared at 5 % with the level total or
   the overall included total.
4. **Reportable** = no blocking issue **and** scale `not_applicable` or `confirmed`.
5. **Schedule hash** = SHA-256 of canonical JSON of the whole schedule except the hash. It is
   deterministic: the same version and convention always give the same hash.

### 6.3 Worked example (`area-schedule.test.ts`): two-storey dwelling with a void

Sketch in metres, basis `BUILDING_AREA`, convention `res-under-main-roof` (includes living,
garage, alfresco).

| Level                      | Component | Type     | Shape   | Gross | Deductions     | Net                | Perimeter | Included                    |
| -------------------------- | --------- | -------- | ------- | ----- | -------------- | ------------------ | --------- | --------------------------- |
| Ground                     | living-gf | living   | 12 × 10 | 120   | 0              | 120                | 44        | yes                         |
| Ground                     | garage    | garage   | 6 × 6   | 36    | 0              | 36                 | 24        | yes                         |
| Ground                     | verandah  | verandah | 12 × 2  | 24    | 0              | 24                 | 28        | no (excluded)               |
| Level 1                    | living-l1 | living   | 12 × 8  | 96    | 9 (void 3 × 3) | 87                 | 40        | yes                         |
| **Ground total**           |           |          |         | 180   | 0              | 180                |           | 156                         |
| **Level 1 total**          |           |          |         | 96    | 9              | 87                 |           | 87                          |
| **Total improvement area** |           |          |         |       |                | 267 (`totalNetM2`) |           | **243** (`totalIncludedM2`) |

No issues; `reportable`; scale `not_applicable`; confidence `high`. Other cases from the same
test file: the `res-living` convention gives 100 m² where `res-under-main-roof` gives 136 m² for
the same living plus garage. Two 10 × 10 rooms offset by 5 m give `GEO-OVERLAP` with an included
total of 150 m² (not 200). A measured 100 m² against a 112 m² builder plan gives
`GEO-SUPPLIED-VARIANCE` (−10.7 %). A traced 500 × 400 px rectangle at 0.02 m/px is 80 m²: not
reportable while unverified (`low`), reportable once confirmed (`medium`).

## 7. Measurement basis and conventions

### 7.1 Bases (`MEASUREMENT_BASIS_OPTIONS`)

| Code            | Label                 | Seed convention                     |
| --------------- | --------------------- | ----------------------------------- |
| `GFA`           | Gross floor area      | `gfa`                               |
| `GBA`           | Gross building area   | `ind-gba`                           |
| `GLA`           | Gross lettable area   | `retail-gla`                        |
| `NLA`           | Net lettable area     | `comm-nla`                          |
| `BUILDING_AREA` | Building area         | `res-living`, `res-under-main-roof` |
| `SITE_COVERAGE` | Site coverage         | **None** (gap G10-08)               |
| `OTHER`         | Other nominated basis | **None** (gap G10-08)               |

### 7.2 Conventions (`DEFAULT_CONVENTIONS`, all `draft`) `[REVIEW: API_STANDARDS]`

| Id                    | Basis         | Includes                                                                                          | Reference (as stored)                                                                    |
| --------------------- | ------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `res-living`          | BUILDING_AREA | living                                                                                            | Firm convention: enclosed habitable area measured to external faces of walls             |
| `res-under-main-roof` | BUILDING_AREA | living, garage, alfresco                                                                          | Firm convention: living plus garage and alfresco areas under the main roof               |
| `comm-nla`            | NLA           | office, retail, storage                                                                           | Recognised lettable-area method nominated by the firm (e.g. PCA method) — reference only |
| `retail-gla`          | GLA           | retail, storage                                                                                   | Recognised lettable-area method nominated by the firm — reference only                   |
| `ind-gba`             | GBA           | warehouse, office, mezzanine, amenities, plant, storage, ancillary                                | Firm convention: warehouse, office, mezzanine and ancillary enclosed areas               |
| `gfa`                 | GFA           | living, garage, office, retail, warehouse, mezzanine, amenities, plant, storage, ancillary, other | Firm convention: all enclosed floor area; excludes open-sided and external areas         |

Recognised methods (for example the Property Council of Australia method of measurement for
lettable areas, A-26) are **referenced by name and edition only**. Their rules are not reproduced
in the product. The firm records the method, edition and any licence in the convention reference
`[REVIEW: API_STANDARDS]` `[REVIEW: DATA_LICENSING]`. Carport, verandah, balcony and hardstand are in
no seed convention. They are measured and shown as "(excluded)" rows so the valuer sees them.

### 7.3 Component types

`living`, `garage`, `carport`, `verandah`, `balcony`, `alfresco`, `office`, `retail`, `warehouse`,
`mezzanine`, `amenities`, `plant`, `storage`, `hardstand`, `ancillary`, `other`. Deductions: `void`,
`courtyard`, `lightwell`, `excluded`. These cover the brief's classifications (living area,
garage, warehouse, office, retail, mezzanine, verandah, carport, hardstand, ancillary
improvements, excluded voids).

### 7.4 Dimension source

| Value       | Meaning                                                             | Confidence effect                                    |
| ----------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| `measured`  | Measured on site by the inspector or valuer                         | `high` when the scale is not applicable or confirmed |
| `supplied`  | From a supplied plan's written dimensions or a third-party document | `medium`                                             |
| `scaled`    | Scaled from a calibrated image                                      | `medium` once confirmed, `low` while unverified      |
| `estimated` | Estimated (e.g. no access)                                          | Always `low`                                         |

## 8. AI assistance

| Rule           | Detail                                                                                                                                                                                                                                                                                                   | Status                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Kinds          | `sketch_outline` (must reference `sourcePlanId`; `value` carries the outline) and `room_label` (label of 60 characters or fewer). Labels implying dimensions, defects, compliance, brand, concealed construction or operational condition are refused (`AI_INFERENCE_PROHIBITED`, e.g. "4.2 m bedroom"). | Implemented             |
| Who            | Only an `ai` principal creates suggestions; only a human with `ai.decide` decides. Never auto-accepted, whatever the confidence (A-11).                                                                                                                                                                  | Implemented             |
| Pending blocks | Pending suggestions block submit and issue (`VAL-AI-001`). A pending AI boundary in a sketch raises `GEO-PENDING-REVIEW` (blocking); a rejected one is ignored; an accepted one has `low` confidence.                                                                                                    | Implemented (domain)    |
| UI             | Dashed overlay labelled "AI suggestion" with confidence % and model version. Accept, edit or reject each boundary and each label; no "accept all". Pending suggestions are never counted in totals (UX-12).                                                                                              | Planned — Pilot (S-069) |
| Scale          | AI never confirms a scale or approves a schedule (`measurement.approve` is human-only).                                                                                                                                                                                                                  | Implemented             |
| Integration    | The API cannot place an AI boundary in a sketch: `BoundaryInput.origin` excludes `ai_suggested`, every posted boundary is stored `accepted`, and an accepted `sketch_outline` becomes only an `AcceptedFact` (gap G10-04).                                                                               | Planned — Pilot (S-069) |

## 9. Versioning, approval and immutability

`SketchVersion` = `id`, `sketchId`, `assetId`, `version`, `parentVersionId?`, `units`
(`metres`/`plan_units`), `sourcePlanId?`, `calibration?` (embedded `ScaleCalibration`),
`boundaries[]`, `basis`, `conventionId`, `northBearingDeg?`, `suppliedAreas?`,
`includeInClientReport`, `changeSummary`, `createdBy`, `createdAt`, `status`.

```
working ──approveMeasurement (valuer, latest version, reportable)──▶ approved ──freezeSketchVersion (issue)──▶ frozen
   ▲                                                                   │                                         │
   └──────────── nextSketchVersion (any edit, confirm-scale, recalibration; also from frozen on amendment) ◀───────┘
```

| Rule                       | Implementation                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New version                | `nextSketchVersion`: copies the parent, applies the changes, `version + 1`, `parentVersionId`, `status: working`. A non-blank change summary is required. Earlier versions are untouched.                                                                                                                                                    |
| Approval binds to the hash | `approveMeasurement`: human actor; the schedule must be computed for the same version, `reportable`, and the version `working`. The API also requires the latest version (`STALE_VERSION`). It writes `measurement_approval` (schedule JSON + `schedule_hash`, append-only) and sets the version to `approved`.                              |
| Edit after approval        | Creates a new `working` version. The old approval no longer matches the reporting schedule, so VAL-AREA-002 blocks until re-approval (J-06 E1).                                                                                                                                                                                              |
| Freeze on issue            | In the issue transaction, every approved reporting version becomes `frozen` (`freezeSketchVersion`).                                                                                                                                                                                                                                         |
| DB triggers (`0002`)       | `sketch_version_guard`: a `frozen` row cannot be updated or deleted; an `approved` row may only change to `frozen`, with `data − status` and `content_hash` unchanged; non-working rows cannot be deleted. `measurement_approval_append_only` rejects any update or delete. `content_hash` = canonical hash of the version without `status`. |
| MFA                        | `measurement.approve` is human-only but not MFA-gated (open question Q10-1 in §13).                                                                                                                                                                                                                                                          |

| Audit action             | Emitted by                                           | Payload                                                                   |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `sketch.version_created` | `POST …/sketches`                                    | `sketchId`, `version`, `changeSummary`, `totalIncludedM2`, `scheduleHash` |
| `calibration.created`    | `POST …/sketches` with `calibration`                 | Full calibration                                                          |
| `calibration.confirmed`  | `POST …/confirm-scale`                               | reason = check note; `sketchVersionId`, `metresPerUnit`                   |
| `measurement.approved`   | `POST …/approve`                                     | `scheduleHash`, `totalIncludedM2`, `basis`                                |
| `field.updated`          | `POST …/sketches` with `useForReport` (default true) | `improvements.areaSchedule` = sketchId; `improvements.measurementBasis`   |

| Rule         | Severity | Stages               | Acknowledgeable    | Check                                                                                            |
| ------------ | -------- | -------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| VAL-AREA-001 | blocking | draft, submit, issue | no                 | Reporting schedule not reportable (lists blocking GEO codes, or the scale status)                |
| VAL-AREA-002 | blocking | submit, issue        | no                 | No `measurement_approval` with the same `sketchVersionId` **and** `scheduleHash`                 |
| VAL-AREA-003 | warning  | draft, submit, issue | yes, with a reason | Each GEO warning (dimension, area, deduction, supplied/floor variance)                           |
| VAL-AREA-004 | blocking | draft, submit, issue | no                 | Ground-level gross > `land.area` (level name matches `^(ground\|gf\|level 0)`, case-insensitive) |

## 10. Report output

| Element                       | Source                                                                                                                                                                                                                 | Status                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Area schedule table and total | `area_schedule` block (09 §5.4): rows, level totals, "Total improvement area" = `totalIncludedM2`, basis in the title, note with scale status and hash prefix                                                          | Implemented                                                                                                 |
| Approved 2D drawing           | `sketch` block plus render assets: vector, fit-to-box, per-level fill, deductions dashed, labels at centroids                                                                                                          | Implemented; one drawing per level, a scale bar and edge dimensions are Planned — MVP (S-056)               |
| Legend                        | Text line "Scale status: …. Levels: …. Dashed outlines are deductions."                                                                                                                                                | Partial; a full legend table (component type → fill, deduction pattern, AI origin) is Planned — MVP (S-056) |
| North point                   | Arrow and "N" from `northBearingDeg`; caption "north point not recorded" when absent                                                                                                                                   | Implemented                                                                                                 |
| Scale status                  | In the drawing and the schedule note                                                                                                                                                                                   | Implemented                                                                                                 |
| Disclaimer                    | Clause `area-disclaimer` (placeholder until the firm's wording is approved) `[REVIEW: API_STANDARDS]`                                                                                                                  | Clause slot Implemented                                                                                     |
| Working sketches excluded     | `includeInClientReport = false` leaves the **drawing** out of the client PDF. The schedule still renders, because it is the reported figure. The version, schedule and approval stay in the DB and the issue snapshot. | Implemented                                                                                                 |
| Source plan image appendix    | Original or rectified plan                                                                                                                                                                                             | Planned — MVP (S-034)                                                                                       |

Only the latest version of the sketch referenced by `improvements.areaSchedule` is reported:
one sketch per asset (gap G10-09).

## 11. API and data model

| Method and path                                                   | Permission                              | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/jobs/{jobId}/assets/{assetId}/sketches`                 | `sketch.edit` (Valuer, Field inspector) | Without `sketchId`: creates v1 (needs `units`, `basis`, `conventionId`, `boundaries`). With `sketchId`: creates the next version from the latest, applying only the supplied fields. Optional `calibration` (`two_point` {p1, p2, knownDistanceM} or `stated_scale` {ratio, dpi}), `sourcePlanId`, `northBearingDeg`, `suppliedAreas`, `includeInClientReport`, `changeSummary` (3 characters or more), `useForReport`. Returns `{ version, schedule }`. |
| `POST /v1/jobs/{jobId}/sketch-versions/{versionId}/confirm-scale` | `measurement.approve` (Valuer; human)   | Body `{ checkNote }`. New version with the confirmed calibration. Returns `{ version, schedule }`.                                                                                                                                                                                                                                                                                                                                                       |
| `POST /v1/jobs/{jobId}/sketch-versions/{versionId}/approve`       | `measurement.approve` (Valuer; human)   | Returns `{ approval, schedule }`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /v1/jobs/{jobId}/ai-suggestions`, `…/{id}/decision`         | AI service; `ai.decide`                 | §8                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Planned endpoints (MVP, S-047/S-048/S-049 unless noted): `GET …/assets/{assetId}/sketches`
(list), `GET …/sketch-versions/{id}` (version + schedule + approvals), `GET …/sketches/{sketchId}/history`,
`POST …/source-plans` (upload, S-034), `POST …/sketch-versions/{id}/calibration-checks` (stores
the `checkCalibration` result; gates confirm), `POST …/source-plans/{id}/rectify` (Pilot, S-069),
`POST …/sketch-versions/{id}/boundaries/{bid}/decision` (Pilot, S-069), and sync entity
`sketch_version` (S-042).

| Brief §9 entity                          | Implementation                                                                                                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sketch / MeasurementProject              | `sketch_id` grouping of versions per asset                                                                                                                                                                 |
| SketchVersion                            | `sketch_version` (`id`, `org_id`, `job_id`, `asset_id`, `sketch_id`, `version`, `status` working/approved/frozen, `data` jsonb, `content_hash`, `created_by`, `created_at`; unique `(sketch_id, version)`) |
| Boundary / AreaComponent / AreaDeduction | `SketchVersion.boundaries[]` with `role` component/deduction                                                                                                                                               |
| ScaleCalibration                         | Embedded in `SketchVersion.calibration` (copied forward; history across versions)                                                                                                                          |
| SourcePlan                               | `sourcePlanId` reference only; `document` table exists, no upload route (Planned S-034)                                                                                                                    |
| AreaSchedule                             | Computed on demand. Stored at approval in `measurement_approval.schedule`, and at issue in the issue snapshot.                                                                                             |
| MeasurementApproval                      | `measurement_approval` (`sketch_version_id`, `schedule`, `schedule_hash`, `approved_by`, `approved_at`), append-only                                                                                       |

## 12. Test plan

| Existing test                                | Covers                                                                                                                                                                                                                                                                                                                           | TC (spec 12)                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `packages/domain/test/geometry.test.ts`      | Shoelace with both windings; L-shape area and perimeter; centroid; invalid polygons; point-in-polygon; intersection, union and coverage; two-point and stated-scale calibration; span and distance limits; check dimension; homography and degenerate points; grid, angle and vertex snapping; wall entry closure and misclosure | TC-GEO-001, 002, 005, 008, 010 |
| `packages/domain/test/area-schedule.test.ts` | §6.3 example; conventions; overlap counted once; shared walls; open, invalid and pending boundaries; deduction outside; implausible values; supplied variance; scale missing, unverified and confirmed; basis mismatch; deterministic hash; approval binding and refusals; version lineage                                       | TC-GEO-003, 004, 006, 009, 011 |
| `packages/domain/test/report.test.ts`        | Area table "Total improvement area" row in composition                                                                                                                                                                                                                                                                           | TC-PDF-004 (part)              |
| `apps/api/test/lifecycle.test.ts`            | API draw, measure and approve (216 m²); inspector approval refused (403); `measurement.approved` in the audit chain; frozen sketch row immutable after issue                                                                                                                                                                     | TC-GEO-011, TC-AUD             |

Additional domain/API tests needed (MVP): recalibration via the API records `supersedesId`, resets
to `unverified` and recomputes areas (TC-GEO-007); confirm-scale on a stale version gives 409;
an edit after approval fails VAL-AREA-002; VAL-AREA-004; `includeInClientReport = false` leaves the
drawing out of client composition but keeps it for internal (TC-PDF-005); `sketch_version` sync
replay is idempotent and branching is flagged; AI boundary insertion and decision; y-up
orientation of traced plans in the PDF; schedule time for 300 boundaries × 500 vertices within a
device budget (PERF).

UI tests needed (S-062; run on phone, tablet and web unless noted):

| ID       | Scenario                                                  | Expected                                                                                    |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| UI-SK-01 | Import image, PDF page and photo                          | Original hash equals upload; PDF dpi recorded; encrypted PDF shows E4 and keeps the file    |
| UI-SK-02 | Two-point calibration                                     | Points < 50 units and distances outside 0.5–2 000 m refused; every area badged "Unverified" |
| UI-SK-03 | Check dimension                                           | Deviation % shown; > 2 % disables Confirm without a reason; confirm creates a version       |
| UI-SK-04 | Draw a rectangle and an L-shape                           | Live m² and perimeter equal the domain values                                               |
| UI-SK-05 | Wall entry by keyboard only                               | Closed polygon; 0.30 m misclosure message; screen reader announces the area                 |
| UI-SK-06 | Snapping toggles                                          | Grid, 90°/45° and vertex snapping give deterministic coordinates                            |
| UI-SK-07 | Undo/redo over 50 operations, then commit                 | One version with a change summary; history lists it                                         |
| UI-SK-08 | Duplicate and copy to level                               | New ids; geometry identical; level totals update                                            |
| UI-SK-09 | Deduction                                                 | Dashed and hatched; net and level totals update; deduction outside gives a warning          |
| UI-SK-10 | Overlap                                                   | Both outlines highlighted; blocking issue links to them; Approve disabled                   |
| UI-SK-11 | Screen-reader list view (VoiceOver, TalkBack, NVDA)       | Every component announced with label, type and m²; create and edit via the vertex table     |
| UI-SK-12 | Airplane mode: three versions offline, then sync (mobile) | No duplicates; server hash equals device hash                                               |
| UI-SK-13 | Offline approval rejected on sync (mobile)                | User notified; areas revert to "Unverified"                                                 |
| UI-SK-14 | AI outline review (Pilot)                                 | Accept, edit or reject each boundary; no accept-all; pending not counted                    |
| UI-SK-15 | Perspective correction (Pilot)                            | "Assistive — not a surveyed measurement" label; calibration still required                  |
| UI-SK-16 | Report-inclusion toggle                                   | W-14 draft preview shows or hides the drawing; the schedule always shows                    |
| UI-SK-17 | 200 % font, outdoor contrast, 48 dp targets               | Tools reachable; strokes thickened                                                          |
| UI-SK-18 | Cross-platform parity fixture                             | Identical schedule hash on phone, tablet and web                                            |

## 13. Gaps found in the code (relative to brief §6) and open questions

| ID     | Gap                                                                                                                                                                                                                     | Proposed fix                                                                                                                     | Release            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| G10-01 | No source-plan upload: `sourcePlanId` is an unchecked UUID, the original file is not preserved, and there is no PDF-page or photo import.                                                                               | `source-plans` route on `document`, with provenance                                                                              | MVP (S-034, S-047) |
| G10-02 | The check dimension (`checkCalibration`) is not exposed: confirm-scale takes only a free-text note. The calibration distance's dimension source (J-06 step 2) is not captured.                                          | Calibration-check endpoint gating confirm; `distanceSource` field                                                                | MVP (S-049)        |
| G10-03 | Stated-scale recalibration does not set `supersedesId`; status `superseded` is never assigned.                                                                                                                          | Set both on every recalibration                                                                                                  | MVP                |
| G10-04 | AI outlines and labels cannot reach a sketch (§8). `room_label` needs no source reference. The `sketch_outline` payload is not validated.                                                                               | Insert-as-pending-boundary flow; payload schema                                                                                  | Pilot (S-069)      |
| G10-05 | Every posted boundary is re-stamped `measuredBy`/`measuredAt`, even unchanged ones, which loses the original measurer. `componentType` is not checked against the type lists, or against the boundary role.             | Keep the stamps for unchanged boundary ids; validate enums                                                                       | MVP                |
| G10-06 | Axis orientation is undefined for traced plans (image y-down against PDF y-up).                                                                                                                                         | Store y-up (§2.3), or record the orientation                                                                                     | MVP                |
| G10-07 | No non-area partition or annotation lines. Internal partitions must tile as rooms.                                                                                                                                      | Boundary role `partition` (not measured)                                                                                         | MVP                |
| G10-08 | No convention for `SITE_COVERAGE`/`OTHER`. Conventions are hard-coded, not firm-configurable or approvable, and a `draft` convention does not block issue. Site coverage is not computed from the schedule.             | Versioned conventions in the rule set; VAL rule at issue `[REVIEW: API_STANDARDS]`                                               | MVP                |
| G10-09 | One reporting sketch per asset (`improvements.floorAreas` is unused); levels are overlaid in one drawing; no read endpoints; no sketch sync; client-generated version ids are not accepted.                             | §10, §11, §2.5                                                                                                                   | MVP                |
| G10-10 | "Inconsistent floor totals" is checked only against supplied per-level areas, and VAL-AREA-004 depends on level names. There is no online-area-data comparison.                                                         | Structured level ordinal; adapter-sourced supplied areas `[REVIEW: DATA_LICENSING]`                                              | MVP / Pilot        |
| G10-11 | Working `sketch_version` rows can still be updated or deleted at the DB level (the application never does).                                                                                                             | Make every version row append-only except status                                                                                 | MVP                |
| G10-12 | No manual override of a computed area (brief §6 "manual override"), e.g. adopting a supplied area with a reason. Asset area fields (`lettableArea`, `officeArea`, …) are free entry, not tied to the approved schedule. | Row-level override with reason, audited like `calculation.overridden`; derive or check area fields against the approved schedule | MVP (S-049)        |
| Q10-1  | Should `measurement.approve` require MFA step-up like the other professional approvals?                                                                                                                                 | Decision: product owner `[REVIEW: API_STANDARDS]`                                                                                | MVP                |
