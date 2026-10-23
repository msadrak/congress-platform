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
 *
 * Then a live probe (local staging mode, still without a network; requests are sent from inside the container):
 * pass-link codes and scanner pairing tokens never reach the access logs, neither in the URL nor in a Referer
 * header; pages with a credential in their URL send no Referer; every response, including the 502 Caddy answers
 * while the API is unreachable, carries an X-Request-ID that is also in the access log.
 */
import { randomBytes } from 'node:crypto';
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

const mounts = [
  '-v', `${resolve(root, 'deploy/staging/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
  '-v', `${resolve(root, 'deploy/staging/caddy')}:/etc/caddy/options:ro`,
];

let failed = 0;
for (const [mode, env] of Object.entries(MODES)) {
  const result = run('docker', [
    'run', '--rm', '--network', 'none',
    ...mounts,
    ...Object.entries(env).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    IMAGE, 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile',
  ], { allowFail: true });
  const ok = result.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'valid  ' : 'INVALID'} ${mode}`);
  if (!ok) console.log(String(result.stderr || result.stdout).trim().split('\n').slice(-8).join('\n'));
}

/** Runs Caddy in local staging mode, sends the requests from inside its container, and checks its access log. */
function logProbe() {
  const CODE = `probecode${randomBytes(4).toString('hex')}`;
  const TOKEN = `probetoken${randomBytes(4).toString('hex')}`;
  const CLIENT_ID = `probe-client-${randomBytes(4).toString('hex')}`;
  const name = `caddy-logprobe-${randomBytes(3).toString('hex')}`;
  const problems = [];
  run('docker', ['run', '-d', '--name', name, '--network', 'none', ...mounts, IMAGE, 'caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);
  try {
    // busybox wget; 4xx/5xx answers are expected (no files, no API) and are still logged.
    const get = (path, headers = {}) => run('docker', ['exec', name, 'wget', '-q', '-O', '/dev/null', '-T', '30',
      ...Object.entries(headers).flatMap(([k, v]) => ['--header', `${k}: ${v}`]), `http://localhost${path}`], { allowFail: true });
    for (let i = 0; i < 50 && /refused|can't connect/i.test(get('/ready-probe').stderr ?? ''); i++) run('sleep', ['0.2']);
    get(`/t/${CODE}`, { Referer: `http://localhost/t/${CODE}` });
    get(`/scan/point-1?token=${TOKEN}`, { Referer: `http://localhost/scan/point-1?token=${TOKEN}` });
    get('/assets/app.js', { Referer: `http://localhost/t/${CODE}` });
    get('/', { 'X-Request-ID': CLIENT_ID });
    // No API container: Caddy answers 502 itself (after lb_try_duration).
    get('/api/health', { Referer: `http://localhost/scan/point-1?token=${TOKEN}` });
    const log = run('docker', ['logs', name], { allowFail: true });
    const raw = `${log.stdout}\n${log.stderr}`.split('\n').filter((l) => l.includes('"http.log.access'));
    for (const secret of [CODE, TOKEN]) {
      if (raw.some((l) => l.includes(secret))) problems.push(`${secret === CODE ? 'a pass-link code' : 'a pairing token'} reached the access log`);
    }
    const lines = raw.map((l) => JSON.parse(l));
    const find = (path) => lines.find((l) => String(l.request?.uri).split('?')[0] === path);
    const respHeader = (line, field) => Object.entries(line?.resp_headers ?? {}).find(([k]) => k.toLowerCase() === field.toLowerCase())?.[1]?.join(', ');
    const pass = find('/t/-');
    if (!pass || pass.logger !== 'http.log.access.short_links') problems.push('no short_links line with the code replaced by /t/-');
    if (respHeader(pass, 'Referrer-Policy') !== 'no-referrer') problems.push(`/t/<code> Referrer-Policy: ${respHeader(pass, 'Referrer-Policy')}`);
    const scan = find('/scan/point-1');
    if (respHeader(scan, 'Referrer-Policy') !== 'no-referrer') problems.push(`/scan/<point> Referrer-Policy: ${respHeader(scan, 'Referrer-Policy')}`);
    const home = find('/');
    if (respHeader(home, 'Referrer-Policy') !== 'strict-origin-when-cross-origin') problems.push(`/ Referrer-Policy: ${respHeader(home, 'Referrer-Policy')}`);
    if (respHeader(home, 'X-Request-ID') !== CLIENT_ID || home?.request_id !== CLIENT_ID) problems.push('a well-formed client request id was not kept');
    const down = find('/api/health');
    if (down?.status !== 502) problems.push(`/api/health without an API: expected 502, got ${down?.status}`);
    const downId = respHeader(down, 'X-Request-ID');
    if (!downId || !/^[A-Za-z0-9._:-]{8,128}$/.test(downId) || down?.request_id !== downId) problems.push(`the 502 carries no request id matching its log line (${downId} / ${down?.request_id})`);
    if (lines.some((l) => Object.keys(l.request?.headers ?? {}).some((h) => /^(referer|authorization|x-admin-token)$/i.test(h)))) problems.push('a Referer/Authorization/X-Admin-Token header was logged');
  } finally {
    run('docker', ['rm', '-f', name], { allowFail: true });
  }
  return problems;
}

const probe = logProbe();
console.log(`${probe.length ? 'FAILED ' : 'passed '} log/referrer/request-id probe`);
for (const p of probe) console.log(`  - ${p}`);
process.exit(failed || probe.length ? 1 : 0);
