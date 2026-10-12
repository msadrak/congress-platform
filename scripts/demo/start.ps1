<#
.SYNOPSIS
  Starts (or restarts) the persistent local demo: PostgreSQL in Docker, FastAPI and the web app.
.DESCRIPTION
  Safe to run repeatedly. The demo database lives in the Docker volume 'congress-demo-pgdata' and is never
  deleted here. Demo data is seeded only when the database has none. Everything listens on 127.0.0.1.
  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\start.ps1
#>
. (Join-Path $PSScriptRoot '_common.ps1')

New-Item -ItemType Directory -Force -Path $DemoDir, $LogDir | Out-Null

# ---- 1. prerequisites ------------------------------------------------------------------------------------
Write-Step 'Checking prerequisites'
if (-not (Test-DockerAvailable)) { throw 'Docker is not running. Start Docker Desktop and run this script again.' }
$venvPython = Join-Path $BackendDir '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) { throw "Backend virtualenv missing. Run: cd backend; uv sync" }
$viteJs = Join-Path $WebDir 'node_modules\vite\bin\vite.js'
if (-not (Test-Path $viteJs)) { throw "Web dependencies missing. Run: cd web; npm ci" }
Write-Ok 'Docker, backend venv and web dependencies found'

# ---- 2. configuration (ports + secrets are generated once and then kept) ---------------------------------
$cfg = Read-Config
if (-not $cfg) {
    $cfg = [pscustomobject]@{
        db_port = 0; api_port = 0; web_port = 0
        db_password = (New-Secret 12); jwt_secret = (New-Secret 32); admin_token = (New-Secret 16)
    }
}
$pids = Read-Pids
$apiAlive = $pids -and (Test-OurProcess $pids.api 'run-api.cmd') -and ($cfg.api_port -gt 0)
$webAlive = $pids -and (Test-OurProcess $pids.web 'run-web.cmd') -and ($cfg.web_port -gt 0)
if (-not $apiAlive) { $cfg.api_port = Find-FreePort $(if ($cfg.api_port -gt 0) { $cfg.api_port } else { 8100 }) }
if (-not $webAlive) { $cfg.web_port = Find-FreePort $(if ($cfg.web_port -gt 0) { $cfg.web_port } else { 5190 }) }

# ---- 3. dedicated database container ---------------------------------------------------------------------
Write-Step 'Starting the dedicated demo database'
function New-DemoContainer([int]$Port) {
    $r = Invoke-Native 'docker' @('run', '-d', '--name', $Container, '--label', $Label,
        '-e', "POSTGRES_USER=$DbUser", '-e', "POSTGRES_PASSWORD=$($cfg.db_password)", '-e', "POSTGRES_DB=$DbName",
        '-v', "$($Volume):/var/lib/postgresql/data", '-p', "127.0.0.1:$($Port):5432", $DbImage)
    if ($r.Code -ne 0) { throw "Could not create $Container : $($r.Out)" }
    $cfg.db_port = $Port
}
$state = Get-ContainerState
if ($null -eq $state) {
    New-DemoContainer (Find-FreePort $(if ($cfg.db_port -gt 0) { $cfg.db_port } else { 55432 }))
    Write-Ok "created $Container (new volume $Volume) on 127.0.0.1:$($cfg.db_port)"
} else {
    Assert-OwnContainer
    $port = [int]((Get-ContainerInfo).HostConfig.PortBindings.'5432/tcp'[0].HostPort)
    $cfg.db_port = $port
    if ($state -ne 'running') {
        $r = Invoke-Native 'docker' @('start', $Container)
        if ($r.Code -ne 0) {
            # Port taken by something else: the container holds no data (the volume does), so re-create it on a free port.
            Write-Warn2 "could not start on port $port ($($r.Out)); re-creating the container on another port, data volume kept"
            Invoke-Native 'docker' @('rm', $Container) | Out-Null
            New-DemoContainer (Find-FreePort ($port + 1))
        }
        Write-Ok "started existing $Container on 127.0.0.1:$($cfg.db_port) (data preserved)"
    } else { Write-Ok "$Container already running on 127.0.0.1:$($cfg.db_port)" }
}
Save-Config $cfg

$deadline = (Get-Date).AddSeconds(60)
while ($true) {
    $r = Invoke-Psql 'select current_database()'
    if ($r.Code -eq 0 -and $r.Out -eq $DbName) { break }
    if ((Get-Date) -gt $deadline) { throw "Database did not become ready: $($r.Out)" }
    Start-Sleep -Milliseconds 800
}
Write-Ok "database '$DbName' is accepting connections"

# ---- 4. environment for the child processes (restored afterwards) ----------------------------------------
$urls = Get-DemoUrls $cfg
$saved = @{}
$envVars = @{
    CONGRESS_DATABASE_URL = (Get-DatabaseUrl $cfg)
    CONGRESS_PLATFORM_ADMIN_TOKEN = $cfg.admin_token
    CONGRESS_JWT_SECRET = $cfg.jwt_secret
    CONGRESS_CORS_ORIGINS = "[`"$($urls.Web)`"]"
    CONGRESS_DEMO_API_ORIGIN = $urls.Api
    PYTHONUTF8 = '1'
}
function New-RunScript([string]$Name, [string]$WorkDir, [string]$CommandLine) {
    $lines = @('@echo off', "cd /d `"$WorkDir`"")
    foreach ($k in $envVars.Keys) { $lines += "set `"$k=$($envVars[$k])`"" }
    $lines += "$CommandLine > `"$(Join-Path $LogDir "$Name.out.log")`" 2> `"$(Join-Path $LogDir "$Name.err.log")`""
    $path = Join-Path $DemoDir "$Name.cmd"
    Set-Content -Path $path -Value $lines -Encoding ASCII
    return $path
}
foreach ($k in $envVars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process'); [Environment]::SetEnvironmentVariable($k, $envVars[$k], 'Process') }
try {
    # ---- 5. migrations -----------------------------------------------------------------------------------
    Write-Step 'Applying Alembic migrations'
    Push-Location $BackendDir
    try { $r = Invoke-Native $venvPython @('-m', 'alembic', 'upgrade', 'head') } finally { Pop-Location }
    if ($r.Code -ne 0) { throw "Migrations failed:`n$($r.Out)" }
    $head = (Invoke-Psql 'select version_num from alembic_version').Out
    Write-Ok "schema at Alembic revision $head"

    # ---- 6. FastAPI --------------------------------------------------------------------------------------
    Write-Step 'Starting FastAPI'
    $apiPid = if ($apiAlive) { $pids.api } else { 0 }
    if (-not $apiAlive) {
        $apiPid = Start-Detached (New-RunScript 'run-api' $BackendDir "`"$venvPython`" -m uvicorn app.main:create_app_from_env --factory --host 127.0.0.1 --port $($cfg.api_port)") $BackendDir
    }
    Save-Pids $apiPid $(if ($webAlive) { $pids.web } else { 0 })
    Wait-Http "$($urls.Api)/openapi.json" 60 'FastAPI'
    Write-Ok "API healthy at $($urls.Api) (pid $apiPid)"

    # ---- 7. seed only when empty -------------------------------------------------------------------------
    Write-Step 'Preparing demo data'
    Push-Location $BackendDir
    try { $r = Invoke-Native $venvPython @('seed_demo.py', '--api', $urls.Api, '--web', $urls.Web, '--state-dir', $DemoDir) } finally { Pop-Location }
    if ($r.Code -ne 0) { Write-Host $r.Out; throw 'Seeding failed (the demo database is left as it is; start.ps1 can be re-run to resume).' }
    $r.Out -split "`n" | ForEach-Object { Write-Host "    $_" }

    # ---- 8. web ------------------------------------------------------------------------------------------
    Write-Step 'Starting the web app'
    $webPid = if ($webAlive) { $pids.web } else { 0 }
    if (-not $webAlive) {
        $webPid = Start-Detached (New-RunScript 'run-web' $WebDir "node `"$viteJs`" --config vite.demo.config.ts --host 127.0.0.1 --port $($cfg.web_port) --strictPort") $WebDir
    }
    Save-Pids $apiPid $webPid
    Wait-Http "$($urls.Web)/" 90 'The web app'
    Wait-Http "$($urls.Web)/api/public/events/ai-health-2026" 30 'The web app API proxy'
    Write-Ok "web healthy at $($urls.Web) (pid $webPid)"
} finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
}

Save-Config $cfg

Write-Host ''
Write-Host 'The local demo is running.' -ForegroundColor Green
Write-Host "  Open this URL : $($urls.Web)/e/ai-health-2026"
Write-Host "  Landing page  : $($urls.Web)/"
Write-Host "  API           : $($urls.Api)  (docs: $($urls.Api)/docs)"
Write-Host "  Guide + logins: $(Join-Path $DemoDir 'DEMO-GUIDE.md')   (local, gitignored)"
Write-Host '  Status        : powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\status.ps1'
Write-Host '  Stop (keeps data): powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\stop.ps1'
