@echo off
setlocal enabledelayedexpansion

echo ==============================================================
echo Congress Platform: Stopping Local Demo Services
echo ==============================================================
echo.

REM Terminate backend process listening on port 8000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r ":8000 .*LISTENING"') do (
  echo Terminating Backend process (PID: %%a)...
  taskkill /F /PID %%a >nul 2>nul
)

REM Terminate frontend dev process listening on port 5173
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r ":5173 .*LISTENING"') do (
  echo Terminating Frontend dev process (PID: %%a)...
  taskkill /F /PID %%a >nul 2>nul
)

REM Terminate frontend preview process listening on port 5180
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r ":5180 .*LISTENING"') do (
  echo Terminating Frontend preview process (PID: %%a)...
  taskkill /F /PID %%a >nul 2>nul
)

echo.
echo ==============================================================
echo All demo services stopped cleanly.
echo (Database and scan queues preserved in IndexedDB / PostgreSQL)
echo ==============================================================
