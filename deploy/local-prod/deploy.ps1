<#
.SYNOPSIS
  Build, migrate, start and smoke-check the local production stack. Rolls back automatically on failure.
.DESCRIPTION
  1. remembers the running image tag (templates-local-prod:<version>-<commit>) as the rollback target
  2. dumps the database (pg_dump, custom format) to backups\ using the migrator role
  3. builds the new image, runs `prisma migrate deploy`, starts web (8200) and API (8201)
  4. runs scripts/smoke.mjs against http://localhost:8200
  On any failure rollback.ps1 is invoked (image rollback; the dump is kept for a manual -RestoreDb).
#>
param([switch]$NoRollback)
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $script:RepoRoot
$cfg = Read-EnvFile
$pgBin = Find-PgBin
$backups = Join-Path $PSScriptRoot 'backups'
New-Item -ItemType Directory -Force $backups | Out-Null

$newTag = Get-ImageVersionTag
$runningTag = Get-StateValue 'IMAGE_TAG'
$hadCurrent = [bool]$runningTag -and [bool](docker image ls -q "templates-local-prod:$runningTag")
if ($hadCurrent -and $runningTag -ne $newTag) { Set-StateValue 'PREVIOUS_IMAGE_TAG' $runningTag }
$env:TEMPLATES_IMAGE_TAG = $newTag

try {
  if ($hadCurrent) {
    $dump = Join-Path $backups ('templates-{0}.dump' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $env:PGPASSWORD = $cfg['MIGRATOR_PASSWORD']
    try { & (Join-Path $pgBin 'pg_dump.exe') -h 127.0.0.1 -p 5432 -U templates_migrator -Fc -f $dump templates }
    finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    if ($LASTEXITCODE -ne 0) { throw 'pre-deploy database dump failed.' }
    Set-Content (Join-Path $backups 'LAST') $dump -Encoding ascii
    Write-Host "Database dump: $dump"
  }
  Invoke-Compose build api
  Invoke-Compose --profile tools run --rm migrate
  Invoke-Compose up -d --force-recreate api web

  $ok = $false
  for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
    try { $ok = (Invoke-WebRequest "$script:ApiUrl/api/health/ready" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { Start-Sleep 2 }
  }
  if (-not $ok) { throw 'API did not become ready.' }
  & node scripts/smoke.mjs --url $script:WebUrl
  if ($LASTEXITCODE -ne 0) { throw 'smoke test failed.' }
  Set-StateValue 'IMAGE_TAG' $newTag
  Write-Host "Deploy OK: $script:WebUrl (API $script:ApiUrl)"
}
catch {
  Write-Host "DEPLOY FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if (-not $NoRollback -and $hadCurrent) { & (Join-Path $PSScriptRoot 'rollback.ps1') }
  elseif (-not $hadCurrent) { try { Invoke-Compose down } catch { } }
  exit 1
}
