Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$expectedRepo = "C:\Users\Angie\Desktop\cspam-git"
$staleRepo = "C:\Users\Angie\Desktop\cspam-main"
$currentCommit = $null

Write-Host "CSPAMS runtime verification" -ForegroundColor Cyan
Write-Host "Current directory: $(Get-Location)"

if (-not (Test-Path -LiteralPath $expectedRepo)) {
    Write-Warning "Expected checkout was not found: $expectedRepo"
} else {
    Write-Host ""
    Write-Host "Git checkout" -ForegroundColor Cyan
    Push-Location $expectedRepo
    try {
        git status --short --branch
        git log -1 --oneline
        $currentCommit = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
    }
}

$distAssets = Join-Path $expectedRepo "frontend\dist\assets"
$buildInfoPath = Join-Path $expectedRepo "frontend\dist\cspams-build-info.json"
Write-Host ""
Write-Host "Frontend dist assets" -ForegroundColor Cyan
if (Test-Path -LiteralPath $distAssets) {
    Get-ChildItem -LiteralPath $distAssets -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 8 Name, LastWriteTime, Length |
        Format-Table -AutoSize
} else {
    Write-Warning "No frontend dist assets found at $distAssets. Run npm.cmd run build from cspam-git\frontend."
}

Write-Host ""
Write-Host "Frontend build metadata" -ForegroundColor Cyan
if (Test-Path -LiteralPath $buildInfoPath) {
    try {
        $buildInfo = Get-Content -LiteralPath $buildInfoPath -Raw | ConvertFrom-Json
        $buildCommit = [string] $buildInfo.commit
        $buildShortCommit = [string] $buildInfo.shortCommit
        $buildBuiltAt = [string] $buildInfo.builtAt
        Write-Host "Built commit: $buildShortCommit"
        Write-Host "Built at: $buildBuiltAt"

        if ($currentCommit -and $buildCommit -and $buildCommit -ne $currentCommit) {
            Write-Warning "Frontend dist was built from $buildShortCommit, but current checkout is $($currentCommit.Substring(0, [Math]::Min(7, $currentCommit.Length))). Rebuild from cspam-git\frontend."
        }
    } catch {
        Write-Warning "Could not parse $buildInfoPath. Rebuild frontend assets from cspam-git\frontend."
    }
} else {
    Write-Warning "No frontend build metadata found at $buildInfoPath. Run npm.cmd run build from cspam-git\frontend."
}

Write-Host ""
Write-Host "Running node/php processes" -ForegroundColor Cyan
$processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe' or name = 'php.exe'" |
    Select-Object ProcessId, Name, ExecutablePath, CommandLine

if ($processes) {
    $processes | Format-List
    $staleMatches = $processes | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($staleRepo, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    }

    if ($staleMatches) {
        Write-Warning "Stale runtime detected: one or more node/php processes reference $staleRepo. Stop those processes and restart from $expectedRepo."
    } else {
        Write-Host "No node/php command line references $staleRepo." -ForegroundColor Green
    }
} else {
    Write-Host "No node.exe or php.exe processes are currently visible."
}

Write-Host ""
Write-Host "Manual browser check" -ForegroundColor Cyan
Write-Host "After rebuilding/restarting from cspam-git, use DevTools > right-click Reload > Empty Cache and Hard Reload."
Write-Host "Monitor School Detail file rows should show View, Verify, Return only; Download belongs inside the file preview modal."
