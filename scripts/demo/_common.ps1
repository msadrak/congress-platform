# Shared helpers for the persistent local demo environment. Dot-sourced by the other scripts.
# Windows PowerShell 5.1 compatible. Everything demo-related is named "congress-demo*" and lives in
# <repo>\.demo (gitignored); nothing here touches any other container, volume, port or process.

$ErrorActionPreference = 'Stop'

$script:RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:DemoDir    = Join-Path $RepoRoot '.demo'
$script:LogDir     = Join-Path $DemoDir 'logs'
$script:ConfigPath = Join-Path $DemoDir 'config.json'
$script:PidPath    = Join-Path $DemoDir 'pids.json'
$script:BackendDir = Join-Path $RepoRoot 'backend'
$script:WebDir     = Join-Path $RepoRoot 'web'

$script:Container = 'congress-demo-pg'
$script:Volume    = 'congress-demo-pgdata'
$script:DbName    = 'congress_demo'
$script:DbUser    = 'congress_demo'
$script:DbImage   = 'postgres:16-alpine'
$script:Label     = 'congress.demo=local-manual-review'

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text){ Write-Host "    !!  $Text" -ForegroundColor Yellow }

function Invoke-Native {
    # Runs a native command, returns @{ Code; Out }. Never throws on stderr output or a non-zero exit.
    param([string]$Exe, [string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Exe @Arguments 2>&1 | ForEach-Object { "$_" } | Out-String
        return @{ Code = $LASTEXITCODE; Out = $out.Trim() }
    } finally { $ErrorActionPreference = $prev }
}

function New-Secret([int]$Bytes) {
    $b = New-Object byte[] $Bytes
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $rng.GetBytes($b)
    $rng.Dispose()
    return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Test-PortFree([int]$Port) {
    $l = $null
    try {
        $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
        $l.Start()
        return $true
    } catch { return $false } finally { if ($l) { $l.Stop() } }
}

function Find-FreePort([int]$Preferred) {
    for ($p = $Preferred; $p -lt $Preferred + 200; $p++) { if (Test-PortFree $p) { return $p } }
    throw "No free local port found near $Preferred"
}

function Read-Config {
    if (Test-Path $ConfigPath) { return (Get-Content $ConfigPath -Raw | ConvertFrom-Json) }
    return $null
}

function Save-Config($Config) {
    New-Item -ItemType Directory -Force -Path $DemoDir | Out-Null
    ($Config | ConvertTo-Json -Depth 5) | Set-Content -Path $ConfigPath -Encoding UTF8
}

function Get-DatabaseUrl($Config) {
    return "postgresql+asyncpg://$DbUser`:$($Config.db_password)@127.0.0.1:$($Config.db_port)/$DbName"
}

function Test-DockerAvailable {
    $r = Invoke-Native 'docker' @('info', '--format', '{{.ServerVersion}}')
    return ($r.Code -eq 0)
}

function Get-ContainerState {
    # 'running' | 'exited' | 'created' | ... | $null when the container does not exist
    $r = Invoke-Native 'docker' @('inspect', '-f', '{{.State.Status}}', $Container)
    if ($r.Code -ne 0) { return $null }
    return $r.Out
}

function Get-ContainerInfo {
    $r = Invoke-Native 'docker' @('inspect', $Container)
    if ($r.Code -ne 0) { return $null }
    return (($r.Out | ConvertFrom-Json) | Select-Object -First 1)
}

function Assert-OwnContainer {
    # Refuse to operate on anything that is not the container this tooling created.
    $info = Get-ContainerInfo
    if (-not $info) { throw "Container $Container does not exist." }
    $label = $info.Config.Labels.'congress.demo'
    $volumes = @($info.Mounts | ForEach-Object { $_.Name })
    if ($label -ne 'local-manual-review' -or $volumes.Count -ne 1 -or $volumes[0] -ne $Volume) {
        throw "Container $Container is not the demo database created by these scripts (label '$label', volumes '$($volumes -join ',')'). Refusing to touch it."
    }
}

function Invoke-Psql([string]$Sql) {
    return (Invoke-Native 'docker' @('exec', $Container, 'psql', '-h', '127.0.0.1', '-U', $DbUser, '-d', $DbName, '-tAc', $Sql))
}

function Read-Pids {
    if (Test-Path $PidPath) { return (Get-Content $PidPath -Raw | ConvertFrom-Json) }
    return $null
}

function Save-Pids([int]$ApiPid, [int]$WebPid) {
    ([pscustomobject]@{ api = $ApiPid; web = $WebPid; started_at = (Get-Date).ToString('o') } | ConvertTo-Json) | Set-Content -Path $PidPath -Encoding UTF8
}

function Start-Detached([string]$CmdFile, [string]$WorkDir) {
    # Launches a hidden process through WMI so it is NOT a child of this console/session: it keeps running after
    # the terminal that ran start.ps1 is closed. WMI children do not inherit our environment, so the .cmd file sets it.
    $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = "cmd.exe /d /c `"`"$CmdFile`"`""; CurrentDirectory = $WorkDir; ProcessStartupInformation = $startup }
    if ($r.ReturnValue -ne 0) { throw "Could not launch $CmdFile (WMI return code $($r.ReturnValue))" }
    return [int]$r.ProcessId
}

function Test-OurProcess([int]$ProcId, [string]$Needle) {
    # True only when the pid is alive AND its command line contains our marker (never kill a recycled pid).
    if (-not $ProcId) { return $false }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcId" -ErrorAction SilentlyContinue
    return [bool]($p -and $p.CommandLine -and $p.CommandLine.Contains($Needle))
}

function Stop-ProcessTree([int]$ProcId) {
    Invoke-Native 'taskkill' @('/PID', "$ProcId", '/T', '/F') | Out-Null
}

function Test-Http([string]$Url, [int]$TimeoutSec = 5) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Wait-Http([string]$Url, [int]$Seconds, [string]$What) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Http $Url 3) { return }
        Start-Sleep -Milliseconds 700
    }
    throw "$What did not become healthy at $Url within $Seconds s (see $LogDir)"
}

function Get-DemoUrls($Config) {
    return @{ Web = "http://127.0.0.1:$($Config.web_port)"; Api = "http://127.0.0.1:$($Config.api_port)" }
}
