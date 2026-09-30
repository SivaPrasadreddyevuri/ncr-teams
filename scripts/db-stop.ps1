<#
.SYNOPSIS
    Stops the repository-local PostgreSQL server.

.DESCRIPTION
    Uses pg_ctl stop in fast mode, which checkpoints and shuts down cleanly.
    Only touches the postgres processes listening on this project's port, so a
    separate PostgreSQL installed elsewhere on the machine is never affected.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$pgRoot   = Join-Path $repoRoot 'pgsql'
$dataDir  = Join-Path $pgRoot 'data'

if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'PG_VERSION'))) {
    Write-Host 'No cluster at pgsql\data - nothing to stop.'
    return
}

$envFile = Join-Path $repoRoot 'database\.env'
$port = [int][regex]::Match((Get-Content -LiteralPath $envFile -Raw), ':(\d+)/ncr_teams').Groups[1].Value

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
    Write-Host "Nothing is listening on $port."
    return
}

# Matched on the executable path, not just the port, so a server that happens to
# be on this port but is not ours is reported rather than killed.
$ourPid  = $listener[0].OwningProcess
$exePath = (Get-CimInstance Win32_Process -Filter "ProcessId=$ourPid").ExecutablePath
$expected = Join-Path $pgRoot 'bin\postgres.exe'

if ($exePath -ne $expected) {
    throw "Port $port is held by $($exePath), which is not this project's PostgreSQL. Refusing to stop it."
}

Write-Host "Stopping PostgreSQL (pid $ourPid)..."
& (Join-Path $pgRoot 'bin\pg_ctl.exe') -D $dataDir -m fast -w stop | Out-Null

if ($LASTEXITCODE -ne 0) { throw "pg_ctl stop failed with exit code $LASTEXITCODE" }
Write-Host 'PostgreSQL stopped.' -ForegroundColor Green
