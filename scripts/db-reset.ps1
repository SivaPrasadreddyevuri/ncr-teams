<#
.SYNOPSIS
    Drops the database, replays every migration from empty, and re-seeds.

.DESCRIPTION
    The full local reproduction of a fresh environment, in the same order CI
    runs it. Destroys all data in the application database.

.EXAMPLE
    .\scripts\db-reset.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$prisma   = Join-Path $repoRoot 'node_modules\.bin\prisma.cmd'

if (-not (Test-Path -LiteralPath $prisma)) {
    throw 'Prisma is not installed. Run npm install at the repository root first.'
}

# The server has to be up for the reset to connect to it.
$envFile = Join-Path $repoRoot 'database\.env'
$port = [int][regex]::Match((Get-Content -LiteralPath $envFile -Raw), ':(\d+)/ncr_teams').Groups[1].Value
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
    throw "PostgreSQL is not listening on $port. Run scripts\db-start.ps1 first."
}

if (-not $PSCmdlet.ShouldProcess('ncr_teams', 'Drop, migrate and seed')) { return }

Push-Location (Join-Path $repoRoot 'database')
try {
    & $prisma migrate reset --force
    if ($LASTEXITCODE -ne 0) { throw "migrate reset failed with exit code $LASTEXITCODE" }

    node --import tsx (Join-Path $repoRoot 'database\scripts\verify-seed.ts')
    if ($LASTEXITCODE -ne 0) { throw 'Seed verification failed.' }
} finally {
    Pop-Location
}
