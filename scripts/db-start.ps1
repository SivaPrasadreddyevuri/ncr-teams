<#
.SYNOPSIS
    Starts the repository-local PostgreSQL server.

.DESCRIPTION
    Idempotent: reports success and does nothing if the port is already
    listening. Run scripts\db-init.ps1 once before this.

.EXAMPLE
    .\scripts\db-start.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$pgRoot   = Join-Path $repoRoot 'pgsql'
$dataDir  = Join-Path $pgRoot 'data'
$logDir   = Join-Path $pgRoot 'logs'

if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'PG_VERSION'))) {
    throw "No cluster at pgsql\data. Run scripts\db-init.ps1 first."
}

$envFile = Join-Path $repoRoot 'database\.env'
$port = [int][regex]::Match((Get-Content -LiteralPath $envFile -Raw), ':(\d+)/ncr_teams').Groups[1].Value

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "PostgreSQL is already listening on $port."
    return
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Start-Process -FilePath (Join-Path $pgRoot 'bin\postgres.exe') `
    -ArgumentList @('-D', "`"$dataDir`"", '-p', "$port", '-h', '127.0.0.1') `
    -WorkingDirectory $pgRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'stdout.log') `
    -RedirectStandardError  (Join-Path $logDir 'stderr.log') | Out-Null

for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
}

if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
    Write-Host "PostgreSQL did not come up on $port. Last lines of stderr:" -ForegroundColor Red
    Get-Content -LiteralPath (Join-Path $logDir 'stderr.log') -Tail 20 -ErrorAction SilentlyContinue
    throw 'Start failed.'
}

Write-Host "PostgreSQL listening on 127.0.0.1:$port" -ForegroundColor Green
