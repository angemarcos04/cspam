# CSPAMS Corrected Codex Prompt

Use this prompt when working on the CSPAMS repository.

## Mission

Work inside the current CSPAMS codebase as it exists today. Fix bugs, complete missing pieces, and improve maintainability **without changing the project’s core compliance workflow, role boundaries, or account lifecycle** unless explicitly instructed.

## Non-Negotiable Product Concepts

1. CSPAMS is a compliance and monitoring system, not a general learner management platform.
2. School Heads are school-scoped users.
3. Monitors have broader operational visibility and privileged review/account actions.
4. Compliance submissions are workflow-driven, reviewable, and auditable.
5. Submission completion is scope-based, not just a single flat status.

## Source of Truth

When documentation and code disagree, trust the code in this order:

1. `routes/api.php`
2. `app/Http/Controllers/Api/`
3. `app/Http/Requests/Api/`
4. `app/Models/`
5. `app/Support/`
6. `app/Http/Resources/`
7. `frontend/src/`
8. `tests/`

## Core Backend Entities You Must Understand

### `IndicatorSubmission`

- compliance package per school / year
- owns status, notes, review metadata
- retains BMEF/SMEA compatibility fields
- exposes files and items

### `IndicatorSubmissionItem`

- one metric row per submission
- carries typed values, display values, target/actual values, compliance state

### `IndicatorSubmissionFile`

- tracks additional submission files
- not limited to BMEF and SMEA
- supports file-type-based workflows

### `FormSubmissionHistory`

- immutable workflow audit trail
- append-only
- used by progress reconstruction

### `LearnerCase`

- current replacement for older "Concern" concepts
- stores PII (`lrn`, `name`)
- is school-scoped for School Heads and broader for Monitors

### `User`

- supports School Head and Monitor workflows
- includes account status, verification metadata, temp-password fields, MFA data, and school linkage

## Critical Routes

### Auth

- `POST /api/auth/login`
- `POST /api/auth/verify-mfa`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/reset-required-password`
- `POST /api/auth/setup-account`
- `GET /api/auth/me`
- session-management routes
- MFA reset routes

### School records / School Head accounts

- `GET /api/dashboard/records`
- `POST /api/dashboard/records`
- `PATCH /api/dashboard/records/{school}`
- archival / restore / permanent delete routes
- School Head account routes under:
  - `/api/dashboard/records/{school}/school-head-account/*`

### Indicators / submissions

- `GET /api/indicators/academic-years`
- `GET /api/indicators/metrics`
- `GET /api/indicators/submissions`
- `POST /api/indicators/submissions/bootstrap`
- `POST /api/indicators/submissions`
- `PUT/PATCH /api/indicators/submissions/{submission}`
- `POST /api/indicators/submissions/{submission}/submit-scopes`
- `POST /api/indicators/submissions/{submission}/submit`
- `POST /api/indicators/submissions/{submission}/review`
- `POST /api/indicators/submissions/{submission}/reset-workspace`
- `GET /api/indicators/submissions/{submission}/history`

### Files

- `POST /api/submissions/{submission}/upload-file`
- `GET /api/submissions/{submission}/view/{type}`
- `GET /api/submissions/{submission}/download/{type}`

### Learner cases

- `GET /api/dashboard/learner-cases`
- `POST /api/dashboard/learner-cases`
- `GET /api/dashboard/learner-cases/{learnerCase}`
- `PUT/PATCH /api/dashboard/learner-cases/{learnerCase}`
- `DELETE /api/dashboard/learner-cases/{learnerCase}`

## Critical Services and Utilities

- `MonitorActionVerificationService`
- `SchoolHeadAccountSetupService`
- `SubmissionScopeProgressResolver`
- `SubmissionFileRequirementResolver`
- `FormSubmissionHistoryLogger`
- indicator helpers under `app/Support/Indicators/`

## Security and Workflow Constraints

Preserve these:

1. School Head login uses exact six-digit school code.
2. Account-status gating remains enforced.
3. Sensitive monitor actions keep verification-challenge behavior.
4. Submission files stay on private storage paths.
5. Auto-calculated and scope-sensitive submission logic must stay consistent.
6. School Head data access remains school-scoped.
7. Temp-password and must-reset-password flows remain enforced.

## Known High-Risk Areas

### Account lifecycle

Be careful around:

- `pending_setup`
- `pending_verification`
- `active`
- `suspended`
- `locked`
- `archived`

Do not simplify these into a generic active/inactive toggle.

### Temporary passwords

The repo now treats temporary passwords as expiring credentials tied to:

- `temporary_password_issued_at`
- `must_reset_password`
- `CSPAMS_SCHOOL_HEAD_TEMP_PASSWORD_EXPIRE_HOURS`

Expired temp passwords must:

- block direct login
- expose `temporaryPasswordExpired`
- expose `temporaryPasswordExpiresAt`
- surface lifecycle state `temporary_password_expired`

### Submission progress

Do not flatten submission completion into one flag. Preserve:

- `requiredScopeIds`
- `submittedScopeIds`
- `pendingScopeIds`
- required file types per submission

### Learner cases

Do not assume learner-case data is aggregate-only. It currently stores learner identifiers and needs privacy-conscious handling.

## Required Working Style

When asked to implement something:

1. Find the exact route/controller/frontend/test path first.
2. Prefer the narrowest correct fix.
3. Preserve API contracts unless the bug requires a coordinated change.
4. Preserve workflow history and role restrictions.
5. Update or add focused tests.
6. Run targeted verification before broad builds when practical.

## What Not To Do

- Do not redesign the product because a workflow is complex.
- Do not rename existing concepts casually.
- Do not move files to public storage.
- Do not bypass verification on sensitive monitor actions.
- Do not delete workflow history.
- Do not remove account-state checks to make tests easier.
- Do not assume old docs are accurate without checking code.

## Expected Output Standard

When you finish a task, report:

1. what changed
2. what was intentionally preserved
3. what verification ran
4. any residual risk that actually matters

## Short Operational Prompt

Use this when starting any CSPAMS task:

> Work inside the current CSPAMS codebase as it exists today. Treat routes, controllers, request classes, models, support services, resources, frontend state/types, and tests as the source of truth. Preserve the core CSPAMS concept: school-level compliance submissions, monitor review workflows, strict role separation, school-scoped data access, and School Head account-state gating. Prefer focused fixes over broad rewrites. Be especially careful around authentication, MFA/reset flows, School Head account management, temporary password expiry, submission review, scope-progress handling, typed indicator values, learner-case privacy, file upload/download privacy, and deletion/archive behavior. Add or update focused tests where practical and verify the smallest relevant surface before broader builds.
