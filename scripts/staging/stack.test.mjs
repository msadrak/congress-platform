// Unit tests for the pure parts of the operations tool:  node --test scripts/staging/stack.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alertDecision, alertFingerprint, alertText, buildProxyArgs, CDN_IPS_VENDORED, cdnProblems, certFinding, certTarget, chooseBackupType,
  dataDirWarnings, DRILL_API_ENV, encryptionProblems, EVENT_MODE_CONF, fillTemplate, freshSecrets, loadParsPackCdnIpListText,
  missingMediaKeys, missingSecrets, nextReleases, offsiteConfigured, parseAddressRanges, parseEnvText, pgbackrestTime, prefixOf,
  rcloneEnv, releaseId, rollbackTarget, selectExpired, smsFindings, SNAPSHOT_BACKUP_SCRIPT, SNAPSHOT_FACTS_SQL, timerPlan,
  walComposeEnv, walEnabled, walProblems, writeVendoredCdnIpList,
} from './stack.mjs';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNITS = join(dirname(fileURLToPath(import.meta.url)), '../../deploy/hosted/systemd');

test('parseAddressRanges accepts addresses and ranges, ignores blanks, comments and duplicates', () => {
  const text = '185.208.173.0/24\r\n\n# note\n2.144.23.191/32  # one host\n2.144.23.191/32\n89.187.169.11\n2001:db8::/48\n';
  assert.deepEqual(parseAddressRanges(text), ['185.208.173.0/24', '2.144.23.191/32', '89.187.169.11', '2001:db8::/48']);
});

test('parseAddressRanges refuses anything that is not an address or range', () => {
  for (const bad of ['example.com', '999.1.1.1/24', '10.0.0.0/33', '10.0.0.0/24/1', '10.0.0.0/abc', '<html>', '1.2.3.4 5.6.7.8']) {
    assert.throws(() => parseAddressRanges(bad), /Not an address/, bad);
  }
});

test('parseAddressRanges refuses ranges so wide that "trusted" would mean everybody', () => {
  for (const wide of ['0.0.0.0/0', '10.0.0.0/8', '1.2.0.0/15', '::/0', '2001::/16']) {
    assert.throws(() => parseAddressRanges(wide), /too wide/, wide);
  }
  assert.deepEqual(parseAddressRanges('1.2.0.0/16'), ['1.2.0.0/16']);
});

test('parseAddressRanges refuses an implausibly long list', () => {
  const many = Array.from({ length: 600 }, (_, i) => `10.${Math.floor(i / 250)}.${i % 250}.0/24`).join('\n');
  assert.throws(() => parseAddressRanges(many), /not a CDN list/);
});

test('cdnProblems: a CDN setting without trusted ranges is refused', () => {
  assert.equal(cdnProblems({ CONGRESS_SITE_ADDRESS: 'x.example' }).length, 0);
  assert.match(cdnProblems({ CONGRESS_CDN: 'on', CONGRESS_SITE_ADDRESS: 'x.example' }).join(), /TRUSTED_PROXIES is empty/);
  assert.match(cdnProblems({ CONGRESS_CDN_ONLY: 'on', CONGRESS_TRUSTED_PROXIES: '1.2.3.0/24', CONGRESS_SITE_ADDRESS: 'x.example' }).join(), /needs CONGRESS_CDN=on/);
  assert.equal(cdnProblems({ CONGRESS_CDN: 'on', CONGRESS_TRUSTED_PROXIES: '1.2.3.0/24', CONGRESS_SITE_ADDRESS: 'x.example' }).length, 0);
});

test('cdnProblems: the origin protocol and the site address must agree', () => {
  assert.match(cdnProblems({ CONGRESS_ORIGIN_TLS: 'off', CONGRESS_SITE_ADDRESS: 'x.example' }).join(), /start with http:\/\//);
  assert.match(cdnProblems({ CONGRESS_SITE_ADDRESS: 'http://x.example' }).join(), /cdn origin https/);
  assert.equal(cdnProblems({ CONGRESS_ORIGIN_TLS: 'off', CONGRESS_SITE_ADDRESS: 'http://x.example' }).length, 0);
  // Local staging's address list must keep working.
  assert.equal(cdnProblems({ CONGRESS_SITE_ADDRESS: 'https://localhost, https://172.16.1.7' }).length, 0);
});

test('vendored ParsPack list loads offline', async () => {
  const { text, source } = await loadParsPackCdnIpListText({ offline: true });
  assert.equal(source, 'vendored');
  assert.ok(parseAddressRanges(text).length >= 40);
  assert.equal(readFileSync(CDN_IPS_VENDORED, 'utf8').trim(), writeVendoredCdnIpList(text).join('\n'));
});

test('buildProxyArgs is empty without a proxy and sets both spellings with one', () => {
  assert.deepEqual(buildProxyArgs({}), []);
  const args = buildProxyArgs({ CONGRESS_BUILD_PROXY: 'http://172.17.0.1:8118', CONGRESS_BUILD_NO_PROXY: 'localhost' });
  assert.ok(args.includes('HTTPS_PROXY=http://172.17.0.1:8118') && args.includes('https_proxy=http://172.17.0.1:8118') && args.includes('no_proxy=localhost'));
});

// ── Backups, releases, timers, alerts (pure parts) ───────────────────────────────────────────────

test('selectExpired keeps the newest N, one per day for N days, weekly and monthly; hourly event backups never push out dailies', () => {
  const daily = ['20261010', '20261011', '20261012', '20261013', '20261014', '20261015', '20261016'].map((d) => `staging-${d}-023000`);
  const hourly = Array.from({ length: 10 }, (_, h) => `staging-20261017-${String(8 + h).padStart(2, '0')}0500`);
  const expired = selectExpired([...daily, ...hourly, 'not-a-backup', 'last-backup.json'], { daily: 7, weekly: 0, monthly: 0 });
  // The 3 oldest hourly ones go; every one of the 7 days keeps its backup (the oldest day falls outside the 7 days).
  assert.deepEqual(expired, [...hourly.slice(0, 3).reverse(), daily[0]]);
  assert.ok(daily.slice(1).every((n) => !expired.includes(n)));
});

test('nextReleases keeps five releases, newest first, and names the expired ones', () => {
  let state = { current: null, history: [] };
  const expired = [];
  for (const id of ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7']) {
    const next = nextReleases(state, { id, at: id, alembic_revision: '0018' });
    state = next.state;
    expired.push(...next.expired);
  }
  assert.deepEqual(state.history.map((r) => r.id), ['g7', 'f6', 'e5', 'd4', 'c3']);
  assert.equal(state.current, 'g7');
  assert.deepEqual(expired, ['a1', 'b2']);
  // Rebuilding a release moves it to the front instead of duplicating it.
  assert.deepEqual(nextReleases(state, { id: 'e5' }).state.history.map((r) => r.id), ['e5', 'g7', 'f6', 'd4', 'c3']);
});

test('rollbackTarget: the previous release by default, an explicit one by id or unique prefix', () => {
  const state = { current: 'c3', history: [{ id: 'c3' }, { id: 'b2aa' }, { id: 'b2bb' }, { id: 'a1' }] };
  assert.equal(rollbackTarget(state).id, 'b2aa');
  assert.equal(rollbackTarget({ ...state, current: 'b2bb' }).id, 'a1');
  assert.equal(rollbackTarget(state, 'a1').id, 'a1');
  assert.equal(rollbackTarget(state, 'b2b').id, 'b2bb');
  assert.throws(() => rollbackTarget(state, 'b2'), /matches several/);
  assert.throws(() => rollbackTarget(state, 'zz'), /not among the kept releases/);
  assert.throws(() => rollbackTarget(state, 'c3'), /already the current/);
  assert.throws(() => rollbackTarget({ current: 'a1', history: [{ id: 'a1' }] }), /No earlier release/);
});

test('releaseId is the short commit of this checkout', () => {
  assert.match(releaseId(), /^([0-9a-f]{7,}(-dirty-\d{8}-\d{6})?|build-\d{8}-\d{6})$/);
});

test('timerPlan installs the units with this checkout, user and Node, then enables the timers', () => {
  const units = Object.fromEntries(readdirSync(UNITS).map((n) => [n, readFileSync(join(UNITS, n), 'utf8')]));
  const plan = timerPlan({ dir: '/srv/congress', user: 'ops', node: '/usr/local/bin/node', wal: false, units, target: '/tmp/sd' });
  const writes = plan.filter((s) => s.write);
  assert.deepEqual(writes.map((s) => s.write).sort(), ['/tmp/sd/congress-backup.service', '/tmp/sd/congress-backup.timer', '/tmp/sd/congress-check.service', '/tmp/sd/congress-check.timer']);
  const backup = writes.find((s) => s.write.endsWith('congress-backup.service')).content;
  assert.match(backup, /^User=ops$/m);
  assert.match(backup, /^WorkingDirectory=\/srv\/congress$/m);
  assert.match(backup, /^ExecStart=\/usr\/local\/bin\/node scripts\/staging\/stack\.mjs scheduled-backup$/m);
  assert.ok(writes.every((s) => !s.content.includes('/opt/congress-platform') && !s.content.includes('/usr/bin/node')));
  assert.deepEqual(plan.slice(-2).map((s) => s.run), [['systemctl', 'daemon-reload'], ['systemctl', 'enable', '--now', 'congress-backup.timer', 'congress-check.timer']]);
  const withWal = timerPlan({ dir: '/srv/congress', user: 'ops', node: '/usr/bin/node', wal: true, units, target: '/tmp/sd' });
  assert.ok(withWal.at(-1).run.includes('congress-basebackup.timer'));
  // The check unit sends alerts itself and treats warning/critical as results.
  assert.match(units['congress-check.service'], /^SuccessExitStatus=1 2$/m);
  assert.doesNotMatch(units['congress-check.service'], /Hook alerting here/);
});

test('event mode replaces the nightly schedule with an hourly one', () => {
  assert.match(EVENT_MODE_CONF, /^OnCalendar=$\n^OnCalendar=\*-\*-\* \*:05:00$/m);
});

test('alertDecision: new problem alerts, repeats are suppressed, changes and reminders send, recovery once', () => {
  const warn = [{ level: 'OK', text: 'db running' }, { level: 'WARNING', text: 'HTTP 5xx in the last 15 min: 23 of 400 requests' }];
  const warnLater = [{ level: 'WARNING', text: 'HTTP 5xx in the last 15 min: 31 of 455 requests' }];
  const crit = [{ level: 'CRITICAL', text: 'api is exited' }];
  const t0 = Date.parse('2026-10-22T10:00:00Z');
  const first = alertDecision(null, 1, warn, t0);
  assert.equal(first.kind, 'alert');
  assert.equal(alertDecision(first.state, 1, warnLater, t0 + 300_000).kind, null, 'same problem, other numbers');
  assert.equal(alertDecision(first.state, 1, warnLater, t0 + 6 * 3_600_000, 6).kind, 'reminder');
  assert.equal(alertDecision(first.state, 2, crit, t0 + 300_000).kind, 'alert');
  const recovered = alertDecision(first.state, 0, [], t0 + 600_000);
  assert.equal(recovered.kind, 'recovery');
  assert.equal(alertDecision(recovered.state, 0, [], t0 + 900_000).kind, null);
  assert.equal(alertDecision(null, 0, [], t0).kind, null);
  assert.match(alertText('alert', 2, crit, { CONGRESS_PUBLIC_ORIGIN: 'https://c.example' }), /^\[CRITICAL\] Congress Platform https:\/\/c\.example\n- CRITICAL: api is exited/);
  assert.equal(alertFingerprint(warn), alertFingerprint([...warnLater, { level: 'INFO', text: 'volume 12 MiB' }]));
});

const S3 = {
  BACKUP_S3_ENDPOINT: 'https://s3.example.org:9443', BACKUP_S3_BUCKET: 'bkt', BACKUP_S3_PREFIX: '/congress-prod/',
  BACKUP_S3_ACCESS_KEY_ID: 'AK', BACKUP_S3_SECRET_ACCESS_KEY: 'SK', BACKUP_ENCRYPTION_KEY: 'k'.repeat(40),
};

test('off-host copies are refused without an encryption key and go through the crypt remote', () => {
  assert.match(encryptionProblems({}).join(), /BACKUP_ENCRYPTION_KEY is not set/);
  assert.match(encryptionProblems({ BACKUP_ENCRYPTION_KEY: 'short' }).join(), /at least 32/);
  assert.deepEqual(encryptionProblems(S3), []);
  const vars = rcloneEnv(S3, 'OBSCURED');
  assert.equal(vars.RCLONE_CONFIG_SECURE_TYPE, 'crypt');
  assert.equal(vars.RCLONE_CONFIG_SECURE_REMOTE, 'offsite:bkt/congress-prod');
  assert.equal(vars.RCLONE_CONFIG_SECURE_PASSWORD, 'OBSCURED');
  assert.equal(vars.RCLONE_NO_CHECK_CERTIFICATE, undefined);
  assert.equal(rcloneEnv({ ...S3, BACKUP_S3_VERIFY_TLS: 'off' }).RCLONE_NO_CHECK_CERTIFICATE, 'true');
  assert.ok(!Object.values(vars).includes(S3.BACKUP_ENCRYPTION_KEY), 'the raw key is never passed to rclone');
});

test('WAL archiving settings: problems are listed, values derived for pgBackRest, drills never archive', () => {
  assert.equal(walEnabled({}), false);
  assert.equal(walEnabled({ BACKUP_WAL: 'on' }), true);
  assert.match(walProblems({ ...S3, BACKUP_S3_ENDPOINT: 'http://minio:9000' }).join(), /https:\/\//);
  assert.match(walProblems({ ...S3, BACKUP_S3_BUCKET: '' }).join(), /BACKUP_S3_BUCKET/);
  assert.match(walProblems({ ...S3, BACKUP_ENCRYPTION_KEY: '' }).join(), /ENCRYPTION_KEY/);
  const env = walComposeEnv(S3);
  assert.equal(env.PGBACKREST_REPO1_S3_ENDPOINT, 's3.example.org');
  assert.equal(env.PGBACKREST_REPO1_STORAGE_PORT, '9443');
  assert.equal(env.PGBACKREST_REPO1_PATH, '/congress-prod/pgbackrest');
  assert.equal(env.PGBACKREST_REPO1_CIPHER_PASS, S3.BACKUP_ENCRYPTION_KEY);
  assert.equal(env.PGBACKREST_REPO1_STORAGE_VERIFY_TLS, 'y');
  assert.equal(env.CONGRESS_DB_ARCHIVE_MODE, 'on');
  assert.equal(walComposeEnv(S3, { archive: false }).CONGRESS_DB_ARCHIVE_MODE, 'off');
  assert.equal(walComposeEnv({ ...S3, BACKUP_S3_VERIFY_TLS: 'off' }).PGBACKREST_REPO1_STORAGE_VERIFY_TLS, 'n');
  assert.deepEqual(walComposeEnv({}), { CONGRESS_DB_ARCHIVE_MODE: 'on' });
});

test('base backups: full weekly, differential otherwise; pitr targets in pgBackRest syntax', () => {
  const now = Date.parse('2026-10-22T03:15:00Z');
  const full = (daysAgo) => ({ type: 'full', timestamp: { stop: (now - daysAgo * 86_400_000) / 1000 } });
  assert.equal(chooseBackupType([], now), 'full');
  assert.equal(chooseBackupType([full(2), { type: 'diff', timestamp: { stop: now / 1000 } }], now), 'diff');
  assert.equal(chooseBackupType([full(8)], now), 'full');
  assert.equal(pgbackrestTime('2026-10-22T09:41:00Z'), '2026-10-22 09:41:00.000+00');
  assert.equal(pgbackrestTime('2026-10-22T13:11:00+03:30'), '2026-10-22 09:41:00.000+00');
  assert.throws(() => pgbackrestTime('yesterday'), /usage: pitr-restore/);
  assert.equal(prefixOf({}), 'congress');
  assert.equal(offsiteConfigured(S3), true);
  assert.deepEqual(parseEnvText('# c\nA=1\nB=x=y\n\nnot a pair\n'), { A: '1', B: 'x=y' });
});

// ── Settings forwarded and documented, secrets, data folder (OPS-FIX-A) ─────────────────────────────

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');

/** Field names of `class Settings` in backend/app/config.py (annotated attributes before its first method). */
function settingsFields() {
  const body = read('backend/app/config.py').split('class Settings(BaseSettings):')[1].split(/\n {4}(?:@|def )/)[0];
  return [...body.matchAll(/^ {4}([a-z_][a-z0-9_]*): /gm)].map((m) => m[1]);
}

test('compose forwards every API setting, and both env templates document every variable compose reads', () => {
  const fields = settingsFields();
  assert.ok(fields.length >= 40 && fields.includes('secret_box_key') && fields.includes('sms_daily_cap'), fields.join());
  const compose = read('deploy/staging/compose.yaml');
  const examples = ['deploy/staging/.env.staging.example', 'deploy/hosted/.env.hosted.example'].map((p) => [p, read(p)]);
  // Set by compose itself from other values.
  const derived = new Set(['database_url', 'media_root', 'cors_origins']);
  for (const field of fields) {
    const name = `CONGRESS_${field.toUpperCase()}`;
    assert.match(compose, new RegExp(`^ {4}${name}: `, 'm'), `${name} is not forwarded by compose.yaml`);
    if (derived.has(field)) continue;
    for (const [path, text] of examples) assert.ok(new RegExp(`\\b${name}\\b`).test(text), `${name} is not documented in ${path}`);
  }
  for (const [, name] of compose.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n').matchAll(/\$\{([A-Z_]+)[:}]/g)) {
    for (const [path, text] of examples) assert.ok(new RegExp(`\\b${name}\\b`).test(text), `${name} (read by compose.yaml) is not documented in ${path}`);
  }
  // Optional settings are forwarded empty when unset: the API then applies its own default.
  assert.match(compose, /^ {4}CONGRESS_SECRET_BOX_KEY: \$\{CONGRESS_SECRET_BOX_KEY:-\}$/m);
  assert.match(compose, /^ {4}CONGRESS_SMS_DAILY_CAP: \$\{CONGRESS_SMS_DAILY_CAP:-\}$/m);
});

test('init fills every generated secret; the secret-box key is long and differs from the JWT secret', () => {
  const secrets = freshSecrets();
  for (const [k, v] of Object.entries(secrets)) assert.ok(v.length >= 32, k);
  assert.notEqual(secrets.CONGRESS_SECRET_BOX_KEY, secrets.CONGRESS_JWT_SECRET);
  const filled = parseEnvText(fillTemplate(read('deploy/staging/.env.staging.example'), { ...secrets, CONGRESS_PERSISTENT_DATA_ROOT: '/srv/x$1' }));
  for (const k of Object.keys(secrets)) assert.equal(filled[k], secrets[k]);
  assert.equal(filled.CONGRESS_PERSISTENT_DATA_ROOT, '/srv/x$1');
  assert.ok(!Object.values(filled).some((v) => v.includes('<generate') || v.includes('<set by')), 'a placeholder is left');
});

test('init --add-missing adds only the secret-box key and never generates secrets an install already depends on', () => {
  const existing = { POSTGRES_PASSWORD: 'p'.repeat(48), CONGRESS_PLATFORM_ADMIN_TOKEN: 'a'.repeat(43), CONGRESS_JWT_SECRET: 'j'.repeat(64) };
  const { add, problems } = missingSecrets({ ...existing, CONGRESS_SECRET_BOX_KEY: '  ' });
  assert.deepEqual(Object.keys(add), ['CONGRESS_SECRET_BOX_KEY']);
  assert.ok(add.CONGRESS_SECRET_BOX_KEY.length >= 32 && add.CONGRESS_SECRET_BOX_KEY !== existing.CONGRESS_JWT_SECRET);
  assert.deepEqual(problems, []);
  assert.deepEqual(missingSecrets({ ...existing, CONGRESS_SECRET_BOX_KEY: 'b'.repeat(64) }).add, {});
  const broken = missingSecrets({ CONGRESS_JWT_SECRET: 'j'.repeat(64), CONGRESS_SECRET_BOX_KEY: 'j'.repeat(64) });
  assert.deepEqual(broken.add, {});
  assert.match(broken.problems.join('\n'), /POSTGRES_PASSWORD is not set.*\n.*ADMIN_TOKEN is not set.*\n.*equals CONGRESS_JWT_SECRET/);
});

test('init warns when the data folder already holds a database or other containers use it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opsfixa-'));
  try {
    const paths = { postgres: join(dir, 'data/postgres') };
    assert.deepEqual(dataDirWarnings(paths, []), []);
    mkdirSync(paths.postgres, { recursive: true });
    assert.deepEqual(dataDirWarnings(paths, []), []);
    writeFileSync(join(paths.postgres, 'PG_VERSION'), '16\n');
    assert.match(dataDirWarnings(paths, []).join(), /already holds a PostgreSQL data directory/);
    assert.match(dataDirWarnings(paths, ['congress-postgres-1 (running)']).join('\n'), /containers already use it: congress-postgres-1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The development database has its own default folder.
  assert.match(read('docker-compose.yml'), /\$\{CONGRESS_DEV_DATA_ROOT:-\$\{HOME\}\/congress-dev-data\}\/postgres:/);
  assert.doesNotMatch(read('docker-compose.yml'), /\$\{CONGRESS_PERSISTENT_DATA_ROOT/);
});

// ── check: SMS delivery, certificate ──────────────────────────────────────────────────────────────────

const healthyOutbox = { counts: { pending: 0, sending: 0, sent: 40, failed: 0, unknown: 0, resolved: 0 }, oldest_pending_at: null, sent_last_hour: 12, sent_last_day: 40, hourly_cap: 2000, daily_cap: 20000 };
const levels = (findings) => findings.map((f) => f.level);

test('smsFindings: healthy delivery is OK; lag, failures, caps and configuration problems are flagged', () => {
  const now = Date.parse('2026-10-23T10:00:00Z');
  const live = { effective: 'smsir' };
  assert.ok(levels(smsFindings({ outbox: healthyOutbox, sms: live }, {}, { now })).every((l) => l === 'OK'));
  const lagging = (min) => ({ ...healthyOutbox, counts: { ...healthyOutbox.counts, pending: 7 }, oldest_pending_at: new Date(now - min * 60_000).toISOString() });
  assert.match(smsFindings({ outbox: lagging(12), sms: live }, {}, { now }).find((f) => f.level === 'WARNING').text, /7 queued, oldest waiting 12\.0 min/);
  assert.ok(levels(smsFindings({ outbox: lagging(31), sms: live }, {}, { now })).includes('CRITICAL'));
  assert.ok(levels(smsFindings({ outbox: lagging(12), sms: live }, { ALERT_SMS_LAG_MINUTES: '15' }, { now })).every((l) => l === 'OK'));
  // A message scheduled for later is not lag.
  assert.ok(levels(smsFindings({ outbox: lagging(-5), sms: live }, {}, { now })).every((l) => l === 'OK'));
  const failed = { ...healthyOutbox, counts: { ...healthyOutbox.counts, failed: 2, unknown: 1 } };
  assert.match(smsFindings({ outbox: failed, sms: live }, {}, { now }).find((f) => f.level === 'WARNING').text, /2 failed and 1 unconfirmed/);
  assert.ok(levels(smsFindings({ outbox: failed, sms: live }, { ALERT_SMS_FAILED_MAX: '5' }, { now })).every((l) => l === 'OK'));
  const capped = smsFindings({ outbox: { ...healthyOutbox, sent_last_hour: 2000, sent_last_day: 16500 }, sms: live }, {}, { now });
  assert.match(capped.find((f) => f.level === 'CRITICAL').text, /hourly cap reached \(2000 of 2000\)/);
  assert.match(capped.find((f) => f.level === 'WARNING').text, /daily cap at 16500 of 20000/);
  assert.ok(levels(smsFindings({ outbox: { ...healthyOutbox, hourly_cap: 0, sent_last_hour: 99999 }, sms: live }, {}, { now })).every((l) => l === 'OK'), 'no cap, no alarm');
  assert.ok(levels(smsFindings({ outbox: healthyOutbox, sms: live }, {}, { now, capRefusals: 3 })).includes('WARNING'));
  assert.ok(levels(smsFindings({ outbox: healthyOutbox, sms: { effective: 'unconfigured' } }, {}, { now })).includes('CRITICAL'));
  assert.ok(levels(smsFindings({ outbox: healthyOutbox, sms: { effective: 'console' } }, { CONGRESS_ENVIRONMENT: 'production' }, { now })).includes('CRITICAL'));
  assert.deepEqual(levels(smsFindings({ outbox: healthyOutbox, sms: { effective: 'console' } }, { CONGRESS_ENVIRONMENT: 'staging' }, { now })).filter((l) => l !== 'OK'), ['INFO']);
  // The alert fingerprint ignores the numbers, so a growing queue is one alert, not one per check.
  assert.equal(alertFingerprint(smsFindings({ outbox: lagging(12), sms: live }, {}, { now })), alertFingerprint(smsFindings({ outbox: lagging(14), sms: live }, {}, { now })));
});

test('certificate expiry: which certificate is watched and how close to expiry is a problem', () => {
  const now = Date.parse('2026-10-23T00:00:00Z');
  const day = 86_400_000;
  assert.equal(certFinding(new Date(now + 60 * day).toUTCString(), 'ACME', now).level, 'OK');
  assert.equal(certFinding(new Date(now + 10 * day).toUTCString(), 'ACME', now).level, 'WARNING');
  assert.equal(certFinding(new Date(now + 2 * day).toUTCString(), 'ACME', now).level, 'CRITICAL');
  assert.match(certFinding(new Date(now - day).toUTCString(), 'ACME', now).text, /EXPIRED/);
  assert.equal(certFinding(new Date(now + 20 * day).toUTCString(), 'ACME', now, 30).level, 'WARNING');
  assert.equal(certTarget({ CONGRESS_PUBLIC_ORIGIN: 'https://localhost:8443', CONGRESS_TLS: 'internal' }), null, 'local CA: Caddy renews it');
  assert.deepEqual(certTarget({ CONGRESS_PUBLIC_ORIGIN: 'https://c.example.org', CONGRESS_TLS: 'ops@example.org', CONGRESS_HTTPS_PORT: '443' }),
    { host: '127.0.0.1', port: 443, servername: 'c.example.org', label: 'ACME (c.example.org)' });
  assert.equal(certTarget({ CONGRESS_PUBLIC_ORIGIN: 'https://c.example.org', CONGRESS_TLS: 'internal', CONGRESS_CDN: 'on' }).host, 'c.example.org');
});

// ── Backups: every table counted, every referenced file checked, drills never send SMS ─────────────

test('backups count every table and check every storage_key column inside the dump snapshot', () => {
  assert.match(SNAPSHOT_BACKUP_SCRIPT, /^begin isolation level repeatable read read only;\nselect pg_export_snapshot\(\) as snap \\gset\n\\setenv CONGRESS_SNAPSHOT :snap\n\\! pg_dump .*--snapshot="\$CONGRESS_SNAPSHOT"/);
  assert.match(SNAPSHOT_FACTS_SQL, /information_schema\.tables where table_schema = 'public' and table_type = 'BASE TABLE'/);
  assert.match(SNAPSHOT_FACTS_SQL, /information_schema\.columns where table_schema = 'public' and column_name = 'storage_key'/);
  assert.match(SNAPSHOT_BACKUP_SCRIPT, /commit;\n$/);
  assert.deepEqual(missingMediaKeys(['e1/a.webp', 'e1/program/f.pdf', './e2/b.png'], new Set(['e1/a.webp', 'e2/b.png'])), ['e1/program/f.pdf']);
  assert.deepEqual(DRILL_API_ENV, { CONGRESS_SMS_OUTBOX_ENABLED: 'false', CONGRESS_RETENTION_ENABLED: 'false' });
});
