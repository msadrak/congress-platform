import { strict as assert } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateOfflineAuthorization,
  formatRemainingWindow,
  getJwtExpiryIso,
  isServerReachable,
  MAX_OFFLINE_WINDOW_MS,
  SERVER_CONTACT_FRESH_MS,
} from "../src/lib/scannerAuthPolicy.ts";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function unsignedJwt(expSeconds: number): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ exp: expSeconds })}.${b64("sig")}`;
}

describe("scannerAuthPolicy — offline authorization window", () => {
  it("online state never bypasses credential expiry or the freshness window", () => {
    const fresh = evaluateOfflineAuthorization(NOW, {
      tokenExpiresAt: iso(NOW + HOUR),
      manifestFetchedAt: iso(NOW - HOUR),
      isOnline: true,
    });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.reason, "ONLINE");
    assert.equal(
      evaluateOfflineAuthorization(NOW, { isOnline: true }).reason,
      "TOKEN_INVALID"
    );
    assert.equal(
      evaluateOfflineAuthorization(NOW, {
        tokenExpiresAt: iso(NOW - HOUR),
        isOnline: true,
      }).reason,
      "TOKEN_EXPIRED"
    );
    const stale = evaluateOfflineAuthorization(NOW, {
      tokenExpiresAt: iso(NOW + HOUR),
      manifestFetchedAt: iso(NOW - 25 * HOUR),
      isOnline: true,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "MANIFEST_STALE");
  });

  it("expired JWT blocks even with a fresh manifest", () => {
    const v = evaluateOfflineAuthorization(NOW, {
      tokenExpiresAt: iso(NOW - HOUR),
      manifestFetchedAt: iso(NOW - HOUR),
    });
    assert.equal(v.ok, false);
    assert.equal(v.reason, "TOKEN_EXPIRED");
  });

  it("permits within the 24h window from the last manifest fetch", () => {
    const v = evaluateOfflineAuthorization(NOW, {
      tokenExpiresAt: iso(NOW + HOUR),
      manifestFetchedAt: iso(NOW - 23 * HOUR),
    });
    assert.equal(v.ok, true);
    assert.equal(v.reason, "WITHIN_WINDOW");
    assert.ok(v.remainingMs > 0 && v.remainingMs <= MAX_OFFLINE_WINDOW_MS);
  });

  it("blocks when the manifest is older than the window", () => {
    const v = evaluateOfflineAuthorization(NOW, {
      tokenExpiresAt: iso(NOW + 48 * HOUR),
      manifestFetchedAt: iso(NOW - 25 * HOUR),
    });
    assert.equal(v.ok, false);
    assert.equal(v.reason, "MANIFEST_STALE");
    assert.equal(v.remainingMs, 0);
    assert.ok((v.offlineForMs ?? 0) >= 25 * HOUR);
  });

  it("measures the window from the manifest fetch only (a batch sync says nothing about new tickets)", () => {
    const v = evaluateOfflineAuthorization(NOW, {
      tokenExpiresAt: iso(NOW + 48 * HOUR),
      manifestFetchedAt: iso(NOW - 24 * HOUR),
      isOnline: true,
    });
    assert.equal(v.ok, false);
    assert.equal(v.reason, "MANIFEST_STALE");
  });

  it("blocks with no baseline at all", () => {
    const v = evaluateOfflineAuthorization(NOW, {
      tokenExpiresAt: iso(NOW + HOUR),
    });
    assert.equal(v.ok, false);
    assert.equal(v.reason, "NO_BASELINE");
  });

  it("decodes JWT exp without verifying signature", () => {
    const expSeconds = Math.floor((NOW + 2 * HOUR) / 1000);
    assert.equal(getJwtExpiryIso(unsignedJwt(expSeconds)), iso(expSeconds * 1000));
    assert.equal(getJwtExpiryIso("not-a-jwt"), null);
    assert.equal(getJwtExpiryIso(null), null);
  });

  it("formats the remaining window for operators", () => {
    assert.equal(formatRemainingWindow(0), "expired");
    assert.equal(formatRemainingWindow(-5), "expired");
    assert.equal(formatRemainingWindow(30 * 60 * 1000), "30m");
    assert.equal(formatRemainingWindow(25 * HOUR + 5 * 60 * 1000), "25h 5m");
  });
});

describe("scannerAuthPolicy — server reachability", () => {
  const SEC = 1000;
  it("is online only after a recent successful request", () => {
    assert.equal(isServerReachable(NOW, { browserOnline: true, lastSuccessAt: null, lastFailureAt: null }), false);
    assert.equal(isServerReachable(NOW, { browserOnline: true, lastSuccessAt: NOW - 10 * SEC, lastFailureAt: null }), true);
    assert.equal(
      isServerReachable(NOW, { browserOnline: true, lastSuccessAt: NOW - SERVER_CONTACT_FRESH_MS, lastFailureAt: null }),
      false
    );
  });

  it("a failure after the last success, or a browser offline event, means offline", () => {
    assert.equal(isServerReachable(NOW, { browserOnline: true, lastSuccessAt: NOW - 10 * SEC, lastFailureAt: NOW - 5 * SEC }), false);
    assert.equal(isServerReachable(NOW, { browserOnline: true, lastSuccessAt: NOW - 5 * SEC, lastFailureAt: NOW - 10 * SEC }), true);
    assert.equal(isServerReachable(NOW, { browserOnline: false, lastSuccessAt: NOW, lastFailureAt: null }), false);
  });
});
