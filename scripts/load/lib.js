// Shared helpers for the k6 scenarios in this folder (see README.md).
import { fail } from 'k6';
import { Counter } from 'k6/metrics';

/** API origin as seen from the k6 container, e.g. http://congress-load-api-<id>:8000 (with K6_NETWORK) or http://api:8000. */
export const BASE_URL = (__ENV.BASE_URL || 'http://host.docker.internal:8000').replace(/\/+$/, '');

/** Any 5xx answer. Every scenario holds this at zero. */
export const serverErrors = new Counter('server_errors');

/**
 * Host header override (HOST_HEADER=localhost) for a local staging stack reached through Caddy from a container:
 * Caddy serves plain HTTP only for the `localhost` site and redirects every other host (host.docker.internal,
 * web) to HTTPS with 308. Every request in these scenarios carries JSON_HEADERS, so the override applies to all.
 */
const HOST_HEADER = __ENV.HOST_HEADER ? { Host: __ENV.HOST_HEADER } : {};

export const JSON_HEADERS = { 'Content-Type': 'application/json', ...HOST_HEADER };

/**
 * The fixture written by setup.mjs (organizer, event, tiers, gates, tickets, tokens). Read in the init
 * context; a missing file yields an empty fixture so `k6 inspect` works without a stack, and
 * `requireFixture` stops the run in `setup()` instead.
 */
export function loadFixture() {
  const path = __ENV.FIXTURE || './.fixture/fixture.json';
  try {
    return JSON.parse(open(path));
  } catch (_) {
    return null;
  }
}

export function requireFixture(fixture, ...keys) {
  if (!fixture) fail('No fixture: run `node scripts/load/setup.mjs` first (or pass -e FIXTURE=<path>).');
  for (const key of keys) {
    if (fixture[key] === undefined || (Array.isArray(fixture[key]) && fixture[key].length === 0)) {
      fail(`The fixture has no "${key}": re-run setup.mjs with the options this scenario needs (README.md).`);
    }
  }
  return fixture;
}

/** Count 5xx answers (and transport failures, status 0) as server errors. */
export function track(response) {
  if (response.status === 0 || response.status >= 500) serverErrors.add(1, { status: String(response.status) });
  return response;
}

/** RFC 4122 version 4 UUID (scan ids). Math.random is enough for unique test ids. */
export function uuid4() {
  const hex = [];
  for (let i = 0; i < 16; i++) hex.push(Math.floor(Math.random() * 256));
  hex[6] = (hex[6] & 0x0f) | 0x40;
  hex[8] = (hex[8] & 0x3f) | 0x80;
  const h = hex.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const intEnv = (name, fallback) => {
  const value = Number.parseInt(__ENV[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** k6 options shared by every scenario: TLS to a staging stack signed by Caddy's local CA. */
export const commonOptions = {
  insecureSkipTLSVerify: __ENV.INSECURE_TLS === '1',
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
