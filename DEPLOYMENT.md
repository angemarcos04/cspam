# Deployment (Cookie-Session SPA Auth)

This project's SPA uses **Sanctum stateful cookie sessions** (httpOnly). Production correctness depends on a few environment values matching your deployed frontend/backend hosts.

## Checklist

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

## Runtime layout

The production web service should handle HTTP traffic. The production worker service should process queued jobs.

- Web service: `docker/render-start.sh`
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
