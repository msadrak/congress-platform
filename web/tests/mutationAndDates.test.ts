import { strict as assert } from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiResponseError } from "../src/api/client.ts";
import { networkErrorMessage } from "../src/lib/errorMessages.ts";
import { codeFontClass, formatLocalizedDate } from "../src/lib/i18n.ts";
import { idleMutation, mutationErrorMessage, mutationReducer, type MutationAction, type MutationState } from "../src/hooks/useMutation.ts";

const run = (actions: MutationAction[], from: MutationState = idleMutation) => actions.reduce(mutationReducer, from);

describe("mutationReducer", () => {
  it("start sets busy and clears the last error", () => {
    assert.deepEqual(run([{ type: "start" }], { busy: false, error: "old" }), { busy: true, error: null });
  });

  it("a failure keeps its message after settling; busy always ends", () => {
    assert.deepEqual(run([{ type: "start" }, { type: "fail", message: "No connection" }, { type: "settle" }]), { busy: false, error: "No connection" });
    assert.deepEqual(run([{ type: "start" }, { type: "settle" }]), { busy: false, error: null });
  });

  it("settle on an idle state returns the same state; setError replaces or clears the message", () => {
    assert.equal(mutationReducer(idleMutation, { type: "settle" }), idleMutation);
    assert.deepEqual(run([{ type: "setError", message: "shown" }]), { busy: false, error: "shown" });
    assert.deepEqual(run([{ type: "setError", message: null }], { busy: true, error: "shown" }), { busy: true, error: null });
  });

  it("an HTTP failure reads by its code; anything else is the network message", () => {
    assert.equal(mutationErrorMessage(new ApiResponseError(409, { detail: "x", code: "TIER_SOLD_OUT" }), "en"), "This pass is sold out.");
    assert.equal(mutationErrorMessage(new ApiResponseError(400, { detail: "Server text" }), "en"), "Server text");
    assert.equal(mutationErrorMessage(new TypeError("Failed to fetch"), "fa"), networkErrorMessage.fa);
  });
});

describe("formatLocalizedDate", () => {
  it("Persian: weekday, day, month and year in Persian digits on the Persian calendar", () => {
    assert.equal(formatLocalizedDate("2026-10-15T08:00:00Z", "fa", "Asia/Tehran"), "پنجشنبه ۲۳ مهر ۱۴۰۵");
  });

  it("English: short weekday and month", () => {
    assert.equal(formatLocalizedDate("2026-10-15T08:00:00Z", "en", "Asia/Tehran"), "Thu, Oct 15, 2026");
  });

  it("the time zone decides the day", () => {
    assert.equal(formatLocalizedDate("2026-10-15T22:00:00Z", "en", "UTC"), "Thu, Oct 15, 2026");
    assert.equal(formatLocalizedDate("2026-10-15T22:00:00Z", "en", "Asia/Tehran"), "Fri, Oct 16, 2026");
    assert.equal(formatLocalizedDate("2026-10-15T22:00:00Z", "fa", "Asia/Tehran"), "جمعه ۲۴ مهر ۱۴۰۵");
  });

  it("an unreadable date is returned as given", () => {
    assert.equal(formatLocalizedDate("not a date", "fa"), "not a date");
  });
});

describe("codeFontClass", () => {
  it("mono only for Latin text", () => {
    assert.equal(codeFontClass("0912 345 6789"), "font-mono");
    assert.equal(codeFontClass("۰۹۱۲ ۳۴۵ ۶۷۸۹"), "tabular");
    assert.equal(codeFontClass("کارت ۰۱"), "tabular");
  });
});
