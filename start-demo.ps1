# Congress Platform: Start Demo Environment (PowerShell)
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "Congress Platform: Starting Local Demo Environment" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan

# 1. Check WSL PostgreSQL
if (Get-Command wsl -ErrorAction SilentlyContinue) {
    Write-Host "[1/3] Ensuring PostgreSQL database is awake in WSL..." -ForegroundColor Yellow
    wsl -d Ubuntu-24.04 -u postgres -e pg_isready 2>$null | Out-Null
}

# 2. Launch Backend
Write-Host "[2/3] Launching FastAPI Backend on http://127.0.0.1:8000..." -ForegroundColor Green
$backendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/k cd /d `"$PSScriptRoot\backend`" && set CONGRESS_PLATFORM_ADMIN_TOKEN=dev&& set CONGRESS_JWT_SECRET=provide-a-secure-random-secret-key-at-least-32-chars-long&& uv run uvicorn app.main:create_app_from_env --factory --host 127.0.0.1 --port 8000" -PassThru

# 3. Launch Frontend
Write-Host "[3/3] Launching React / Vite Frontend on http://127.0.0.1:5173..." -ForegroundColor Green
$frontendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/k cd /d `"$PSScriptRoot\web`" && npm run dev -- --host 127.0.0.1 --port 5173" -PassThru

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "DEMO SERVICES STARTED!" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "Demo Event Page:     http://127.0.0.1:5173/e/ai-health-2026"
Write-Host "Organizer Console:   http://127.0.0.1:5173/organizer"
Write-Host "Attendee Pass:       http://127.0.0.1:5173/my-tickets"
Write-Host "Attendee Network:    http://127.0.0.1:5173/my-network"
Write-Host ""
Write-Host "Credentials saved in: demo_credentials.json" -ForegroundColor Yellow
Write-Host "To stop services: run .\stop-demo.ps1 or stop-demo.bat" -ForegroundColor Yellow
Write-Host "==============================================================" -ForegroundColor Cyan
