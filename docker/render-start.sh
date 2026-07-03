#!/usr/bin/env sh
set -eu

echo "========== RENDER START DEBUG =========="
echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "User: $(whoami)"
echo "PWD: $(pwd)"
echo "PORT: ${PORT:-10000}"
echo "APP_ENV: ${APP_ENV:-not-set}"
echo "----------------------------------------"

is_truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

echo "[DEBUG] ls -la (current dir)"
ls -la
echo "----------------------------------------"

echo "[DEBUG] Checking Laravel critical paths..."
for p in artisan public public/index.php bootstrap/cache storage; do
  if [ -e "$p" ]; then
    echo "OK: $p exists"
  else
    echo "ERROR: $p is missing"
  fi
done
echo "----------------------------------------"

if [ ! -d public ]; then
  echo "FATAL: Directory 'public' does not exist in $(pwd)"
  echo "[DEBUG] /var/www listing:"
  ls -la /var/www || true
  echo "[DEBUG] /var/www/html listing:"
  ls -la /var/www/html || true
  exit 1
fi

echo "[1/7] Prepare writable dirs"
mkdir -p \
  storage/framework/cache \
  storage/framework/sessions \
  storage/framework/views \
  bootstrap/cache
if ! chmod -R ug+rw storage bootstrap/cache; then
  echo "FATAL: failed to set writable permissions on storage/bootstrap cache dirs"
  exit 1
fi

echo "[2/7] Install composer dependencies (safe rerun)"
composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader

echo "[3/7] Clear Laravel caches first (using file cache to avoid DB connection)"
if ! CACHE_STORE=file php artisan optimize:clear; then
  echo "FATAL: failed to clear Laravel caches"
  exit 1
fi

echo "[4/7] Run database migrations"
if ! php artisan migrate --force; then
  echo "FATAL: database migrations failed"
  exit 1
fi

echo "[5/7] Seed required roles and permissions"
if ! php artisan db:seed --class=Database\\Seeders\\RolesAndPermissionsSeeder --force; then
  echo "FATAL: roles and permissions seeding failed"
  exit 1
fi

echo "Checking submission storage diagnostics..."
if php artisan cspams:diagnose-submission-storage; then
  echo "Submission storage diagnostics completed."
else
  echo "WARNING: submission storage diagnostics reported a problem. File uploads may fail. Check migrations and database configuration."
fi

echo "Auditing submission storage for missing uploaded files..."
if php artisan cspams:audit-submission-storage --only-missing --limit="${CSPAMS_STORAGE_AUDIT_LIMIT:-50}"; then
  echo "Submission storage audit completed."
else
  echo "WARNING: submission storage audit reported issues or failed. Check Render logs."
fi

if is_truthy "${CSPAMS_SEED_DEMO_DATA:-false}"; then
  echo "Seeding demo data..."
  if ! php artisan db:seed --class=Database\\Seeders\\DemoDataSeeder --force; then
    echo "FATAL: demo data seeding failed"
    exit 1
  fi
else
  echo "Demo data seeding disabled."
fi

if is_truthy "${CSPAMS_PURGE_DEMO_DATA_ON_START:-false}"; then
  echo "Purging known seeded demo data..."
  if ! php artisan cspams:purge-demo-data --force; then
    echo "FATAL: demo data purge failed"
    exit 1
  fi
else
  echo "Demo data startup purge disabled."
fi

echo "[6/7] Rebuild caches (using file cache during startup)"
if ! CACHE_STORE=file php artisan config:cache; then
  echo "FATAL: failed to rebuild config cache"
  exit 1
fi
if ! CACHE_STORE=file php artisan route:cache; then
  echo "FATAL: failed to rebuild route cache"
  exit 1
fi
if ! CACHE_STORE=file php artisan view:cache; then
  echo "FATAL: failed to rebuild view cache"
  exit 1
fi

echo "[DEBUG] Check verification delivery configuration"
php artisan app:check-verification-delivery || true

echo "[7/7] Starting PHP server"
exec php -S 0.0.0.0:${PORT:-10000} -t public public/index.php
