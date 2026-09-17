$ErrorActionPreference = 'Stop'
# scripts/push.ps1 — direct push (link already done)
$root = "C:/Users/admin/Documents/minimax_projects/FamSchedule"
$logDir = Join-Path $root 'supabase'

# Load .env silently
$envVars = @{}
foreach ($line in (Get-Content (Join-Path $root '.env'))) {
    $trimmed = $line.Trim()
    if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }
    if ($trimmed -match '^([^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $val = $matches[2].Trim()
        if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
        if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length - 2) }
        $envVars[$key] = $val
    }
}
foreach ($k in $envVars.Keys) { Set-Item -Path "Env:$k" -Value $envVars[$k] }

# db push
Write-Host "=== supabase db push ==="
$pushOut = & npx -y supabase@latest db push --include-all 2>&1 | Out-String
$pushExit = $LASTEXITCODE
$pushOut | Out-File -FilePath (Join-Path $logDir '.push.out') -Encoding utf8
Write-Host "exit=$pushExit"
Write-Host "----- db push output -----"
Write-Host $pushOut
Write-Host "--------------------------"

if ($pushExit -ne 0) {
    Write-Host ""
    Write-Host "=== fallback: supabase db execute --file ==="
    $fallbackOut = & npx -y supabase@latest db execute --file (Join-Path $root 'supabase/migrations/20250911000000_init.sql') 2>&1 | Out-String
    $fallbackExit = $LASTEXITCODE
    $fallbackOut | Out-File -FilePath (Join-Path $logDir '.execute.out') -Encoding utf8
    Write-Host "fallback exit=$fallbackExit"
    Write-Host "----- db execute output -----"
    Write-Host $fallbackOut
    Write-Host "-----------------------------"
    if ($fallbackExit -ne 0) { exit $fallbackExit }
}
Write-Host "=== push.ps1 complete ==="
