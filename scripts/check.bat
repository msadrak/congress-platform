@echo off
setlocal enabledelayedexpansion

echo ==========================================
echo Congress Platform: Full-Stack Verification
echo ==========================================

echo.
echo [1/3] Checking Backend (Python / FastAPI)...
cd backend
call uv run mypy
if errorlevel 1 ( echo [FAIL] Backend mypy failed & exit /b 1 )
call uv run pytest -q
if errorlevel 1 ( echo [FAIL] Backend pytest failed & exit /b 1 )
cd ..

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
