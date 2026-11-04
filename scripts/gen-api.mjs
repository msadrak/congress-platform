#!/usr/bin/env node
/**
 * Regenerates web/src/api/schema.d.ts from the backend's OpenAPI document.
 *
 *   cd web && npm run gen:api          # rewrite the file
 *   node scripts/gen-api.mjs --check   # exit 1 if the file is stale; writes nothing
 *
 * Run it after any change to a backend route, request or response model; CI and scripts/check.*
 * run --check. No database or server is needed: the app is built in development mode with throwaway
 * secrets only to read its schema. Without uv on PATH the schema is read inside the backend test-runner image
 * (scripts/lib/backend-image.mjs, built on first use) with backend/ mounted read-only and no network.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBackendTestImage } from './lib/backend-image.mjs';
import { run } from './lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'web/src/api/schema.d.ts');
const check = process.argv.includes('--check');

const EXPORT_SCHEMA = 'import json, sys\nfrom app.main import create_app_from_env\njson.dump(create_app_from_env().openapi(), sys.stdout)';
const exportEnv = {
  CONGRESS_ENVIRONMENT: 'development',
  CONGRESS_PLATFORM_ADMIN_TOKEN: 'schema-export',
  CONGRESS_JWT_SECRET: 'schema-export-only-secret-0123456789abcdef',
  PYTHONUTF8: '1',
};
const hasUv = run('uv', ['--version'], { allowFail: true }).status === 0;

const schema = hasUv
  ? run('uv', ['run', '--quiet', 'python', '-c', EXPORT_SCHEMA], { cwd: resolve(root, 'backend'), env: exportEnv }).stdout
  : run('docker', [
    'run', '--rm', '--network', 'none', '-v', `${resolve(root, 'backend')}:/src:ro`, '-w', '/src',
    ...Object.entries(exportEnv).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    ensureBackendTestImage(), '/app/.venv/bin/python', '-c', EXPORT_SCHEMA,
  ]).stdout;

const dir = mkdtempSync(join(tmpdir(), 'congress-openapi-'));
try {
  const spec = join(dir, 'openapi.json');
  const out = check ? join(dir, 'schema.d.ts') : target;
  writeFileSync(spec, schema);
  run(process.execPath, [resolve(root, 'web/node_modules/openapi-typescript/bin/cli.js'), spec, '-o', out], {
    stdio: check ? 'pipe' : 'inherit',
  });
  if (check) {
    const lf = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    if (lf(out) !== lf(target)) {
      console.error('web/src/api/schema.d.ts is stale: run `cd web && npm run gen:api` and commit the result.');
      process.exitCode = 1;
    } else {
      console.log('web/src/api/schema.d.ts matches the backend.');
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
