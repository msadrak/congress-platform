# Congress Platform: Stop Demo Environment (PowerShell)
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "Congress Platform: Stopping Local Demo Services" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan

$ports = @(8000, 5173, 5180)

foreach ($port in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        foreach ($c in $conns) {
            $pidToKill = $c.OwningProcess
            Write-Host "Terminating process on port $port (PID: $pidToKill)..." -ForegroundColor Yellow
            Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ""
Write-Host "All demo services stopped cleanly." -ForegroundColor Green
Write-Host "(Database records and scan queues preserved in IndexedDB / PostgreSQL)" -ForegroundColor Gray
Write-Host "==============================================================" -ForegroundColor Cyan
