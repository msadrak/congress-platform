#!/usr/bin/env node
/**
 * Congress Platform staging operations (Windows PowerShell, macOS and Linux alike):
 *
 *   node scripts/staging/stack.mjs init               generate .staging/staging.env (never overwrites)
 *   node scripts/staging/stack.mjs up                 build images (tagged with the commit too), migrate, start, wait until
 *                                                     healthy; keeps the last 5 releases' images for rollback
 *   node scripts/staging/stack.mjs releases           deployed releases (newest first) and the current one
 *   node scripts/staging/stack.mjs rollback [<sha>]   run the previous (or the given) release's images again; no migration
 *   node scripts/staging/stack.mjs status             containers, health, URLs
 *   node scripts/staging/stack.mjs logs [service]     last 200 log lines (all services or one)
 *   node scripts/staging/stack.mjs stop | start       stop / start containers (data untouched)
 *   node scripts/staging/stack.mjs migrate            run the one-shot migration service explicitly
 *   node scripts/staging/stack.mjs ca                 export Caddy's local root CA to .staging/caddy-root.crt
 *   node scripts/staging/stack.mjs lan [<ip> | off]   serve the stack on this computer's current network address
 *                                                     (detected; run again after joining another network)
 *   node scripts/staging/stack.mjs cdn <status|check|sync|parspack|origin|only|off>
 *                                                     a CDN (ParsPack) in front: trusted ranges, real visitor address, origin protocol
 *   node scripts/staging/stack.mjs backup             timestamped database + media backup in .staging/backups
 *   node scripts/staging/stack.mjs backups [--offsite] list backups (local, or the encrypted off-host copies)
 *   node scripts/staging/stack.mjs restore-verify <name> [--keep] [--from-offsite]
 *                                                     restore a backup into a NEW disposable project and verify it
 *                                                     (--from-offsite: download and decrypt the off-host copy first)
 *   node scripts/staging/stack.mjs scheduled-backup   backup + consistency check + encrypted off-host copy + retention;
 *                                                     writes .staging/backups/last-backup.json, exit 1 on failure
 *   node scripts/staging/stack.mjs base-backup [full|diff|incr]
 *                                                     pgBackRest base backup (BACKUP_WAL=on; full weekly, diff otherwise)
 *   node scripts/staging/stack.mjs pitr-restore --to <time|latest> [--keep]
 *                                                     point-in-time recovery drill into a NEW disposable project
 *   node scripts/staging/stack.mjs install-timers [--user <name>] [--dry-run] | uninstall-timers [--dry-run]
 *                                                     systemd timers for backups, base backups and the health check
 *   node scripts/staging/stack.mjs event-mode on|off|status [--dry-run]
 *                                                     hourly backups during a live congress (systemd drop-in)
 *   node scripts/staging/stack.mjs check              operator health check (exit 0 ok, 1 warning, 2 critical);
 *                                                     Telegram alert/recovery message when ALERT_TELEGRAM_* is set
 *   node scripts/staging/stack.mjs metrics            the API's Prometheus metrics, read inside the API container
 *   node scripts/staging/stack.mjs organizer list | create <name> | rotate <id> | revoke <id>
 *                                                     platform administration from inside the API container
 *   node scripts/staging/stack.mjs sms-code <mobile>  newest SMS sign-in code (CONGRESS_SMS_PROVIDER=console only)
 *   node scripts/staging/stack.mjs sms-template list | set <otp|ticket_confirmation> (<text> | --file <path>) | reset <kind>
 *                                                     platform-wide SMS wording (organizers override the confirmation per event)
 *
 * Data lives on the host under CONGRESS_PERSISTENT_DATA_ROOT (not Docker named volumes).
 * `down -v` no longer wipes production data; restore-verify uses a disposable folder under .staging/restores/.
 *
 * Off-host backup, alert and point-in-time-recovery settings (BACKUP_*, ALERT_*) may live in a separate root/congress
 * file, /etc/congress/backup.env (CONGRESS_OPS_ENV_FILE), read here and by the systemd units.
 * CONGRESS_STACK_PROJECT runs a second stack (a drill) from the same checkout under another Compose project name.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { isIP } from 'node:net';
import { homedir, hostname, networkInterfaces, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATE = join(root, '.staging');
const ENV_FILE = join(STATE, 'staging.env');
const BACKUPS = join(STATE, 'backups');
const RELEASES = join(STATE, 'releases.json');
const COMPOSE_FILE = join(root, 'deploy/staging/compose.yaml');
const COMPOSE_WAL_FILE = join(root, 'deploy/staging/compose.wal.yaml');
const PROJECT = process.env.CONGRESS_STACK_PROJECT?.trim() || 'congress-staging';
const OPS_ENV_FILE = process.env.CONGRESS_OPS_ENV_FILE || '/etc/congress/backup.env';
const OPS_KEY = /^(BACKUP|ALERT)_/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function composeEnvFile(override) {
  if (!override || !Object.keys(override).length) return ENV_FILE;
  const map = { ...parseEnvFile(ENV_FILE), ...override };
  const body = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  const tmp = join(STATE, `.compose-env-${process.pid}-${randomBytes(3).toString('hex')}.tmp`);
  writeFileSync(tmp, body, { mode: 0o600 });
  return tmp;
}

/**
 * docker compose for a project. With BACKUP_WAL=on the main project (and a point-in-time drill, `wal: true`) also
 * gets deploy/staging/compose.wal.yaml, with the pgBackRest settings passed as environment of the compose process
 * (never on a command line). Only the main project archives WAL; a drill's database never writes to the bucket.
 */
export function compose(project, args, opts = {}) {
  const settings = existsSync(ENV_FILE) ? { ...readEnv(), ...opts.envOverride } : {};
  const wal = (opts.wal ?? project === PROJECT) && walEnabled(settings);
  if (wal && args.includes('up')) {
    const problems = walProblems(settings);
    if (problems.length) throw new Error(`BACKUP_WAL=on but:\n  - ${problems.join('\n  - ')}\n(settings: ${ENV_FILE} or ${OPS_ENV_FILE})`);
  }
  const files = wal ? [COMPOSE_FILE, COMPOSE_WAL_FILE] : [COMPOSE_FILE];
  const env = { ...(wal ? walComposeEnv(settings, { archive: project === PROJECT }) : {}), ...opts.env };
  const envFile = composeEnvFile(opts.envOverride);
  try {
    return run('docker', ['compose', '-p', project, '--env-file', envFile, ...files.flatMap((f) => ['-f', f]), ...args], { ...opts, env: Object.keys(env).length ? env : undefined });
  } finally {
    if (envFile !== ENV_FILE) rmSync(envFile, { force: true });
  }
}

/** Host directory for PostgreSQL, media and Caddy state (DrGibi ~/drgibi-persistent-data). */
export function persistentDataRoot(env = readEnv()) {
  const v = env.CONGRESS_PERSISTENT_DATA_ROOT?.trim();
  return v || join(homedir(), 'congress-persistent-data');
}
export function persistentPaths(env = readEnv()) {
  const root = persistentDataRoot(env);
  return {
    root,
    postgres: join(root, 'data/postgres'),
    media: join(root, 'data/media'),
    caddyData: join(root, 'data/caddy/data'),
    caddyConfig: join(root, 'data/caddy/config'),
  };
}
export const parseEnvText = (text) => Object.fromEntries(
  text
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const parseEnvFile = (file) => parseEnvText(readFileSync(file, 'utf8'));

function opsEnvFile() {
  try {
    return Object.fromEntries(Object.entries(parseEnvFile(OPS_ENV_FILE)).filter(([k]) => OPS_KEY.test(k)));
  } catch {
    return {}; // absent or not readable by this user
  }
}

export const readEnv = () => ({
  ...parseEnvFile(ENV_FILE),
  // Backup and alert settings may also come from a separate secrets file or the scheduler's environment, so the
  // off-host credentials need not live next to the application secrets.
  ...opsEnvFile(),
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => OPS_KEY.test(k))),
});
export const psql = (project, sql, opts = {}) =>
  compose(project, ['exec', '-T', 'db', 'psql', '-U', 'congress', '-d', 'congress', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], opts).stdout.trim();
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
    CONGRESS_METRICS_TOKEN: randomBytes(32).toString('base64url'),
    CONGRESS_PERSISTENT_DATA_ROOT: join(homedir(), 'congress-persistent-data'),
  };
  const env = template.replace(/^(POSTGRES_PASSWORD|CONGRESS_PLATFORM_ADMIN_TOKEN|CONGRESS_JWT_SECRET|CONGRESS_METRICS_TOKEN|CONGRESS_PERSISTENT_DATA_ROOT)=.*$/gm, (_, k) => `${k}=${values[k]}`);
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
  if ((env.CONGRESS_LOCAL_HTTP || 'on') === 'off') {
    // Hosted server: there is no plain-HTTP localhost site (HTTP redirects to HTTPS on the public name), so ask
    // the API container directly.
    for (const p of ['/api/health', '/api/ready']) {
      const r = compose(PROJECT, ['exec', '-T', 'api', 'python', '-c', `import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000${p}',timeout=5).status)`], { allowFail: true });
      say(`  ${p.padEnd(12)} ${r.stdout.trim() || 'unreachable'}   (inside the API container)`);
    }
    if ((env.CONGRESS_CDN || 'off') === 'on') {
      say(`\n  Public: ${env.CONGRESS_PUBLIC_ORIGIN}   (visitors' certificate comes from the CDN; check: curl -I ${env.CONGRESS_PUBLIC_ORIGIN}/api/ready)\n  ${describeCdn(env)}`);
    } else {
      say(`\n  Public: ${env.CONGRESS_PUBLIC_ORIGIN}   (certificate from ${env.CONGRESS_TLS === 'internal' ? "Caddy's local CA" : 'Let\'s Encrypt/ZeroSSL'}; check: curl -I ${env.CONGRESS_PUBLIC_ORIGIN}/api/ready)`);
    }
    return rows;
  }
  const http = `http://localhost:${env.CONGRESS_HTTP_PORT || 18080}`;
  for (const p of ['/api/health', '/api/ready']) {
    let s = 'unreachable';
    try { s = String((await fetch(http + p)).status); } catch { /* down */ }
    say(`  ${p.padEnd(12)} ${s}`);
  }
  say(`\n  HTTPS: ${env.CONGRESS_PUBLIC_ORIGIN}   (local CA; see "ca")\n  HTTP : ${http}   (localhost only)`);
  return rows;
}

// Servers without direct internet build through an HTTP proxy (`deploy/proxy/congress-proxy.sh deploy` sets
// CONGRESS_BUILD_PROXY). The proxy variables are predefined Docker build arguments: they reach `npm ci` and
// `uv sync` without being declared in a Dockerfile, are not stored in the image, and never reach the running
// containers. Without the variable nothing changes.
export function buildProxyArgs(env = process.env) {
  const proxy = env.CONGRESS_BUILD_PROXY?.trim();
  if (!proxy) return [];
  const noProxy = env.CONGRESS_BUILD_NO_PROXY?.trim() ?? '';
  const pairs = [['HTTP_PROXY', proxy], ['HTTPS_PROXY', proxy], ['ALL_PROXY', proxy], ['NO_PROXY', noProxy]];
  return pairs.flatMap(([k, v]) => ['--build-arg', `${k}=${v}`, '--build-arg', `${k.toLowerCase()}=${v}`]);
}

/** Slow SSH tunnels need longer daemon RPC timeouts and one image at a time. */
export function buildComposeEnv(env = process.env) {
  const out = {
    DOCKER_BUILDKIT: env.DOCKER_BUILDKIT || '1',
    DOCKER_CLIENT_TIMEOUT: env.DOCKER_CLIENT_TIMEOUT || '600',
    COMPOSE_HTTP_TIMEOUT: env.COMPOSE_HTTP_TIMEOUT || '600',
    COMPOSE_PARALLEL_LIMIT: env.CONGRESS_BUILD_PARALLEL_LIMIT || '1',
  };
  if (env.CONGRESS_BUILD_PROXY?.trim()) return out;
  return { DOCKER_BUILDKIT: out.DOCKER_BUILDKIT };
}

function ensurePersistentHostDirs() {
  const fix = join(root, 'scripts/staging/fix-persistent-permissions.sh');
  if (!existsSync(fix)) return;
  run(fix, [], {
    allowFail: true,
    env: { ...process.env, CONGRESS_PERSISTENT_DATA_ROOT: persistentDataRoot() },
  });
}

async function up() {
  requireEnv();
  cdnPreflight();
  ensurePersistentHostDirs();
  const release = releaseId();
  compose(PROJECT, ['build', ...buildProxyArgs()], { env: buildComposeEnv() });
  tagRelease(release);
  // `up --wait` returns once every service is healthy (migrate must have exited 0 for api to start).
  const r = compose(PROJECT, ['up', '-d', '--wait', '--wait-timeout', '300'], { allowFail: true });
  if (r.status !== 0) {
    say(r.stderr);
    say(compose(PROJECT, ['logs', '--tail', '80', 'migrate', 'api'], { allowFail: true }).stdout);
    throw new Error(`Stack did not become healthy (see logs above). The previous release can be started again with: node scripts/staging/stack.mjs rollback`);
  }
  const revision = psql(PROJECT, 'select version_num from alembic_version');
  say(`migrations: ${revision}`);
  recordRelease(release, revision);
  if (walEnabled(readEnv())) walInit();
  await status();
}

// ───────────────────────────── Releases and rollback ─────────────────────────────
// Every `up` tags the images it built with the commit (congress-platform/api:<sha>, …/web:<sha>) beside the alias the
// services run (CONGRESS_IMAGE_TAG, e.g. staging/hosted). The last RELEASE_KEEP releases are kept; `rollback` points
// the alias at an older release's images and restarts api + web without running migrations, so the older API must
// accept the database as it is (app/schema_guard.py: same revision, or ahead only by backward-compatible migrations).

const IMAGES = ['congress-platform/api', 'congress-platform/web'];
export const RELEASE_KEEP = 5;
const imageAlias = () => readEnv().CONGRESS_IMAGE_TAG || 'staging';
const imageId = (ref) => run('docker', ['image', 'inspect', '--format', '{{.Id}}', ref]).stdout.trim();

/** The commit being deployed (short SHA); uncommitted or untracked files (they are in the build context) get a unique -dirty-<time> suffix; no git: a timestamp. */
export function releaseId(cwd = root) {
  const sha = run('git', ['rev-parse', '--short', 'HEAD'], { cwd, allowFail: true });
  if (sha.status !== 0) return `build-${stamp()}`;
  const dirty = run('git', ['status', '--porcelain'], { cwd, allowFail: true }).stdout.trim();
  return dirty ? `${sha.stdout.trim()}-dirty-${stamp()}` : sha.stdout.trim();
}

export function readReleases(file = RELEASES) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { current: null, history: [] };
  }
}

/** Newest first, one entry per release id, at most `keep`; also returns the ids whose images may be removed. */
export function nextReleases(state, entry, keep = RELEASE_KEEP) {
  const history = [entry, ...state.history.filter((r) => r.id !== entry.id)];
  return { state: { current: entry.id, history: history.slice(0, keep) }, expired: history.slice(keep).map((r) => r.id) };
}

/** The release `rollback` goes to: the given id (or unique prefix), else the one deployed before the current. */
export function rollbackTarget(state, wanted) {
  if (!wanted) {
    const target = state.history[state.history.findIndex((r) => r.id === state.current) + 1];
    if (!target) throw new Error('No earlier release is kept to roll back to (see: stack.mjs releases).');
    return target;
  }
  const matches = state.history.filter((r) => r.id === wanted || r.id.startsWith(wanted));
  if (matches.length !== 1) {
    throw new Error(matches.length
      ? `${wanted} matches several releases: ${matches.map((r) => r.id).join(', ')}`
      : `Release ${wanted} is not among the kept releases: ${state.history.map((r) => r.id).join(', ') || 'none'}`);
  }
  if (matches[0].id === state.current) throw new Error(`${matches[0].id} is already the current release.`);
  return matches[0];
}

function tagRelease(id) {
  const alias = imageAlias();
  for (const image of IMAGES) run('docker', ['tag', `${image}:${alias}`, `${image}:${id}`]);
}

function recordRelease(id, revision) {
  const entry = { id, at: new Date().toISOString(), alembic_revision: revision, images: Object.fromEntries(IMAGES.map((i) => [i, imageId(`${i}:${id}`)])) };
  const { state, expired } = nextReleases(readReleases(), entry);
  // Removes only these tags; layers still used by a kept release stay.
  for (const old of expired) for (const image of IMAGES) run('docker', ['image', 'rm', `${image}:${old}`], { allowFail: true });
  writeFileSync(RELEASES, JSON.stringify(state, null, 2));
  say(`release ${id} (${IMAGES.map((i) => `${i}:${id}`).join(', ')}); ${state.history.length} kept for rollback`);
}

function listReleases() {
  const s = readReleases();
  if (!s.history.length) return say('No releases recorded yet (`up` records them).');
  for (const r of s.history) say(`  ${r.id === s.current ? '*' : ' '} ${r.id.padEnd(32)} ${r.at}  schema ${r.alembic_revision}`);
}

async function rollback(wanted) {
  requireEnv();
  const state = readReleases();
  const target = rollbackTarget(state, wanted);
  const alias = imageAlias();
  for (const image of IMAGES) {
    if (run('docker', ['image', 'inspect', `${image}:${target.id}`], { allowFail: true }).status !== 0) throw new Error(`Image ${image}:${target.id} no longer exists; cannot roll back to it.`);
  }
  const before = Object.fromEntries(IMAGES.map((i) => [i, imageId(`${i}:${alias}`)]));
  say(`Switching ${state.current ?? "(unrecorded)"} -> ${target.id} (built for schema ${target.alembic_revision}; the database is at ${psql(PROJECT, 'select version_num from alembic_version')})`);
  for (const image of IMAGES) run('docker', ['tag', `${image}:${target.id}`, `${image}:${alias}`]);
  const restart = () => compose(PROJECT, ['up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'api', 'web'], { allowFail: true });
  if (restart().status !== 0) {
    say(compose(PROJECT, ['logs', '--tail', '40', 'api'], { allowFail: true }).stdout);
    for (const image of IMAGES) run('docker', ['tag', before[image], `${image}:${alias}`]);
    restart();
    throw new Error(`Rollback to ${target.id} failed (API log above; the schema guard refuses a database it cannot run on). The images that ran before were started again.`);
  }
  writeFileSync(RELEASES, JSON.stringify({ ...state, current: target.id }, null, 2));
  say(`Now running ${target.id}.${state.current ? ` Back to the newer release: node scripts/staging/stack.mjs rollback ${state.current}` : ''}`);
  await status();
}

// ───────────────────────────── LAN access ─────────────────────────────

const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
// VPN tunnels, Docker/VM bridges and other virtual adapters are never what phones on the Wi-Fi can reach.
const VIRTUAL_INTERFACE = /^(lo|utun|tun|tap|ipsec|ppp|gif|stf|awdl|llw|bridge|docker|br-|veth|vmnet|vboxnet|virbr|zt|tailscale|wg|anpi|ap\d)|vEthernet|VirtualBox|VMware|Hyper-V|Loopback/i;
const PHYSICAL_INTERFACE = /^(en|eth|wlan|wl|Wi-?Fi|Ethernet)/i;

/** This computer's address on the local network: private IPv4 on a physical interface, Wi-Fi/Ethernet first. */
export function detectLanAddress() {
  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const a of addresses ?? []) {
      if (a.family !== 'IPv4' || a.internal || !PRIVATE_IPV4.test(a.address)) continue;
      candidates.push({ name, address: a.address, physical: PHYSICAL_INTERFACE.test(name) });
    }
  }
  candidates.sort((x, y) => Number(y.physical) - Number(x.physical) || x.name.localeCompare(y.name));
  return candidates;
}

/** Replace KEY=value lines in .staging/staging.env (appending missing keys), keeping every other line. */
function setEnvValues(values) {
  let text = readFileSync(ENV_FILE, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\n*$/, '\n')}${line}\n`;
  }
  writeFileSync(ENV_FILE, text, { mode: 0o600 });
}

function httpsStatus(url, ca) {
  return new Promise((done) => {
    const req = https.get(url, { ca, agent: false, timeout: 10000 }, (res) => { res.resume(); done(String(res.statusCode)); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => done(e.code || e.message));
  });
}

async function lan(arg) {
  requireEnv();
  const env = readEnv();
  const port = env.CONGRESS_HTTPS_PORT || 8443;
  let values;
  if (arg === 'off') {
    values = {
      CONGRESS_BIND: '127.0.0.1',
      CONGRESS_SITE_ADDRESS: 'https://localhost',
      CONGRESS_DEFAULT_SNI: 'localhost',
      CONGRESS_PUBLIC_ORIGIN: `https://localhost:${port}`,
    };
  } else {
    let address = arg;
    if (address) {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) throw new Error('usage: lan [<ipv4 address> | off]');
    } else {
      const found = detectLanAddress();
      if (!found.length) throw new Error('No private network address found. Connect to Wi-Fi/Ethernet, or pass one: lan <ip>');
      address = found[0].address;
      say(`Network address: ${address} (${found[0].name})${found.length > 1 ? `; others: ${found.slice(1).map((c) => `${c.address} (${c.name})`).join(', ')}` : ''}`);
    }
    values = {
      CONGRESS_BIND: '0.0.0.0',
      CONGRESS_SITE_ADDRESS: `https://localhost, https://${address}`,
      // Clients connecting to a bare IP send no SNI; they get this address's certificate.
      CONGRESS_DEFAULT_SNI: address,
      CONGRESS_PUBLIC_ORIGIN: `https://${address}:${port}`,
    };
  }
  if (Object.entries(values).every(([k, v]) => env[k] === v)) {
    say(`Already serving ${values.CONGRESS_PUBLIC_ORIGIN}; nothing to change.`);
  } else {
    setEnvValues(values);
    say(`Updated ${ENV_FILE}; restarting the edge and the API ...`);
    // Only the services that read these values: Caddy (address, certificate, binding) and the API (links, CORS).
    const r = compose(PROJECT, ['up', '-d', '--wait', '--wait-timeout', '300', 'api', 'web'], { allowFail: true });
    if (r.status !== 0) throw new Error(`Restart failed:\n${r.stderr}`);
  }
  const caPath = join(STATE, 'caddy-root.crt');
  if (!existsSync(caPath)) exportCa();
  const ready = await httpsStatus(`${values.CONGRESS_PUBLIC_ORIGIN}/api/ready`, readFileSync(caPath));
  say(`\n  Open on phones/tablets: ${values.CONGRESS_PUBLIC_ORIGIN}   (HTTPS check: ${ready === '200' ? 'ok' : ready})`);
  if (arg !== 'off') say('  Devices trust it once .staging/caddy-root.crt is installed; the certificate authority does not change with the address.');
}

// ───────────────────────────── CDN in front (ParsPack) ─────────────────────────────
// The CDN terminates the visitors' HTTPS with its own certificate and connects to this server (the origin). Caddy
// then needs the CDN's address ranges: only connections from them may tell us who the visitor is
// (docs/deployment/CDN.md). The settings live in .staging/staging.env and are read by deploy/staging/compose.yaml.

const PARSPACK_IP_LIST = 'https://parspack.com/cdnips.txt';
/** Vendored copy (DrGibi drgibi-gateway/cdnips.txt). Updated by `cdn sync` or a successful `cdn parspack` fetch. */
export const CDN_IPS_VENDORED = join(root, 'deploy/staging/cdn/cdnips.txt');

export async function loadParsPackCdnIpListText({ offline = false } = {}) {
  if (!offline) {
    try {
      const r = await fetch(PARSPACK_IP_LIST, { signal: AbortSignal.timeout(20000) });
      if (r.ok) return { text: await r.text(), source: 'network' };
    } catch { /* use vendored */ }
  }
  if (!existsSync(CDN_IPS_VENDORED)) {
    throw new Error(`Missing ${CDN_IPS_VENDORED}. On a machine with internet run: node scripts/staging/stack.mjs cdn sync`);
  }
  return { text: readFileSync(CDN_IPS_VENDORED, 'utf8'), source: 'vendored' };
}

export function writeVendoredCdnIpList(text) {
  const ranges = parseAddressRanges(text);
  writeFileSync(CDN_IPS_VENDORED, `${ranges.join('\n')}\n`, { mode: 0o644 });
  return ranges;
}

/**
 * One IPv4/IPv6 address or CIDR range per line (blank lines and # comments allowed). Everything else is refused,
 * and so are ranges so wide that "trusted" would mean "everybody": a bad list would let any visitor forge the
 * address the rate limits and logs rely on.
 */
export function parseAddressRanges(text, { max = 500 } = {}) {
  const ranges = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [address, prefix, ...extra] = line.split('/');
    const family = isIP(address);
    const bits = family === 4 ? 32 : 128;
    const length = prefix === undefined ? bits : /^\d{1,3}$/.test(prefix) ? Number(prefix) : NaN;
    if (!family || extra.length || !(length >= 0 && length <= bits)) throw new Error(`Not an address or range: ${JSON.stringify(line.slice(0, 60))}`);
    if (length < (family === 4 ? 16 : 32)) throw new Error(`Refusing ${line}: far too wide to be a CDN's address range.`);
    ranges.push(prefix === undefined ? address : `${address}/${length}`);
  }
  const unique = [...new Set(ranges)];
  if (unique.length > max) throw new Error(`${unique.length} ranges: more than ${max}, which is not a CDN list.`);
  return unique;
}

/** The setting combinations Caddy cannot run, caught before containers are touched. */
export function cdnProblems(env) {
  const problems = [];
  const on = (k) => (env[k] || 'off') === 'on';
  const site = env.CONGRESS_SITE_ADDRESS || '';
  const httpOrigin = (env.CONGRESS_ORIGIN_TLS || 'on') === 'off';
  if ((on('CONGRESS_CDN') || on('CONGRESS_CDN_ONLY')) && !(env.CONGRESS_TRUSTED_PROXIES || '').trim()) {
    problems.push('CONGRESS_CDN/CONGRESS_CDN_ONLY is on but CONGRESS_TRUSTED_PROXIES is empty. Run: node scripts/staging/stack.mjs cdn parspack');
  }
  if (on('CONGRESS_CDN_ONLY') && !on('CONGRESS_CDN')) problems.push('CONGRESS_CDN_ONLY needs CONGRESS_CDN=on.');
  if (httpOrigin && !/^http:\/\//.test(site)) problems.push('CONGRESS_ORIGIN_TLS=off needs CONGRESS_SITE_ADDRESS to start with http:// (run: stack.mjs cdn origin http).');
  if (!httpOrigin && /^http:\/\//.test(site)) problems.push('CONGRESS_SITE_ADDRESS starts with http:// but CONGRESS_ORIGIN_TLS is not off (run: stack.mjs cdn origin https).');
  return problems;
}

function cdnPreflight(env = readEnv()) {
  const problems = cdnProblems(env);
  if (problems.length) throw new Error(`CDN settings in ${ENV_FILE}:\n  - ${problems.join('\n  - ')}`);
}

function describeCdn(env) {
  const on = (k) => (env[k] || 'off') === 'on';
  if (!on('CONGRESS_CDN')) return 'CDN: off (visitors connect directly)';
  const n = (env.CONGRESS_TRUSTED_PROXIES || '').split(/\s+/).filter(Boolean).length;
  const direct = on('CONGRESS_CDN_ONLY') ? 'blocked at Caddy (403; CDN + private nets only, like DrGibi)' : 'allowed';
  return `CDN: on, ${n} trusted ranges, visitor address from ${env.CONGRESS_CLIENT_IP_HEADER || 'X-Forwarded-For'}; origin ${(env.CONGRESS_ORIGIN_TLS || 'on') === 'off' ? 'HTTP' : `HTTPS (${env.CONGRESS_TLS === 'internal' ? "Caddy's own certificate" : 'public certificate'})`}; public direct visits ${direct}`;
}

async function cdn(args) {
  requireEnv();
  const [action = 'status', ...rest] = args;
  const env = readEnv();
  const hostOf = () => {
    try { return new URL(env.CONGRESS_PUBLIC_ORIGIN).host; } catch { throw new Error('CONGRESS_PUBLIC_ORIGIN must be a URL like https://congress.example.org'); }
  };
  const apply = (values) => {
    const next = { ...env, ...values };
    cdnPreflight(next);
    setEnvValues(values);
    say(`Updated ${ENV_FILE}. Restarting the edge (Caddy) ...`);
    const r = compose(PROJECT, ['up', '-d', '--wait', '--wait-timeout', '300', 'web'], { allowFail: true });
    if (r.status !== 0) throw new Error(`Restart failed:\n${r.stderr}\nLook at: node scripts/staging/stack.mjs logs web`);
    say(`  ${describeCdn(readEnv())}`);
  };
  switch (action) {
    case 'status':
      say(`  ${describeCdn(env)}`);
      for (const p of cdnProblems(env)) say(`  PROBLEM: ${p}`);
      return;
    case 'check': {
      // After sending a few requests through the CDN: did Caddy find the visitor's address?
      const lines = compose(PROJECT, ['logs', '--since', '30m', '--no-log-prefix', 'web'], { allowFail: true }).stdout.split(/\r?\n/);
      const seen = [];
      for (const line of lines) {
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.logger !== 'http.log.access' || !j.request || j.request.host === '127.0.0.1:8081') continue;
        const h = j.request.headers || {};
        const pick = (n) => Object.entries(h).find(([k]) => k.toLowerCase() === n)?.[1]?.join(', ');
        seen.push({ path: String(j.request.uri).split('?')[0], remote: j.request.remote_ip, client: j.request.client_ip, xff: pick('x-forwarded-for'), real: pick('x-real-ip') || pick('true-client-ip') || pick('cdn-real-ip') });
      }
      if (!seen.length) return say('  No requests in the last 30 minutes. Open the site through its public address, then run this again.');
      for (const r of seen.slice(-8)) say(`  ${r.path.padEnd(28).slice(0, 28)} connecting ${String(r.remote).padEnd(16)} visitor ${String(r.client).padEnd(16)} X-Forwarded-For: ${r.xff ?? '-'}${r.real ? `  other: ${r.real}` : ''}`);
      const resolved = seen.filter((r) => r.remote !== r.client).length;
      if (resolved) say(`\n  OK: for ${resolved}/${seen.length} requests the visitor address differs from the CDN's, so it was read from the header.`);
      else if (env.CONGRESS_CDN === 'on' && seen.some((r) => r.xff || r.real)) {
        say('\n  PROBLEM: the CDN sends an address header, but Caddy does not use it. Either the connecting address is not in the trusted list');
        say('  (run `stack.mjs cdn parspack` again, or ask ParsPack for the current ranges) or the header has another name (see "other:" above; then `cdn parspack --header <name>`).');
      } else if (env.CONGRESS_CDN === 'on') say('\n  The requests carry no forwarded address. Were they sent through the CDN, or straight to the server?');
      else say('\n  CDN mode is off, so the connecting address is the visitor. Run `stack.mjs cdn parspack` first.');
      return;
    }
    case 'sync': {
      const r = await fetch(PARSPACK_IP_LIST, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`${PARSPACK_IP_LIST} answered ${r.status}`);
      const ranges = writeVendoredCdnIpList(await r.text());
      say(`Wrote ${ranges.length} ranges to ${CDN_IPS_VENDORED} (commit this file after review, like DrGibi cdnips.txt).`);
      return;
    }
    case 'parspack': {
      const file = rest.indexOf('--file');
      const header = rest.indexOf('--header');
      const allowDirect = rest.includes('--allow-direct');
      const offline = rest.includes('--offline');
      let text;
      let source = 'file';
      if (file >= 0) {
        if (!rest[file + 1]) throw new Error('usage: cdn parspack [--offline] [--allow-direct] [--file <path>] [--header <name>]');
        text = readFileSync(rest[file + 1], 'utf8');
      } else {
        ({ text, source } = await loadParsPackCdnIpListText({ offline }));
        if (source === 'vendored') say(`Using vendored list ${CDN_IPS_VENDORED} (fetch failed or --offline).`);
      }
      const ranges = parseAddressRanges(text);
      if (!ranges.length) throw new Error('The list has no address ranges.');
      if (source === 'network') {
        writeVendoredCdnIpList(text);
        say(`Updated ${CDN_IPS_VENDORED} from parspack.com.`);
      }
      const name = header >= 0 ? rest[header + 1] : env.CONGRESS_CLIENT_IP_HEADER || 'X-Forwarded-For';
      if (!/^[A-Za-z0-9-]{1,64}$/.test(name || '')) throw new Error('--header must be a header name such as X-Forwarded-For');
      say(`${ranges.length} ParsPack address ranges. CONGRESS_CDN_ONLY=${allowDirect ? 'off' : 'on'} (DrGibi production default: direct public access denied).`);
      say('Then on the server: sudo deploy/staging/cdn/configure-firewall-cdn.sh');
      return apply({
        CONGRESS_CDN: 'on',
        CONGRESS_TRUSTED_PROXIES: ranges.join(' '),
        CONGRESS_CLIENT_IP_HEADER: name,
        CONGRESS_CDN_ONLY: allowDirect ? 'off' : 'on',
      });
    }
    case 'origin': {
      const host = hostOf();
      if (rest[0] === 'https') {
        // The CDN already shows visitors a trusted certificate; the origin only needs an encrypted hop, so Caddy
        // uses its own CA and never asks Let's Encrypt (no outbound proxy needed for certificates).
        return apply({ CONGRESS_ORIGIN_TLS: 'on', CONGRESS_SITE_ADDRESS: host, CONGRESS_TLS: 'internal', CONGRESS_DEFAULT_SNI: host });
      }
      if (rest[0] === 'http') return apply({ CONGRESS_ORIGIN_TLS: 'off', CONGRESS_SITE_ADDRESS: `http://${host}` });
      throw new Error('usage: cdn origin https | http');
    }
    case 'only':
      if (!['on', 'off'].includes(rest[0])) throw new Error('usage: cdn only on | off');
      return apply({ CONGRESS_CDN_ONLY: rest[0] });
    case 'off': {
      const host = hostOf();
      const values = { CONGRESS_CDN: 'off', CONGRESS_CDN_ONLY: 'off' };
      if ((env.CONGRESS_ORIGIN_TLS || 'on') === 'off') Object.assign(values, { CONGRESS_ORIGIN_TLS: 'on', CONGRESS_SITE_ADDRESS: host });
      if (env.CONGRESS_TLS === 'internal') say('Note: CONGRESS_TLS is still "internal". For a public certificate set it to your e-mail address and run `stack.mjs start`.');
      return apply(values);
    }
    default:
      throw new Error('usage: cdn status | check | sync | parspack [--offline] [--allow-direct] [--file <path>] [--header <name>] | origin https|http | only on|off | off');
  }
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
  const { media } = persistentPaths(readEnv());
  run('docker', ['run', '-d', '--name', helper, '--network', 'none', '-v', `${media}:/data:ro`, 'postgres:16-alpine', 'sleep', '600']);
  try {
    run('docker', ['exec', helper, 'tar', 'czf', '/tmp/media.tar.gz', '-C', '/data', '.']);
    run('docker', ['cp', `${helper}:/tmp/media.tar.gz`, join(dir, 'media.tar.gz')]);
    var mediaSums = run('docker', ['exec', helper, 'sh', '-c', 'cd /data && find . -type f -exec sha256sum {} + | sort -k2']).stdout.trim();
  } finally {
    run('docker', ['rm', '-f', helper], { allowFail: true });
  }
  // Consistency: every image the database knows must be in the media archive (the dump is taken first,
  // so only a deletion during the backup window could break this; such a backup is reported as failed).
  const keys = psql(project, "select coalesce(string_agg(storage_key, ','), '') from media_assets").split(',').filter(Boolean);
  const archived = new Set((mediaSums ? mediaSums.split('\n') : []).map((l) => l.split(/\s+/)[1].replace(/^\.\//, '')));
  const missingMedia = keys.filter((k) => !archived.has(k));
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
    missing_media: missingMedia,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  say(`Backup ${name}: ${dir}`);
  say(`  db.dump ${readFileSync(join(dir, 'db.dump')).length} bytes, media.tar.gz ${readFileSync(join(dir, 'media.tar.gz')).length} bytes, ${manifest.media_sha256.length} media files`);
  say(`  counts ${JSON.stringify(counts)}`);
  if (missingMedia.length) throw new Error(`Backup ${name} is inconsistent: ${missingMedia.length} database images missing from the media archive`);
  return { name, dir, manifest };
}

// ── Off-host copy (any S3-compatible store via rclone) and retention ─────────────────────────────────

const BACKUP_NAME = /^staging-\d{8}-\d{6}$/;

/**
 * Keep the newest N backups, the newest of each of the last N days (so hourly event-day backups never push out the
 * dailies), and the newest per ISO week (W) and per month (M); everything else is old.
 */
export function selectExpired(names, { daily = 7, weekly = 4, monthly = 6 } = {}) {
  const sorted = names.filter((n) => BACKUP_NAME.test(n)).sort().reverse();
  const keep = new Set(sorted.slice(0, daily));
  const take = (keyOf, n) => {
    const seen = new Set();
    for (const name of sorted) {
      const k = keyOf(name);
      if (seen.size >= n) break;
      if (!seen.has(k)) { seen.add(k); keep.add(name); }
    }
  };
  const date = (name) => new Date(`${name.slice(8, 12)}-${name.slice(12, 14)}-${name.slice(14, 16)}T00:00:00Z`);
  take((n) => n.slice(8, 16), daily);
  take((n) => { const d = date(n); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); }, weekly);
  take((n) => n.slice(8, 14), monthly);
  return sorted.filter((n) => !keep.has(n));
}

// Encryption: every file is encrypted on this host before upload, with an rclone `crypt` remote layered over the S3
// remote (XSalsa20-Poly1305, key derived from BACKUP_ENCRYPTION_KEY with scrypt). rclone is already the upload tool,
// so encryption adds no new binary or key format, and `rclone cryptcheck` still proves every uploaded file matches
// the local one. File and folder names stay readable (backup timestamps); contents are encrypted and authenticated.
// The same passphrase encrypts the pgBackRest WAL archive (aes-256-cbc). Keep a copy of it off the server: without it
// no off-host copy can be restored.
export const prefixOf = (env) => (env.BACKUP_S3_PREFIX || 'congress').replace(/^\/+|\/+$/g, '');
export const offsiteConfigured = (env) => Boolean(env.BACKUP_S3_ENDPOINT && env.BACKUP_S3_BUCKET);

export function encryptionProblems(env) {
  const key = env.BACKUP_ENCRYPTION_KEY || '';
  if (!key) return ['BACKUP_ENCRYPTION_KEY is not set: off-host copies are always encrypted (generate one: openssl rand -base64 48)'];
  if (key.length < 32) return ['BACKUP_ENCRYPTION_KEY must be at least 32 characters'];
  return [];
}

let obscured;
/** rclone wants its crypt passwords "obscured"; done by rclone itself, the key passed on stdin. */
function obscuredKey(env) {
  obscured ??= run('docker', ['run', '--rm', '-i', env.BACKUP_RCLONE_IMAGE || 'rclone/rclone:1.68', 'obscure', '-'], { input: env.BACKUP_ENCRYPTION_KEY }).stdout.trim();
  return obscured;
}

// Credentials travel as environment variables of the docker client process (`-e NAME` without a value),
// so they never appear on a command line, in an error message or in the status file.
export function rcloneEnv(env, password = '') {
  return {
    RCLONE_CONFIG_OFFSITE_TYPE: 's3',
    RCLONE_CONFIG_OFFSITE_PROVIDER: env.BACKUP_S3_PROVIDER || 'Other',
    RCLONE_CONFIG_OFFSITE_ENDPOINT: env.BACKUP_S3_ENDPOINT,
    RCLONE_CONFIG_OFFSITE_REGION: env.BACKUP_S3_REGION || 'us-east-1',
    RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID: env.BACKUP_S3_ACCESS_KEY_ID,
    RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY: env.BACKUP_S3_SECRET_ACCESS_KEY,
    RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE: 'true',
    RCLONE_S3_NO_CHECK_BUCKET: 'true',
    // `secure:` = the encrypted view of s3://<bucket>/<prefix>; everything off-host goes through it.
    RCLONE_CONFIG_SECURE_TYPE: 'crypt',
    RCLONE_CONFIG_SECURE_REMOTE: `offsite:${env.BACKUP_S3_BUCKET}/${prefixOf(env)}`,
    RCLONE_CONFIG_SECURE_PASSWORD: password,
    RCLONE_CONFIG_SECURE_FILENAME_ENCRYPTION: 'off',
    RCLONE_CONFIG_SECURE_DIRECTORY_NAME_ENCRYPTION: 'false',
    // Self-hosted S3 with its own certificate authority (or a local drill): BACKUP_S3_VERIFY_TLS=off.
    ...((env.BACKUP_S3_VERIFY_TLS || 'on') === 'off' ? { RCLONE_NO_CHECK_CERTIFICATE: 'true' } : {}),
  };
}
const rclone = (env, args, { mount = `${BACKUPS}:/backups:ro` } = {}) => {
  const problems = encryptionProblems(env);
  if (problems.length) throw new Error(`off-host copy refused: ${problems[0]}`);
  const vars = rcloneEnv(env, obscuredKey(env));
  const r = run('docker', ['run', '--rm', ...(env.BACKUP_RCLONE_NETWORK ? ['--network', env.BACKUP_RCLONE_NETWORK] : []), ...Object.keys(vars).flatMap((k) => ['-e', k]), '-v', mount, env.BACKUP_RCLONE_IMAGE || 'rclone/rclone:1.68', ...args], { env: vars, allowFail: true });
  if (r.status !== 0) {
    const reason = (r.stderr || '').split(/\r?\n/).filter((l) => /ERROR|Failed|error/.test(l)).slice(-1)[0] ?? `exit ${r.status}`;
    throw new Error(`off-host ${args[0]} failed: ${reason.replace(env.BACKUP_S3_SECRET_ACCESS_KEY || '\u0000', '***').slice(0, 300)}`);
  }
  return r;
};

/** Copies one backup off the host, encrypted, and proves every remote file decrypts to the local bytes. */
function offsite(env, name) {
  rclone(env, ['copy', `/backups/${name}`, `secure:${name}`]);
  rclone(env, ['cryptcheck', '--one-way', `/backups/${name}`, `secure:${name}`]);
  return `offsite:${env.BACKUP_S3_BUCKET}/${prefixOf(env)}/${name} (encrypted)`;
}

/** Downloads and decrypts one off-host backup into `dir/<name>`. */
function fetchOffsite(env, name, dir) {
  if (!BACKUP_NAME.test(name)) throw new Error(`Not a backup name: ${name}`);
  mkdirSync(dir, { recursive: true });
  rclone(env, ['copy', `secure:${name}`, `/restore/${name}`], { mount: `${dir}:/restore` });
  return join(dir, name);
}

const remoteBackups = (env) => rclone(env, ['lsf', '--dirs-only', 'secure:']).stdout.split(/\r?\n/).map((l) => l.replace(/\/$/, '')).filter((n) => BACKUP_NAME.test(n)).sort();

function pruneRemote(env) {
  const expired = selectExpired(remoteBackups(env), retention(env));
  for (const name of expired) rclone(env, ['purge', `secure:${name}`]);
  return expired;
}

const retention = (env) => ({ daily: Number(env.BACKUP_KEEP_DAILY || 7), weekly: Number(env.BACKUP_KEEP_WEEKLY || 4), monthly: Number(env.BACKUP_KEEP_MONTHLY || 6) });

function pruneLocal(env) {
  const expired = selectExpired(existsSync(BACKUPS) ? readdirSync(BACKUPS) : [], retention(env));
  for (const name of expired) rmSync(join(BACKUPS, name), { recursive: true, force: true });
  return expired;
}

/** For schedulers (cron/systemd/Task Scheduler): one backup, verified consistency, off-host copy, retention. */
export function scheduledBackup() {
  requireEnv();
  const env = readEnv();
  const status = { at: new Date().toISOString(), ok: false, name: null, offsite: 'not-configured', pruned_local: [], pruned_remote: [], error: null };
  try {
    const { name } = backup();
    status.name = name;
    if (offsiteConfigured(env)) {
      status.offsite = offsite(env, name);
      status.pruned_remote = pruneRemote(env);
    }
    // Local copies are only pruned after the newest one is safely off the host (or none is configured).
    status.pruned_local = pruneLocal(env);
    status.ok = true;
  } catch (e) {
    status.error = String(e.message).split('\n')[0];
  }
  mkdirSync(BACKUPS, { recursive: true });
  writeFileSync(join(BACKUPS, 'last-backup.json'), JSON.stringify(status, null, 2));
  say(JSON.stringify(status, null, 2));
  if (!status.ok) throw new Error(`Scheduled backup FAILED: ${status.error}`);
  return status;
}

// ── Point-in-time recovery: continuous WAL archiving with pgBackRest (BACKUP_WAL=on) ────────────────────
// The nightly dump bounds data loss to a day. With BACKUP_WAL=on the database (image deploy/db, overlay
// deploy/staging/compose.wal.yaml) also ships every WAL segment to s3://<bucket>/<prefix>/pgbackrest, encrypted, at the
// latest BACKUP_WAL_ARCHIVE_TIMEOUT (60) seconds after it was written; with a daily base backup any moment since the
// oldest kept full backup can be restored. Media files are not in WAL: they come from the newest scheduled backup.

export const walEnabled = (env) => (env.BACKUP_WAL || 'off') === 'on';

export function walProblems(env) {
  const problems = [];
  if (!/^https:\/\//.test(env.BACKUP_S3_ENDPOINT || '')) problems.push('BACKUP_S3_ENDPOINT must be an https:// URL (pgBackRest speaks only TLS to S3)');
  for (const k of ['BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY']) if (!env[k]) problems.push(`${k} is not set`);
  return [...problems, ...encryptionProblems(env)];
}

/** PGBACKREST_* values for compose.wal.yaml, derived from the BACKUP_* settings. */
export function walComposeEnv(env, { archive = true } = {}) {
  const out = { CONGRESS_DB_ARCHIVE_MODE: archive ? 'on' : 'off' };
  // Tuning read by compose.wal.yaml; passed on because it may live in the ops file rather than staging.env.
  for (const k of ['BACKUP_WAL_ARCHIVE_TIMEOUT', 'BACKUP_WAL_RETENTION_FULL', 'BACKUP_WAL_QUEUE_MAX']) if (env[k]) out[k] = env[k];
  if (walProblems(env).length) return out;
  const url = new URL(env.BACKUP_S3_ENDPOINT);
  return {
    ...out,
    PGBACKREST_REPO1_S3_ENDPOINT: url.hostname,
    PGBACKREST_REPO1_STORAGE_PORT: url.port || '443',
    PGBACKREST_REPO1_STORAGE_VERIFY_TLS: (env.BACKUP_S3_VERIFY_TLS || 'on') === 'off' ? 'n' : 'y',
    PGBACKREST_REPO1_S3_BUCKET: env.BACKUP_S3_BUCKET,
    PGBACKREST_REPO1_S3_REGION: env.BACKUP_S3_REGION || 'us-east-1',
    PGBACKREST_REPO1_S3_KEY: env.BACKUP_S3_ACCESS_KEY_ID,
    PGBACKREST_REPO1_S3_KEY_SECRET: env.BACKUP_S3_SECRET_ACCESS_KEY,
    PGBACKREST_REPO1_CIPHER_PASS: env.BACKUP_ENCRYPTION_KEY,
    PGBACKREST_REPO1_PATH: `/${prefixOf(env)}/pgbackrest`,
  };
}

const pgbackrest = (project, args, opts = {}) => compose(project, ['exec', '-T', '-u', 'postgres', 'db', 'pgbackrest', ...args], opts);
const walInfo = (project = PROJECT, opts = {}) => JSON.parse(pgbackrest(project, ['info', '--output=json'], opts).stdout)[0] ?? {};

/** Full when no full backup is younger than `fullDays`, differential otherwise. */
export function chooseBackupType(backups = [], now = Date.now(), fullDays = 7) {
  const fulls = backups.filter((b) => b.type === 'full').map((b) => b.timestamp.stop * 1000);
  return !fulls.length || now - Math.max(...fulls) > fullDays * 86_400_000 ? 'full' : 'diff';
}

/** After `up`: the repository exists (idempotent), archiving works end to end, and there is a base backup. */
function walInit() {
  say('WAL archiving (BACKUP_WAL=on): checking the pgBackRest repository ...');
  pgbackrest(PROJECT, ['stanza-create']);
  // Forces a WAL switch and waits until that segment is in the bucket.
  pgbackrest(PROJECT, ['check']);
  if (!(walInfo().backup ?? []).length) {
    say('  no base backup yet: taking the first full backup');
    baseBackup('full');
  }
  say('  WAL archiving OK');
}

export function baseBackup(requested) {
  requireEnv();
  const env = readEnv();
  if (!walEnabled(env)) throw new Error('base-backup needs BACKUP_WAL=on (see docs/deployment/STAGING_OPERATIONS.md, Point-in-time recovery).');
  if (requested && !['full', 'diff', 'incr'].includes(requested)) throw new Error('usage: base-backup [full|diff|incr]');
  const status = { at: new Date().toISOString(), ok: false, type: null, label: null, wal: null, error: null };
  try {
    status.type = requested || chooseBackupType(walInfo().backup, Date.now(), Number(env.BACKUP_WAL_FULL_DAYS || 7));
    pgbackrest(PROJECT, ['backup', `--type=${status.type}`]);
    const info = walInfo();
    status.label = info.backup?.at(-1)?.label ?? null;
    status.wal = info.archive?.[0] ? `${info.archive[0].min} .. ${info.archive[0].max}` : null;
    status.ok = true;
  } catch (e) {
    status.error = String(e.message).split('\n').filter(Boolean).slice(-1)[0].replace(env.BACKUP_S3_SECRET_ACCESS_KEY || '\u0000', '***').slice(0, 300);
  }
  mkdirSync(BACKUPS, { recursive: true });
  writeFileSync(join(BACKUPS, 'last-base-backup.json'), JSON.stringify(status, null, 2));
  say(JSON.stringify(status, null, 2));
  if (!status.ok) throw new Error(`Base backup FAILED: ${status.error}`);
  return status;
}

/** pgBackRest's --target syntax for an ISO-8601 (or any Date-parsable) time. */
export function pgbackrestTime(input) {
  const ms = Date.parse(input ?? '');
  if (Number.isNaN(ms)) throw new Error('usage: pitr-restore --to <time> | --to latest, e.g. --to 2026-10-22T09:41:00Z (UTC unless an offset is given)');
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '+00');
}

const NEWEST = [['organizers', 'created_at'], ['events', 'created_at'], ['users', 'created_at'], ['tickets', 'created_at'], ['checkins', 'synced_at'], ['sms_messages', 'created_at']];

/**
 * Point-in-time recovery drill: restore the database as it was at `target` into a brand-new Compose project (own data
 * folder under .staging/restores/, no published ports, archive_mode off so it never writes to the bucket), start the
 * normal migrate + api path on it and report what it holds. The live stack is not touched.
 */
export async function pitrRestore(target, { keep = false } = {}) {
  requireEnv();
  const env = readEnv();
  if (!walEnabled(env)) throw new Error('pitr-restore needs BACKUP_WAL=on (continuous WAL archiving).');
  const problems = walProblems(env);
  if (problems.length) throw new Error(`pitr-restore: ${problems.join('; ')}`);
  const latest = target === 'latest';
  const when = latest ? 'latest' : pgbackrestTime(target);
  const project = `congress-pitr-${randomBytes(3).toString('hex')}`;
  const restoreRoot = join(STATE, 'restores', project);
  const opts = { envOverride: { CONGRESS_PERSISTENT_DATA_ROOT: restoreRoot }, wal: true };
  mkdirSync(join(restoreRoot, 'data/postgres'), { recursive: true });
  mkdirSync(join(restoreRoot, 'data/media'), { recursive: true });
  const checks = [];
  const check = (label, ok, detail = '') => { checks.push({ label, ok }); say(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); };
  say(`Restoring the database as it was at ${latest ? 'the end of the WAL archive' : when} into disposable project ${project} (archiving off)`);
  const started = Date.now();
  const dbLog = () => say(compose(project, ['logs', '--tail', '30', 'db'], { ...opts, allowFail: true }).stdout);
  try {
    // `latest`: everything in the archive (pgBackRest's default recovery type); otherwise stop just before `when`.
    const recovery = latest ? '' : ' --type=time "--target=$1" --target-action=promote';
    compose(project, ['run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh', 'db', '-c',
      `set -e; chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"; exec su-exec postgres pgbackrest restore${recovery}`,
      'pitr', when], opts);
    check('pgBackRest restored the base backup', true);
    if (compose(project, ['up', '-d', '--wait', '--wait-timeout', '300', 'db'], { ...opts, allowFail: true }).status !== 0) {
      dbLog();
      throw new Error('The recovered database did not start (log above). "recovery ended before configured recovery target was reached" means nothing was committed after the target and archived yet: choose an earlier time, or --to latest.');
    }
    let state = '';
    for (const end = Date.now() + 900_000; Date.now() < end && state !== 'f';) {
      state = compose(project, ['exec', '-T', 'db', 'psql', '-U', 'congress', '-d', 'congress', '-At', '-c', 'select pg_is_in_recovery()'], { ...opts, allowFail: true }).stdout.trim();
      if (state !== 'f') await sleep(2000);
    }
    if (state !== 'f') dbLog();
    check(`WAL replayed up to ${latest ? 'the end of the archive' : 'the target'} and the database was promoted`, state === 'f', `${Math.round((Date.now() - started) / 1000)} s`);
    if (state !== 'f') throw new Error('Recovery did not finish (database log above). Is the target time covered by the archive? See `pgbackrest info`.');
    compose(project, ['up', '-d', '--wait', '--wait-timeout', '180', 'api'], opts);
    const revision = psql(project, 'select version_num from alembic_version', opts);
    const ready = compose(project, ['exec', '-T', 'api', 'python', '-c', "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/api/ready',timeout=5).status)"], { ...opts, allowFail: true }).stdout.trim();
    check('migrate + API (schema guard) accepted the recovered database', ready === '200', `schema ${revision}`);
    const limit = latest ? Infinity : Date.parse(target) + 1000;
    for (const [table, column] of NEWEST) {
      const newest = psql(project, `select coalesce(max(${column})::text, '') from ${table}`, opts);
      const count = psql(project, `select count(*) from ${table}`, opts);
      check(latest ? `${table} recovered` : `${table}: nothing newer than the target`, !newest || Date.parse(newest.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')) <= limit, `${count} rows, newest ${newest || '-'}`);
    }
  } finally {
    if (keep) say(`Kept ${project} (data: ${restoreRoot}). Inspect: docker compose -p ${project} exec db psql -U congress congress; remove: docker compose -p ${project} down, then delete that folder.`);
    else if (/^congress-pitr-[0-9a-f]{6}$/.test(project)) {
      compose(project, ['down', '--remove-orphans'], { ...opts, allowFail: true });
      removeRestoreRoot(restoreRoot);
    }
  }
  const failed = checks.filter((c) => !c.ok).length;
  say(`pitr-restore: ${checks.length - failed}/${checks.length} checks passed (recovered to ${when} in ${Math.round((Date.now() - started) / 1000)} s)`);
  if (failed) throw new Error('Point-in-time recovery drill failed');
  return checks;
}

/** check: archiving on and succeeding, queue short, base backup fresh. */
function walHealth(env, note) {
  if (!walEnabled(env)) return;
  const sql = "select current_setting('archive_mode'), archived_count, coalesce(last_archived_time::text, ''), failed_count, coalesce(last_failed_time::text, ''), "
    + "(select count(*) from pg_ls_archive_statusdir() where name like '%.ready'), extract(epoch from now() - coalesce(last_archived_time, now()))::int from pg_stat_archiver";
  const r = compose(PROJECT, ['exec', '-T', 'db', 'psql', '-U', 'congress', '-d', 'congress', '-At', '-F', '|', '-c', sql], { allowFail: true });
  if (r.status !== 0) return note('CRITICAL', 'WAL archiving: could not read pg_stat_archiver');
  const [mode, archived, lastOk, failed, lastFail, ready, ageS] = r.stdout.trim().split('|');
  if (mode !== 'on') note('CRITICAL', `BACKUP_WAL=on but archive_mode is ${mode}: the database runs without the WAL overlay (restart it with stack.mjs start)`);
  else if (Number(failed) > 0 && (!lastOk || lastFail > lastOk)) note('CRITICAL', `WAL archiving is failing (last failure ${lastFail}; see: stack.mjs logs db)`);
  else if (Number(ready) > 10) note('WARNING', `WAL archiving is behind: ${ready} segments waiting`);
  else note('OK', `WAL archiving: ${archived} segments archived, last ${lastOk ? `${Math.round(Number(ageS) / 60)} min ago` : 'never'}, ${ready} waiting`);
  const file = join(BACKUPS, 'last-base-backup.json');
  const maxAge = Number(env.BACKUP_WAL_MAX_AGE_HOURS || 26);
  if (!existsSync(file)) return note('WARNING', 'no base backup recorded yet (stack.mjs base-backup)');
  const last = JSON.parse(readFileSync(file, 'utf8'));
  const ageH = (Date.now() - Date.parse(last.at)) / 3_600_000;
  if (!last.ok) note('CRITICAL', `last base backup FAILED at ${last.at}: ${last.error}`);
  else if (ageH > maxAge) note('CRITICAL', `last successful base backup is ${ageH.toFixed(1)} h old (limit ${maxAge} h)`);
  else note('OK', `last base backup ${last.label} (${last.type}), ${ageH.toFixed(1)} h ago`);
}

// ── systemd timers and event-day mode ────────────────────────────────────────────────────────────
// The unit files in deploy/hosted/systemd are templates for /opt/congress-platform, user `congress` and /usr/bin/node;
// install-timers writes them with this checkout's path, the operating user and this Node, then enables the timers.

const UNIT_DIR = join(root, 'deploy/hosted/systemd');
const systemdDir = () => process.env.CONGRESS_SYSTEMD_DIR || '/etc/systemd/system';
const EVENT_DROPIN = 'congress-backup.timer.d/event-mode.conf';
export const EVENT_MODE_CONF = `# Written by \`stack.mjs event-mode on\`: hourly backups during a live congress. Remove: stack.mjs event-mode off
[Timer]
OnCalendar=
OnCalendar=*-*-* *:05:00
RandomizedDelaySec=2m
`;

export function renderUnit(text, { root: dir, user, node }) {
  return text.replaceAll('/opt/congress-platform', dir).replace(/^User=.*$/m, `User=${user}`).replaceAll('/usr/bin/node', node);
}

/** The files to write and the systemctl calls, in order (printed by --dry-run, executed otherwise). */
export function timerPlan({ dir, user, node, wal, units, target = '/etc/systemd/system' }) {
  const names = Object.keys(units).filter((n) => wal || !n.startsWith('congress-basebackup'));
  const timers = names.filter((n) => n.endsWith('.timer'));
  return [
    ...names.map((n) => ({ write: join(target, n), content: renderUnit(units[n], { root: dir, user, node }) })),
    { run: ['systemctl', 'daemon-reload'] },
    { run: ['systemctl', 'enable', '--now', ...timers] },
  ];
}

function executePlan(plan, dryRun) {
  for (const step of plan) {
    if (step.write) {
      say(`${dryRun ? 'would write' : 'write'} ${step.write}`);
      if (dryRun) say(step.content.replace(/^/gm, '    '));
      else { mkdirSync(dirname(step.write), { recursive: true }); writeFileSync(step.write, step.content, { mode: 0o644 }); }
    } else if (step.remove) {
      say(`${dryRun ? 'would remove' : 'remove'} ${step.remove}`);
      if (!dryRun) rmSync(step.remove, { recursive: true, force: true });
    } else {
      say(`${dryRun ? 'would run' : 'run'} ${step.run.join(' ')}`);
      if (!dryRun) run(step.run[0], step.run.slice(1), { allowFail: Boolean(step.allowFail) });
    }
  }
}

function requireRoot(dryRun) {
  if (!dryRun && process.getuid?.() !== 0) throw new Error('Writing systemd units needs root: run with sudo (or add --dry-run to see what would happen).');
}

function installTimers(args) {
  const dryRun = args.includes('--dry-run');
  const userAt = args.indexOf('--user');
  const user = userAt >= 0 ? args[userAt + 1] : process.env.SUDO_USER || userInfo().username;
  if (!user || !/^[a-z_][a-z0-9_-]*$/i.test(user)) throw new Error('usage: install-timers [--user <name>] [--dry-run]');
  requireEnv();
  requireRoot(dryRun);
  if (user !== 'root' && !run('id', ['-nG', user], { allowFail: true }).stdout.split(/\s+/).includes('docker')) {
    say(`Note: ${user} is not in the docker group; the timers would fail. Add it: usermod -aG docker ${user}`);
  }
  const units = Object.fromEntries(readdirSync(UNIT_DIR).filter((n) => /\.(service|timer)$/.test(n)).map((n) => [n, readFileSync(join(UNIT_DIR, n), 'utf8')]));
  executePlan(timerPlan({ dir: root, user, node: process.execPath, wal: walEnabled(readEnv()), units, target: systemdDir() }), dryRun);
  if (!dryRun) say(run('systemctl', ['list-timers', 'congress-*', '--no-pager'], { allowFail: true }).stdout);
}

function uninstallTimers(args) {
  const dryRun = args.includes('--dry-run');
  requireRoot(dryRun);
  const names = readdirSync(UNIT_DIR).filter((n) => /\.(service|timer)$/.test(n));
  executePlan([
    { run: ['systemctl', 'disable', '--now', ...names.filter((n) => n.endsWith('.timer'))], allowFail: true },
    ...names.map((n) => ({ remove: join(systemdDir(), n) })),
    { remove: join(systemdDir(), 'congress-backup.timer.d') },
    { run: ['systemctl', 'daemon-reload'] },
  ], dryRun);
}

const eventModeOn = () => existsSync(join(systemdDir(), EVENT_DROPIN));

function eventMode(args) {
  const [action = 'status'] = args;
  const dryRun = args.includes('--dry-run');
  const file = join(systemdDir(), EVENT_DROPIN);
  if (action === 'status') return say(`event mode: ${eventModeOn() ? 'ON (hourly backups)' : 'off (nightly backups)'}\n${run('systemctl', ['list-timers', 'congress-backup.timer', '--no-pager'], { allowFail: true }).stdout}`);
  if (!['on', 'off'].includes(action)) throw new Error('usage: event-mode on | off | status [--dry-run]');
  requireRoot(dryRun);
  executePlan([
    action === 'on' ? { write: file, content: EVENT_MODE_CONF } : { remove: dirname(file) },
    { run: ['systemctl', 'daemon-reload'] },
    { run: ['systemctl', 'restart', 'congress-backup.timer'] },
  ], dryRun);
  if (action === 'on' && !dryRun) say('Hourly backups on; `check` now expects a backup younger than BACKUP_EVENT_MAX_AGE_HOURS (2). Run `stack.mjs scheduled-backup` once now.');
}

// ── Alert delivery (Telegram) ────────────────────────────────────────────────────────────────────

const ALERT_STATE = join(STATE, 'alert-state.json');

/** The problems, with numbers blanked, so "23 of 400" and "24 of 410" are the same alert. */
export const alertFingerprint = (findings) => findings.filter((f) => f.level === 'WARNING' || f.level === 'CRITICAL')
  .map((f) => `${f.level}:${f.text.replace(/\d+(\.\d+)?/g, '#')}`).sort().join('\n');

/** Send on a new or changed problem, again every `repeatHours` while it lasts, and once when it is resolved. */
export function alertDecision(previous, level, findings, now = Date.now(), repeatHours = 6) {
  const fingerprint = alertFingerprint(findings);
  const prev = previous ?? { level: 0, fingerprint: '', sent_at: null };
  if (level === 0) return prev.level > 0 ? { kind: 'recovery', state: { level: 0, fingerprint: '', sent_at: new Date(now).toISOString() } } : { kind: null, state: prev };
  const stale = !prev.sent_at || now - Date.parse(prev.sent_at) >= repeatHours * 3_600_000;
  if (prev.level === level && prev.fingerprint === fingerprint && !stale) return { kind: null, state: prev };
  return { kind: prev.level > 0 && prev.fingerprint === fingerprint ? 'reminder' : 'alert', state: { level, fingerprint, sent_at: new Date(now).toISOString() } };
}

export function alertText(kind, level, findings, env) {
  const where = env.CONGRESS_PUBLIC_ORIGIN || hostname();
  if (kind === 'recovery') return `[RECOVERED] Congress Platform ${where}: all checks OK again.`;
  const lines = findings.filter((f) => f.level === 'WARNING' || f.level === 'CRITICAL').map((f) => `- ${f.level}: ${f.text}`);
  return [`[${['OK', 'WARNING', 'CRITICAL'][level]}]${kind === 'reminder' ? ' (still)' : ''} Congress Platform ${where}`, ...lines, '', `On the server: node scripts/staging/stack.mjs check`].join('\n');
}

async function deliverAlert(env, level, findings) {
  const token = env.ALERT_TELEGRAM_BOT_TOKEN;
  const chat = env.ALERT_TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  let previous = null;
  try { previous = JSON.parse(readFileSync(ALERT_STATE, 'utf8')); } catch { /* first run */ }
  const { kind, state } = alertDecision(previous, level, findings, Date.now(), Number(env.ALERT_REPEAT_HOURS || 6));
  if (!kind) return;
  // ALERT_TELEGRAM_API: a relay with the same API where api.telegram.org is not reachable from the server.
  const base = (env.ALERT_TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: alertText(kind, level, findings, env), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    mkdirSync(STATE, { recursive: true });
    writeFileSync(ALERT_STATE, JSON.stringify(state, null, 2));
    say(`  alert   Telegram ${kind} sent`);
  } catch (e) {
    // Not recorded as sent, so the next check tries again.
    say(`  WARNING Telegram ${kind} could not be sent: ${String(e.message).replace(token, '***').slice(0, 200)}`);
  }
}

// ── Operator health check ────────────────────────────────────────────────────────────────────────

export async function healthCheck() {
  requireEnv();
  const env = readEnv();
  const findings = [];
  const note = (level, text) => { findings.push({ level, text }); say(`  ${level.padEnd(8)} ${text}`); };
  const rows = JSON.parse(`[${compose(PROJECT, ['ps', '-a', '--format', 'json']).stdout.trim().split(/\r?\n/).filter(Boolean).join(',')}]`);
  const by = Object.fromEntries(rows.map((r) => [r.Service, r]));
  for (const svc of ['db', 'api', 'web']) {
    const r = by[svc];
    if (!r || r.State !== 'running') note('CRITICAL', `${svc} is ${r ? r.State : 'missing'}`);
    else if (r.Health && r.Health !== 'healthy') note('CRITICAL', `${svc} health: ${r.Health}`);
    else note('OK', `${svc} running${r.Health ? ', healthy' : ''}`);
  }
  if (by.migrate && by.migrate.State === 'exited' && by.migrate.ExitCode !== 0) note('CRITICAL', `last migration exited ${by.migrate.ExitCode}`);
  try {
    const r = await fetch(`http://localhost:${env.CONGRESS_HTTP_PORT || 18080}/api/ready`);
    note(r.status === 200 ? 'OK' : 'CRITICAL', `/api/ready through the proxy: ${r.status}`);
  } catch {
    // Hosted servers have no plain-HTTP localhost site; ask the API container directly.
    const r = compose(PROJECT, ['exec', '-T', 'api', 'python', '-c', "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/api/ready',timeout=5).status)"], { allowFail: true });
    note(r.stdout.trim() === '200' ? 'OK' : 'CRITICAL', `/api/ready in the API container: ${r.stdout.trim() || 'unreachable'}`);
  }
  // Server errors seen by the proxy in the last 15 minutes (Caddy JSON access log).
  const logs = compose(PROJECT, ['logs', '--since', '15m', '--no-log-prefix', 'web'], { allowFail: true }).stdout.split(/\r?\n/);
  const errors = logs.filter((l) => /"status":5\d\d/.test(l)).length;
  const total = logs.filter((l) => /"status":\d{3}/.test(l)).length;
  note(errors > 20 || (total > 50 && errors / total > 0.05) ? 'WARNING' : 'OK', `HTTP 5xx in the last 15 min: ${errors} of ${total} requests`);
  const apiErrors = compose(PROJECT, ['logs', '--since', '15m', '--no-log-prefix', 'api'], { allowFail: true }).stdout.split(/\r?\n/).filter((l) => /Traceback|ERROR/.test(l)).length;
  note(apiErrors ? 'WARNING' : 'OK', `API error lines in the last 15 min: ${apiErrors}`);
  // Disk: the filesystem holding Docker volumes, plus each persistent volume.
  const probe = `${PROJECT}-check-${randomBytes(3).toString('hex')}`;
  const { postgres, media } = persistentPaths();
  const du = run('docker', ['run', '--rm', '--name', probe, '--network', 'none', '-v', `${postgres}:/v/pgdata:ro`, '-v', `${media}:/v/media:ro`, 'postgres:16-alpine', 'sh', '-c', 'df -Pk /v | tail -1; du -sk /v/pgdata /v/media'], { allowFail: true }).stdout.trim().split('\n');
  if (du.length >= 3) {
    const [, sizeK, usedK, availK, pct] = du[0].split(/\s+/);
    const used = Number(String(pct).replace('%', ''));
    note(used >= 90 ? 'CRITICAL' : used >= 80 ? 'WARNING' : 'OK', `docker volume disk ${used}% used (${Math.round(availK / 1048576)} GiB free of ${Math.round(sizeK / 1048576)} GiB)`);
    for (const line of du.slice(1)) { const [k, path] = line.split(/\s+/); note('INFO', `${path.replace('/v/', 'volume ')}: ${Math.round(Number(k) / 1024)} MiB`); }
  } else note('WARNING', 'could not measure volume disk usage');
  // Backups: freshness and last result (event mode: hourly backups, so a much shorter limit).
  const statusFile = join(BACKUPS, 'last-backup.json');
  const maxAge = eventModeOn() ? Number(env.BACKUP_EVENT_MAX_AGE_HOURS || 2) : Number(env.BACKUP_MAX_AGE_HOURS || 26);
  if (!existsSync(statusFile)) note('WARNING', 'no scheduled backup has run yet');
  else {
    const last = JSON.parse(readFileSync(statusFile, 'utf8'));
    const ageH = (Date.now() - Date.parse(last.at)) / 3_600_000;
    if (!last.ok) note('CRITICAL', `last scheduled backup FAILED at ${last.at}: ${last.error}`);
    else if (ageH > maxAge) note('CRITICAL', `last successful backup is ${ageH.toFixed(1)} h old (limit ${maxAge} h)`);
    else note('OK', `last backup ${last.name}, ${ageH.toFixed(1)} h ago, off-host: ${last.offsite}`);
  }
  walHealth(env, note);
  const level = findings.some((f) => f.level === 'CRITICAL') ? 2 : findings.some((f) => f.level === 'WARNING') ? 1 : 0;
  say(`check: ${['OK', 'WARNING', 'CRITICAL'][level]}`);
  await deliverAlert(env, level, findings);
  return level;
}

/** `check` for schedulers: a check that cannot even run is itself critical, and alerted on. */
async function checkCommand() {
  try {
    return await healthCheck();
  } catch (e) {
    const text = `the health check itself failed: ${String(e.message).split('\n')[0].slice(0, 200)}`;
    say(`  CRITICAL ${text}\ncheck: CRITICAL`);
    if (existsSync(ENV_FILE)) await deliverAlert(readEnv(), 2, [{ level: 'CRITICAL', text }]);
    return 2;
  }
}

/** The API's Prometheus metrics, fetched inside the API container with its own token (no scraper needed). */
function metricsCommand() {
  requireEnv();
  const script = `
import os, sys, urllib.request, urllib.error
token = os.environ.get("CONGRESS_METRICS_TOKEN", "")
if not token:
    print("CONGRESS_METRICS_TOKEN is not set: /api/metrics is disabled", file=sys.stderr); sys.exit(1)
req = urllib.request.Request("http://127.0.0.1:8000/api/metrics", headers={"Authorization": "Bearer " + token})
print(urllib.request.urlopen(req, timeout=10).read().decode())`;
  return compose(PROJECT, ['exec', '-T', 'api', 'python', '-c', script]).stdout;
}

// ── Platform administration (never through the public proxy) ───────────────────────────────────

function organizerAdmin(args) {
  requireEnv();
  const [action, arg] = args;
  const routes = { list: ['GET', '/api/organizers', null], create: ['POST', '/api/organizers', { name: arg }], rotate: ['POST', `/api/organizers/${arg}/rotate-key`, null], revoke: ['POST', `/api/organizers/${arg}/revoke`, null] };
  if (!routes[action] || (action !== 'list' && !arg)) throw new Error('usage: organizer list | create <name> | rotate <organizer-id> | revoke <organizer-id>');
  const [method, path, body] = routes[action];
  // Runs inside the API container: the admin token comes from that container's environment and never
  // leaves it; the request goes to 127.0.0.1 and does not pass through Caddy.
  const script = `
import json, os, sys, urllib.request, urllib.error
req = urllib.request.Request("http://127.0.0.1:8000" + sys.argv[1], method=sys.argv[2], data=(sys.argv[3].encode() if sys.argv[3] != "null" else None),
    headers={"X-Admin-Token": os.environ["CONGRESS_PLATFORM_ADMIN_TOKEN"], "Content-Type": "application/json"})
try:
    print(json.dumps(json.load(urllib.request.urlopen(req, timeout=10)), indent=2))
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode(), file=sys.stderr); sys.exit(1)`;
  const out = compose(PROJECT, ['exec', '-T', 'api', 'python', '-c', script, path, method, JSON.stringify(body)]).stdout;
  say(out);
  if (action === 'create' || action === 'rotate') say('The api_key above is shown once. Hand it to the organizer over a secure channel; it cannot be retrieved again.');
}

/** Newest sign-in code the console SMS provider recorded for a number (staging checks; nothing is sent). */
export function smsCode(mobile) {
  requireEnv();
  if (!mobile) throw new Error('usage: sms-code <mobile>');
  const script = `
import json, os, sys, urllib.parse, urllib.request, urllib.error
url = "http://127.0.0.1:8000/api/platform/sms-outbox?" + urllib.parse.urlencode({"mobile": sys.argv[1]})
req = urllib.request.Request(url, headers={"X-Admin-Token": os.environ["CONGRESS_PLATFORM_ADMIN_TOKEN"]})
try:
    sent = json.load(urllib.request.urlopen(req, timeout=10))
except urllib.error.HTTPError as e:
    print(e.code, "(is CONGRESS_SMS_PROVIDER=console?)", file=sys.stderr); sys.exit(1)
codes = [m["code"] for m in sent if m["code"]]
if not codes:
    print("no code recorded for this number", file=sys.stderr); sys.exit(1)
print(codes[0])`;
  return compose(PROJECT, ['exec', '-T', 'api', 'python', '-c', script, mobile]).stdout.trim();
}

/** Platform-wide SMS wording (sign-in code, default ticket confirmation), from inside the API container. */
function smsTemplateAdmin(args) {
  requireEnv();
  const [action, kind, ...rest] = args;
  const usage = 'usage: sms-template list | set <otp|ticket_confirmation> (<text> | --file <path>) | reset <otp|ticket_confirmation>';
  if (!['list', 'set', 'reset'].includes(action) || (action !== 'list' && !['otp', 'ticket_confirmation'].includes(kind))) throw new Error(usage);
  let body = null;
  if (action === 'set') {
    body = rest[0] === '--file' ? readFileSync(rest[1], 'utf8') : rest.join(' ');
    if (!body.trim()) throw new Error(usage);
  }
  const [method, path] = { list: ['GET', ''], set: ['PUT', `/${kind}`], reset: ['DELETE', `/${kind}`] }[action];
  const script = `
import json, os, sys, urllib.request, urllib.error
data = sys.stdin.buffer.read()
req = urllib.request.Request("http://127.0.0.1:8000/api/platform/sms-templates" + sys.argv[1], method=sys.argv[2],
    data=data or None, headers={"X-Admin-Token": os.environ["CONGRESS_PLATFORM_ADMIN_TOKEN"], "Content-Type": "application/json"})
try:
    out = json.load(urllib.request.urlopen(req, timeout=10))
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode(), file=sys.stderr); sys.exit(1)
for t in (out if isinstance(out, list) else [out]):
    print(f"--- {t['kind']} ({'custom' if t['is_custom'] else 'built-in default'}); placeholders: " + ", ".join("{" + p + "}" for p in t["placeholders"]))
    print(t["body"])`;
  const input = body === null ? '' : JSON.stringify({ body });
  return compose(PROJECT, ['exec', '-T', 'api', 'python', '-c', script, path, method], { input }).stdout;
}

function listBackups(args = []) {
  if (args.includes('--offsite')) {
    requireEnv();
    const env = readEnv();
    if (!offsiteConfigured(env)) throw new Error('No off-host store configured (BACKUP_S3_*).');
    const names = remoteBackups(env);
    for (const name of names) say(`  ${name}  (encrypted, offsite:${env.BACKUP_S3_BUCKET}/${prefixOf(env)}/${name})`);
    return say(names.length ? `${names.length} off-host backups. Verify one: stack.mjs restore-verify <name> --from-offsite` : 'No off-host backups.');
  }
  if (!existsSync(BACKUPS)) return say('No backups yet.');
  for (const name of readdirSync(BACKUPS).sort()) {
    const m = join(BACKUPS, name, 'manifest.json');
    if (!existsSync(m)) continue;
    const j = JSON.parse(readFileSync(m, 'utf8'));
    say(`  ${name}  rev ${j.alembic_revision}  events ${j.counts.events}  tickets ${j.counts.tickets}  media ${j.media_sha256.length}`);
  }
}

/**
 * Restore a backup into a brand-new, separately named Compose project (its own host data directory under
 * .staging/restores/, no published ports), run the normal migrate + api services against it, and compare.
 */
export async function restoreVerify(name, { keep = false, fromOffsite = false } = {}) {
  requireEnv();
  if (!name) throw new Error('usage: restore-verify <backup name> [--keep] [--from-offsite]');
  if (!fromOffsite) return verifyRestore(name, join(BACKUPS, name), { keep });
  // The off-host copy itself: downloaded and decrypted into a throw-away folder, then the same checksums and checks.
  const fetched = join(STATE, 'restores', `offsite-${randomBytes(3).toString('hex')}`);
  try {
    say(`Downloading and decrypting ${name} from the off-host copy ...`);
    return await verifyRestore(name, fetchOffsite(readEnv(), name, fetched), { keep });
  } finally {
    rmSync(fetched, { recursive: true, force: true });
  }
}

/** Deletes a disposable restore folder; PostgreSQL's files in it belong to the container's postgres user. */
function removeRestoreRoot(dir) {
  if (!existsSync(dir)) return;
  run('docker', ['run', '--rm', '--network', 'none', '-v', `${dir}:/r`, 'postgres:16-alpine', 'sh', '-c', 'rm -rf /r/* /r/.[!.]*'], { allowFail: true });
  rmSync(dir, { recursive: true, force: true });
}

async function verifyRestore(name, dir, { keep }) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  for (const [f, sum] of Object.entries(manifest.files)) {
    if (createHash('sha256').update(readFileSync(join(dir, f))).digest('hex') !== sum) throw new Error(`${f} checksum mismatch`);
  }
  const project = `congress-restore-${randomBytes(3).toString('hex')}`;
  const restoreRoot = join(STATE, 'restores', project);
  const envOverride = { CONGRESS_PERSISTENT_DATA_ROOT: restoreRoot };
  mkdirSync(restoreRoot, { recursive: true });
  run(join(root, 'scripts/staging/fix-persistent-permissions.sh'), [], {
    allowFail: true,
    env: { ...process.env, CONGRESS_PERSISTENT_DATA_ROOT: restoreRoot },
  });
  const checks = [];
  const check = (label, ok, detail = '') => { checks.push({ label, ok }); say(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); };
  say(`Restoring ${name} into disposable project ${project}`);
  try {
    compose(project, ['up', '-d', '--wait', 'db'], { envOverride });
    const dbId = compose(project, ['ps', '-q', 'db']).stdout.trim();
    run('docker', ['cp', join(dir, 'db.dump'), `${dbId}:/tmp/restore.dump`]);
    compose(project, ['exec', '-T', 'db', 'pg_restore', '-U', 'congress', '-d', 'congress', '--no-owner', '--exit-on-error', '/tmp/restore.dump'], { envOverride });
    const helper = `${project}-media`;
    const restoreMedia = join(restoreRoot, 'data/media');
    run('docker', ['run', '-d', '--name', helper, '--network', 'none', '-v', `${restoreMedia}:/data`, 'postgres:16-alpine', 'sleep', '600']);
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
    compose(project, ['up', '-d', '--wait', '--wait-timeout', '180', 'api'], { envOverride });
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
    if (keep) say(`Kept ${project} (data: ${restoreRoot}; remove with compose down and delete that folder)`);
    else if (/^congress-restore-[0-9a-f]{6}$/.test(project)) {
      compose(project, ['down', '--remove-orphans'], { allowFail: true, envOverride });
      removeRestoreRoot(restoreRoot);
    }
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
    case 'start': requireEnv(); cdnPreflight(); compose(PROJECT, ['up', '-d', '--wait', '--wait-timeout', '300']); return status();
    case 'migrate': requireEnv(); return say(compose(PROJECT, ['run', '--rm', 'migrate']).stderr);
    case 'ca': return exportCa();
    case 'lan': return lan(rest[0]);
    case 'cdn': return cdn(rest);
    case 'releases': return listReleases();
    case 'rollback': return rollback(rest.find((a) => !a.startsWith('-')));
    case 'backup': return backup();
    case 'backups': return listBackups(rest);
    case 'restore-verify': return restoreVerify(rest.find((a) => !a.startsWith('-')), { keep: rest.includes('--keep'), fromOffsite: rest.includes('--from-offsite') });
    case 'scheduled-backup': return scheduledBackup();
    case 'base-backup': return baseBackup(rest[0]);
    case 'pitr-restore': {
      const at = rest.indexOf('--to');
      return pitrRestore(at >= 0 ? rest[at + 1] : undefined, { keep: rest.includes('--keep') });
    }
    case 'install-timers': return installTimers(rest);
    case 'uninstall-timers': return uninstallTimers(rest);
    case 'event-mode': return eventMode(rest);
    case 'check': process.exitCode = await checkCommand(); return;
    case 'metrics': return say(metricsCommand());
    case 'organizer': return organizerAdmin(rest);
    case 'sms-code': return say(smsCode(rest[0]));
    case 'sms-template': return say(smsTemplateAdmin(rest));
    default: throw new Error(`Unknown command ${cmd}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
