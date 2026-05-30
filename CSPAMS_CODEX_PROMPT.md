# CSPAMS Codex Working Prompt
## Safe Implementation Guide for This Codebase

You are working in the CSPAMS repository. Your job is to fix bugs, complete missing behavior, and improve maintainability without changing the core business concept, workflow design, or role boundaries unless the user explicitly asks for a redesign.

This is a compliance and monitoring system for schools. It is not a generic learner-management app. Preserve the existing product intent.

## 1. Source of Truth

If documentation and code disagree, trust the codebase first.

Primary sources of truth:
- `routes/api.php`
- `app/Http/Controllers/Api/`
- `app/Http/Requests/Api/`
- `app/Models/`
- `app/Support/`
- `app/Http/Resources/`
- `frontend/src/`
- `tests/`

Documentation files are reference material only:
- `README.md`
- `CSPAMS_DOCUMENTATION_INDEX.md`
- `CSPAMS_PROJECT_ANALYSIS.md`
- `CSPAMS_IMPLEMENTATION_GUIDE.md`
- `CSPAMS_MASTER_CHECKLIST.md`
- other `CSPAMS_*.md` files

If a document is outdated, do not blindly follow it. Verify against code.

## 2. Core Product Rules You Must Preserve

These are non-negotiable unless the user asks to change them:

- School Heads are school-scoped.
- Monitors have broader visibility and privileged review/account actions.
- Compliance submissions are workflow-driven, reviewable, and auditable.
- Submission completion is scope-based, not just a single status flag.
- File uploads are private and handled through controlled routes.
- Sensitive account actions must remain gated and verifiable.
- Audit/history behavior must remain intact.
- Role separation must not be weakened for convenience.

## 3. Current Realities in This Repo

Use these real concepts, not older design notes:

- `LearnerCase` is the current learner-case model.
- `IndicatorSubmissionFile` exists for file tracking.
- `FormSubmissionHistory` exists for immutable submission audit.
- `SubmissionScopeProgressResolver` drives section/scope completion.
- `MonitorActionVerificationService` handles critical monitor-side verification.
- School Head temporary-password and password-reset flows are security-sensitive.
- Frontend state types and UI labels already expect lifecycle states such as:
  - `pending_setup`
  - `pending_verification`
  - `temporary_password_active`
  - `temporary_password_expired`
  - `password_reset_required`
  - `active_ready`

## 4. Known High-Risk Areas

Before changing anything, inspect the exact code path involved.

### Authentication and account lifecycle
Check:
- `app/Http/Controllers/Api/AuthController.php`
- `app/Http/Middleware/EnsureActiveAccount.php`
- related request classes
- `app/Models/User.php`
- account-status logic
- temporary-password logic
- password reset logic
- session management routes

Preserve:
- school-code login for School Heads
- email/password login for Monitors
- account-status gating
- MFA and reset flows
- session revocation behavior
- audit logging for auth actions

### School Head account management
Check:
- `app/Http/Controllers/Api/SchoolHeadAccountController.php`
- `app/Http/Resources/SchoolRecordResource.php`
- `app/Http/Controllers/Api/SchoolRecordController.php`
- tests under `tests/Feature/`

Preserve:
- activation/setup/verification flow
- temporary password issuance and expiration behavior
- monitor verification for sensitive status changes
- lifecycle state labels and recommended actions
- safe account removal/archive semantics

### Submission workflow
Check:
- `app/Http/Controllers/Api/IndicatorSubmissionController.php`
- `app/Models/IndicatorSubmission.php`
- `app/Models/IndicatorSubmissionItem.php`
- `app/Models/IndicatorSubmissionFile.php`
- `app/Support/Indicators/`
- `app/Support/Forms/FormSubmissionHistoryLogger.php`

Preserve:
- submission bootstrap/update/review/reset behavior
- typed values and display values
- yearly matrix behavior
- scope-based submission completion
- file-type requirements
- append-only history trail

### Learner cases
Check:
- `app/Models/LearnerCase.php`
- `app/Http/Controllers/Api/LearnerCaseController.php`
- authorization policies if present
- related tests

Preserve:
- school-scoped access
- privacy-sensitive handling
- current field semantics
- role-based visibility

### Frontend behavior
Check:
- `frontend/src/pages/`
- `frontend/src/context/`
- `frontend/src/types.ts`
- `frontend/src/api/`
- relevant tests

Preserve:
- existing contract with backend payloads
- lifecycle state labels
- selected-year reporting behavior
- read-only treatment for auto-calculated values
- monitor vs School Head UI separation

## 5. Safe Change Standard

A good change in this repo should:
- solve the reported issue directly
- keep the blast radius small
- preserve public contracts unless the bug requires a coordinated change
- preserve role restrictions and account-state checks
- preserve history/audit behavior
- add focused tests where practical
- avoid broad refactors unless they are necessary for correctness

Do not rewrite large subsystems just because the code is imperfect.

## 6. How You Should Work

When asked to implement a fix:

1. Identify the exact user-facing symptom.
2. Trace the route, controller, model, support class, and frontend consumer involved.
3. Read existing tests for the same area.
4. Determine whether the issue is:
   - backend-only
   - frontend-only
   - contract mismatch
   - validation bug
   - authorization bug
   - state/lifecycle bug
   - audit/history bug
5. Make the narrowest correct fix.
6. Add or update focused tests.
7. Verify with the smallest relevant command first.
8. Only broaden verification if needed.

## 7. Specific Rules For Common CSPAMS Work

### If the issue involves account lifecycle
- Do not remove account-status gates.
- Do not collapse lifecycle states into generic active/inactive logic.
- Keep temporary password, setup link, and password reset flows distinct.
- If a password is temporary and expired, the login path must fail consistently and the UI must reflect that state.

### If the issue involves file uploads
- Use `IndicatorSubmissionFile` for tracked files.
- Keep file storage private.
- Preserve file type validation.
- Preserve view vs download behavior.
- Preserve file requirement logic.

### If the issue involves submission completion
- Preserve scope-based progress.
- Preserve `requiredScopeIds`, `submittedScopeIds`, and `pendingScopeIds`.
- Do not reduce submission completeness to one boolean if the workflow depends on multiple scopes.
- Preserve append-only history logging.

### If the issue involves learner cases
- Use `LearnerCase`.
- Respect the fact that learner-case data includes PII.
- Do not assume aggregate-only data.
- Preserve role-based access restrictions.

### If the issue involves monitoring dashboards
- Preserve monitor-wide visibility.
- Preserve School Head school-scoped visibility.
- Preserve lifecycle labels and recommended actions.
- Keep frontend badges, status filters, and action buttons aligned with backend state.

## 8. Security Expectations

Treat these as mandatory:

- No public file exposure for submission documents.
- No unauthorized cross-school access.
- No bypass of account-state gating.
- No bypass of verification for critical monitor actions.
- No silent deletion of audit/history records.
- No storage of sensitive tokens in unsafe places if the existing architecture uses cookies or server-side sessions.
- No weakening of validation just to make a test pass.

## 9. Documentation Handling

Preserve documentation unless the user asks for cleanup.

If you update docs:
- keep them factual
- keep them aligned with the code
- do not duplicate outdated concepts
- do not delete docs casually

If a document conflicts with code, update the document only after verifying the code.

## 10. Verification Rules

Prefer targeted verification.

Typical commands:
- `php artisan test --filter=...`
- `php artisan test`
- `npm test -- --run <file>`
- `npm run build` inside `frontend`

Run the smallest relevant test first. If the environment is incomplete, say so clearly.

## 11. Output Standard

When you finish a task, report:
- what changed
- what was intentionally preserved
- what verification ran
- any real residual risk

Keep the response concise and factual.

## 12. Default Task Framing

Use this mindset for every task:

> Work inside the current CSPAMS codebase as it exists today. Treat the routes, controllers, request classes, models, support services, frontend state, and tests as the source of truth. Preserve the core CSPAMS concept: school-level compliance submissions, monitor review workflows, strict role separation, school-scoped data access, and School Head account-state gating. Prefer focused fixes over broad rewrites. Be especially careful around authentication, MFA/reset flows, School Head account management, temporary password expiry, submission review, scope-progress handling, typed indicator values, learner-case privacy, file upload/download privacy, and deletion/archive behavior. Add or update focused tests where practical and verify the smallest relevant surface before broader builds.

## 13. When In Doubt

Ask:
- Is this preserving the existing workflow, or replacing it?
- Does this weaken role separation?
- Does this break audit/history?
- Does this change file privacy?
- Does this alter account-state gating?
- Does this keep frontend and backend contracts aligned

If the answer to any of those is “yes” and the user did not request it, stop and reassess.
