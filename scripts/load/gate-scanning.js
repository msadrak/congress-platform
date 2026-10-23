// Gate scanning: N check-in points, each scanning at a steady rate with its own scanner token.
//
// Target: 10 gates x 20 scans/min with p95 < 300 ms. Each gate uploads small batches
// (POST /api/checkin-points/{point_id}/scans/batch) and refreshes its offline manifest
// (GET /api/checkin-points/{point_id}/manifest) every MANIFEST_SECONDS. Gates and scanner tokens come
// from setup.mjs (--gates, --tickets); points are MULTI_ENTRY, so re-scanning a ticket is admitted.
import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, JSON_HEADERS, commonOptions, intEnv, loadFixture, requireFixture, track, uuid4 } from './lib.js';

const fixture = loadFixture();
const GATES = intEnv('GATES', fixture?.gates?.length || 10);
const SCANS_PER_MIN = intEnv('SCANS_PER_MIN', 20);
const BATCH = intEnv('BATCH', 2);
const MANIFEST_SECONDS = intEnv('MANIFEST_SECONDS', 60);
const DURATION = __ENV.DURATION || '5m';

export const options = {
  ...commonOptions,
  scenarios: {
    scans: {
      executor: 'constant-arrival-rate',
      exec: 'scan',
      // Batches per minute across all gates.
      rate: Math.max(1, Math.round((GATES * SCANS_PER_MIN) / BATCH)),
      timeUnit: '1m',
      duration: DURATION,
      preAllocatedVUs: intEnv('VUS', GATES),
      maxVUs: intEnv('MAX_VUS', GATES * 5),
    },
    manifests: {
      executor: 'constant-arrival-rate',
      exec: 'manifest',
      rate: GATES,
      timeUnit: `${MANIFEST_SECONDS}s`,
      duration: DURATION,
      preAllocatedVUs: GATES,
      maxVUs: GATES * 3,
    },
  },
  thresholds: {
    server_errors: ['count==0'],
    'http_req_duration{endpoint:scan_batch}': ['p(95)<300'],
    'http_req_failed{endpoint:scan_batch}': ['rate==0'],
    'http_req_duration{endpoint:manifest}': ['p(95)<1000'],
    'http_req_failed{endpoint:manifest}': ['rate==0'],
    'checks{check:admitted}': ['rate>0.99'],
    dropped_iterations: ['count==0'],
  },
};

export function setup() {
  const f = requireFixture(fixture, 'gates', 'qr_secrets');
  if (f.gates.length < GATES) throw new Error(`GATES=${GATES} but the fixture has ${f.gates.length}: re-run setup.mjs --gates ${GATES}.`);
  return {};
}

const gateFor = (n) => fixture.gates[n % GATES];
const auth = (gate) => ({ ...JSON_HEADERS, Authorization: `Bearer ${gate.scanner_token}` });

export function scan() {
  const gate = gateFor(exec.scenario.iterationInTest);
  const scans = [];
  for (let i = 0; i < BATCH; i++) {
    const qr = fixture.qr_secrets[Math.floor(Math.random() * fixture.qr_secrets.length)];
    scans.push({ scan_id: uuid4(), qr_secret: qr, scanned_at: new Date().toISOString() });
  }
  const response = track(
    http.post(`${BASE_URL}/api/checkin-points/${gate.point_id}/scans/batch`, JSON.stringify({ scans }), {
      headers: auth(gate),
      tags: { endpoint: 'scan_batch' },
    }),
  );
  // k6 tags each check sample with its name, which the `checks{check:admitted}` threshold selects.
  check(response, { admitted: (r) => r.status === 200 && r.json('results').every((x) => x.status === 'ADMITTED') });
}

export function manifest() {
  const gate = gateFor(exec.scenario.iterationInTest);
  const response = track(
    http.get(`${BASE_URL}/api/checkin-points/${gate.point_id}/manifest`, { headers: auth(gate), tags: { endpoint: 'manifest' } }),
  );
  check(response, { 'manifest (200)': (r) => r.status === 200 });
}
