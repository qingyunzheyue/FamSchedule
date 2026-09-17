$ErrorActionPreference = 'Stop'
# ============================================================
# scripts/deploy.ps1 — load .env, run supabase login + link + db push
# ============================================================

$root = "C:/Users/admin/Documents/minimax_projects/FamSchedule"
$envPath = Join-Path $root '.env'
$logDir = Join-Path $root 'supabase'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

# 1. Load .env silently
if (-not (Test-Path $envPath)) { Write-Host "FAIL: .env not found" ; exit 1 }
$envVars = @{}
foreach ($line in (Get-Content $envPath)) {
    $trimmed = $line.Trim()
    if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
    if ($trimmed -match '^([^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $val = $matches[2].Trim()
        if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
        if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length - 2) }
        $envVars[$key] = $val
        Set-Item -Path "Env:$key" -Value $val
    }
}
$loaded = ($envVars.Keys | Where-Object { $envVars[$_] }) | Sort-Object
Write-Host "[1/5] env loaded: $($loaded -join ', ')"

# 2. Health check (verbose, no value echo)
Write-Host "[2/5] health check: GET $env:SUPABASE_URL/auth/v1/health"
try {
    $h = Invoke-WebRequest -Uri "$env:SUPABASE_URL/auth/v1/health" -Method GET -UseBasicParsing -TimeoutSec 25
    Write-Host "  status=$($h.StatusCode) content=$($h.Content.Substring(0, [Math]::Min(200, $h.Content.Length)))"
} catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'N/A' }
    $msg = $_.Exception.Message
    Write-Host "  EXCEPTION (HTTP $code): $msg"
    if ($code -ne 200) {
        Write-Host "WARN: auth health non-200; continuing (db push does not need auth endpoint, only DB connection)"
    }
}

# 3. supabase login
Write-Host "[3/5] supabase login"
$loginOut = & npx -y supabase@latest login --token $env:SUPABASE_ACCESS_TOKEN 2>&1
$loginExit = $LASTEXITCODE
$loginOut | Out-File -FilePath (Join-Path $logDir '.login.out') -Encoding utf8
Write-Host "  exit=$loginExit"
$loginOut | Select-Object -Last 10 | ForEach-Object { Write-Host "  | $_" }
if ($loginExit -ne 0) { Write-Host "FAIL: supabase login failed. See .login.out" ; exit $loginExit }

# 4. supabase link
Write-Host "[4/5] supabase link --project-ref $($env:SUPABASE_PROJECT_REF.Substring(0,8))..."
$linkOut = & npx -y supabase@latest link --project-ref $env:SUPABASE_PROJECT_REF --password $env:SUPABASE_DB_PASSWORD 2>&1
$linkExit = $LASTEXITCODE
$linkOut | Out-File -FilePath (Join-Path $logDir '.link.out') -Encoding utf8
Write-Host "  exit=$linkExit"
$linkOut | Select-Object -Last 15 | ForEach-Object { Write-Host "  | $_" }
if ($linkExit -ne 0) { Write-Host "FAIL: supabase link failed. See .link.out" ; exit $linkExit }

# 5. supabase db push (with fallback to db execute --file)
Write-Host "[5/5] supabase db push"
$pushOut = & npx -y supabase@latest db push 2>&1
$pushExit = $LASTEXITCODE
$pushOut | Out-File -FilePath (Join-Path $logDir '.push.out') -Encoding utf8
Write-Host "  exit=$pushExit"
$pushOut | Select-Object -Last 30 | ForEach-Object { Write-Host "  | $_" }
if ($pushExit -ne 0) {
    Write-Host "WARN: db push failed (exit=$pushExit). Falling back to db execute --file migration..."
    $fallbackOut = & npx -y supabase@latest db execute --file (Join-Path $root 'supabase/migrations/20250911000000_init.sql') 2>&1
    $fallbackExit = $LASTEXITCODE
    $fallbackOut | Out-File -FilePath (Join-Path $logDir '.execute.out') -Encoding utf8
    Write-Host "  fallback exit=$fallbackExit"
    $fallbackOut | Select-Object -Last 30 | ForEach-Object { Write-Host "  | $_" }
    if ($fallbackExit -ne 0) {
        Write-Host "FAIL: both db push and db execute failed. Inspect .push.out and .execute.out"
        exit $fallbackExit
    }
    Write-Host "OK: db execute --file succeeded (migration applied)"
} else {
    Write-Host "OK: db push succeeded"
}

Write-Host "=== deploy.ps1 complete ==="
