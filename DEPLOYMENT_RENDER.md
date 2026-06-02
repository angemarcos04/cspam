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
APP_URL=https://cspams.onrender.com

MAIL_MAILER=resend
MAIL_FROM_ADDRESS=onboarding@resend.dev
MAIL_FROM_NAME=CSPAMS
RESEND_API_KEY=<set in Render only>
```

`onboarding@resend.dev` is only for limited Resend testing. For real recipients, use a verified Resend domain.

Real secrets must be set only in Render Environment Variables. Do not commit `.env` or API keys.

## Startup Behavior

`scripts/render-start.sh` runs every time the container starts. It clears Laravel cached configuration, runs migrations and required seeders, checks mail delivery configuration, and launches the PHP server.
