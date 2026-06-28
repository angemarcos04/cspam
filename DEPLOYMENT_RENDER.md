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
APP_URL=https://cspam-eea2.onrender.com

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

`scripts/render-start.sh` runs every time the container starts. It clears Laravel cached configuration, runs migrations, seeds required roles and permissions, checks mail delivery configuration, and launches the PHP server.

Demo data seeding is opt-in. Keep `CSPAMS_SEED_DEMO_DATA=false` in production so deploys do not recreate `schoolhead1@cspams.local`, `schoolhead2@cspams.local`, or `schoolhead3@cspams.local`.

For a one-time Render Free Tier purge, set `CSPAMS_PURGE_DEMO_DATA_ON_START=true`, redeploy, verify logs show `Demo data purge completed.`, then set it back to `false`.

## Diagnosing 503 / Service Unavailable

A browser message about service unavailability means Vercel or the frontend reached a backend/proxy `502`, `503`, or `504`; it is not a normal School Head or Monitor workflow validation error.

Use this order:

1. Confirm `frontend/vercel.json` rewrites `/api`, `/sanctum`, and `/broadcasting` to `https://cspam-eea2.onrender.com`.
2. Open `https://cspam-eea2.onrender.com/api/health`. A healthy Laravel process returns `200 OK` with `status: ok`.
3. Temporarily set `VITE_CSPAMS_API_DIAGNOSTICS=true` in the frontend environment and redeploy the frontend. The browser message will append safe request metadata such as `Diagnostic: GET /api/dashboard/records returned 503.` without exposing tokens, payloads, or query values.
4. With the private diagnostics token configured, check protected readiness:
   ```bash
   curl -i "https://cspam-eea2.onrender.com/api/ops/readiness?token=$CSPAMS_DIAGNOSTICS_TOKEN"
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
8. Confirm required environment values include `APP_ENV=production`, `APP_DEBUG=false`, a persistent `APP_KEY`, `APP_URL=https://cspam-eea2.onrender.com`, database credentials, and the production frontend URL.

If `/api/health` is unavailable, fix the backend service or proxy first. If the response is HTML with `x-render-routing: suspend-by-user` or text like `This service has been suspended by its owner.`, resume or reactivate the Render service before debugging CSPAMS code. If `/api/health` succeeds but a dashboard endpoint still returns `503`, use Render logs and the Network tab to identify the specific failing endpoint.

## Notification Center Runtime Check

The notification bell depends on the Laravel `notifications` table and the authenticated notification routes. On every backend deploy, confirm migrations ran before testing the frontend dropdown:

```bash
php artisan migrate --force
php artisan route:list | grep notifications
```

Then verify the active database in Tinker:

```php
Schema::hasTable('notifications');
DB::table('notifications')->count();
```

Expected results are `true` for the table check and an integer count of `0` or higher. If the frontend notification bell still shows a server error after this passes, confirm the Vercel rewrites point to `https://cspam-eea2.onrender.com` and redeploy the frontend.
