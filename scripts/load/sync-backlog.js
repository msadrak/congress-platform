// Sync backlog: one scanner device comes back online and uploads its offline backlog in chunks.
//
// Target: a 2000-scan backlog synced in under 30 s. The device uploads CHUNK scans per request, one request
// after another (as the scanner's sync loop does), on its own check-in point (`backlog_gate` from
// setup.mjs) so it does not disturb gate-scanning results. Scan ids are fresh, so nothing is deduplicated.
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, JSON_HEADERS, commonOptions, intEnv, loadFixture, requireFixture, track, uuid4 } from './lib.js';

const SCANS = intEnv('SCANS', 2000);
const CHUNK = intEnv('CHUNK', 100);
const fixture = loadFixture();
const syncTime = new Trend('backlog_sync_ms', true);

export const options = {
  ...commonOptions,
  scenarios: {
    sync_backlog: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '5m' },
  },
  thresholds: {
    server_errors: ['count==0'],
    backlog_sync_ms: ['max<30000'],
    'http_req_failed{endpoint:scan_batch}': ['rate==0'],
    'checks{check:chunk_accepted}': ['rate==1'],
  },
};

export function setup() {
  requireFixture(fixture, 'backlog_gate', 'qr_secrets');
  return {};
}

export default function () {
  const gate = fixture.backlog_gate;
  const headers = { ...JSON_HEADERS, Authorization: `Bearer ${gate.scanner_token}` };
  // Scans taken over the last hour while offline, oldest first.
  const start = Date.now() - 60 * 60 * 1000;
  const backlog = [];
  for (let i = 0; i < SCANS; i++) {
    backlog.push({
      scan_id: uuid4(),
      qr_secret: fixture.qr_secrets[i % fixture.qr_secrets.length],
      scanned_at: new Date(start + Math.floor((i * 60 * 60 * 1000) / SCANS)).toISOString(),
    });
  }

  const began = Date.now();
  for (let offset = 0; offset < backlog.length; offset += CHUNK) {
    const scans = backlog.slice(offset, offset + CHUNK);
    const response = track(
      http.post(`${BASE_URL}/api/checkin-points/${gate.point_id}/scans/batch`, JSON.stringify({ scans }), {
        headers,
        tags: { endpoint: 'scan_batch' },
        timeout: '60s',
      }),
    );
    check(response, { chunk_accepted: (r) => r.status === 200 && r.json('results').length === scans.length });
  }
  const elapsed = Date.now() - began;
  syncTime.add(elapsed);
  console.log(`synced ${SCANS} scans in ${Math.ceil(SCANS / CHUNK)} chunks of ${CHUNK}: ${elapsed} ms`);
}
