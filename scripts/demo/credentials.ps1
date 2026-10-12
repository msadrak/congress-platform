<#
.SYNOPSIS
  Opens the local demo guide, or copies a Scanner device token to the clipboard (never printed).
.EXAMPLE
  scripts\demo\credentials.ps1                         # print the guide path
  scripts\demo\credentials.ps1 -CopyScannerToken main  # main | lunch | workshop | hall | cardio
#>
param([ValidateSet('main', 'lunch', 'workshop', 'hall', 'cardio')][string]$CopyScannerToken)
. (Join-Path $PSScriptRoot '_common.ps1')

$credPath = Join-Path $DemoDir 'credentials.json'
if (-not (Test-Path $credPath)) { throw 'No credentials yet. Run scripts\demo\start.ps1 first.' }
if (-not $CopyScannerToken) {
    Write-Host "Guide (contains logins; local and gitignored): $(Join-Path $DemoDir 'DEMO-GUIDE.md')"
    exit 0
}
$creds = Get-Content $credPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pointId = if ($CopyScannerToken -eq 'cardio') { $creds.ids.points.cardio_main } else { $creds.ids.points.$CopyScannerToken }
$entry = $creds.scanner_credentials | Where-Object { $_.point_id -eq $pointId } | Select-Object -First 1
if (-not $entry) { throw "No scanner credential for '$CopyScannerToken'." }
Set-Clipboard -Value $entry.token
Write-Host "Scanner token for '$($entry.point_name)' copied to the clipboard (expires $($entry.expires_at))."
Write-Host "Paste it into the credential field at /scan/$pointId. It is intentionally not printed."
