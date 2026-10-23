import test from "node:test";
import assert from "node:assert/strict";
import {
  PARTICIPANTS_COPY,
  cancelReasonLabel,
  cancelledByLabel,
  clampPage,
  fill,
  pageRange,
  participantListQuery,
  transferProblem,
} from "../src/lib/participants.ts";

const base = { q: "", tierId: "", status: "" as const, page: 0, pageSize: 25 };

test("the list query leaves empty filters out and pages by offset", () => {
  assert.deepEqual(participantListQuery(base), { limit: 25, offset: 0 });
  assert.deepEqual(
    participantListQuery({ ...base, q: "  Sara ", tierId: "tier-1", status: "cancelled", page: 2 }),
    { q: "Sara", tier_id: "tier-1", status: "cancelled", limit: 25, offset: 50 },
  );
  assert.deepEqual(participantListQuery({ ...base, q: "   ", page: -3 }), { limit: 25, offset: 0 });
});

test("the page range is 1-based and knows whether there is a previous or next page", () => {
  assert.deepEqual(pageRange(0, 0, 0), { from: 0, to: 0, hasPrev: false, hasNext: false });
  assert.deepEqual(pageRange(0, 25, 57), { from: 1, to: 25, hasPrev: false, hasNext: true });
  assert.deepEqual(pageRange(25, 25, 57), { from: 26, to: 50, hasPrev: true, hasNext: true });
  assert.deepEqual(pageRange(50, 7, 57), { from: 51, to: 57, hasPrev: true, hasNext: false });
});

test("a page past the end is pulled back to the last page that has rows", () => {
  assert.equal(clampPage(3, 25, 57), 2);
  assert.equal(clampPage(1, 25, 25), 0);
  assert.equal(clampPage(2, 25, 0), 0);
  assert.equal(clampPage(-1, 25, 57), 0);
  assert.equal(clampPage(1, 25, 57), 1);
});

test("transfer asks for a valid mobile, then a name only when the number has no account", () => {
  assert.equal(transferProblem({ mobile: "0912", fullName: "" }, false), "mobileInvalid");
  assert.equal(transferProblem({ mobile: "۰۹۱۲۱۲۳۴۵۶۷", fullName: "" }, false), null);
  assert.equal(transferProblem({ mobile: "+98 912 123 4567", fullName: "  " }, true), "nameRequired");
  assert.equal(transferProblem({ mobile: "09121234567", fullName: "Sara Ahmadi" }, true), null);
});

test("fill replaces known tokens and keeps unknown ones", () => {
  assert.equal(fill("{from}–{to} of {total}", { from: 1, to: 25, total: 57 }), "1–25 of 57");
  assert.equal(fill("Ticket transferred to {name}.", {}), "Ticket transferred to {name}.");
});

test("who cancelled and why read in the organizer's language", () => {
  const fa = PARTICIPANTS_COPY.fa;
  const en = PARTICIPANTS_COPY.en;
  assert.equal(cancelledByLabel("attendee", en), en.actorAttendee);
  assert.equal(cancelledByLabel("account_deleted", fa), fa.actorAccountDeleted);
  assert.equal(cancelledByLabel("organizer", fa), fa.actorOrganizer);
  assert.equal(cancelledByLabel(null, en), "");
  assert.equal(cancelReasonLabel("transferred", fa), fa.reasonTransferred);
  assert.equal(cancelReasonLabel("Duplicate booking", en), "Duplicate booking");
  assert.equal(cancelReasonLabel(undefined, en), "");
});

test("Persian and English copy have the same keys and follow the glossary", () => {
  assert.deepEqual(Object.keys(PARTICIPANTS_COPY.fa).sort(), Object.keys(PARTICIPANTS_COPY.en).sort());
  for (const [key, text] of Object.entries(PARTICIPANTS_COPY.fa)) {
    assert.ok(text.trim(), `fa ${key} is empty`);
    assert.doesNotMatch(text, /بلیط/, `fa ${key} spells بلیت with ط`);
  }
});

test("the participants API sends the organizer key, the filters and JSON bodies, and keeps error codes", async () => {
  const { createParticipantsApi } = await import("../src/lib/participantsApi.ts");
  const { ApiResponseError, apiErrorCode } = await import("../src/api/client.ts");
  const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
  const replies: Response[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      auth: headers.get("Authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return replies.shift() ?? new Response("{}", { status: 200 });
  }) as typeof fetch;
  const api = createParticipantsApi("org-key", "event/1", { baseUrl: "https://api.test", fetch: fakeFetch });

  replies.push(Response.json({ items: [], total: 0, limit: 25, offset: 25 }));
  await api.list({ ...base, q: " Ali ", status: "active", page: 1 });
  assert.equal(calls[0].url, "https://api.test/api/events/event%2F1/participants?q=Ali&status=active&limit=25&offset=25");
  assert.equal(calls[0].auth, "Bearer org-key");

  await api.cancel("t-1", { reason: "Duplicate", notify: false });
  assert.deepEqual([calls[1].method, calls[1].url.endsWith("/participants/t-1/cancel"), calls[1].body], [
    "POST", true, { reason: "Duplicate", notify: false },
  ]);

  replies.push(new Response("a,b\n", { status: 200 }));
  await api.exportCsv({ ...base, tierId: "tier-1", page: 3 });
  assert.equal(calls[2].url, "https://api.test/api/events/event%2F1/participants/export-csv?tier_id=tier-1");

  replies.push(Response.json({ detail: "Cancel instead", code: "PARTICIPANT_HAS_HISTORY" }, { status: 409 }));
  await assert.rejects(api.remove("t-2"), (error: unknown) => {
    assert.ok(error instanceof ApiResponseError);
    assert.equal(error.status, 409);
    assert.equal(apiErrorCode(error), "PARTICIPANT_HAS_HISTORY");
    return true;
  });
  assert.equal(calls[3].method, "DELETE");
});
