<#
.SYNOPSIS
  Stops the local demo services. The demo database and all demo data are KEPT.
.DESCRIPTION
  Stops only the web and API processes started by start.ps1 (matched by pid AND command line) and then stops
  the 'congress-demo-pg' container. The Docker volume with the data is never removed.
  Use -KeepDatabase to leave the database container running.
#>
param([switch]$KeepDatabase)
. (Join-Path $PSScriptRoot '_common.ps1')

$pids = Read-Pids
foreach ($svc in @(@{ Name = 'web'; Needle = 'run-web.cmd' }, @{ Name = 'api'; Needle = 'run-api.cmd' })) {
    $procId = if ($pids) { [int]$pids.($svc.Name) } else { 0 }
    if ($procId -and (Test-OurProcess $procId $svc.Needle)) {
        Stop-ProcessTree $procId
        Write-Ok "stopped $($svc.Name) (pid $procId)"
    } else { Write-Host "    $($svc.Name): not running" }
}
if (Test-Path $PidPath) { Remove-Item $PidPath -Force }

if ($KeepDatabase) {
    Write-Host '    database: left running (-KeepDatabase)'
} elseif ($null -ne (Get-ContainerState)) {
    Assert-OwnContainer
    $r = Invoke-Native 'docker' @('stop', $Container)
    if ($r.Code -eq 0) { Write-Ok "database container stopped; volume '$Volume' (your demo data) is untouched" }
    else { Write-Warn2 "could not stop $Container : $($r.Out)" }
} else { Write-Host '    database: container does not exist' }

Write-Host ''
Write-Host 'Demo stopped. Data is preserved. Restart with scripts\demo\start.ps1' -ForegroundColor Green
