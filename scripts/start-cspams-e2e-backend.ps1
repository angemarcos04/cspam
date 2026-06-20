param(
    [int] $Port = 8097
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$dbPath = Join-Path $repoRoot "database\cspams_e2e.sqlite"

Push-Location $repoRoot
try {
    $env:APP_ENV = "testing"
    $env:APP_KEY = "base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    $env:APP_DEBUG = "true"
    $env:APP_URL = "http://127.0.0.1:$Port"
    $env:FRONTEND_URL = "http://127.0.0.1:4178"
    $env:DB_CONNECTION = "sqlite"
    $env:DB_DATABASE = $dbPath
    $env:CACHE_STORE = "array"
    $env:QUEUE_CONNECTION = "sync"
    $env:SESSION_DRIVER = "file"
    $env:MAIL_MAILER = "array"
    $env:BROADCAST_CONNECTION = "log"
    $env:SANCTUM_TOKEN_EXPIRATION = "120"
    $env:CSPAMS_MONITOR_MFA_ENABLED = "false"
    $env:CSPAMS_ENABLE_STATEFUL_SPA_API = "true"
    $env:CSPAMS_SQLI_GUARD_ENABLED = "true"

    if (Test-Path -LiteralPath $dbPath) {
        Remove-Item -LiteralPath $dbPath -Force
    }
    New-Item -ItemType File -Path $dbPath -Force | Out-Null

    php artisan migrate:fresh --force
    php artisan db:seed --class=Database\Seeders\RolesAndPermissionsSeeder --force
    php artisan e2e:seed-monitor-review
    php artisan e2e:verify-monitor-review-fixture
    # The isolated SQLite fixture can take longer than the local CLI default while Laravel builds dashboard summaries.
    $router = Join-Path $repoRoot "vendor\laravel\framework\src\Illuminate\Foundation\resources\server.php"
    Push-Location (Join-Path $repoRoot "public")
    try {
        php -d max_execution_time=180 -S 127.0.0.1:$Port $router
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
}
