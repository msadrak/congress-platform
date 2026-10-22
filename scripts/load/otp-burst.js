// OTP burst: many distinct mobiles asking for a sign-in code (POST /api/auth/otp/request).
//
// Target: 1000 requests in 15 minutes without a single 5xx. Defaults run exactly that; a smoke run:
//   -e TOTAL=60 -e DURATION=1m
//
// Limits (app/routes/auth.py): per mobile a resend cooldown and 5 sends/hour (every iteration uses a new
// number, so these never trigger), and per client IP 100 sends/hour by default. From one load generator,
// raise the per-IP budget first (`setup.mjs --relax-otp-limits`), or, only when k6 talks to uvicorn
// directly (not through Caddy, which replaces the header), spread requests over synthetic venue IPs with
// -e SPREAD_IPS=1. Throttled answers are 429, never 5xx; ACCEPTED_RATE sets how many must be 202.
// With the `console` SMS provider (development/test, or CONGRESS_SMS_PROVIDER=console) nothing is sent.
import exec from 'k6/execution';
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, JSON_HEADERS, commonOptions, intEnv, track } from './lib.js';

const TOTAL = intEnv('TOTAL', 1000);
const DURATION = __ENV.DURATION || '15m';
const accepted = new Rate('otp_accepted');

export const options = {
  ...commonOptions,
  scenarios: {
    otp_burst: {
      executor: 'constant-arrival-rate',
      rate: TOTAL,
      timeUnit: DURATION,
      duration: DURATION,
      preAllocatedVUs: intEnv('VUS', 20),
      maxVUs: intEnv('MAX_VUS', 200),
    },
  },
  thresholds: {
    server_errors: ['count==0'],
    otp_accepted: [`rate>=${__ENV.ACCEPTED_RATE || '0.99'}`],
    'http_req_duration{endpoint:otp_request}': ['p(95)<1000'],
    dropped_iterations: ['count==0'],
  },
};

export function setup() {
  // One prefix per run so a second run within the hour does not hit the per-mobile cooldown.
  return { seed: Math.floor(Date.now() / 1000) % 500 };
}

export default function (data) {
  const n = exec.scenario.iterationInTest;
  // Synthetic numbers in the unassigned 0900 range: 0900 + run block (000-499; setup.mjs uses 500-998) + iteration.
  const mobile = `0900${String(data.seed).padStart(3, '0')}${String(n % 10000).padStart(4, '0')}`;
  const headers = { ...JSON_HEADERS };
  if (__ENV.SPREAD_IPS === '1') headers['X-Forwarded-For'] = `10.${(n >> 14) & 255}.${(n >> 6) & 255}.${(n & 63) + 1}`;
  const response = track(
    http.post(`${BASE_URL}/api/auth/otp/request`, JSON.stringify({ mobile, purpose: 'signin' }), {
      headers,
      tags: { endpoint: 'otp_request' },
      responseCallback: http.expectedStatuses(202, 429),
    }),
  );
  accepted.add(response.status === 202);
  check(response, { 'code requested (202) or throttled (429)': (r) => r.status === 202 || r.status === 429 });
}
