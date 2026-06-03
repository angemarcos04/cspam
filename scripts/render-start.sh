#!/usr/bin/env bash
set -euo pipefail

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
    storage/framework/cache \
    storage/framework/sessions \
    storage/framework/views \
    bootstrap/cache

chmod -R ug+rw storage bootstrap/cache || true

echo "Clearing Laravel cached configuration before boot..."
CACHE_STORE=file php artisan config:clear || true
CACHE_STORE=file php artisan route:clear || true
CACHE_STORE=file php artisan view:clear || true
CACHE_STORE=file php artisan event:clear || true
CACHE_STORE=file php artisan cache:clear || true
CACHE_STORE=file php artisan optimize:clear || true

echo "Ensuring database migrations are applied..."
php artisan migrate --force

echo "Seeding required roles and permissions..."
php artisan db:seed --class=Database\\Seeders\\RolesAndPermissionsSeeder --force

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

echo "Checking verification delivery configuration..."
php artisan app:check-verification-delivery || true

echo "Launching application..."
exec php -S 0.0.0.0:"${PORT:-10000}" -t public public/index.php
