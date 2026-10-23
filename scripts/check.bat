@echo off
rem Full-stack verification (Windows CMD / PowerShell); same checks as scripts/check.sh. Every check runs or the
rem script fails; a missing tool falls back to Docker where it can, never to a skip.
rem   Backend: Docker -> scripts\integration\backend-tests.mjs (disposable PostgreSQL); else local uv + PostgreSQL
rem            on 127.0.0.1:5433 (backend\tests\conftest.py).
rem   Dart:    dart on PATH, the WinGet Dart SDK, else the dart image (CONGRESS_DART_IMAGE, default dart:stable).
setlocal enabledelayedexpansion

rem Run from the repository root wherever this is started from.
cd /d "%~dp0.."
rem User-level tool locations (uv installs to .local\bin or .cargo\bin) that new terminals may not have yet.
set "PATH=%PATH%;%USERPROFILE%\.local\bin;%USERPROFILE%\.cargo\bin"

set HAVE_DOCKER=0
docker info >nul 2>nul
if not errorlevel 1 set HAVE_DOCKER=1

echo ==========================================
echo Congress Platform: Full-Stack Verification
echo ==========================================

echo.
echo [1/3] Checking Backend (Python / FastAPI)...
rem Preferred: mypy + pytest on disposable Docker infrastructure with a steady clock
rem (the WSL runner's clock oscillates and causes spurious JWT 401s; see scripts\integration\backend-tests.mjs).
if "%HAVE_DOCKER%"=="1" (
  call node scripts\integration\backend-tests.mjs
  if errorlevel 1 ( echo [FAIL] Backend mypy/pytest failed & exit /b 1 )
  goto schema
)

where uv >nul 2>nul
if errorlevel 1 ( echo [FAIL] The backend checks need Docker ^(preferred^) or uv with PostgreSQL on 127.0.0.1:5433 & exit /b 1 )
cd backend
call uv run mypy
if errorlevel 1 ( echo [FAIL] Backend mypy failed & exit /b 1 )
call uv run pytest -q
if errorlevel 1 ( echo [FAIL] Backend pytest failed & exit /b 1 )
cd ..

:schema
if not exist web\node_modules (
  pushd web
  call npm ci --no-audit --no-fund
  if errorlevel 1 ( echo [FAIL] npm ci failed & exit /b 1 )
  popd
)
call node scripts\gen-api.mjs --check
if errorlevel 1 ( echo [FAIL] web\src\api\schema.d.ts is stale & exit /b 1 )
echo.
echo [2/3] Checking Web (React / TypeScript)...
cd web
call npm test
if errorlevel 1 ( echo [FAIL] Web test failed & exit /b 1 )
call npm run typecheck
if errorlevel 1 ( echo [FAIL] Web typecheck failed & exit /b 1 )
call npm run lint
if errorlevel 1 ( echo [FAIL] Web lint failed & exit /b 1 )
call npm run build
if errorlevel 1 ( echo [FAIL] Web build failed & exit /b 1 )
cd ..

echo.
echo [3/3] Checking Mobile (Flutter / Dart)...
set "DART_BIN="
where dart >nul 2>nul
if not errorlevel 1 set "DART_BIN=dart"
if not defined DART_BIN (
  for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.DartSDK_*") do (
    if exist "%%~D\dart-sdk\bin\dart.exe" set "DART_BIN=%%~D\dart-sdk\bin\dart.exe"
  )
)

if defined DART_BIN (
  cd mobile
  call "!DART_BIN!" test
  if errorlevel 1 ( echo [FAIL] Dart test failed & exit /b 1 )
  call "!DART_BIN!" analyze lib/models lib/services test
  if errorlevel 1 ( echo [FAIL] Dart analyze failed & exit /b 1 )
  cd ..
  goto done
)

if not "%HAVE_DOCKER%"=="1" ( echo [FAIL] The mobile checks need the Dart SDK on PATH or Docker & exit /b 1 )
if not defined CONGRESS_DART_IMAGE set "CONGRESS_DART_IMAGE=dart:stable"
echo   -^> dart is not on PATH; running the Dart checks in !CONGRESS_DART_IMAGE!...
rem mobile\ is mounted read-only and copied inside, so nothing is written to the checkout; the pub cache is a named
rem volume so packages are downloaded once.
docker run --rm -v "%CD%\mobile:/src:ro" -v congress-dart-pub-cache:/root/.pub-cache "!CONGRESS_DART_IMAGE!" sh -euc "cp -R /src /mobile && rm -rf /mobile/.dart_tool && cd /mobile && dart pub get && dart test && dart analyze lib/models lib/services test"
if errorlevel 1 ( echo [FAIL] Dart test/analyze failed & exit /b 1 )

:done
echo.
echo ==========================================
echo [SUCCESS] ALL CHECKS PASSED ACROSS ALL THREE STACKS
echo ==========================================
