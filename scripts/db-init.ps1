<#
.SYNOPSIS
    Initialises the repository-local PostgreSQL cluster and the application
    role and database.

.DESCRIPTION
    Creates pgsql\data with initdb, starts the server on the port from
    database\.env, then calls the workspace bootstrap script to create the role
    and database.

    Safe to re-run: initdb is skipped if the cluster already exists, and the
    bootstrap script is idempotent. If the cluster exists but is not running,
    it is started rather than recreated -- destroying a cluster on a re-run
    would silently discard whatever the developer had in it.

.PARAMETER Force
    Delete an existing cluster and start over. Destroys all local data.
#>
[CmdletBinding(SupportsShouldProcess)]
param([switch]$Force)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$pgRoot   = Join-Path $repoRoot 'pgsql'
$pgBin    = Join-Path $pgRoot 'bin'
$dataDir  = Join-Path $pgRoot 'data'
$logDir   = Join-Path $pgRoot 'logs'
$envFile  = Join-Path $repoRoot 'database\.env'

foreach ($exe in @('initdb.exe', 'postgres.exe', 'pg_ctl.exe')) {
    $path = Join-Path $pgBin $exe
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing $path. Restore the PostgreSQL 17.10 binaries into pgsql\ before running this script."
    }
}

# The port is read from database\.env rather than hard-coded, so there is one
# place to change it. Parsed textually: a full URI parse would need a runtime
# that PowerShell does not have.
if (-not (Test-Path -LiteralPath $envFile)) {
    Copy-Item -LiteralPath (Join-Path $repoRoot 'database\.env.example') -Destination $envFile
    Write-Host "Created database\.env from the example. Set the passwords before continuing." -ForegroundColor Yellow
    return
}
$envText  = Get-Content -LiteralPath $envFile -Raw
$portLine = [regex]::Match($envText, ':(\d+)/ncr_teams')
if (-not $portLine.Success) { throw "Could not find the port in database\.env" }
$port     = [int]$portLine.Groups[1].Value

$superPw = [regex]::Match($envText, 'POSTGRES_SUPERUSER_URL="[^:]*://[^:]+:([^@]+)@').Groups[1].Value
$appPw   = [regex]::Match($envText, 'DATABASE_URL="[^:]*://[^:]+:([^@]+)@').Groups[1].Value
if (-not $superPw -or -not $appPw) { throw 'Could not read the passwords from database\.env' }

$alreadyRunning = [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)

if ($Force -and (Test-Path -LiteralPath $dataDir) -and -not $alreadyRunning) {
    if ($PSCmdlet.ShouldProcess($dataDir, 'Delete existing cluster')) {
        Remove-Item -LiteralPath $dataDir -Recurse -Force
    }
}

if (Test-Path -LiteralPath $dataDir) {
    Write-Host "Cluster already initialised at pgsql\data - reusing it."
} else {
    if (-not $PSCmdlet.ShouldProcess($dataDir, 'initdb')) { return }
    Write-Host 'Running initdb...'
    # The password has to reach initdb through a file; there is no inline
    # argument for it. The file is deleted immediately afterwards.
    $pwFile = Join-Path ([System.IO.Path]::GetTempPath()) "ncr-pw-$PID.txt"
    try {
        [System.IO.File]::WriteAllText($pwFile, $superPw)
        & (Join-Path $pgBin 'initdb.exe') -D $dataDir -U postgres `
            --auth-local=trust --auth-host=scram-sha-256 `
            --pwfile=$pwFile -E UTF8 --no-sync | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "initdb failed with exit code $LASTEXITCODE" }
    } finally {
        Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue
    }
    Write-Host 'Cluster created.' -ForegroundColor Green
}

if ($alreadyRunning) {
    Write-Host "PostgreSQL is already listening on $port."
} else {
    if ($PSCmdlet.ShouldProcess("127.0.0.1:$port", 'Start PostgreSQL')) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        Start-Process -FilePath (Join-Path $pgBin 'postgres.exe') `
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
    }
}

if ($PSCmdlet.ShouldProcess('application role and database', 'Create')) {
    Push-Location (Join-Path $repoRoot 'database')
    try {
        & (Join-Path $repoRoot 'node_modules\.bin\prisma.cmd') --version | Out-Null
        node --import tsx (Join-Path $repoRoot 'database\scripts\create-database.ts')
        if ($LASTEXITCODE -ne 0) { throw "Bootstrap failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

Write-Host ''
Write-Host 'Next: npm run db:migrate -- --name <name>   then   npm run db:seed' -ForegroundColor Cyan
