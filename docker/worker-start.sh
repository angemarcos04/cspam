#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

. "${SCRIPT_DIR}/common-env.sh"

echo "CSPAMS queue worker starting..."
echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "PWD: $(pwd)"
echo "Queue names: ${CSPAMS_QUEUE_NAMES:-mail,default}"
sanitize_runtime_environment

mkdir -p \
  storage/framework/cache \
  storage/framework/sessions \
  storage/framework/views \
  bootstrap/cache

if ! chmod -R ug+rw storage bootstrap/cache; then
  echo "FATAL: failed to set writable permissions on storage/bootstrap cache dirs"
  exit 1
fi

echo "Clearing and rebuilding Laravel config for queue worker..."
CACHE_STORE=file php artisan optimize:clear
CACHE_STORE=file php artisan config:cache

echo "Checking verification delivery configuration..."
php artisan app:check-verification-delivery || true

echo "Queue worker started"
exec php artisan queue:work \
  --verbose \
  --queue="${CSPAMS_QUEUE_NAMES:-mail,default}" \
  --tries="${CSPAMS_QUEUE_TRIES:-3}" \
  --timeout="${CSPAMS_QUEUE_TIMEOUT:-90}" \
  --sleep="${CSPAMS_QUEUE_SLEEP:-3}"
