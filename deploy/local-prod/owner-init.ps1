# Creates the single owner account interactively inside the production image (first deploy only).
. (Join-Path $PSScriptRoot 'common.ps1')
Invoke-Compose --profile tools run --rm owner-init
