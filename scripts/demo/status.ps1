<#
.SYNOPSIS
  Shows whether the local demo database, API and web app are running, healthy and populated.
#>
. (Join-Path $PSScriptRoot '_common.ps1')

$cfg = Read-Config
$pids = Read-Pids
$allUp = $true

function Show([string]$Name, [bool]$Up, [string]$Detail) {
    $mark = if ($Up) { 'RUNNING ' } else { 'STOPPED ' }
    Write-Host ("  {0,-9}{1}{2}" -f $Name, $mark, $Detail) -ForegroundColor $(if ($Up) { 'Green' } else { 'Red' })
}

if (-not (Test-DockerAvailable)) {
    Show 'docker' $false 'Docker is not running'
    exit 1
}
$state = Get-ContainerState
$dbUp = ($state -eq 'running')
$volume = Invoke-Native 'docker' @('volume', 'inspect', $Volume, '--format', '{{.Name}}')
$dbDetail = if ($null -eq $state) { 'container not created yet (run start.ps1)' } else { "container $Container is $state; data volume $(if ($volume.Code -eq 0) { 'present' } else { 'MISSING' })" }
if ($cfg -and $cfg.db_port) { $dbDetail += "; 127.0.0.1:$($cfg.db_port)" }
Show 'database' $dbUp $dbDetail
if (-not $dbUp) { $allUp = $false }

if ($cfg -and $cfg.api_port -gt 0) {
    $urls = Get-DemoUrls $cfg
    $apiProc = $pids -and (Test-OurProcess $pids.api 'run-api.cmd')
    $apiOk = $apiProc -and (Test-Http "$($urls.Api)/openapi.json")
    Show 'api' $apiOk "$($urls.Api)$(if ($apiProc -and -not $apiOk) { ' (process alive, not answering)' })"
    $webProc = $pids -and (Test-OurProcess $pids.web 'run-web.cmd')
    $webOk = $webProc -and (Test-Http "$($urls.Web)/") -and (Test-Http "$($urls.Web)/api/public/events/ai-health-2026")
    Show 'web' $webOk "$($urls.Web)$(if ($webProc -and -not $webOk) { ' (process alive, not answering)' })"
    if (-not $apiOk -or -not $webOk) { $allUp = $false }
} else {
    Show 'api' $false 'not configured yet'
    Show 'web' $false 'not configured yet'
    $allUp = $false
}

if ($dbUp) {
    $r = Invoke-Psql "select (select count(*) from events)||' congresses, '||(select count(*) from tickets)||' tickets, '||(select count(*) from checkins)||' check-in scans, '||(select count(*) from booths)||' booths, '||(select count(*) from leads)||' leads'"
    if ($r.Code -eq 0) { Write-Host "  data     $($r.Out)" }
}
if ($allUp) {
    Write-Host "`n  Open: $($urls.Web)/e/ai-health-2026   Guide: $(Join-Path $DemoDir 'DEMO-GUIDE.md')" -ForegroundColor Green
} else {
    Write-Host "`n  Something is stopped. Start everything (data is preserved): powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\start.ps1" -ForegroundColor Yellow
}
exit $(if ($allUp) { 0 } else { 1 })
