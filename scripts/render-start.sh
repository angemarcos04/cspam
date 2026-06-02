#!/usr/bin/env bash
set -euo pipefail

echo "Starting CSPAMS on Render..."
echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "PORT: ${PORT:-10000}"
echo "APP_ENV: ${APP_ENV:-not-set}"

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

echo "Seeding required demo access data..."
php artisan db:seed --class=Database\\Seeders\\RolesAndPermissionsSeeder --force
php artisan db:seed --class=Database\\Seeders\\DemoDataSeeder --force

php artisan storage:link || true

echo "Checking verification delivery configuration..."
php artisan app:check-verification-delivery || true

echo "Launching application..."
exec php -S 0.0.0.0:"${PORT:-10000}" -t public public/index.php
