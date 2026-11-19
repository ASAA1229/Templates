<#
.SYNOPSIS
  Backup/restore drill: dump the production database, restore it into a throwaway database, compare a row count,
  then leave the throwaway database for you to drop. Production data is only read.
#>
. (Join-Path $PSScriptRoot 'common.ps1')
$cfg = Read-EnvFile
$bin = Find-PgBin
$dump = Join-Path ([IO.Path]::GetTempPath()) ('templates-drill-{0}.dump' -f [guid]::NewGuid().ToString('N'))
$drill = 'templates_drill'
$pg = @('-h', '127.0.0.1', '-p', '5432')
try {
  $env:PGPASSWORD = $cfg['MIGRATOR_PASSWORD']
  & (Join-Path $bin 'pg_dump.exe') @pg -U templates_migrator -Fc -f $dump templates
  if ($LASTEXITCODE -ne 0) { throw 'dump failed' }
  Write-Host ('dump {0} bytes, sha256 {1}' -f (Get-Item $dump).Length, (Get-FileHash $dump).Hash.Substring(0, 16))
  $secure = Read-Host -AsSecureString 'postgres superuser password (to create the throwaway database)'
  $env:PGPASSWORD = [Net.NetworkCredential]::new('', $secure).Password
  & (Join-Path $bin 'psql.exe') @pg -U postgres -X -q -c "DROP DATABASE IF EXISTS $drill" -c "CREATE DATABASE $drill OWNER templates_migrator"
  if ($LASTEXITCODE -ne 0) { throw 'could not create the throwaway database' }
  $env:PGPASSWORD = $cfg['MIGRATOR_PASSWORD']
  & (Join-Path $bin 'pg_restore.exe') @pg -U templates_migrator -d $drill --no-owner $dump
  if ($LASTEXITCODE -ne 0) { throw 'restore failed' }
  $count = 'SELECT count(*) FROM "Owner"'
  $a = & (Join-Path $bin 'psql.exe') @pg -U templates_migrator -d templates -tA -c $count
  $b = & (Join-Path $bin 'psql.exe') @pg -U templates_migrator -d $drill -tA -c $count
  if ($a -ne $b) { throw "row count mismatch: $a vs $b" }
  Write-Host "Restore drill PASSED (Owner rows: $a). Drop the throwaway database: DROP DATABASE $drill;"
}
finally {
  Remove-Item $dump -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
