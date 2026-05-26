# CSPAMS Codebase Issues, Root Causes, and Safe Solutions

This document summarizes the highest-signal implementation issues and constraints in the current CSPAMS codebase. It is meant for engineers and AI assistants working on the repo.

## Scope

This analysis is based on the current codebase structure:

- `routes/api.php`
- `app/Http/Controllers/Api/`
- `app/Http/Requests/Api/`
- `app/Models/`
- `app/Support/`
- `app/Http/Resources/`
- `frontend/src/`
- `tests/`

When this document conflicts with the code, the code wins.

## Issue 1: Older docs still talk about "Concerns" instead of `LearnerCase`

### Problem

Some historical documentation and design notes describe a "Concern" model and `/concerns` workflow, but the current implementation uses `LearnerCase`.

### Current Reality

- Model: `app/Models/LearnerCase.php`
- Controller: `app/Http/Controllers/Api/LearnerCaseController.php`
- Routes:
  - `GET /api/dashboard/learner-cases`
  - `POST /api/dashboard/learner-cases`
  - `GET /api/dashboard/learner-cases/{learnerCase}`
  - `PUT/PATCH /api/dashboard/learner-cases/{learnerCase}`
  - `DELETE /api/dashboard/learner-cases/{learnerCase}`

### Important Detail

`LearnerCase` currently stores PII:

- `lrn`
- `name`
- `grade_section`
- `issue_type`
- `severity`
- `status`
- `case_notes`

This is materially different from the older "aggregate-only concern" concept.

### Safe Guidance

- Use `LearnerCase`, not `Concern`
- Review authorization via `LearnerCasePolicy` before changing case access
- Treat learner-case data as privacy-sensitive

## Issue 2: File uploads are not just inline submission fields

### Problem

BMEF and SMEA are partly represented on `IndicatorSubmission`, but the file system is broader than that. Newer file types are tracked separately.

### Current Reality

- Model: `app/Models/IndicatorSubmissionFile.php`
- Submission relation: `IndicatorSubmission::submissionFiles()`
- Core legacy-compatible fields on `IndicatorSubmission`:
  - `bmef_file_path`
  - `bmef_original_filename`
  - `bmef_uploaded_at`
  - `bmef_file_size`
  - `smea_file_path`
  - `smea_original_filename`
  - `smea_uploaded_at`
  - `smea_file_size`
- Additional file types are tracked through `indicator_submission_files`

### Supported file types

Frontend type source: `frontend/src/types.ts`

- `bmef`
- `smea`
- `fm_qad_001`
- `fm_qad_002`
- `fm_qad_003`
- `fm_qad_004`
- `fm_qad_008`
- `fm_qad_009`
- `fm_qad_010`
- `fm_qad_011`
- `fm_qad_034`
- `fm_qad_041`

### Safe Guidance

- Do not implement upload logic as "BMEF and SMEA only"
- Use `SubmissionFileDefinition` and `SubmissionFileRequirementResolver`
- Keep files private and accessed through controller routes, not public URLs

## Issue 3: Submission history is an append-only audit surface

### Problem

Submission transitions are not just status updates on `IndicatorSubmission`. They are also logged separately.

### Current Reality

- Model: `app/Models/FormSubmissionHistory.php`
- Logger service: `app/Support/Forms/FormSubmissionHistoryLogger.php`
- History route:
  - `GET /api/indicators/submissions/{submission}/history`

### Safe Guidance

- Log workflow transitions through `FormSubmissionHistoryLogger`
- Do not treat `form_submission_histories` as disposable data
- Preserve metadata used by scope-progress reconstruction

## Issue 4: Progressive submission is scope-based, not all-or-nothing

### Problem

The current workflow supports submitting and tracking specific sections independently before final submission.

### Current Reality

- Resolver: `app/Support/Indicators/SubmissionScopeProgressResolver.php`
- Routes:
  - `POST /api/indicators/submissions/{submission}/submit-scopes`
  - `POST /api/indicators/submissions/{submission}/submit`
  - `POST /api/indicators/submissions/{submission}/reset-workspace`

### Required scopes

Required scopes are built from:

- metric workspaces:
  - `school_achievements_learning_outcomes`
  - `key_performance_indicators`
- required file types resolved per submission

### Safe Guidance

- Do not collapse scope progress into a single boolean
- Preserve `requiredScopeIds`, `submittedScopeIds`, and `pendingScopeIds`
- Be careful with reset behavior because scope status is reconstructed from history and current state

## Issue 5: Critical School Head account actions use verification challenges

### Problem

Account state changes are not simple patch operations. Some require monitor-side verification codes.

### Current Reality

- Service: `app/Support/Auth/MonitorActionVerificationService.php`
- Verification route:
  - `POST /api/dashboard/records/{school}/school-head-account/verification-code`
- Consumed by status changes and related sensitive actions

### Safe Guidance

- Do not remove verification flows from status-changing monitor actions
- Preserve code TTL and max-attempt behavior
- Keep monitor email delivery failure handling intact

## Issue 6: Temporary password lifecycle was partially implemented

### Problem

The codebase had temp-password fields and frontend concepts, but temp-password expiry checks were stubbed out in auth and response serializers.

### Current Reality

Relevant fields:

- `users.temporary_password_issued_at`
- `users.temporary_password_display`
- `users.must_reset_password`

Related surfaces:

- `AuthController::schoolHeadTemporaryPasswordExpired()`
- monitor-facing account payloads in:
  - `SchoolHeadAccountController`
  - `SchoolRecordController`
  - `SchoolRecordResource`

### What was fixed

This repo now computes temporary-password expiry from:

- `temporary_password_issued_at`
- `CSPAMS_SCHOOL_HEAD_TEMP_PASSWORD_EXPIRE_HOURS` (default 72)

It now:

- blocks school-head login when the temp password is expired
- exposes `temporaryPasswordExpiresAt`
- exposes `temporaryPasswordExpired`
- surfaces lifecycle state as `temporary_password_expired`
- recommends `regenerate_temporary_password` when applicable

### Safe Guidance

- Keep temp-password policy consistent across auth and monitor UI payloads
- Do not show temp-password displays once the password-reset requirement has been cleared

## Issue 7: Auth is mixed-mode and role-sensitive

### Problem

The repo supports stateful browser sessions and bearer tokens, with different monitor and school-head behaviors.

### Current Reality

Key routes in `routes/api.php`:

- `POST /api/auth/login`
- `POST /api/auth/verify-mfa`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/reset-required-password`
- `POST /api/auth/setup-account`
- `GET /api/auth/me`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/{session}`
- `POST /api/auth/sessions/revoke-others`
- MFA reset routes

### Safe Guidance

- Preserve school-head login by exact six-digit school code
- Preserve monitor login by normalized email
- Preserve account-status gating
- Preserve the `must_reset_password` path

## Issue 8: Frontend terminology is ahead of some backend payloads

### Problem

The frontend already knows about lifecycle states such as:

- `temporary_password_active`
- `temporary_password_expired`
- `password_reset_required`

but some backend serializers were still returning null/false placeholders.

### Safe Guidance

- Keep frontend/backed lifecycle payloads aligned
- Prefer changing backend payload truth over weakening the frontend state model

## Implementation Checklist

Before changing anything substantial, verify:

- Are you using `LearnerCase`, not the old "Concern" concept?
- Are you using `IndicatorSubmissionFile` for non-core submission files?
- Are workflow transitions logged to `FormSubmissionHistory`?
- Are you preserving scope-progress semantics?
- Are you preserving monitor verification for sensitive account actions?
- Are you keeping temp-password expiry consistent across auth and monitor payloads?
- Are you avoiding public file exposure?
- Are school-head views still school-scoped?

## Recommended Working Rule for Codex

Treat the current routes, models, request classes, support services, and tests as the source of truth. Preserve the project’s core workflows and role boundaries. Prefer focused fixes over broad rewrites.
