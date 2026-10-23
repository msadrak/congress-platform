#!/usr/bin/env node
/**
 * `caddy validate` of deploy/staging/Caddyfile in every edge mode the stack is run in:
 *
 *   node scripts/ci/validate-caddyfile.mjs
 *
 * The Caddyfile imports /etc/caddy/options/<switch>-<on|off>.caddy from deploy/staging/caddy/ (as
 * deploy/web/Dockerfile copies them) and reads CONGRESS_* variables (deploy/staging/compose.yaml). Each mode
 * runs the official caddy image (CONGRESS_CADDY_IMAGE, default caddy:2-alpine) with those files mounted
 * read-only, no network and the mode's environment. Needs Docker.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMAGE = process.env.CONGRESS_CADDY_IMAGE ?? 'caddy:2-alpine';

const MODES = {
  // compose.yaml defaults: https://localhost with Caddy's own CA plus plain http://localhost.
  'local staging': {},
  'LAN access by IP': { CONGRESS_SITE_ADDRESS: 'https://localhost, https://192.168.1.10', CONGRESS_DEFAULT_SNI: '192.168.1.10' },
  'hosted domain': {
    CONGRESS_SITE_ADDRESS: 'congress.example.org', CONGRESS_TLS: 'ops@example.org', CONGRESS_LOCAL_HTTP: 'off',
    CONGRESS_HSTS: 'on', CONGRESS_ADMIN_ALLOW: '127.0.0.1/32', CONGRESS_DEFAULT_SNI: 'congress.example.org',
  },
  'behind a CDN, plain-HTTP origin': {
    CONGRESS_SITE_ADDRESS: 'http://congress.example.org', CONGRESS_LOCAL_HTTP: 'off', CONGRESS_ORIGIN_TLS: 'off',
    CONGRESS_CDN: 'on', CONGRESS_CDN_ONLY: 'on', CONGRESS_TRUSTED_PROXIES: '185.208.173.0/24 2.144.23.191/32',
    CONGRESS_CLIENT_IP_HEADER: 'X-Forwarded-For', CONGRESS_ADMIN_ALLOW: '127.0.0.1/32',
  },
  'behind a CDN, HTTPS origin': {
    CONGRESS_SITE_ADDRESS: 'congress.example.org', CONGRESS_TLS: 'ops@example.org', CONGRESS_LOCAL_HTTP: 'off',
    CONGRESS_HSTS: 'on', CONGRESS_CDN: 'on', CONGRESS_TRUSTED_PROXIES: '185.208.173.0/24',
  },
};

let failed = 0;
for (const [mode, env] of Object.entries(MODES)) {
  const result = run('docker', [
    'run', '--rm', '--network', 'none',
    '-v', `${resolve(root, 'deploy/staging/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
    '-v', `${resolve(root, 'deploy/staging/caddy')}:/etc/caddy/options:ro`,
    ...Object.entries(env).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    IMAGE, 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile',
  ], { allowFail: true });
  const ok = result.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'valid  ' : 'INVALID'} ${mode}`);
  if (!ok) console.log(String(result.stderr || result.stdout).trim().split('\n').slice(-8).join('\n'));
}
process.exit(failed ? 1 : 0);
