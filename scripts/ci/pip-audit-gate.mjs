#!/usr/bin/env node
/**
 * Fails on high or critical Python vulnerabilities only:  node scripts/ci/pip-audit-gate.mjs <pip-audit.json>
 *
 * pip-audit reports advisories without a severity, so this looks each one up in OSV (api.osv.dev) together
 * with its aliases. Severity is the GitHub advisory rating (database_specific.severity) when there is one,
 * otherwise the CVSS v3 base score. An advisory whose severity cannot be determined counts as high (fail
 * closed). Everything found is printed; only high and critical fail the run (exit 1).
 *
 * Input: `pip-audit --format json --output <file>` over `uv export` of backend/uv.lock (see .github/workflows/ci.yml).
 */
import { readFileSync } from 'node:fs';

const RANK = { LOW: 1, MODERATE: 2, MEDIUM: 2, HIGH: 3, CRITICAL: 4, UNKNOWN: 3 };
const FAILING = RANK.HIGH;

// CVSS v3.x base score (https://www.first.org/cvss/v3.1/specification-document, section 7).
const W = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }, AC: { L: 0.77, H: 0.44 }, UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
};
const roundUp = (x) => { const i = Math.round(x * 100000); return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10; };
function cvss3Score(vector) {
  const m = Object.fromEntries(vector.split('/').slice(1).map((part) => part.split(':')));
  const changed = m.S === 'C';
  const pr = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
  const iss = 1 - (1 - W.CIA[m.C]) * (1 - W.CIA[m.I]) * (1 - W.CIA[m.A]);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const exploitability = 8.22 * W.AV[m.AV] * W.AC[m.AC] * pr * W.UI[m.UI];
  if ([pr, iss, exploitability].some(Number.isNaN)) return null;
  if (impact <= 0) return 0;
  return roundUp(Math.min((changed ? 1.08 : 1) * (impact + exploitability), 10));
}
const ratingOf = (score) => (score >= 9 ? 'CRITICAL' : score >= 7 ? 'HIGH' : score >= 4 ? 'MEDIUM' : 'LOW');

const cache = new Map();
async function osv(id) {
  if (!cache.has(id)) {
    cache.set(id, (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
          if (response.status === 404) return null;
          if (response.ok) return await response.json();
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
      throw new Error(`OSV lookup of ${id} failed`);
    })());
  }
  return cache.get(id);
}

/** The severity of one advisory, following aliases one level (PYSEC/CVE -> GHSA). */
async function severityOf(vuln) {
  const ids = new Set([vuln.id, ...(vuln.aliases ?? [])]);
  const records = [];
  for (const id of ids) {
    const record = await osv(id);
    if (!record) continue;
    records.push(record);
    for (const alias of record.aliases ?? []) {
      if (!ids.has(alias) && alias.startsWith('GHSA-')) { ids.add(alias); const extra = await osv(alias); if (extra) records.push(extra); }
    }
  }
  const rated = records.map((r) => r.database_specific?.severity?.toUpperCase()).filter((s) => s in RANK);
  if (rated.length) return rated.sort((a, b) => RANK[b] - RANK[a])[0];
  const scores = records.flatMap((r) => r.severity ?? []).filter((s) => s.type === 'CVSS_V3').map((s) => cvss3Score(s.score)).filter((s) => s !== null);
  return scores.length ? ratingOf(Math.max(...scores)) : 'UNKNOWN';
}

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rows = [];
for (const dep of report.dependencies ?? []) {
  for (const vuln of dep.vulns ?? []) {
    rows.push({ name: dep.name, version: dep.version, id: vuln.id, fix: (vuln.fix_versions ?? []).join(', ') || '-', severity: await severityOf(vuln) });
  }
}
rows.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.name.localeCompare(b.name));
for (const r of rows) console.log(`${r.severity.padEnd(8)} ${`${r.name} ${r.version}`.padEnd(32)} ${r.id.padEnd(22)} fixed in ${r.fix}`);
const failing = rows.filter((r) => RANK[r.severity] >= FAILING);
console.log(`\n${rows.length} known vulnerabilities, ${failing.length} high or critical (unknown severity counts as high).`);
process.exit(failing.length ? 1 : 0);
