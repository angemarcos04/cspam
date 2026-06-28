# Deployment (Cookie-Session SPA Auth)

This project's SPA uses **Sanctum stateful cookie sessions** (httpOnly). Production correctness depends on a few environment values matching your deployed frontend/backend hosts.

## Checklist

### Render Free Tier Docker command

Render Free Tier does not provide shell access. For the Docker-based Render web service, do not use Build Command / Start Command fields. Docker services build from the Dockerfile and use Docker Command to override the container command.

Set:

- Docker Command: `bash scripts/render-start.sh`
- Pre-Deploy Command: leave blank on Free Tier

The startup script clears cached Laravel configuration before booting the app, which is important after changing Render environment variables such as `MAIL_MAILER`, `RESEND_API_KEY`, or `CSPAMS_MONITOR_MFA_DELIVERY_MODE`.

### Composer / Docker build failures

If Render fails during Docker build at `composer install` with a GitHub codeload ZIP error such as `ratchet/rfc6455` returning `HTTP/2 400`, the backend image was not built. Laravel never starts, so `/api/health`, login, and dashboard routes remain unavailable until the image builds.

The Dockerfile now runs production Composer install with `--prefer-dist` first and falls back to `--prefer-source` if dist archives fail. The image keeps `git` installed for that source fallback, still uses `--no-dev`, and still optimizes the autoloader.

After pushing the fix, redeploy the backend from Render:

```text
Manual Deploy
Clear build cache & deploy
```

If GitHub archive or clone failures continue, set `COMPOSER_AUTH` only in Render environment variables:

```text
COMPOSER_AUTH={"github-oauth":{"github.com":"<github-token>"}}
```

Do not commit Composer tokens or secrets.

### Diagnosing 503 / Service Unavailable

If the School Head or Monitor dashboard reports that the server is temporarily unavailable, the frontend received a backend/proxy `502`, `503`, or `504`. Treat this as a runtime availability issue first, not as a Save/Send/Review workflow validation problem.

Check:

1. `frontend/vercel.json` rewrites `/api`, `/sanctum`, and `/broadcasting` to `https://cspams.onrender.com`.
2. `https://cspams.onrender.com/api/health` returns `200 OK` and `status: ok`.
3. Temporarily enable `VITE_CSPAMS_API_DIAGNOSTICS=true` in the frontend environment and redeploy the frontend. The visible error will include safe request metadata such as `Diagnostic: GET /api/auth/me returned 503.` Query values are redacted.
4. If `CSPAMS_DIAGNOSTICS_TOKEN` is configured, check protected readiness:
   ```bash
   curl -i "https://cspams.onrender.com/api/ops/readiness?token=$CSPAMS_DIAGNOSTICS_TOKEN"
   ```
   Missing, wrong, or unconfigured tokens return `404`; a valid response reports only safe booleans/statuses for database, queue, mail, notifications, and dashboard-critical tables/columns.
5. Render logs around the failure timestamp for migration, seeding, database, `APP_KEY`, config/cache, or restart-loop failures.
6. Render Docker Command is `bash scripts/render-start.sh`.
7. Required production env vars are present, including `APP_ENV=production`, `APP_DEBUG=false`, persistent `APP_KEY`, `APP_URL=https://cspams.onrender.com`, database credentials, and `FRONTEND_URL`.

If `/api/health` is down, repair the backend service/proxy first. If it returns HTML with `x-render-routing: suspend-by-user` or text like `This service has been suspended by its owner.`, resume or reactivate the Render service before debugging CSPAMS code. If it is up but a dashboard endpoint fails, inspect the exact endpoint in the browser Network tab and correlate it with Render logs.

### Production demo data cleanup

Production should not recreate sample School Head accounts on every deploy. Keep demo seeding disabled:

```env
CSPAMS_SEED_DEMO_DATA=false
```

To purge the known seeded demo School Head accounts on Render Free Tier without shell access, set this for one deploy only:

```env
CSPAMS_PURGE_DEMO_DATA_ON_START=true
```

Redeploy, verify the logs include `Purging known seeded demo data...` and `Demo data purge completed.`, then immediately set it back to:

```env
CSPAMS_PURGE_DEMO_DATA_ON_START=false
```

The purge command deletes only `schoolhead1@cspams.local`, `schoolhead2@cspams.local`, and `schoolhead3@cspams.local` by default. It does not delete the monitor account. If shell access is available, the equivalent command is:

```bash
php artisan cspams:purge-demo-data --force
```

### 1) Set correct URLs

- `APP_URL` = backend base URL (e.g., `https://api.example.com`)
- `FRONTEND_URL` = frontend base URL (e.g., `https://app.example.com`)
- `VITE_API_BASE_URL` = backend base URL from the frontend's perspective (usually same as `APP_URL`)
  - Required in production builds; the frontend throws on startup if missing.

### 2) Configure Sanctum stateful domains (hosts, not full URLs)

`SANCTUM_STATEFUL_DOMAINS` must include the frontend host (and typically the backend host):

- Example: `SANCTUM_STATEFUL_DOMAINS=app.example.com,api.example.com`

### 3) Configure credentialed CORS (origins, full scheme+host(+port))

`CORS_ALLOWED_ORIGINS` must include the frontend origin:

- Example: `CORS_ALLOWED_ORIGINS=https://app.example.com`

Cookie auth requires `supports_credentials=true` (already set in `config/cors.php`).

### 4) Configure secure session cookies

Recommended production/staging values:

- `SESSION_SECURE_COOKIE=true`
- `SESSION_HTTP_ONLY=true`
- `SESSION_LIFETIME=120` (or another short value you're comfortable with)
- `SESSION_SAME_SITE=lax` for same-site subdomains (common case)
- `SESSION_SAME_SITE=none` only when the frontend and API are on different "sites" and you truly need cross-site cookies (must be paired with `SESSION_SECURE_COOKIE=true`)

Notes:

- `SESSION_DOMAIN` can usually remain `null` (host-only cookie on the API domain). Only set it when you explicitly need a shared domain cookie.

### 5) Clear cached config after env changes

After updating environment values on the server:

- `php artisan optimize:clear`
- `php artisan config:cache`

### 6) Ensure sessions storage exists

If using `SESSION_DRIVER=database`, ensure migrations ran and the `sessions` table exists:

- `php artisan migrate --force`

### 7) Choose monitor MFA email delivery mode

`MonitorMfaCodeNotification` is queued (`ShouldQueue`) by default. Queued delivery is the recommended production mode, but it requires a running queue worker. If Render cannot run a separate worker for this project, set `CSPAMS_MONITOR_MFA_DELIVERY_MODE=sync` so the web service sends the monitor OTP through SMTP during login.

**Option A: queued delivery + worker (recommended production setup)**

```env
CSPAMS_MONITOR_MFA_DELIVERY_MODE=queued
QUEUE_CONNECTION=database
CSPAMS_MONITOR_MFA_QUEUE=mail
```

Without a running worker the MFA code email is never delivered and monitor sign-in stalls at the MFA step.

**Local / development:**

```bash
php artisan queue:table   # only needed once, before first migrate
php artisan migrate
php artisan queue:work
```

**Production (long-lived process):**

```bash
php artisan queue:work --verbose --queue=mail,default --tries=3 --timeout=90
```

On Render, Railway, Fly.io, or similar PaaS platforms, run this as a separate worker service so it restarts automatically on failure. This repo now includes `docker/worker-start.sh` for that purpose. Make sure the worker's environment variables match the API server's (same `APP_KEY`, same `QUEUE_CONNECTION`, same DB connection).

**Render Background Worker (recommended):**

Important: `render.yaml` defines the worker for Render Blueprint deployments. If the web service was created manually in the Render dashboard, Render does not automatically create `cspam-backend-worker` just because this file exists in the repo. In that case, create the Background Worker manually or redeploy from the blueprint.

Create a separate Render Background Worker from the same repo/branch as the web service:

- Service type: `Background Worker`
- Repository: `angemarcos04/cspam`
- Branch: `main`
- Root directory: repository root
- Build command:

```bash
composer install --prefer-dist --no-dev --no-interaction --optimize-autoloader
```

- Start command:

```bash
bash docker/worker-start.sh
```

Copy all web service environment variables to the worker, especially `APP_KEY`, all `DB_*` values, `QUEUE_CONNECTION=database`, `CSPAMS_MONITOR_MFA_QUEUE=mail`, all `MAIL_*` values, `LOG_CHANNEL=stderr`, and `LOG_LEVEL=info`. Prefer a Render Environment Group if available so the web and worker services cannot drift.

The worker script does not run migrations or seeders. It prepares Laravel cache and runs:

```bash
php artisan queue:work --verbose --queue=mail,default --tries=3 --timeout=90 --sleep=3
```

The included `render.yaml` defines both `cspam-backend` and `cspam-backend-worker`. If you do not see a separate Background Worker service in the Render dashboard, the worker is missing. MFA OTP email cannot send until that service exists, is deployed from `main`, and shows `CSPAMS queue worker starting...` followed by `Queue worker started` in its logs.

**Option B: sync delivery without worker**

Use this when the Render Background Worker is unavailable or not running. The web service sends the monitor MFA email directly through SMTP during the login request:

```env
CSPAMS_MONITOR_MFA_DELIVERY_MODE=sync
```

Sync mode keeps MFA enabled and keeps the same login challenge flow. It avoids stuck queue jobs, but login waits for SMTP, so keep `MAIL_TIMEOUT=10`. If Gmail rejects delivery, login returns the existing `mfa_delivery_failed` 503 response and does not expose the OTP.

### 7a) Render environment variables

Set these on both the web service and the background worker:

```env
APP_ENV=production
APP_DEBUG=false
APP_KEY=<same persistent Laravel app key>
APP_URL=https://cspams.onrender.com
FRONTEND_URL=https://cspam.vercel.app/

DB_CONNECTION=pgsql
DB_HOST=<Render internal DB host>
DB_PORT=5432
DB_DATABASE=<database name>
DB_USERNAME=<database user>
DB_PASSWORD=<database password>

QUEUE_CONNECTION=database
CSPAMS_MONITOR_MFA_ENABLED=true
CSPAMS_MONITOR_MFA_DELIVERY_MODE=queued
CSPAMS_MONITOR_MFA_QUEUE=mail
CSPAMS_SCHOOL_REMINDER_DELIVERY_MODE=queued
LOG_CHANNEL=stderr
LOG_LEVEL=info

MAIL_MAILER=smtp
MAIL_SCHEME=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=cspams.local@gmail.com
MAIL_PASSWORD=<fresh Gmail App Password>
MAIL_FROM_ADDRESS=cspams.local@gmail.com
MAIL_FROM_NAME=CSPAMS
MAIL_TIMEOUT=10
```

For Resend on Render, use:

```env
MAIL_MAILER=resend
MAIL_FROM_ADDRESS=onboarding@resend.dev
MAIL_FROM_NAME=CSPAMS
RESEND_API_KEY=<secret>
```

`onboarding@resend.dev` is only for limited Resend testing and can send only to the email address allowed by your Resend account. Production sending should use a verified Resend domain. Keep real secrets only in Render environment variables.

School Head password reset links use the same real mailer configuration. The monitor dashboard sends those reset links to the School Head account's current saved email address, so update the School Head email first if ownership changes, then issue the reset link. If `MAIL_MAILER=resend` uses `onboarding@resend.dev`, Resend can reject arbitrary School Head recipients with a testing-domain restriction; use a verified Resend domain sender for real schools.

Queue List reminders use the same School Head notification center and mailer. The default is:

```env
CSPAMS_SCHOOL_REMINDER_DELIVERY_MODE=queued
```

Queued reminder delivery requires the Render Background Worker because both the email and database notification are queued. If the worker is unavailable, use:

```env
CSPAMS_SCHOOL_REMINDER_DELIVERY_MODE=sync
```

Sync reminder delivery writes the School Head dashboard notification during the monitor request, then attempts email delivery. If the mail provider rejects the email, the monitor still receives a warning and the School Head dashboard notification remains available.

Blank or delete:

```env
MAIL_ENCRYPTION
```

Recommended seeded monitor receiver:

```env
CSPAMS_MONITOR_EMAIL=marcosangellie2004@gmail.com
CSPAMS_DEMO_MONITOR_PASSWORD=Demo@123456
CSPAMS_SYNC_DEMO_MONITOR_PASSWORD=true
```

Use host names, not full URLs, for Sanctum stateful domains:

```env
SANCTUM_STATEFUL_DOMAINS=cspam.vercel.app,cspams.onrender.com
```

Use full origins for CORS:

```env
CORS_ALLOWED_ORIGINS=https://cspam.vercel.app
```

### 7b) Render verification logs

The web service startup should show:

```text
[DEBUG] Check verification delivery configuration
Verification delivery status
[7/7] Starting PHP server
```

The background worker startup should show:

```text
CSPAMS queue worker starting...
Checking verification delivery configuration...
Queue worker started
```

After a monitor login attempt, the worker logs should show:

```text
Monitor MFA email job rendering mail message.
```

If delivery fails, logs should show:

```text
Queue job failed.
```

The failure message should identify the Gmail SMTP problem without logging the OTP code or mail password.

In sync mode, after a monitor login attempt the web service logs should show:

```text
Monitor MFA sync email delivery starting.
Monitor MFA sync email delivery succeeded.
```

If Gmail rejects SMTP delivery in sync mode, the login response should be `503` with `mfa_delivery_failed`, and the web service logs should show:

```text
Monitor MFA sync email delivery failed.
```

### 7c) Queue diagnostics without Render shell

If the MFA response says the code was sent but no email arrives, temporarily set this env var on the Render web service:

```env
CSPAMS_DIAGNOSTICS_TOKEN=<random-long-token>
```

Redeploy the web service, then open:

```text
https://cspams.onrender.com/api/ops/queue-diagnostics?token=<random-long-token>
```

You can also call it through the Vercel rewrite:

```text
https://cspam.vercel.app/api/ops/queue-diagnostics?token=<random-long-token>
```

Expected signals:

- `mfa.deliveryMode = queued` and no worker logs: email cannot send because no worker is processing the `mail` queue.
- `mfa.deliveryMode = sync`: monitor MFA email is sent directly by the web service during login, so the worker is not required for monitor MFA.
- Sync mode returns `503 mfa_delivery_failed`: Gmail SMTP rejected the send or the SMTP env vars are wrong.
- Sync mode returns `202 delivery=sent` but no inbox email: check Spam, All Mail, Gmail filters, and that the recipient is `CSPAMS_MONITOR_EMAIL`.
- `jobs.total > 0` with `jobs.byQueue[].queue = mail`: MFA mail jobs are stuck, so the Render Background Worker is not running, not deployed, or cannot reach the same database.
- `jobs.total = 0` and `failedJobs.total > 0`: the worker is processing jobs, but Gmail/SMTP or mail config is failing. Check `failedJobs.recent[].exceptionSummary` and worker logs for `Queue job failed.`
- `jobs.total = 0` and `failedJobs.total = 0`: the last MFA job was processed successfully or the login request did not queue a job against this database.

The endpoint reports mailer, SMTP host/port/scheme, sender, whether SMTP username/password are configured, and whether the Resend API key is configured. It never returns queued job payloads because those payloads can contain the OTP before the worker sends it, and it never returns app keys, mail passwords, or Resend API keys. Delete `CSPAMS_DIAGNOSTICS_TOKEN` after debugging.

To test the configured mail transport without generating an OTP, send a POST request to:

```text
https://cspams.onrender.com/api/ops/mail-diagnostics/send?token=<random-long-token>
```

This sends a harmless diagnostic email to `CSPAMS_MONITOR_EMAIL`. If delivery fails, the response includes the sanitized provider error without exposing the Resend API key or mail password.

If these markers do not appear in the Render dashboard logs, confirm both services use:

```env
LOG_CHANNEL=stderr
LOG_LEVEL=info
```

### 8) Only enable realtime when Reverb is actually deployed

The frontend now treats realtime as opt-in. Leave `VITE_REALTIME_ENABLED=false` unless you have a separate Reverb service running.

**Dedicated Reverb process:**

```bash
php artisan reverb:start --host=0.0.0.0 --port=8080
```

This repo includes `docker/reverb-start.sh` so the websocket service can be deployed separately from the web service.

## Deploy sequence

Run these in order on every deploy:

```bash
php artisan migrate --force
php artisan cspams:sync-rolling-years
php artisan app:check-production-config   # exits non-zero if config is unsafe
php artisan optimize
```

The config-check command exits with a non-zero code and prints the list of failing checks if the environment is misconfigured, making it safe to gate deploys on it.

### Notification center runtime check

The notification dropdown requires the active backend database to have the Laravel `notifications` table and authenticated notification routes. After deploying the backend, verify:

```bash
php artisan migrate --force
php artisan route:list | grep notifications
```

Then confirm the active database state in Tinker:

```php
Schema::hasTable('notifications');
Schema::hasColumn('notifications', 'cleared_at');
DB::table('notifications')->count();
```

Expected results are `true`, `true`, and an integer count of `0` or higher. If `CSPAMS_DIAGNOSTICS_TOKEN` is configured, the protected readiness response should also report `checks.notifications.clearedAtColumn: true`. If the notification bell shows a server error, check this first, then confirm the frontend rewrites target `https://cspams.onrender.com`.

## Runtime layout

The production web service should handle HTTP traffic. The production worker service should process queued jobs.

- Web service: `bash scripts/render-start.sh` through the Render Docker Command
- Worker service: `docker/worker-start.sh`
- Reverb service: `docker/reverb-start.sh` when realtime is enabled

Use your platform's pre-deploy or release phase for:

- `php artisan migrate --force`
- `php artisan cspams:sync-rolling-years`

## Production/Staging boot guard

`app/Providers/AppServiceProvider.php` enforces a safe baseline on every request in `production`/`staging` and will refuse to boot if critical auth/session values are unsafe or inconsistent (debug mode, MFA test knobs, mailer safety, token TTL, password-reset enforcement, secure cookie settings). The full cross-origin CORS/Sanctum audit is deferred to the deploy-time `app:check-production-config` command above.

## Smoke test

After deploying, verify these flows manually before announcing the release.

**A — School Head login:**
1. Enter school code → sign in.
2. Refresh the page — confirm session restores.
3. Log out → refresh again — confirm session is gone.

**B — Monitor login with MFA:**
1. Enter monitor email + password → confirm the MFA challenge appears.
2. Confirm the MFA code email actually arrives (requires the queue worker to be running).
3. Complete MFA → refresh — confirm session restores.

**C — Failure paths:**
1. Stop the backend temporarily and attempt login — confirm the frontend shows a timeout/error rather than hanging forever.
2. Attempt logout with the backend unavailable — confirm the UI does not silently fake a clean logout.
