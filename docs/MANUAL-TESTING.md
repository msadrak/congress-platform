# Local demo for manual product review

A persistent, localhost-only environment with synthetic data, for clicking through every portal in a browser.
It is separate from the automated checks (`scripts/check.*`, `scripts/integration`), which create and destroy their own
environments.

## Commands (Windows PowerShell, from the repository root)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\start.ps1    # start or restart everything
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\status.ps1   # what is running, and how much data
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\stop.ps1     # stop; the database and its data are KEPT
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\credentials.ps1 -CopyScannerToken main   # clipboard, never printed
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\reset.ps1 -ConfirmDatabase congress_demo  # DESTRUCTIVE, explicit
```

Prerequisites: Docker Desktop running, `cd backend; uv sync`, `cd web; npm ci`.

## What `start.ps1` does

1. Starts (or creates) the Docker container `congress-demo-pg` (PostgreSQL 16, database `congress_demo`) bound to
   `127.0.0.1`, with the data in the Docker volume `congress-demo-pgdata`. Nothing else in Docker is touched.
2. Applies Alembic migrations to that database only.
3. Starts FastAPI and the Vite dev server (`web/vite.demo.config.ts`) as hidden background processes on free
   `127.0.0.1` ports (preferred: API 8100, web 5190, database 55432; the actual ports are printed). They keep
   running after the terminal is closed.
4. Runs `backend/seed_demo.py`, which uses the public HTTP API and does nothing when the demo data already exists.
5. Waits for health and prints the URLs.

`stop.ps1` stops only the processes it started (matched by pid and command line) and the demo container. It never
removes the volume. `reset.ps1` verifies the container label, the volume and `current_database()` before deleting
the container, the volume and the local credential files; without `-ConfirmDatabase congress_demo` it only reports.

## Where the logins and URLs are

`.demo/DEMO-GUIDE.md` (generated on every start with the real ports, ids, accounts, test badges and the checklist) and
`.demo/credentials.json`. The `.demo/` directory is gitignored; scanner tokens are only copied to the clipboard.
All people, companies and addresses are synthetic (`example.com`).

## Not verified by this environment

Camera decoding and USB HID reader input (the scanner and badge capture are exercised by typing codes), real e-mail
delivery (none exists), production build / service-worker behaviour (the dev server is used).
