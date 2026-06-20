param(
    [int] $Port = 8098,
    [int] $ReverbPort = 8086
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$dbPath = Join-Path $repoRoot "database\cspams_e2e_realtime.sqlite"
$reverbProcess = $null
$queueProcess = $null

Push-Location $repoRoot
try {
    # FIX: this isolated server is the only E2E path allowed to start real Reverb and queue workers.
    $env:APP_ENV = "testing"
    $env:APP_KEY = "base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    $env:APP_DEBUG = "true"
    $env:APP_URL = "http://127.0.0.1:$Port"
    $env:FRONTEND_URL = "http://127.0.0.1:4179"
    $env:DB_CONNECTION = "sqlite"
    $env:DB_DATABASE = $dbPath
    $env:CACHE_STORE = "array"
    $env:QUEUE_CONNECTION = "database"
    $env:SESSION_DRIVER = "file"
    $env:MAIL_MAILER = "array"
    $env:BROADCAST_CONNECTION = "reverb"
    $env:REVERB_APP_ID = "cspams-e2e"
    $env:REVERB_APP_KEY = "cspams-e2e-key"
    $env:REVERB_APP_SECRET = "cspams-e2e-secret"
    $env:REVERB_HOST = "127.0.0.1"
    $env:REVERB_PORT = "$ReverbPort"
    $env:REVERB_SCHEME = "http"
    $env:REVERB_SERVER_HOST = "127.0.0.1"
    $env:REVERB_SERVER_PORT = "$ReverbPort"
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

    $reverbProcess = Start-Process -FilePath "php" -ArgumentList "artisan", "reverb:start", "--host=127.0.0.1", "--port=$ReverbPort" -PassThru -NoNewWindow
    $queueProcess = Start-Process -FilePath "php" -ArgumentList "artisan", "queue:work", "database", "--queue=broadcasts", "--sleep=1", "--tries=1", "--timeout=60" -PassThru -NoNewWindow

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-NetConnection -ComputerName "127.0.0.1" -Port $ReverbPort -InformationLevel Quiet) {
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-NetConnection -ComputerName "127.0.0.1" -Port $ReverbPort -InformationLevel Quiet)) {
        throw "Reverb did not start on port $ReverbPort."
    }

    # Match Laravel's built-in server routing with a test-only request timeout.
    $router = Join-Path $repoRoot "vendor\laravel\framework\src\Illuminate\Foundation\resources\server.php"
    Push-Location (Join-Path $repoRoot "public")
    try {
        php -d max_execution_time=180 -S 127.0.0.1:$Port $router
    } finally {
        Pop-Location
    }
} finally {
    if ($queueProcess -and -not $queueProcess.HasExited) {
        Stop-Process -Id $queueProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($reverbProcess -and -not $reverbProcess.HasExited) {
        Stop-Process -Id $reverbProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Pop-Location
}
