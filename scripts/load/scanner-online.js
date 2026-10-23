// Scanner online path: what an online gate does on the day, one badge at a time.
//
// Target: 10 gates x 30 scans/min decided by the server (POST /api/checkin-points/{point_id}/scan, one scan per
// request, no client verdict) with p95 < 300 ms, while every gate keeps its offline manifest current with
// delta refreshes (GET /api/checkin-points/{point_id}/manifest?since=<cursor>) every DELTA_SECONDS, p95 < 500 ms.
// setup() takes one full manifest per gate for the first cursor, as a freshly paired scanner does; each delta
// then passes the cursor of the last manifest this VU saw for that gate. Gates and scanner tokens come from
// setup.mjs (--gates, --tickets); points are MULTI_ENTRY, so re-scanning a ticket is admitted.
import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, JSON_HEADERS, commonOptions, intEnv, loadFixture, requireFixture, track, uuid4 } from './lib.js';

const fixture = loadFixture();
const GATES = intEnv('GATES', fixture?.gates?.length || 10);
const SCANS_PER_MIN = intEnv('SCANS_PER_MIN', 30);
const DELTA_SECONDS = intEnv('DELTA_SECONDS', 30);
const DURATION = __ENV.DURATION || '5m';
const deltaTickets = new Trend('manifest_delta_tickets');

export const options = {
  ...commonOptions,
  scenarios: {
    scans: {
      executor: 'constant-arrival-rate',
      exec: 'scan',
      rate: GATES * SCANS_PER_MIN,
      timeUnit: '1m',
      duration: DURATION,
      preAllocatedVUs: intEnv('VUS', GATES * 2),
      maxVUs: intEnv('MAX_VUS', GATES * 10),
    },
    deltas: {
      executor: 'constant-arrival-rate',
      exec: 'delta',
      rate: GATES,
      timeUnit: `${DELTA_SECONDS}s`,
      duration: DURATION,
      preAllocatedVUs: GATES,
      maxVUs: GATES * 3,
    },
  },
  thresholds: {
    server_errors: ['count==0'],
    'http_req_duration{endpoint:scan}': ['p(95)<300'],
    'http_req_failed{endpoint:scan}': ['rate==0'],
    'checks{check:admitted}': ['rate>0.99'],
    'http_req_duration{endpoint:manifest_delta}': ['p(95)<500'],
    'http_req_failed{endpoint:manifest_delta}': ['rate==0'],
    'checks{check:delta}': ['rate==1'],
    dropped_iterations: ['count==0'],
  },
};

const auth = (gate) => ({ ...JSON_HEADERS, Authorization: `Bearer ${gate.scanner_token}` });

export function setup() {
  const f = requireFixture(fixture, 'gates', 'qr_secrets');
  if (f.gates.length < GATES) throw new Error(`GATES=${GATES} but the fixture has ${f.gates.length}: re-run setup.mjs --gates ${GATES}.`);
  const cursors = [];
  for (let i = 0; i < GATES; i++) {
    const gate = f.gates[i];
    const response = track(
      http.get(`${BASE_URL}/api/checkin-points/${gate.point_id}/manifest`, { headers: auth(gate), tags: { endpoint: 'manifest_full' } }),
    );
    if (response.status !== 200) throw new Error(`Full manifest for gate ${i + 1}: ${response.status} ${response.body}`);
    cursors.push(response.json('cursor'));
  }
  return { cursors };
}

// Per VU (each VU has its own copy): the newest cursor this VU received for each gate.
const latest = {};

export function scan() {
  const gate = fixture.gates[exec.scenario.iterationInTest % GATES];
  const qr = fixture.qr_secrets[Math.floor(Math.random() * fixture.qr_secrets.length)];
  const body = JSON.stringify({ scan_id: uuid4(), qr_secret: qr, scanned_at: new Date().toISOString() });
  const response = track(
    http.post(`${BASE_URL}/api/checkin-points/${gate.point_id}/scan`, body, { headers: auth(gate), tags: { endpoint: 'scan' } }),
  );
  check(response, { admitted: (r) => r.status === 200 && r.json('status') === 'ADMITTED' });
}

export function delta(data) {
  const n = exec.scenario.iterationInTest % GATES;
  const gate = fixture.gates[n];
  const since = latest[n] || data.cursors[n];
  const response = track(
    http.get(`${BASE_URL}/api/checkin-points/${gate.point_id}/manifest?since=${encodeURIComponent(since)}`, {
      headers: auth(gate),
      tags: { endpoint: 'manifest_delta' },
    }),
  );
  const ok = check(response, { delta: (r) => r.status === 200 && r.json('is_delta') === true });
  if (ok) {
    latest[n] = response.json('cursor');
    deltaTickets.add(response.json('tickets').length);
  }
}
