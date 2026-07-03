# Render Docker Deployment

CSPAMS is deployed as a Docker-based Render Web Service. Render Free Tier does not provide shell access, so Laravel cache and config clearing must happen during container startup.

## Render Settings

For this Docker-based Render service, do not use Build Command / Start Command.

Set:

```text
Docker Command:
bash scripts/render-start.sh
```

Leave Pre-Deploy Command blank on Free Tier.

The Dockerfile also defaults to `bash scripts/render-start.sh`, so the same startup path is used if the Docker Command is not overridden.

## Composer / Docker Build Failures

If Render fails during Docker build at `composer install` with a GitHub codeload ZIP error such as `ratchet/rfc6455` returning `HTTP/2 400`, the backend image was not built and Laravel never started. In that state, the frontend service-unavailable message is expected because `/api/health`, login, and dashboard endpoints cannot be served.

The Dockerfile now installs production dependencies with `--prefer-dist` first, then falls back to `--prefer-source` when a dist archive download fails. The image keeps `git` installed so Composer can clone source packages during fallback. If both Composer strategies fail, the Docker build still fails visibly.

After pushing a Dockerfile fix, redeploy from Render with:

```text
Manual Deploy
Clear build cache & deploy
```

If GitHub archive or clone failures persist, configure `COMPOSER_AUTH` as a Render environment variable only:

```text
COMPOSER_AUTH={"github-oauth":{"github.com":"<github-token>"}}
```

Do not commit Composer tokens or other secrets.

## Required Environment Variables

```env
APP_ENV=production
APP_DEBUG=false
APP_URL=https://cspams.onrender.com

MAIL_MAILER=resend
MAIL_FROM_ADDRESS=onboarding@resend.dev
MAIL_FROM_NAME=CSPAMS
RESEND_API_KEY=<set in Render only>
CSPAMS_SEED_DEMO_DATA=false
CSPAMS_PURGE_DEMO_DATA_ON_START=false
```

`onboarding@resend.dev` is only for limited Resend testing. For real recipients, including School Head password reset links sent from the monitor dashboard, use a verified Resend domain. Password reset links are sent to the School Head account's current saved email address, so update the account email first before issuing a reset link after an ownership change.

Real secrets must be set only in Render Environment Variables. Do not commit `.env` or API keys.

## Startup Behavior

`scripts/render-start.sh` runs every time the container starts. It is the active startup script because the root `Dockerfile` uses `CMD ["bash", "scripts/render-start.sh"]`; `docker/render-start.sh` is copied into the image but is not the active path unless the command is changed.

Startup clears Laravel cached configuration, runs migrations, seeds required roles and permissions, prints safe submission-storage diagnostics, runs a non-fatal missing-file audit, checks mail delivery configuration, and launches the PHP server.

The important startup commands are:

```bash
CACHE_STORE=file php artisan config:clear
CACHE_STORE=file php artisan route:clear
CACHE_STORE=file php artisan view:clear
CACHE_STORE=file php artisan event:clear
CACHE_STORE=file php artisan cache:clear
CACHE_STORE=file php artisan optimize:clear
php artisan migrate --force
php artisan db:seed --class=Database\\Seeders\\RolesAndPermissionsSeeder --force
php artisan cspams:diagnose-submission-storage
php artisan cspams:audit-submission-storage --only-missing --limit="${CSPAMS_STORAGE_AUDIT_LIMIT:-50}"
```

Migration and required role seeding failures remain fatal. Submission-storage diagnostics and the missing-file audit are log-visible but non-fatal, so old missing upload records do not prevent the backend from booting.

Demo data seeding is opt-in. Keep `CSPAMS_SEED_DEMO_DATA=false` in production so deploys do not recreate `schoolhead1@cspams.local`, `schoolhead2@cspams.local`, or `schoolhead3@cspams.local`.

For a one-time Render Free Tier purge, set `CSPAMS_PURGE_DEMO_DATA_ON_START=true`, redeploy, verify logs show `Demo data purge completed.`, then set it back to `false`.

## Diagnosing 503 / Service Unavailable

A browser message about service unavailability means Vercel or the frontend reached a backend/proxy `502`, `503`, or `504`; it is not a normal School Head or Monitor workflow validation error.

Use this order:

1. Confirm `frontend/vercel.json` rewrites `/api`, `/sanctum`, and `/broadcasting` to `https://cspams.onrender.com`.
2. Open `https://cspams.onrender.com/api/health`. A healthy Laravel process returns `200 OK` with `status: ok`.
3. Temporarily set `VITE_CSPAMS_API_DIAGNOSTICS=true` in the frontend environment and redeploy the frontend. The browser message will append safe request metadata such as `Diagnostic: GET /api/dashboard/records returned 503.` without exposing tokens, payloads, or query values.
4. With the private diagnostics token configured, check protected readiness:
   ```bash
   curl -i "https://cspams.onrender.com/api/ops/readiness?token=$CSPAMS_DIAGNOSTICS_TOKEN"
   ```
   This endpoint returns only booleans/statuses for database, queue, mail, notification, and dashboard-critical table/column readiness. Missing, wrong, or unconfigured tokens intentionally return `404`.
5. Check Render service logs at the timestamp of the `503`.
6. Look for startup failures:
   - `php artisan migrate --force` failed
   - roles/permissions seeding failed
   - database connection failed
   - `APP_KEY` is missing or invalid
   - config/cache failure
   - container restart loop
7. Confirm the Render Docker Command is `bash scripts/render-start.sh`.
8. Confirm required environment values include `APP_ENV=production`, `APP_DEBUG=false`, a persistent `APP_KEY`, `APP_URL=https://cspams.onrender.com`, database credentials, and the production frontend URL.

If `/api/health` is unavailable, fix the backend service or proxy first. If the response is HTML with `x-render-routing: suspend-by-user` or text like `This service has been suspended by its owner.`, resume or reactivate the Render service before debugging CSPAMS code. If `/api/health` succeeds but a dashboard endpoint still returns `503`, use Render logs and the Network tab to identify the specific failing endpoint.

## Student Records Refresh Diagnostics

If the Monitor dashboard shows `Student records failed to refresh`, the backend route to check is `GET /api/dashboard/students`. After every deploy, run:

```bash
php artisan migrate --force
php artisan optimize:clear
```

Then call the protected readiness endpoint. It should report `checks.dashboard.columns.students.status: ok`, `checks.dashboard.columns.schools.status: ok`, `checks.dashboard.columns.performanceMetrics.status: ok`, `checks.dashboard.columns.indicatorSubmissionItems.status: ok`, and `checks.dashboard.data.students.status: ok`.

Smoke-test the endpoint with a Monitor token:

```bash
curl -i -H "Authorization: Bearer <MONITOR_TOKEN>" "https://cspams.onrender.com/api/dashboard/students?per_page=25"
```

Expected result: HTTP `200`, `Content-Type: application/json`, plus `data` and `meta` keys. If readiness is ok but `/api/dashboard/students` still returns `500`, use Render logs for `GET /api/dashboard/students`, `student_records_refresh_failed`, `SQLSTATE`, undefined columns/tables, `ValueError`, or `UnexpectedValueException` at the failure timestamp.

In the browser, open DevTools -> Network -> `GET /api/dashboard/students`. If the JSON body contains `errorCode: "student_records_refresh_failed"`, the frontend and safe backend handler are current, and the real exception is in Render logs. If that code is missing, verify the backend deploy, frontend rewrites/API base URL, and `/api/health`.

Operational note: rolling academic-year maintenance is currently best-effort during student dashboard refresh. It should eventually move to a scheduled command, deployment task, admin maintenance endpoint, or queue job.

## Submission File Persistent Storage

Render Free does not persist local uploaded files. CSPAMS now stores new School Head requirement upload bytes in PostgreSQL using `database://indicator-submissions/{submission_id}/{file_type}` metadata paths. Do not store uploads in GitHub, frontend localStorage, public storage, or the Render local filesystem.

Recommended production limit:

```env
CSPAMS_SUBMISSION_FILE_MAX_KB=2048
```

Use `5120` only if the team accepts the database storage cost. Database-backed file storage is intended for small requirement files.

Render Shell is not required for normal deploy migrations. On deploy/start, the active `scripts/render-start.sh` startup script runs:

```bash
php artisan migrate --force
php artisan cspams:diagnose-submission-storage
php artisan cspams:audit-submission-storage --only-missing --limit="${CSPAMS_STORAGE_AUDIT_LIMIT:-50}"
```

The audit is non-fatal and does not use `--fail-on-missing` during startup. Old missing files cannot be reconstructed from metadata; rows marked `reupload_required` must be re-uploaded by the School Head.

After pushing this fix, run Render `Manual Deploy -> Clear build cache & deploy`. Check logs for `databaseBlobTableExists: yes`, `databaseBlobReadable: yes`, `databaseBlobColumnsReady: yes`, `databaseBlobSchemaReady: yes`, and `databaseBlobReady: yes`. With `CSPAMS_DIAGNOSTICS_TOKEN` configured, the protected readiness endpoint should report matching `true` values under `checks.submissionStorage`:

```bash
curl -i "https://cspams.onrender.com/api/ops/readiness?token=$CSPAMS_DIAGNOSTICS_TOKEN"
```

Diagnostics verify blob table existence, table readability, required blob columns, and the PostgreSQL `content` column type. The expected production type is `bytea`. That schema result is necessary but not sufficient by itself: CSPAMS writes PostgreSQL blobs through a binary-safe `bytea` path using hex bytes and `decode(..., 'hex')`, so raw uploaded file bytes are not inserted as UTF-8 text.

Smoke-test persistence after deploy: upload a small PDF under 500 KB, refresh, logout and login again, preview/download, send the scope or package, confirm Monitor preview/download works, redeploy the backend, then preview/download the same file again. Existing old disk-based files may already be missing if they were uploaded before the blob fix. The startup audit identifies records that require School Head re-upload.

Files already lost from ephemeral storage cannot be reconstructed from database metadata alone. Re-upload those files through the School Head workflow.

If upload still fails with the safe persistence message, search Render logs for:

```text
submission_file_upload_persist_failed
SQLSTATE
indicator_submission_file_blobs
invalid byte sequence
content
bytea
```

The upload-failure log is structured and safe: it does not print uploaded file contents, temporary upload paths, absolute storage paths, `DATABASE_URL`, `DB_PASSWORD`, `APP_KEY`, or other secrets.

## Notification Center Runtime Check

The notification bell depends on the Laravel `notifications` table and the authenticated notification routes. On every backend deploy, confirm migrations ran before testing the frontend dropdown:

```bash
php artisan migrate --force
php artisan route:list | grep notifications
```

Then verify the active database in Tinker:

```php
Schema::hasTable('notifications');
Schema::hasColumn('notifications', 'cleared_at');
DB::table('notifications')->count();
```

Expected results are `true`, `true`, and an integer count of `0` or higher. If `CSPAMS_DIAGNOSTICS_TOKEN` is configured, the protected readiness response should also report `checks.notifications.clearedAtColumn: true`. If the frontend notification bell still shows a server error after this passes, confirm the Vercel rewrites point to `https://cspams.onrender.com` and redeploy the frontend.
