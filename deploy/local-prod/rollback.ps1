<#
.SYNOPSIS
  Return the local production stack to the previous image (the exact tag recorded in the backups folder), then check readiness.
.DESCRIPTION
  Migrations are forward-only. If a deploy applied a migration the old image cannot run with, add -RestoreDb to
  restore the pre-deploy dump listed in backups\LAST (this replaces current data; you must type RESTORE).
#>
param([switch]$RestoreDb)
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $script:RepoRoot
$previousTag = Get-StateValue 'PREVIOUS_IMAGE_TAG'
if (-not $previousTag -or -not (docker image ls -q "templates-local-prod:$previousTag")) { throw 'No previous image to roll back to.' }
if ($RestoreDb) {
  $last = Join-Path $PSScriptRoot 'backups\LAST'
  if (-not (Test-Path $last)) { throw 'No database dump recorded.' }
  $dump = (Get-Content $last -Raw).Trim()
  if ((Read-Host "Restore $dump and OVERWRITE the templates database? Type RESTORE") -ne 'RESTORE') { throw 'Cancelled.' }
  $cfg = Read-EnvFile
  Invoke-Compose stop api web
  $env:PGPASSWORD = $cfg['MIGRATOR_PASSWORD']
  try { & (Join-Path (Find-PgBin) 'pg_restore.exe') -h 127.0.0.1 -p 5432 -U templates_migrator -d templates --clean --if-exists --no-owner $dump }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}
$env:TEMPLATES_IMAGE_TAG = $previousTag
Set-StateValue 'IMAGE_TAG' $previousTag
Invoke-Compose up -d --no-build --force-recreate api web
for ($i = 0; $i -lt 30; $i++) {
  try {
    if ((Invoke-WebRequest "$script:ApiUrl/api/health/ready" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) {
      Write-Host 'Rolled back and ready.'
      exit 0
    }
  } catch { Start-Sleep 2 }
}
Write-Host 'Rolled back but the API is not ready.' -ForegroundColor Red
exit 1
