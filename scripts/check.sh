#!/usr/bin/env bash
set -euo pipefail

# Ensure standard user bin paths are on PATH across POSIX and Windows Git Bash
USER_DIR="${USERPROFILE:-${HOME:-/c/Users/sadra}}"
USER_DIR="${USER_DIR//\\//}"
export PATH="$PATH:$USER_DIR/.local/bin:$USER_DIR/AppData/Local/Microsoft/WinGet/Packages/Google.DartSDK_Microsoft.Winget.Source_8wekyb3d8bbwe/dart-sdk/bin"

echo "=========================================="
echo "Congress Platform: Full-Stack Verification"
echo "=========================================="

# 1. Backend Verification
echo ""
echo "[1/3] Checking Backend (Python / FastAPI)..."
cd backend
echo "  -> Running strict mypy..."
uv run mypy
echo "  -> Running pytest suite..."
uv run pytest -q
cd ..

# 2. Web Verification
echo ""
echo "[2/3] Checking Web (React / TypeScript)..."
cd web
echo "  -> Running unit tests..."
npm test
echo "  -> Running TypeScript typecheck..."
npm run typecheck
echo "  -> Running production Vite build..."
npm run build
cd ..

# 3. Mobile Verification
echo ""
echo "[3/3] Checking Mobile (Flutter / Dart)..."
cd mobile
DART_BIN="dart"
if ! command -v dart &> /dev/null; then
  WINGET_DART="$USER_DIR/AppData/Local/Microsoft/WinGet/Packages/Google.DartSDK_Microsoft.Winget.Source_8wekyb3d8bbwe/dart-sdk/bin/dart.exe"
  if [ -f "$WINGET_DART" ]; then
    DART_BIN="$WINGET_DART"
  fi
fi

echo "  -> Running Dart unit tests..."
"$DART_BIN" test
echo "  -> Running Dart static analysis..."
"$DART_BIN" analyze lib/models lib/services test
cd ..

echo ""
echo "=========================================="
echo "✓ ALL CHECKS PASSED ACROSS ALL THREE STACKS"
echo "=========================================="
