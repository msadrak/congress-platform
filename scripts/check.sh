#!/usr/bin/env bash
# Full-stack verification (macOS, Linux, Windows Git Bash): backend mypy + pytest, API schema, web tests, typecheck,
# lint and build, mobile tests and analysis. Every check runs or the script fails; a missing tool falls back to
# Docker where it can, never to a skip.
#   Backend: Docker -> scripts/integration/backend-tests.mjs (disposable PostgreSQL); else local uv + PostgreSQL on
#            127.0.0.1:5433 (backend/tests/conftest.py).
#   Dart:    `dart` on PATH, the WinGet Dart SDK, else the dart image (CONGRESS_DART_IMAGE, default dart:stable).
set -euo pipefail

# Run from the repository root wherever this is started from (also when installed as .git/hooks/pre-commit).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))"
cd "$REPO_ROOT"

# User-level tool locations that login shells add but hooks and IDEs often do not (uv, dart).
USER_DIR="${USERPROFILE:-${HOME:-}}"
USER_DIR="${USER_DIR//\\//}"
if [ -n "$USER_DIR" ]; then
  export PATH="$PATH:$USER_DIR/.local/bin:$USER_DIR/.cargo/bin"
fi

have() { command -v "$1" > /dev/null 2>&1; }
HAVE_DOCKER=0
if have docker && docker info > /dev/null 2>&1; then HAVE_DOCKER=1; fi

echo "=========================================="
echo "Congress Platform: Full-Stack Verification"
echo "=========================================="

# 1. Backend Verification
echo ""
echo "[1/3] Checking Backend (Python / FastAPI)..."
if [ "$HAVE_DOCKER" = 1 ]; then
  # Preferred: mypy + pytest on disposable Docker PostgreSQL with a steady clock (same as check.bat).
  node scripts/integration/backend-tests.mjs
elif have uv; then
  cd backend
  echo "  -> Running strict mypy..."
  uv run mypy
  echo "  -> Running pytest suite..."
  uv run pytest -q
  cd ..
else
  echo "[FAIL] The backend checks need Docker (preferred) or uv with PostgreSQL on 127.0.0.1:5433." >&2
  exit 1
fi
echo "  -> Checking web/src/api/schema.d.ts against the backend..."
if [ ! -d web/node_modules ]; then (cd web && npm ci --no-audit --no-fund); fi
node scripts/gen-api.mjs --check

# 2. Web Verification
echo ""
echo "[2/3] Checking Web (React / TypeScript)..."
cd web
echo "  -> Running unit tests..."
npm test
echo "  -> Running TypeScript typecheck..."
npm run typecheck
echo "  -> Running oxlint..."
npm run lint
echo "  -> Running production Vite build..."
npm run build
cd ..

# 3. Mobile Verification
echo ""
echo "[3/3] Checking Mobile (Flutter / Dart)..."
DART_BIN=""
if have dart; then
  DART_BIN="dart"
elif [ -n "${LOCALAPPDATA:-}" ]; then
  for candidate in "${LOCALAPPDATA//\\//}"/Microsoft/WinGet/Packages/Google.DartSDK_*/dart-sdk/bin/dart.exe; do
    if [ -f "$candidate" ]; then DART_BIN="$candidate"; break; fi
  done
fi

if [ -n "$DART_BIN" ]; then
  cd mobile
  echo "  -> Running Dart unit tests..."
  "$DART_BIN" test
  echo "  -> Running Dart static analysis..."
  "$DART_BIN" analyze lib/models lib/services test
  cd ..
elif [ "$HAVE_DOCKER" = 1 ]; then
  DART_IMAGE="${CONGRESS_DART_IMAGE:-dart:stable}"
  echo "  -> dart is not on PATH; running the Dart checks in $DART_IMAGE..."
  # mobile/ is mounted read-only and copied inside, so nothing is written to the checkout; the pub cache is a
  # named volume so packages are downloaded once. pwd -W gives Git Bash a Windows path Docker understands.
  MOBILE_DIR="$(cd mobile && (pwd -W 2> /dev/null || pwd))"
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$MOBILE_DIR:/src:ro" -v congress-dart-pub-cache:/root/.pub-cache \
    "$DART_IMAGE" sh -euc 'cp -R /src /mobile && rm -rf /mobile/.dart_tool && cd /mobile && dart pub get \
      && echo "  -> Running Dart unit tests..." && dart test \
      && echo "  -> Running Dart static analysis..." && dart analyze lib/models lib/services test'
else
  echo "[FAIL] The mobile checks need the Dart SDK on PATH or Docker." >&2
  exit 1
fi

echo ""
echo "=========================================="
echo "✓ ALL CHECKS PASSED ACROSS ALL THREE STACKS"
echo "=========================================="
