@echo off
setlocal enabledelayedexpansion

echo ==============================================================
echo Congress Platform: Starting Local Demo Environment
echo ==============================================================
echo.

REM 1. Ensure WSL PostgreSQL is awake
where wsl >nul 2>nul
if not errorlevel 1 (
  echo [1/3] Ensuring PostgreSQL database is awake in WSL...
  wsl -d Ubuntu-24.04 -u postgres -e pg_isready >nul 2>nul
)

REM 2. Start Backend in separate window
echo [2/3] Launching FastAPI Backend on http://127.0.0.1:8000...
start "Congress-Backend" cmd /k "cd /d "%~dp0backend" && set CONGRESS_PLATFORM_ADMIN_TOKEN=dev&& set CONGRESS_JWT_SECRET=provide-a-secure-random-secret-key-at-least-32-chars-long&& uv run uvicorn app.main:create_app_from_env --factory --host 127.0.0.1 --port 8000"

REM 3. Start Frontend in separate window
echo [3/3] Launching React / Vite Frontend on http://127.0.0.1:5173...
start "Congress-Frontend" cmd /k "cd /d "%~dp0web" && npm run dev -- --host 127.0.0.1 --port 5173"

echo.
echo ==============================================================
echo DEMO SERVICES STARTED!
echo ==============================================================
echo.
echo Demo Event Page:     http://127.0.0.1:5173/e/ai-health-2026
echo Organizer Console:   http://127.0.0.1:5173/organizer
echo Attendee Pass:       http://127.0.0.1:5173/my-tickets
echo Attendee Network:    http://127.0.0.1:5173/my-network
echo.
echo Demo credentials saved in: demo_credentials.json
echo To stop services: run stop-demo.bat
echo ==============================================================
