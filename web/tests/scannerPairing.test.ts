import test from "node:test";
import assert from "node:assert/strict";
import { isLoopbackHost, scannerPairingUrl } from "../src/lib/scannerPairing.ts";

const POINT = "3f2c9a7e-1111-4222-8333-444455556666";

test("pairing link opens the point's scanner route with the token as a query parameter", () => {
  assert.equal(
    scannerPairingUrl("https://192.168.1.160:8443", POINT, "eyJhbGciOi.payload.sig"),
    `https://192.168.1.160:8443/scan/${POINT}?token=eyJhbGciOi.payload.sig`,
  );
});

test("pairing link tolerates a trailing slash on the origin and encodes unsafe characters", () => {
  const url = new URL(scannerPairingUrl("https://congress.example.org/", "a/b", "t+o&k=en"));
  assert.equal(url.pathname, "/scan/a%2Fb");
  assert.equal(url.searchParams.get("token"), "t+o&k=en");
});

test("loopback hosts are recognised; LAN addresses and domains are not", () => {
  for (const host of ["localhost", "LOCALHOST", "app.localhost", "127.0.0.1", "127.10.0.3", "::1", "[::1]"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ["192.168.1.160", "10.0.0.5", "congress.example.org", "mac.local", "localhost.example.org", "1127.0.0.1"]) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});
