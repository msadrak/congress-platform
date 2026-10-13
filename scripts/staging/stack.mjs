#!/usr/bin/env node
/**
 * Congress Platform staging operations (Windows PowerShell, macOS and Linux alike):
 *
 *   node scripts/staging/stack.mjs init               generate .staging/staging.env (never overwrites)
 *   node scripts/staging/stack.mjs up                 build images, migrate, start, wait until healthy
 *   node scripts/staging/stack.mjs status             containers, health, URLs
 *   node scripts/staging/stack.mjs logs [service]     last 200 log lines (all services or one)
 *   node scripts/staging/stack.mjs stop | start       stop / start containers (data untouched)
 *   node scripts/staging/stack.mjs migrate            run the one-shot migration service explicitly
 *   node scripts/staging/stack.mjs ca                 export Caddy's local root CA to .staging/caddy-root.crt
 *   node scripts/staging/stack.mjs backup             timestamped database + media backup in .staging/backups
 *   node scripts/staging/stack.mjs backups            list backups
 *   node scripts/staging/stack.mjs restore-verify <name> [--keep]
 *                                                     restore a backup into a NEW disposable project and verify it
 *
 * Nothing here deletes the staging volumes. The only `down -v` is on the disposable
 * `congress-restore-*` project that restore-verify itself creates.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATE = join(root, '.staging');
const ENV_FILE = join(STATE, 'staging.env');
const BACKUPS = join(STATE, 'backups');
const COMPOSE_FILE = join(root, 'deploy/staging/compose.yaml');
const PROJECT = 'congress-staging';

export const run = (cmd, args, { allowFail = false, input, quiet = false, binary = false } = {}) => {
  const r = spawnSync(cmd, args, { input, encoding: binary ? 'buffer' : 'utf8', stdio: quiet || binary ? 'pipe' : ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 30 });
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')} -> exit ${r.status}\n${(r.stderr ?? '').toString().slice(-2000)}`);
  return r;
};
export const compose = (project, args, opts) => run('docker', ['compose', '-p', project, '--env-file', ENV_FILE, '-f', COMPOSE_FILE, ...args], opts);
export const readEnv = () =>
  Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
export const psql = (project, sql) =>
  compose(project, ['exec', '-T', 'db', 'psql', '-U', 'congress', '-d', 'congress', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]).stdout.trim();
const say = (s) => console.log(s);

function requireEnv() {
  if (!existsSync(ENV_FILE)) throw new Error(`Missing ${ENV_FILE}. Run: node scripts/staging/stack.mjs init`);
}

function init() {
  mkdirSync(STATE, { recursive: true });
  if (existsSync(ENV_FILE)) return say(`${ENV_FILE} already exists; left unchanged.`);
  const template = readFileSync(join(root, 'deploy/staging/.env.staging.example'), 'utf8');
  const values = {
    POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
    CONGRESS_PLATFORM_ADMIN_TOKEN: randomBytes(32).toString('base64url'),
    CONGRESS_JWT_SECRET: randomBytes(32).toString('hex'),
  };
  const env = template.replace(/^(POSTGRES_PASSWORD|CONGRESS_PLATFORM_ADMIN_TOKEN|CONGRESS_JWT_SECRET)=.*$/gm, (_, k) => `${k}=${values[k]}`);
  writeFileSync(ENV_FILE, env, { mode: 0o600 });
  say(`Generated ${ENV_FILE} with fresh secrets (git-ignored). The admin token is in that file; it is not printed.`);
}

async function waitHttp(url, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function status() {
  requireEnv();
  const env = readEnv();
  const rows = JSON.parse(`[${compose(PROJECT, ['ps', '-a', '--format', 'json']).stdout.trim().split(/\r?\n/).filter(Boolean).join(',')}]`);
  for (const c of rows) say(`  ${c.Service.padEnd(8)} ${c.State.padEnd(9)} ${c.Health || (c.ExitCode !== undefined && c.State === 'exited' ? `exit ${c.ExitCode}` : '')}`);
  const http = `http://localhost:${env.CONGRESS_HTTP_PORT || 18080}`;
  for (const p of ['/api/health', '/api/ready']) {
    let s = 'unreachable';
    try { s = String((await fetch(http + p)).status); } catch { /* down */ }
    say(`  ${p.padEnd(12)} ${s}`);
  }
  say(`\n  HTTPS: ${env.CONGRESS_PUBLIC_ORIGIN}   (local CA; see "ca")\n  HTTP : ${http}   (localhost only)`);
  return rows;
}

async function up() {
  requireEnv();
  compose(PROJECT, ['build'], { quiet: false });
  // `up --wait` returns once every service is healthy (migrate must have exited 0 for api to start).
  const r = compose(PROJECT, ['up', '-d', '--wait', '--wait-timeout', '300'], { allowFail: true });
  if (r.status !== 0) {
    say(r.stderr);
    say(compose(PROJECT, ['logs', '--tail', '80', 'migrate', 'api'], { allowFail: true }).stdout);
    throw new Error('Stack did not become healthy (see logs above).');
  }
  say(`migrations: ${psql(PROJECT, 'select version_num from alembic_version')}`);
  await status();
}

function exportCa() {
  mkdirSync(STATE, { recursive: true });
  const out = join(STATE, 'caddy-root.crt');
  const pem = compose(PROJECT, ['exec', '-T', 'web', 'cat', '/data/caddy/pki/authorities/local/root.crt']).stdout;
  writeFileSync(out, pem);
  say(`Caddy local root CA written to ${out}`);
  say('Trust it for this Windows user (optional, removes browser warnings):');
  say(`  Import-Certificate -FilePath "${out}" -CertStoreLocation Cert:\\CurrentUser\\Root`);
  return out;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

/** Database (pg_dump custom format) + media tarball + manifest with counts and checksums. */
export function backup(project = PROJECT) {
  requireEnv();
  const name = `staging-${stamp()}`;
  const dir = join(BACKUPS, name);
  mkdirSync(dir, { recursive: true });
  // Dump inside the container, then copy out (binary-safe on every host OS).
  compose(project, ['exec', '-T', 'db', 'sh', '-c', 'pg_dump -U congress -d congress -Fc -f /tmp/backup.dump']);
  const dbId = compose(project, ['ps', '-q', 'db']).stdout.trim();
  run('docker', ['cp', `${dbId}:/tmp/backup.dump`, join(dir, 'db.dump')]);
  compose(project, ['exec', '-T', 'db', 'rm', '-f', '/tmp/backup.dump']);
  // Media: read-only mount of the volume in a throw-away helper container.
  const helper = `${project}-backup-${randomBytes(3).toString('hex')}`;
  run('docker', ['run', '-d', '--name', helper, '--network', 'none', '-v', `${project}_media:/data:ro`, 'postgres:16-alpine', 'sleep', '600']);
  try {
    run('docker', ['exec', helper, 'tar', 'czf', '/tmp/media.tar.gz', '-C', '/data', '.']);
    run('docker', ['cp', `${helper}:/tmp/media.tar.gz`, join(dir, 'media.tar.gz')]);
    var mediaSums = run('docker', ['exec', helper, 'sh', '-c', 'cd /data && find . -type f -exec sha256sum {} + | sort -k2']).stdout.trim();
  } finally {
    run('docker', ['rm', '-f', helper], { allowFail: true });
  }
  const counts = Object.fromEntries(
    ['organizers', 'events', 'users', 'tickets', 'entity_qrs', 'booths', 'leads', 'checkins', 'desk_operators', 'scanner_devices', 'media_assets'].map((t) => [t, Number(psql(project, `select count(*) from ${t}`))]),
  );
  counts.published_pages = Number(psql(project, 'select count(*) from event_pages where published is not null'));
  const manifest = {
    name,
    created_at: new Date().toISOString(),
    alembic_revision: psql(project, 'select version_num from alembic_version'),
    counts,
    published_slugs: psql(project, "select coalesce(string_agg(e.slug, ',' order by e.slug), '') from events e join event_pages p on p.event_id = e.id where p.published is not null").split(',').filter(Boolean),
    files: Object.fromEntries(['db.dump', 'media.tar.gz'].map((f) => [f, createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')])),
    media_sha256: mediaSums ? mediaSums.split('\n').map((l) => l.split(/\s+/)) : [],
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  say(`Backup ${name}: ${dir}`);
  say(`  db.dump ${readFileSync(join(dir, 'db.dump')).length} bytes, media.tar.gz ${readFileSync(join(dir, 'media.tar.gz')).length} bytes, ${manifest.media_sha256.length} media files`);
  say(`  counts ${JSON.stringify(counts)}`);
  return { name, dir, manifest };
}

function listBackups() {
  if (!existsSync(BACKUPS)) return say('No backups yet.');
  for (const name of readdirSync(BACKUPS).sort()) {
    const m = join(BACKUPS, name, 'manifest.json');
    if (!existsSync(m)) continue;
    const j = JSON.parse(readFileSync(m, 'utf8'));
    say(`  ${name}  rev ${j.alembic_revision}  events ${j.counts.events}  tickets ${j.counts.tickets}  media ${j.media_sha256.length}`);
  }
}

/**
 * Restore a backup into a brand-new, separately named Compose project (its own volumes, no published
 * ports), run the normal migrate + api services against it, and compare everything with the manifest.
 */
export async function restoreVerify(name, { keep = false } = {}) {
  requireEnv();
  const dir = join(BACKUPS, name);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  for (const [f, sum] of Object.entries(manifest.files)) {
    if (createHash('sha256').update(readFileSync(join(dir, f))).digest('hex') !== sum) throw new Error(`${f} checksum mismatch`);
  }
  const project = `congress-restore-${randomBytes(3).toString('hex')}`;
  const checks = [];
  const check = (label, ok, detail = '') => { checks.push({ label, ok }); say(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); };
  say(`Restoring ${name} into disposable project ${project}`);
  try {
    compose(project, ['up', '-d', '--wait', 'db']);
    const dbId = compose(project, ['ps', '-q', 'db']).stdout.trim();
    run('docker', ['cp', join(dir, 'db.dump'), `${dbId}:/tmp/restore.dump`]);
    compose(project, ['exec', '-T', 'db', 'pg_restore', '-U', 'congress', '-d', 'congress', '--no-owner', '--exit-on-error', '/tmp/restore.dump']);
    const helper = `${project}-media`;
    run('docker', ['run', '-d', '--name', helper, '--network', 'none', '-v', `${project}_media:/data`, 'postgres:16-alpine', 'sleep', '600']);
    try {
      run('docker', ['cp', join(dir, 'media.tar.gz'), `${helper}:/tmp/media.tar.gz`]);
      // The API runs as uid 10001; restored files must stay readable/writable by it.
      run('docker', ['exec', helper, 'sh', '-c', 'tar xzf /tmp/media.tar.gz -C /data && chown -R 10001:10001 /data']);
      const sums = run('docker', ['exec', helper, 'sh', '-c', 'cd /data && find . -type f -exec sha256sum {} + | sort -k2']).stdout.trim();
      check('media files identical to the backup (sha256)', JSON.stringify(sums ? sums.split('\n').map((l) => l.split(/\s+/)) : []) === JSON.stringify(manifest.media_sha256), `${manifest.media_sha256.length} files`);
    } finally {
      run('docker', ['rm', '-f', helper], { allowFail: true });
    }
    // Normal startup path: migrate (no-op at the same revision) then the API with the schema guard.
    compose(project, ['up', '-d', '--wait', '--wait-timeout', '180', 'api']);
    check('migrate service accepted the restored schema', psql(project, 'select version_num from alembic_version') === manifest.alembic_revision, manifest.alembic_revision);
    for (const [table, expected] of Object.entries(manifest.counts)) {
      const got = Number(psql(project, table === 'published_pages' ? 'select count(*) from event_pages where published is not null' : `select count(*) from ${table}`));
      check(`${table} rows`, got === expected, `${got}/${expected}`);
    }
    // Through the restored API: published pages and every published image, byte-for-byte.
    const probe = `
import hashlib, json, sys, urllib.request
base = "http://127.0.0.1:8000"
out = {}
for slug in ${JSON.stringify(manifest.published_slugs)}:
    page = json.load(urllib.request.urlopen(f"{base}/api/public/events/{slug}"))
    out[slug] = {a["id"]: hashlib.sha256(urllib.request.urlopen(base + a["url"]).read()).hexdigest() for a in page["page"]["assets"]}
print(json.dumps(out))`;
    const served = JSON.parse(compose(project, ['exec', '-T', 'api', 'python', '-c', probe]).stdout.trim());
    check('every published page answers through the restored API', Object.keys(served).length === manifest.published_slugs.length, `${Object.keys(served).length} pages`);
    const backupSums = new Map(manifest.media_sha256.map(([sum, path]) => [path.split('/').pop().split('.')[0], sum]));
    const images = Object.values(served).flatMap((assets) => Object.entries(assets));
    check('published images served by the restored API match the backup', images.every(([id, sum]) => backupSums.get(id) === sum), `${images.length} images`);
  } finally {
    if (keep) say(`Kept ${project} (remove with: docker compose -p ${project} -f deploy/staging/compose.yaml --env-file .staging/staging.env down -v)`);
    else if (/^congress-restore-[0-9a-f]{6}$/.test(project)) compose(project, ['down', '-v', '--remove-orphans'], { allowFail: true });
  }
  const failed = checks.filter((c) => !c.ok).length;
  say(`restore-verify: ${checks.length - failed}/${checks.length} checks passed`);
  if (failed) throw new Error('Restore verification failed');
  return checks;
}

async function main() {
  const [cmd = 'status', ...rest] = process.argv.slice(2);
  if (rest.includes('-v') || rest.includes('--volumes')) throw new Error('Refusing: this tool never removes staging volumes.');
  switch (cmd) {
    case 'init': return init();
    case 'up': return up();
    case 'status': return status();
    case 'logs': return say(compose(PROJECT, ['logs', '--tail', '200', ...rest]).stdout);
    case 'stop': requireEnv(); compose(PROJECT, ['stop']); return say('Stopped (containers and volumes kept).');
    case 'start': requireEnv(); compose(PROJECT, ['up', '-d', '--wait', '--wait-timeout', '300']); return status();
    case 'migrate': requireEnv(); return say(compose(PROJECT, ['run', '--rm', 'migrate']).stderr);
    case 'ca': return exportCa();
    case 'backup': return backup();
    case 'backups': return listBackups();
    case 'restore-verify': return restoreVerify(rest[0], { keep: rest.includes('--keep') });
    default: throw new Error(`Unknown command ${cmd}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
