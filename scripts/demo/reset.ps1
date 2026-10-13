<#
.SYNOPSIS
  DESTRUCTIVE: deletes ONLY the local demo database and its credentials, so start.ps1 can seed from scratch.
.DESCRIPTION
  Without -ConfirmDatabase congress_demo this only prints what would be deleted. Before deleting anything it
  verifies that the container carries this tooling's label, mounts the demo volume, and that the server it
  would wipe really reports current_database() = 'congress_demo'. No other container, volume or database
  is ever touched.
  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\reset.ps1 -ConfirmDatabase congress_demo
#>
param([string]$ConfirmDatabase)
. (Join-Path $PSScriptRoot '_common.ps1')

if (-not (Test-DockerAvailable)) { throw 'Docker is not running.' }
$state = Get-ContainerState
if ($null -eq $state) { Write-Host 'No demo database container exists; nothing to reset.'; exit 0 }
Assert-OwnContainer

if ($state -ne 'running') {
    $r = Invoke-Native 'docker' @('start', $Container)
    if ($r.Code -ne 0) { throw "Cannot start $Container to verify it: $($r.Out)" }
    Start-Sleep -Seconds 3
}
$r = Invoke-Psql 'select current_database()'
if ($r.Code -ne 0 -or $r.Out -ne $DbName) { throw "Target verification failed (expected database '$DbName', got '$($r.Out)'). Nothing deleted." }
$count = (Invoke-Psql 'select count(*) from events').Out

Write-Host "Target verified: container $Container, database '$DbName', volume $Volume ($count congress(es) inside)." -ForegroundColor Yellow
Write-Host "Reset would delete: that container, that volume, and $DemoDir\credentials.json + DEMO-GUIDE.md + pids." -ForegroundColor Yellow
if ($ConfirmDatabase -ne $DbName) {
    Write-Host "Nothing was deleted. To proceed run again with:  -ConfirmDatabase $DbName" -ForegroundColor Cyan
    exit 2
}

& (Join-Path $PSScriptRoot 'stop.ps1')
Assert-OwnContainer
Invoke-Native 'docker' @('rm', '-f', $Container) | Out-Null
$r = Invoke-Native 'docker' @('volume', 'rm', $Volume)
if ($r.Code -ne 0) { throw "Could not remove volume $Volume : $($r.Out)" }
foreach ($f in @('credentials.json', 'DEMO-GUIDE.md', 'pids.json')) {
    $p = Join-Path $DemoDir $f
    if (Test-Path $p) { Remove-Item $p -Force }
}
Write-Host 'Demo database and credentials deleted. Run scripts\demo\start.ps1 to create a fresh demo.' -ForegroundColor Green
