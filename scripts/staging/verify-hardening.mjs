#!/usr/bin/env node
/**
 * Milestone 10 verification against the running local staging stack (project congress-staging):
 *
 *   node scripts/staging/verify-hardening.mjs
 *
 * 1. Organizer key lifecycle through the operator CLI (inside the API container, never via the proxy).
 * 2. Failed-login throttling through Caddy (real client address path).
 * 3. Hosted-mode Caddy configuration in a throw-away web container on the staging network:
 *    HTTP→HTTPS redirect, HSTS, admin API not reachable from outside, no localhost HTTP site.
 * 4. Scheduled backup with an off-host copy to a controlled S3-compatible endpoint (rclone serve s3 in a
 *    throw-away container — NOT a real external provider), failure reporting, retention, health check.
 * Every container/network/volume created here is named congress-hardening-* and removed at the end.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/process.mjs';
import { compose, readEnv, smsCode } from './stack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const env = readEnv();
const HTTP_BASE = `http://localhost:${env.CONGRESS_HTTP_PORT || 18080}`;
const OUT = resolve(root, 'docs/deployment/hardening-evidence');
const RUN = randomBytes(3).toString('hex');
const SIM = `congress-hardening-web-${RUN}`, S3 = `congress-hardening-s3-${RUN}`, NET = `congress-hardening-net-${RUN}`;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = async (name, fn) => {
  try { const note = await fn(); results.push({ ok: true, name, note: note ?? null }); console.log(`PASS ${name}${note ? ` — ${note}` : ''}`); }
  catch (e) { results.push({ ok: false, name, error: String(e.message).split('\n')[0] }); console.log(`FAIL ${name} — ${String(e.message).split('\n')[0]}`); }
};
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); };
const assert = (c, m) => { if (!c) throw new Error(m); };
const stack = (args, extraEnv = {}) => run(process.execPath, [join(root, 'scripts/staging/stack.mjs'), ...args], { allowFail: true, env: extraEnv });
const api = async (method, path, { key, body } = {}) => {
  const r = await fetch(HTTP_BASE + path, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json, headers: r.headers };
};
const raw = (port, { host, path = '/', tls = false, servername } = {}) =>
  new Promise((ok, fail) => {
    const mod = tls ? https : { request: (o, cb) => import('node:http').then((h) => h.request(o, cb)) };
    const opts = { host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host }, agent: false, ...(tls ? { servername, rejectUnauthorized: false } : {}) };
    Promise.resolve(mod.request(opts, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b })); })).then((req) => { req.on('error', fail); req.end(); });
  });

try {
  // ── 1. Organizer key lifecycle via the operator CLI ──
  await check('01 organizer create / rotate / revoke through the operator CLI (key shown once, old key dead at once)', async () => {
    const created = stack(['organizer', 'create', `Hardening Organizer ${RUN}`]);
    assert(created.status === 0, created.stderr);
    const org = JSON.parse(created.stdout.slice(created.stdout.indexOf('{'), created.stdout.lastIndexOf('}') + 1));
    eq((await api('GET', '/api/events', { key: org.api_key })).status, 200, 'new key');
    const rotated = stack(['organizer', 'rotate', org.id]);
    const next = JSON.parse(rotated.stdout.slice(rotated.stdout.indexOf('{'), rotated.stdout.lastIndexOf('}') + 1));
    eq((await api('GET', '/api/events', { key: org.api_key })).status, 401, 'old key after rotation');
    eq((await api('GET', '/api/events', { key: next.api_key })).status, 200, 'rotated key');
    assert(stack(['organizer', 'revoke', org.id]).status === 0, 'revoke');
    eq((await api('GET', '/api/events', { key: next.api_key })).status, 401, 'revoked key');
    const list = stack(['organizer', 'list']).stdout;
    assert(!list.includes(org.api_key) && !list.includes(next.api_key) && !list.includes('api_key_hash'), 'list leaks a secret');
    const logs = compose('congress-staging', ['logs', '--no-color', 'api', 'web']).stdout;
    assert(!logs.includes(org.api_key) && !logs.includes(next.api_key) && !logs.includes(env.CONGRESS_PLATFORM_ADMIN_TOKEN), 'secret in logs');
    return `organizer ${org.id.slice(0, 8)}…: create 200, rotate → old 401 / new 200, revoke → 401; no keys in list or logs`;
  });

  // ── 2. Throttling through the proxy ──
  await check('02 repeated wrong SMS codes through Caddy are throttled (429 + Retry-After); other numbers unaffected', async () => {
    // Synthetic numbers in the unassigned 0900 range (staging must run CONGRESS_SMS_PROVIDER=console).
    const number = `0900888${String(parseInt(RUN, 16) % 10000).padStart(4, '0')}`;
    eq((await api('POST', '/api/auth/otp/request', { body: { mobile: number } })).status, 202, 'code requested');
    const real = smsCode(number);
    const wrong = real === '000000' ? '111111' : '000000';
    const codes = [];
    for (let i = 0; i < 10; i++) codes.push((await api('POST', '/api/auth/otp/verify', { body: { mobile: number, code: wrong } })).status);
    const locked = await api('POST', '/api/auth/otp/verify', { body: { mobile: number, code: real } });
    eq(codes, Array(10).fill(401), 'failures');
    eq(locked.status, 429, 'locked');
    assert(Number(locked.headers.get('retry-after')) > 0, 'retry-after');
    const other = `0900777${String(parseInt(RUN, 16) % 10000).padStart(4, '0')}`;
    eq((await api('POST', '/api/auth/otp/request', { body: { mobile: other } })).status, 202, 'other number code');
    eq((await api('POST', '/api/auth/otp/verify', { body: { mobile: other, code: smsCode(other) } })).status, 200, 'other number');
    return `10×401 then 429 (Retry-After ${locked.headers.get('retry-after')} s); another number still signs in`;
  });

  // ── 3. Hosted-mode Caddy simulation ──
  await check('03 hosted-mode edge: HTTP→HTTPS redirect, HSTS, admin API closed to outside, no localhost site', async () => {
    run('docker', ['run', '-d', '--name', SIM, '--network', 'congress-staging_backend',
      '-e', 'CONGRESS_SITE_ADDRESS=congress.example.test', '-e', 'CONGRESS_TLS=internal', // ACME is not exercised offline
      '-e', 'CONGRESS_LOCAL_HTTP=off', '-e', 'CONGRESS_HSTS=on', '-e', 'CONGRESS_ADMIN_ALLOW=127.0.0.1/32',
      '-p', '127.0.0.1:18091:80', '-p', '127.0.0.1:18491:443', 'congress-platform/web:staging']);
    run('docker', ['network', 'connect', 'congress-staging_edge', SIM]);
    for (let i = 0; i < 40; i++) { try { await raw(18491, { tls: true, host: 'congress.example.test', servername: 'congress.example.test', path: '/api/health' }); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
    const http = await raw(18091, { host: 'congress.example.test', path: '/e/x?y=1' });
    assert([301, 308].includes(http.status) && http.headers.location === 'https://congress.example.test/e/x?y=1', `redirect ${http.status} ${http.headers.location}`);
    const page = await raw(18491, { tls: true, host: 'congress.example.test', servername: 'congress.example.test', path: '/' });
    eq(page.status, 200, 'https page');
    eq(page.headers['strict-transport-security'], 'max-age=31536000', 'hsts');
    const ready = await raw(18491, { tls: true, host: 'congress.example.test', servername: 'congress.example.test', path: '/api/ready' });
    eq(ready.status, 200, 'api via hosted edge');
    const admin = await raw(18491, { tls: true, host: 'congress.example.test', servername: 'congress.example.test', path: '/api/organizers' });
    eq(admin.status, 404, 'admin from outside');
    const local = await raw(18091, { host: 'localhost', path: '/' });
    assert(!local.body.includes('<div id="root">'), 'localhost HTTP site still served in hosted mode');
    const adapted = run('docker', ['exec', SIM, 'caddy', 'adapt', '--config', '/etc/caddy/Caddyfile']).stdout;
    writeFileSync(join(OUT, 'hosted-caddy-adapted.json'), adapted);
    return `http ${http.status} → ${http.headers.location}; HSTS on; /api/organizers 404 from outside; /api/ready 200`;
  });

  // ── 4. Scheduled backup with an off-host copy (controlled S3-compatible stand-in) ──
  const s3env = {
    BACKUP_S3_ENDPOINT: `http://${S3}:8080`, BACKUP_S3_BUCKET: 'congress-backups', BACKUP_S3_PREFIX: 'staging',
    BACKUP_S3_ACCESS_KEY_ID: `ak${RUN}`, BACKUP_S3_SECRET_ACCESS_KEY: randomBytes(16).toString('hex'), BACKUP_RCLONE_NETWORK: NET,
  };
  await check('04 failed off-host upload is reported (exit 1, last-backup.json ok=false, check CRITICAL)', async () => {
    run('docker', ['network', 'create', NET]);
    run('docker', ['run', '-d', '--name', S3, '--network', NET, '-v', `${S3}-data:/data`, 'rclone/rclone:1.68', 'serve', 's3', '--addr', ':8080', '--auth-key', `${s3env.BACKUP_S3_ACCESS_KEY_ID},${s3env.BACKUP_S3_SECRET_ACCESS_KEY}`, '/data']);
    run('docker', ['exec', S3, 'mkdir', '-p', '/data/congress-backups']);
    const bad = stack(['scheduled-backup'], { ...s3env, BACKUP_S3_SECRET_ACCESS_KEY: 'wrong-secret' });
    eq(bad.status, 1, 'exit code');
    const status = JSON.parse(readFileSync(join(root, '.staging/backups/last-backup.json'), 'utf8'));
    eq(status.ok, false, 'status ok');
    const health = stack(['check']);
    assert(health.status === 2 && /last scheduled backup FAILED/.test(health.stdout), `check exit ${health.status}`);
    return `error recorded: ${status.error.slice(0, 80)}`;
  });

  await check('05 scheduled backup: consistent dump + media, copied off-host and verified by checksum; check OK', async () => {
    const good = stack(['scheduled-backup'], s3env);
    assert(good.status === 0, good.stdout.slice(-400) + good.stderr.slice(-400));
    const status = JSON.parse(readFileSync(join(root, '.staging/backups/last-backup.json'), 'utf8'));
    assert(status.ok && status.offsite.endsWith(status.name), JSON.stringify(status));
    const manifest = JSON.parse(readFileSync(join(root, '.staging/backups', status.name, 'manifest.json'), 'utf8'));
    eq(manifest.missing_media, [], 'consistency');
    const remote = run('docker', ['exec', S3, 'sh', '-c', `cd /data/congress-backups/staging/${status.name} && sha256sum db.dump media.tar.gz`]).stdout.trim().split('\n').map((l) => l.split(/\s+/));
    eq(Object.fromEntries(remote.map(([sum, f]) => [f, sum])), manifest.files, 'remote copy checksums');
    const health = stack(['check']);
    writeFileSync(join(OUT, 'check-output.txt'), health.stdout);
    assert(health.status <= 1 && /last backup staging-/.test(health.stdout), `check exit ${health.status}: ${health.stdout}`);
    writeFileSync(join(OUT, 'last-backup.json'), JSON.stringify({ ...status, offsite: status.offsite.replace(/offsite:/, 's3://(controlled stand-in)/') }, null, 2));
    return `${status.name} → ${status.offsite}; check exit ${health.status}`;
  });

  await check('06 the backup copied off-host restores in a disposable project (local copy; remote checksums matched in 05)', async () => {
    const status = JSON.parse(readFileSync(join(root, '.staging/backups/last-backup.json'), 'utf8'));
    const verify = stack(['restore-verify', status.name]);
    assert(verify.status === 0, verify.stdout.slice(-600));
    return (verify.stdout.match(/restore-verify: .*/) ?? [''])[0];
  });
} finally {
  for (const c of [SIM, S3]) run('docker', ['rm', '-f', c], { allowFail: true });
  run('docker', ['volume', 'rm', `${S3}-data`], { allowFail: true });
  run('docker', ['network', 'rm', NET], { allowFail: true });
  writeFileSync(join(OUT, 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} hardening checks passed`);
  process.exit(failed ? 1 : 0);
}
