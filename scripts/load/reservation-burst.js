// Reservation burst: signed-in attendees reserving the free tier (POST /api/events/{id}/tickets/reserve).
//
// Target: a 50 reservations/s burst. Each attendee can hold one ticket per event, so every iteration uses
// its own pre-signed-in attendee from the fixture: run setup.mjs with --attendees >= RATE x seconds
// (defaults: 50/s for 10 s = 500 attendees). Signing those attendees in needs their SMS codes; setup.mjs
// reads them from the dev-only outbox (README.md), so token acquisition is not part of the measurement.
import exec from 'k6/execution';
import http from 'k6/http';
import { check, fail } from 'k6';
import { BASE_URL, JSON_HEADERS, commonOptions, intEnv, loadFixture, requireFixture, track } from './lib.js';

const RATE = intEnv('RATE', 50);
const SECONDS = intEnv('SECONDS', 10);
const fixture = loadFixture();

export const options = {
  ...commonOptions,
  scenarios: {
    reservation_burst: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: `${SECONDS}s`,
      preAllocatedVUs: intEnv('VUS', RATE * 2),
      maxVUs: intEnv('MAX_VUS', RATE * 6),
    },
  },
  thresholds: {
    server_errors: ['count==0'],
    // Every reservation succeeds (201): the tier quota is far above the burst.
    'http_req_failed{endpoint:reserve}': ['rate==0'],
    'http_req_duration{endpoint:reserve}': ['p(95)<1000'],
    // The server kept up with the arrival rate (no iteration skipped for lack of a free VU).
    dropped_iterations: ['count==0'],
  },
};

export function setup() {
  const f = requireFixture(fixture, 'event_id', 'reservation_tier_id', 'attendee_tokens');
  if (f.attendee_tokens.length < RATE * SECONDS) {
    fail(`Need ${RATE * SECONDS} attendees, the fixture has ${f.attendee_tokens.length}: re-run setup.mjs --attendees ${RATE * SECONDS}.`);
  }
  return { eventId: f.event_id, tierId: f.reservation_tier_id };
}

export default function (data) {
  // The arrival-rate executor may start one iteration more than RATE x SECONDS; never reuse an attendee.
  const token = fixture.attendee_tokens[exec.scenario.iterationInTest];
  if (!token) return;
  const response = track(
    http.post(
      `${BASE_URL}/api/events/${data.eventId}/tickets/reserve`,
      JSON.stringify({ ticket_tier_id: data.tierId }),
      { headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` }, tags: { endpoint: 'reserve' } },
    ),
  );
  // A second run with the same fixture gets 409 ALREADY_REGISTERED: run setup.mjs again for a fresh event.
  check(response, { 'reserved (201)': (r) => r.status === 201 });
}
