#!/usr/bin/env bash
set -euo pipefail

echo "Installing PHP dependencies..."
composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader

if [ -f frontend/package.json ]; then
    echo "Installing frontend dependencies..."
    (cd frontend && npm ci)

    echo "Building frontend assets..."
    (cd frontend && npm run build)
elif [ -f package.json ]; then
    echo "Installing root frontend dependencies..."
    npm ci

    echo "Building root frontend assets..."
    npm run build
fi

echo "Clearing Laravel cached configuration..."
CACHE_STORE=file php artisan config:clear || true
CACHE_STORE=file php artisan route:clear || true
CACHE_STORE=file php artisan view:clear || true
CACHE_STORE=file php artisan event:clear || true
CACHE_STORE=file php artisan cache:clear || true
CACHE_STORE=file php artisan optimize:clear || true

echo "Running database migrations..."
php artisan migrate --force

echo "Build completed."
