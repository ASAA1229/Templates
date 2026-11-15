# Shared helpers for the local production scripts (dot-sourced).
$ErrorActionPreference = 'Stop'
$script:Here = $PSScriptRoot
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:EnvFile = Join-Path $PSScriptRoot '.env.local-prod'
$script:Compose = Join-Path $PSScriptRoot 'docker-compose.yml'
$script:WebUrl = 'http://localhost:8200'
$script:ApiUrl = 'http://localhost:8201'

function Find-PgBin {
  $candidates = @($env:PG_BIN, 'C:\Program Files\PostgreSQL\18\bin') | Where-Object { $_ }
  foreach ($c in $candidates) { if (Test-Path (Join-Path $c 'psql.exe')) { return $c } }
  throw 'PostgreSQL 18 client tools not found. Set PG_BIN to the folder holding psql.exe and pg_dump.exe.'
}

function Read-EnvFile {
  if (-not (Test-Path $script:EnvFile)) { throw "Missing $script:EnvFile. Run setup-db.ps1 first." }
  $map = @{}
  foreach ($line in Get-Content $script:EnvFile) {
    if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $map[$Matches[1]] = $Matches[2] }
  }
  $map
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments)][string[]]$ComposeArgs)
  & docker compose --env-file $script:EnvFile -f $script:Compose @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') failed ($LASTEXITCODE)." }
}
