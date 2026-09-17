$ErrorActionPreference = 'Stop'
# ============================================================
# scripts/verify.ps1 — run verify.sql + verify_rls_and_rpc.sql via supabase db execute
# ============================================================

$root = "C:/Users/admin/Documents/minimax_projects/FamSchedule"
$envPath = Join-Path $root '.env'
$logDir = Join-Path $root 'supabase'

# Load .env
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

# 1. Run static verify
Write-Host "=== [1/2] supabase db execute --file supabase/verify.sql ==="
$verifyOut = & npx -y supabase@latest db execute --file (Join-Path $root 'supabase/verify.sql') 2>&1
$verifyExit = $LASTEXITCODE
$verifyOut | Out-File -FilePath (Join-Path $logDir '.verify-static.out') -Encoding utf8
Write-Host "  exit=$verifyExit"
Write-Host "----- verify.sql output -----"
$verifyOut | ForEach-Object { Write-Host "  $_" }
Write-Host "------------------------------"

# 2. Run dynamic RLS + RPC verify
Write-Host ""
Write-Host "=== [2/2] supabase db execute --file supabase/verify_rls_and_rpc.sql ==="
$rlsOut = & npx -y supabase@latest db execute --file (Join-Path $root 'supabase/verify_rls_and_rpc.sql') 2>&1
$rlsExit = $LASTEXITCODE
$rlsOut | Out-File -FilePath (Join-Path $logDir '.verify-rls.out') -Encoding utf8
Write-Host "  exit=$rlsExit"
Write-Host "----- verify_rls_and_rpc.sql output -----"
$rlsOut | ForEach-Object { Write-Host "  $_" }
Write-Host "------------------------------------------"

Write-Host "=== verify.ps1 complete (static_exit=$verifyExit, rls_exit=$rlsExit) ==="
