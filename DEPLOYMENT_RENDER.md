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
