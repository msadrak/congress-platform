import test from "node:test";
import assert from "node:assert/strict";
import { ApiResponseError, apiErrorCode, formatApiError, localizedApiError } from "../src/api/client.ts";
import { errorMessages, isTierUnavailable, networkErrorMessage } from "../src/lib/errorMessages.ts";

const soldOut = { detail: "Ticket tier is sold out / quota exhausted", code: "TIER_SOLD_OUT" };

test("apiErrorCode reads the code from an error body or an ApiResponseError", () => {
  assert.equal(apiErrorCode(soldOut), "TIER_SOLD_OUT");
  assert.equal(apiErrorCode(new ApiResponseError(410, soldOut)), "TIER_SOLD_OUT");
  assert.equal(apiErrorCode({ detail: "Event not found" }), undefined);
  assert.equal(apiErrorCode({ detail: "x", code: null }), undefined);
  assert.equal(apiErrorCode({ detail: "x", code: 42 }), undefined);
  assert.equal(apiErrorCode({ detail: "x", code: "" }), undefined);
  assert.equal(apiErrorCode(null), undefined);
  assert.equal(apiErrorCode("TIER_SOLD_OUT"), undefined);
});

test("a known code is shown in the reader's language, never the English detail", () => {
  assert.equal(localizedApiError(soldOut, "fa"), errorMessages.fa.TIER_SOLD_OUT);
  assert.equal(localizedApiError(soldOut, "en"), errorMessages.en.TIER_SOLD_OUT);
  assert.notEqual(localizedApiError(soldOut, "fa"), soldOut.detail);
  assert.equal(localizedApiError(new ApiResponseError(410, soldOut), "fa"), errorMessages.fa.TIER_SOLD_OUT);
});

test("unknown or missing codes fall back to the existing error text", () => {
  assert.equal(localizedApiError({ detail: "Slug already in use" }, "fa"), "Slug already in use");
  assert.equal(localizedApiError({ detail: "Future failure", code: "SOMETHING_NEW" }, "en"), "Future failure");
  assert.equal(localizedApiError({ detail: "x", code: "constructor" }, "en"), "x");
  const validation = { detail: [{ loc: ["body", "ticket_tier_id"], msg: "Input should be a valid UUID" }] };
  assert.equal(localizedApiError(validation, "fa"), formatApiError(validation));
  assert.equal(localizedApiError(undefined, "fa"), formatApiError(undefined));
});

test("every code has a Persian and an English message", () => {
  assert.deepEqual(Object.keys(errorMessages.fa).sort(), Object.keys(errorMessages.en).sort());
  for (const code of [
    "EVENT_NOT_FOUND", "TIER_NOT_FOUND", "TIER_CLOSED", "TIER_SOLD_OUT", "ALREADY_REGISTERED", "ANALYTICS_RANGE_INVALID",
    "EVENT_ENDED", "REGISTRATION_CLOSED", "REGISTRATION_NOT_OPEN", "TIER_SALES_NOT_OPEN", "TIER_SALES_CLOSED",
    "EVENT_ARCHIVED", "EVENT_HAS_TICKETS", "EVENT_HAS_RECORDS", "TIER_HAS_RESERVATIONS", "HALL_NAME_TAKEN", "HALL_IN_USE",
    "PROGRAM_FILE_NOT_FOUND", "PROGRAM_FILE_LABEL_REQUIRED", "PROGRAM_FILE_TYPE_UNSUPPORTED", "PROGRAM_FILE_TOO_LARGE",
    "PROGRAM_FILE_EMPTY", "PROGRAM_FILE_LIMIT_REACHED", "PROGRAM_FILE_PDF_REJECTED", "PROGRAM_FILE_IMAGE_REJECTED",
  ]) {
    assert.ok(errorMessages.fa[code]?.trim(), `fa ${code}`);
    assert.ok(errorMessages.en[code]?.trim(), `en ${code}`);
    assert.match(code, /^[A-Z][A-Z0-9_]*$/);
  }
  assert.ok(networkErrorMessage.fa.trim() && networkErrorMessage.en.trim());
});

test("sold-out and closed tiers mean the page should reload availability", () => {
  assert.equal(isTierUnavailable("TIER_SOLD_OUT"), true);
  assert.equal(isTierUnavailable("TIER_CLOSED"), true);
  assert.equal(isTierUnavailable("TIER_SALES_CLOSED"), true);
  assert.equal(isTierUnavailable("REGISTRATION_CLOSED"), true);
  assert.equal(isTierUnavailable("ALREADY_REGISTERED"), false);
  assert.equal(isTierUnavailable(undefined), false);
});
