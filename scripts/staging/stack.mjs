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
 *   node scripts/staging/stack.mjs lan [<ip> | off]   serve the stack on this computer's current network address
 *                                                     (detected; run again after joining another network)
 *   node scripts/staging/stack.mjs cdn <status|check|sync|parspack|origin|only|off>
 *                                                     a CDN (ParsPack) in front: trusted ranges, real visitor address, origin protocol
 *   node scripts/staging/stack.mjs backup             timestamped database + media backup in .staging/backups
 *   node scripts/staging/stack.mjs backups            list backups
 *   node scripts/staging/stack.mjs restore-verify <name> [--keep]
 *                                                     restore a backup into a NEW disposable project and verify it
 *   node scripts/staging/stack.mjs scheduled-backup   backup + consistency check + off-host copy + retention;
 *                                                     writes .staging/backups/last-backup.json, exit 1 on failure
 *   node scripts/staging/stack.mjs check              operator health check (exit 0 ok, 1 warning, 2 critical)
 *   node scripts/staging/stack.mjs organizer list | create <name> | rotate <id> | revoke <id>
 *                                                     platform administration from inside the API container
 *   node scripts/staging/stack.mjs sms-code <mobile>  newest SMS sign-in code (CONGRESS_SMS_PROVIDER=console only)
 *   node scripts/staging/stack.mjs sms-template list | set <otp|ticket_confirmation> (<text> | --file <path>) | reset <kind>
 *                                                     platform-wide SMS wording (organizers override the confirmation per event)
 *
 * Data lives on the host under CONGRESS_PERSISTENT_DATA_ROOT (not Docker named volumes).
 * `down -v` no longer wipes production data; restore-verify uses a disposable folder under .staging/restores/.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { isIP } from 'node:net';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATE = join(root, '.staging');
const ENV_FILE = join(STATE, 'staging.env');
const BACKUPS = join(STATE, 'backups');
const COMPOSE_FILE = join(root, 'deploy/staging/compose.yaml');
const PROJECT = 'congress-staging';

function composeEnvFile(override) {
  if (!override || !Object.keys(override).length) return ENV_FILE;
  const map = { ...readEnv(), ...override };
  const body = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  const tmp = join(STATE, `.compose-env-${process.pid}-${randomBytes(3).toString('hex')}.tmp`);
  writeFileSync(tmp, body, { mode: 0o600 });
  return tmp;
}
export const compose = (project, args, opts = {}) =>
  run('docker', ['compose', '-p', project, '--env-file', composeEnvFile(opts.envOverride), '-f', COMPOSE_FILE, ...args], opts);

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
export const readEnv = () => ({
  ...Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  ),
  // Backup settings may also come from the scheduler's environment (e.g. a separate secrets file), so the
  // off-host credentials need not live next to the application secrets.
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('BACKUP_'))),
});
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
    CONGRESS_PERSISTENT_DATA_ROOT: join(homedir(), 'congress-persistent-data'),
  };
  const env = template.replace(/^(POSTGRES_PASSWORD|CONGRESS_PLATFORM_ADMIN_TOKEN|CONGRESS_JWT_SECRET|CONGRESS_PERSISTENT_DATA_ROOT)=.*$/gm, (_, k) => `${k}=${values[k]}`);
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
  compose(PROJECT, ['build', ...buildProxyArgs()], { env: buildComposeEnv() });
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

/** Keep the newest N backups plus the newest per ISO week (W) and per month (M); everything else is old. */
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
  take((n) => { const d = date(n); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); }, weekly);
  take((n) => n.slice(8, 14), monthly);
  return sorted.filter((n) => !keep.has(n));
}

// Credentials travel as environment variables of the docker client process (`-e NAME` without a value),
// so they never appear on a command line, in an error message or in the status file.
function rcloneEnv(env) {
  return {
    RCLONE_CONFIG_OFFSITE_TYPE: 's3',
    RCLONE_CONFIG_OFFSITE_PROVIDER: env.BACKUP_S3_PROVIDER || 'Other',
    RCLONE_CONFIG_OFFSITE_ENDPOINT: env.BACKUP_S3_ENDPOINT,
    RCLONE_CONFIG_OFFSITE_REGION: env.BACKUP_S3_REGION || 'us-east-1',
    RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID: env.BACKUP_S3_ACCESS_KEY_ID,
    RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY: env.BACKUP_S3_SECRET_ACCESS_KEY,
    RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE: 'true',
    RCLONE_S3_NO_CHECK_BUCKET: 'true',
  };
}
const rclone = (env, args) => {
  const vars = rcloneEnv(env);
  const r = run('docker', ['run', '--rm', ...(env.BACKUP_RCLONE_NETWORK ? ['--network', env.BACKUP_RCLONE_NETWORK] : []), ...Object.keys(vars).flatMap((k) => ['-e', k]), '-v', `${BACKUPS}:/backups:ro`, env.BACKUP_RCLONE_IMAGE || 'rclone/rclone:1.68', ...args], { env: vars, allowFail: true });
  if (r.status !== 0) {
    const reason = (r.stderr || '').split(/\r?\n/).filter((l) => /ERROR|Failed|error/.test(l)).slice(-1)[0] ?? `exit ${r.status}`;
    throw new Error(`off-host ${args[0]} failed: ${reason.replace(env.BACKUP_S3_SECRET_ACCESS_KEY || '\u0000', '***').slice(0, 300)}`);
  }
  return r;
};

/** Copies one backup off the host and proves the remote copy matches byte-for-byte. */
function offsite(env, name) {
  const remote = `offsite:${env.BACKUP_S3_BUCKET}/${(env.BACKUP_S3_PREFIX || 'congress').replace(/\/$/, '')}/${name}`;
  rclone(env, ['copy', '--checksum', `/backups/${name}`, remote]);
  rclone(env, ['check', '--one-way', `/backups/${name}`, remote]);
  return remote;
}

function pruneRemote(env) {
  const base = `offsite:${env.BACKUP_S3_BUCKET}/${(env.BACKUP_S3_PREFIX || 'congress').replace(/\/$/, '')}`;
  const names = rclone(env, ['lsf', '--dirs-only', base]).stdout.split(/\r?\n/).map((l) => l.replace(/\/$/, '')).filter(Boolean);
  const expired = selectExpired(names, retention(env));
  for (const name of expired) rclone(env, ['purge', `${base}/${name}`]);
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
    if (env.BACKUP_S3_ENDPOINT && env.BACKUP_S3_BUCKET) {
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
  // Backups: freshness and last result.
  const statusFile = join(BACKUPS, 'last-backup.json');
  const maxAge = Number(env.BACKUP_MAX_AGE_HOURS || 26);
  if (!existsSync(statusFile)) note('WARNING', 'no scheduled backup has run yet');
  else {
    const last = JSON.parse(readFileSync(statusFile, 'utf8'));
    const ageH = (Date.now() - Date.parse(last.at)) / 3_600_000;
    if (!last.ok) note('CRITICAL', `last scheduled backup FAILED at ${last.at}: ${last.error}`);
    else if (ageH > maxAge) note('CRITICAL', `last successful backup is ${ageH.toFixed(1)} h old (limit ${maxAge} h)`);
    else note('OK', `last backup ${last.name}, ${ageH.toFixed(1)} h ago, off-host: ${last.offsite}`);
  }
  const level = findings.some((f) => f.level === 'CRITICAL') ? 2 : findings.some((f) => f.level === 'WARNING') ? 1 : 0;
  say(`check: ${['OK', 'WARNING', 'CRITICAL'][level]}`);
  return level;
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
 * Restore a backup into a brand-new, separately named Compose project (its own host data directory under
 * .staging/restores/, no published ports), run the normal migrate + api services against it, and compare.
 */
export async function restoreVerify(name, { keep = false } = {}) {
  requireEnv();
  const dir = join(BACKUPS, name);
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
      rmSync(restoreRoot, { recursive: true, force: true });
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
    case 'backup': return backup();
    case 'backups': return listBackups();
    case 'restore-verify': return restoreVerify(rest[0], { keep: rest.includes('--keep') });
    case 'scheduled-backup': return scheduledBackup();
    case 'check': process.exitCode = await healthCheck(); return;
    case 'organizer': return organizerAdmin(rest);
    case 'sms-code': return say(smsCode(rest[0]));
    case 'sms-template': return say(smsTemplateAdmin(rest));
    default: throw new Error(`Unknown command ${cmd}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
