import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RETRY_SECONDS,
  MAX_RETRY_SECONDS,
  formatCountdown,
  parseRetryAfter,
  retryDeadline,
  secondsLeft,
} from "../src/lib/retryAfter.ts";

const NOW = Date.parse("2026-10-23T10:00:00Z");

test("delay-seconds are read as whole seconds, at least one", () => {
  assert.equal(parseRetryAfter("42", NOW), 42);
  assert.equal(parseRetryAfter(" 87 ", NOW), 87);
  assert.equal(parseRetryAfter("1.2", NOW), 2);
  assert.equal(parseRetryAfter("0", NOW), 1);
});

test("an HTTP-date is measured against the client clock", () => {
  assert.equal(parseRetryAfter("Fri, 23 Oct 2026 10:01:30 GMT", NOW), 90);
  // Already past: retry soon, but never "now or never".
  assert.equal(parseRetryAfter("Fri, 23 Oct 2026 09:00:00 GMT", NOW), 1);
});

test("absurd values are capped at one day", () => {
  assert.equal(parseRetryAfter("999999999", NOW), MAX_RETRY_SECONDS);
  assert.equal(parseRetryAfter("Wed, 01 Jan 2031 00:00:00 GMT", NOW), MAX_RETRY_SECONDS);
});

test("missing or unreadable headers are unknown", () => {
  for (const value of [null, undefined, "", "   ", "soon", "-5", "1e3", "Infinity"]) {
    assert.equal(parseRetryAfter(value, NOW), null, String(value));
  }
});

test("the deadline falls back to the default wait", () => {
  assert.equal(retryDeadline("10", NOW), NOW + 10_000);
  assert.equal(retryDeadline(null, NOW), NOW + DEFAULT_RETRY_SECONDS * 1000);
});

test("seconds left round up and stop at zero", () => {
  assert.equal(secondsLeft(NOW + 10_000, NOW), 10);
  assert.equal(secondsLeft(NOW + 9_001, NOW), 10);
  assert.equal(secondsLeft(NOW + 1, NOW), 1);
  assert.equal(secondsLeft(NOW, NOW), 0);
  assert.equal(secondsLeft(NOW - 5_000, NOW), 0);
});

test("the countdown reads m:ss, h:mm:ss from an hour, in the reader's digits", () => {
  assert.equal(formatCountdown(42, "en"), "0:42");
  assert.equal(formatCountdown(87, "en"), "1:27");
  assert.equal(formatCountdown(3600 + 65, "en"), "1:01:05");
  assert.equal(formatCountdown(87, "fa"), "۱:۲۷");
  assert.equal(formatCountdown(-3, "en"), "0:00");
});
