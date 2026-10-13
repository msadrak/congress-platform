@echo off
setlocal enabledelayedexpansion

echo ==========================================
echo Congress Platform: Full-Stack Verification
echo ==========================================

echo.
echo [1/3] Checking Backend (Python / FastAPI)...
rem Preferred: mypy + pytest on disposable Docker infrastructure with a steady clock
rem (the WSL runner's clock oscillates and causes spurious JWT 401s; see scripts\integration\backend-tests.mjs).
docker info >nul 2>nul
if not errorlevel 1 (
  call node scripts\integration\backend-tests.mjs
  if errorlevel 1 ( echo [FAIL] Backend mypy/pytest failed & exit /b 1 )
  goto web
)

cd backend
call uv run mypy
if errorlevel 1 ( echo [FAIL] Backend mypy failed & exit /b 1 )
cd ..

rem Fallback: pytest inside WSL where asyncpg is stable; skip WSL when it is unavailable.
where wsl >nul 2>nul
if errorlevel 1 (
  echo [SKIP] WSL not available; running pytest locally
  cd backend
  call uv run pytest -q
  if errorlevel 1 ( echo [FAIL] Backend pytest failed & exit /b 1 )
  cd ..
) else (
  wsl -d Ubuntu-24.04 -u root -e bash -lc "pg_isready -h localhost -p 5433 >nul 2>&1 || service postgresql start >nul 2>&1; cd '/mnt/h/Freelancing_Project/KalaniProject/DR.MaHDi/Congere Managment Platform/backend' && /root/backend_venv/bin/pip install -q 'pillow>=11' && /root/backend_venv/bin/pytest -q --tb=short"
  if errorlevel 1 ( echo [FAIL] Backend pytest failed & exit /b 1 )
)

:web
echo.
echo [2/3] Checking Web (React / TypeScript)...
cd web
call npm test
if errorlevel 1 ( echo [FAIL] Web test failed & exit /b 1 )
call npm run typecheck
if errorlevel 1 ( echo [FAIL] Web typecheck failed & exit /b 1 )
call npm run build
if errorlevel 1 ( echo [FAIL] Web build failed & exit /b 1 )
cd ..

echo.
echo [3/3] Checking Mobile (Flutter / Dart)...
cd mobile
set DART_BIN=dart
where dart >nul 2>nul
if errorlevel 1 (
  set "DART_BIN=C:\Users\sadra\AppData\Local\Microsoft\WinGet\Packages\Google.DartSDK_Microsoft.Winget.Source_8wekyb3d8bbwe\dart-sdk\bin\dart.exe"
)
call "!DART_BIN!" test
if errorlevel 1 ( echo [FAIL] Dart test failed & exit /b 1 )
call "!DART_BIN!" analyze lib/models lib/services test
if errorlevel 1 ( echo [FAIL] Dart analyze failed & exit /b 1 )
cd ..

echo.
echo ==========================================
echo [SUCCESS] ALL CHECKS PASSED ACROSS ALL THREE STACKS
echo ==========================================
