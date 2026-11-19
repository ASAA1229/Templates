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

# Image tags are exact and version-derived: <package.json version>-<short commit> (version only without git).
# The running and previous tags are remembered in backups\ (git-ignored) so rollback targets an exact tag.
function Get-ImageVersionTag {
  $version = (Get-Content (Join-Path $script:RepoRoot 'package.json') -Raw | ConvertFrom-Json).version
  $sha = ''
  try { $sha = (& git -C $script:RepoRoot rev-parse --short=7 HEAD 2>$null) } catch { }
  if ($LASTEXITCODE -eq 0 -and $sha -match '^[0-9a-f]{7}$') { return "$version-$sha" }
  return "$version"
}

function Get-StateValue([string]$Name) {
  $file = Join-Path $script:Here "backups\$Name"
  if (Test-Path $file) { return (Get-Content $file -Raw).Trim() }
  return ''
}

function Set-StateValue([string]$Name, [string]$Value) {
  New-Item -ItemType Directory -Force (Join-Path $script:Here 'backups') | Out-Null
  Set-Content (Join-Path $script:Here "backups\$Name") $Value -Encoding ascii
}

# docker-compose.yml resolves ${TEMPLATES_IMAGE_TAG}: the running deployment's tag, else the version-derived one.
if (-not $env:TEMPLATES_IMAGE_TAG) {
  $runningTag = Get-StateValue 'IMAGE_TAG'
  $env:TEMPLATES_IMAGE_TAG = if ($runningTag) { $runningTag } else { Get-ImageVersionTag }
}
