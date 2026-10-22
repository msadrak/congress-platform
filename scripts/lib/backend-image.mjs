/**
 * The backend test-runner image shared by scripts/integration/*.mjs (and scripts/gen-api.mjs without uv).
 *
 * `backendImage()` returns CONGRESS_E2E_BACKEND_IMAGE when set (used as is; it must provide Python 3.11 and
 * uv). Otherwise it returns `congress-backend-test:<hash>`, built from scripts/integration/backend-test.Dockerfile
 * with backend/ as context when no image of that tag exists yet. The tag is a hash of the Dockerfile,
 * backend/pyproject.toml and backend/uv.lock, so a fresh machine builds it once and a lock change builds a new
 * one; nothing is ever pulled under that name. The build is retried because the package index is reached over a
 * flaky network.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DOCKERFILE = resolve(root, 'scripts/integration/backend-test.Dockerfile');
const INPUTS = [DOCKERFILE, resolve(root, 'backend/pyproject.toml'), resolve(root, 'backend/uv.lock')];
const BUILD_ATTEMPTS = 3;

/** `congress-backend-test:<12 hex>` for the current Dockerfile and lock file (CRLF-insensitive). */
export function backendImageTag() {
  const hash = createHash('sha256');
  for (const file of INPUTS) hash.update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).update('\0');
  return `congress-backend-test:${hash.digest('hex').slice(0, 12)}`;
}

/** The image to run the backend in: the override, or the hashed test image (built here if missing). */
export function backendImage() {
  return process.env.CONGRESS_E2E_BACKEND_IMAGE || ensureBackendTestImage();
}

/** The hashed test image, built here if missing; ignores CONGRESS_E2E_BACKEND_IMAGE. */
export function ensureBackendTestImage() {
  const tag = backendImageTag();
  if (run('docker', ['image', 'inspect', tag], { allowFail: true }).status === 0) return tag;
  // Bare --build-arg NAME passes the variable from this environment, when set (backend/Dockerfile's proxy args).
  const proxyArgs = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'].filter((name) => process.env[name]).flatMap((name) => ['--build-arg', name]);
  for (let attempt = 1; ; attempt++) {
    console.log(`building ${tag} from scripts/integration/backend-test.Dockerfile (attempt ${attempt}/${BUILD_ATTEMPTS}) …`);
    const build = run('docker', ['build', '-f', DOCKERFILE, '-t', tag, ...proxyArgs, resolve(root, 'backend')], { allowFail: true, stdio: 'inherit' });
    if (build.status === 0) return tag;
    if (attempt === BUILD_ATTEMPTS) throw new Error(`docker build of ${tag} failed ${BUILD_ATTEMPTS} times`);
  }
}

/**
 * Runs `uv sync --frozen` inside a runner container, retried. The hashed image already holds the locked dependencies,
 * so this is a no-op unless an override image predates the lock file.
 */
export function syncBackendDependencies(container, extra = []) {
  for (let attempt = 1; ; attempt++) {
    const sync = run('docker', ['exec', '-e', 'UV_PROJECT_ENVIRONMENT=/app/.venv', '-e', 'UV_HTTP_TIMEOUT=120', '-w', '/app', container, 'uv', 'sync', '--frozen', '--quiet', ...extra], { allowFail: true, stdio: 'inherit' });
    if (sync.status === 0) return;
    if (attempt === BUILD_ATTEMPTS) throw new Error(`uv sync in ${container} failed ${BUILD_ATTEMPTS} times`);
    console.log(`uv sync attempt ${attempt} failed; retrying …`);
  }
}
