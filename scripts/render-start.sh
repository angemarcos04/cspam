#!/usr/bin/env bash
set -euo pipefail

boot_started_at="$(date +%s)"

echo "Starting CSPAMS on Render..."
echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "PORT: ${PORT:-10000}"
echo "APP_ENV: ${APP_ENV:-not-set}"

is_truthy() {
    case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on) return 0 ;;
        *) return 1 ;;
    esac
}

mkdir -p \
    /tmp \
    storage/framework/cache \
    storage/framework/sessions \
    storage/framework/views \
    bootstrap/cache

chmod 1777 /tmp || true
chmod -R ug+rw storage bootstrap/cache || true

step_started_at="$(date +%s)"
echo "Preparing Laravel cache state..."
CACHE_STORE=file php artisan optimize:clear || true
echo "Cache preparation completed in $(( $(date +%s) - step_started_at ))s."

step_started_at="$(date +%s)"
echo "Applying database migrations..."
php artisan migrate --force
echo "Migrations completed in $(( $(date +%s) - step_started_at ))s."

step_started_at="$(date +%s)"
echo "Ensuring required roles and permissions..."
php artisan db:seed --class=Database\\Seeders\\RolesAndPermissionsSeeder --force
echo "Role and permission seeding completed in $(( $(date +%s) - step_started_at ))s."

if is_truthy "${CSPAMS_SEED_DEMO_DATA:-false}"; then
    echo "Seeding demo data..."
    php artisan db:seed --class=Database\\Seeders\\DemoDataSeeder --force
else
    echo "Demo data seeding disabled."
fi

if is_truthy "${CSPAMS_PURGE_DEMO_DATA_ON_START:-false}"; then
    echo "Purging known seeded demo data..."
    php artisan cspams:purge-demo-data --force
else
    echo "Demo data startup purge disabled."
fi

php artisan storage:link || true

step_started_at="$(date +%s)"
echo "Building production Laravel caches..."
php artisan config:cache
php artisan route:cache
php artisan view:cache
echo "Production cache building completed in $(( $(date +%s) - step_started_at ))s."

if is_truthy "${CSPAMS_RUN_STARTUP_DIAGNOSTICS:-false}"; then
    echo "Running optional startup diagnostics..."

    if php artisan cspams:diagnose-submission-storage; then
        echo "Submission storage diagnostics completed."
    else
        echo "WARNING: submission storage diagnostics reported a problem. File uploads may fail. Check migrations and database configuration."
    fi

    if php artisan cspams:audit-submission-storage --only-missing --limit="${CSPAMS_STORAGE_AUDIT_LIMIT:-50}"; then
        echo "Submission storage audit completed."
    else
        echo "WARNING: submission storage audit reported issues or failed. Check Render logs."
    fi

    php artisan app:check-verification-delivery || true
else
    echo "Optional startup diagnostics disabled. Run storage and verification checks manually during deployment verification."
fi

echo "Launching application after $(( $(date +%s) - boot_started_at ))s."
exec php -S 0.0.0.0:"${PORT:-10000}" -t public public/index.php
