#!/usr/bin/env sh
set -eu

. /var/www/html/docker/common-env.sh

echo "CSPAMS Reverb service starting..."
sanitize_runtime_environment

php artisan optimize:clear
php artisan config:cache

SERVER_HOST="${REVERB_SERVER_HOST:-0.0.0.0}"
SERVER_PORT="${PORT:-${REVERB_SERVER_PORT:-8080}}"

echo "Reverb listen address: ${SERVER_HOST}:${SERVER_PORT}"
exec php artisan reverb:start --host="${SERVER_HOST}" --port="${SERVER_PORT}"
