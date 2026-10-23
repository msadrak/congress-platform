import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiResponseError,
  apiErrorDiagnostic,
  genericApiErrorMessage,
  localizedApiError,
  NETWORK_FAILURE_CODE,
} from "../src/api/client.ts";
import { errorMessages, networkErrorMessage } from "../src/lib/errorMessages.ts";

/** Statuses the product names a sentence for, and the sentences themselves (copy is pinned for review). */
const SENTENCES: ReadonlyArray<{ status: number; fa: string; en: string }> = [
  {
    status: 400,
    fa: "درخواست معتبر نبود. اطلاعات واردشده را بررسی کنید و دوباره تلاش کنید.",
    en: "The request was not valid. Check the details and try again.",
  },
  { status: 401, fa: "زمان ورود شما تمام شده است. دوباره وارد شوید.", en: "You've been signed out. Sign in again." },
  { status: 403, fa: "اجازهٔ انجام این کار را ندارید.", en: "You do not have permission to do this." },
  { status: 404, fa: "مورد درخواستی پیدا نشد.", en: "What you asked for was not found." },
  {
    status: 409,
    fa: "این کار با وضعیت فعلی در تعارض است. صفحه را به‌روز کنید و دوباره تلاش کنید.",
    en: "This conflicts with the current state. Refresh the page and try again.",
  },
  { status: 413, fa: "حجم اطلاعات یا فایل ارسالی بیشتر از حد مجاز است.", en: "What you sent is too large." },
  { status: 415, fa: "این نوع فایل پشتیبانی نمی‌شود.", en: "This type of file is not supported." },
  {
    status: 422,
    fa: "برخی از اطلاعات واردشده معتبر نیست. آن‌ها را بررسی و اصلاح کنید.",
    en: "Some of the details you entered are not valid. Check them and try again.",
  },
  { status: 429, fa: "تعداد درخواست‌ها زیاد است. کمی صبر کنید و دوباره تلاش کنید.", en: "Too many requests. Wait a moment and try again." },
  { status: 500, fa: "در سرور خطایی رخ داد. کمی بعد دوباره تلاش کنید.", en: "Something went wrong on the server. Try again in a little while." },
];
const GENERIC = { fa: "انجام نشد. دوباره تلاش کنید.", en: "That didn't work. Try again." };

test("each listed status has its own localized sentence, pinned", () => {
  for (const { status, fa, en } of SENTENCES) {
    assert.equal(genericApiErrorMessage(status, "fa"), fa, `fa ${status}`);
    assert.equal(genericApiErrorMessage(status, "en"), en, `en ${status}`);
  }
  assert.equal(new Set(SENTENCES.map((s) => s.fa)).size, SENTENCES.length, "every fa sentence differs");
  assert.equal(new Set(SENTENCES.map((s) => s.en)).size, SENTENCES.length, "every en sentence differs");
});

test("every server error status shares the 5xx sentence; anything else gets the neutral one", () => {
  for (const status of [500, 501, 502, 503, 504, 599]) {
    assert.equal(genericApiErrorMessage(status, "fa"), SENTENCES[SENTENCES.length - 1]?.fa, String(status));
    assert.equal(genericApiErrorMessage(status, "en"), SENTENCES[SENTENCES.length - 1]?.en, String(status));
  }
  for (const status of [undefined, 0, -1, Number.NaN, 200, 301, 410, 418, 600, 1000]) {
    assert.equal(genericApiErrorMessage(status, "fa"), GENERIC.fa, String(status));
    assert.equal(genericApiErrorMessage(status, "en"), GENERIC.en, String(status));
  }
});

test("the Persian sentences are Persian only, and never use the retired «بلیط»", () => {
  for (const status of [...SENTENCES.map((s) => s.status), undefined]) {
    const fa = genericApiErrorMessage(status, "fa");
    assert.match(fa, /[\u0600-\u06FF]/);
    assert.doesNotMatch(fa, /[A-Za-z]/, fa);
    assert.doesNotMatch(fa, /بلیط/, fa);
  }
});

test("an error without a known code never shows its English detail to a Persian reader", () => {
  for (const { status, fa } of SENTENCES) {
    const error = new ApiResponseError(status, { detail: "Slug already in use" });
    const shown = localizedApiError(error, "fa");
    assert.equal(shown, fa, String(status));
    assert.ok(!shown.includes("Slug"), String(status));
  }
  // The same for a code this build has not heard of yet.
  const future = new ApiResponseError(409, { detail: "Future failure", code: "SOMETHING_NEW" });
  assert.equal(localizedApiError(future, "fa"), genericApiErrorMessage(409, "fa"));
});

test("English readers keep the server's own text, and get the sentence only when there is none", () => {
  assert.equal(localizedApiError(new ApiResponseError(409, { detail: "Slug already in use" }), "en"), "Slug already in use");
  assert.equal(localizedApiError({ detail: "Slug already in use" }, "en"), "Slug already in use");
  // A proxy's HTML page or an empty body is no message for a person.
  assert.equal(localizedApiError(new ApiResponseError(502, "<html><body>Bad Gateway</body></html>"), "en"), genericApiErrorMessage(502, "en"));
  assert.equal(localizedApiError(new ApiResponseError(404, {}), "en"), genericApiErrorMessage(404, "en"));
  assert.equal(localizedApiError(new ApiResponseError(429, { detail: "" }), "en"), genericApiErrorMessage(429, "en"));
});

test("coded errors keep their existing messages whatever the status", () => {
  const soldOut = { detail: "Ticket tier is sold out / quota exhausted", code: "TIER_SOLD_OUT" };
  for (const status of [400, 409, 410, 500]) {
    assert.equal(localizedApiError(new ApiResponseError(status, soldOut), "fa"), errorMessages.fa.TIER_SOLD_OUT);
    assert.equal(localizedApiError(new ApiResponseError(status, soldOut), "en"), errorMessages.en.TIER_SOLD_OUT);
  }
  assert.equal(localizedApiError(soldOut, "fa", 500), errorMessages.fa.TIER_SOLD_OUT);
});

test("a bare error body has no status: a validation body means 422, anything else the neutral sentence", () => {
  const validation = { detail: [{ loc: ["body", "mobile"], msg: "Field required" }] };
  assert.equal(localizedApiError(validation, "fa"), genericApiErrorMessage(422, "fa"));
  assert.equal(localizedApiError({ detail: "Slug already in use" }, "fa"), GENERIC.fa);
  assert.equal(localizedApiError(undefined, "fa"), GENERIC.fa);
  assert.equal(localizedApiError(null, "fa"), GENERIC.fa);
  assert.equal(localizedApiError("<html>oops</html>", "fa"), GENERIC.fa);
});

test("a caller that has the response can pass its status for a bare body", () => {
  assert.equal(localizedApiError({ detail: "Nope" }, "fa", 403), genericApiErrorMessage(403, "fa"));
  assert.equal(localizedApiError(undefined, "fa", 503), genericApiErrorMessage(503, "fa"));
  assert.equal(localizedApiError({}, "en", 404), genericApiErrorMessage(404, "en"));
  // The explicit status wins over a validation-shaped body, and over the neutral sentence.
  assert.equal(localizedApiError({ detail: [{ loc: ["x"], msg: "bad" }] }, "fa", 400), genericApiErrorMessage(400, "fa"));
});

test("an unreachable server reads as a network problem in both languages", () => {
  assert.equal(localizedApiError(new TypeError("Failed to fetch"), "fa"), networkErrorMessage.fa);
  assert.equal(localizedApiError(new TypeError("Failed to fetch"), "en"), networkErrorMessage.en);
  assert.equal(localizedApiError(new TypeError("NetworkError when attempting to fetch resource."), "fa"), networkErrorMessage.fa);
  assert.equal(localizedApiError(new TypeError("Load failed"), "fa"), networkErrorMessage.fa);
  assert.equal(localizedApiError({ detail: "x", code: NETWORK_FAILURE_CODE }, "fa"), networkErrorMessage.fa);
  assert.equal(localizedApiError(new ApiResponseError(0, { code: NETWORK_FAILURE_CODE }), "en"), networkErrorMessage.en);
  // An unrelated TypeError is a bug of ours, not the network.
  assert.equal(localizedApiError(new TypeError("x is not a function"), "fa"), GENERIC.fa);
});

test("a thrown Error's message is the developer's English: shown to en readers as before, never to fa", () => {
  assert.equal(localizedApiError(new Error("Upload failed"), "en"), "Upload failed");
  assert.equal(localizedApiError(new Error("Upload failed"), "fa"), GENERIC.fa);
});

test("the English detail stays available as a diagnostic", () => {
  assert.equal(apiErrorDiagnostic({ detail: "Slug already in use" }), "Slug already in use");
  assert.equal(apiErrorDiagnostic(new ApiResponseError(409, { detail: "Slug already in use", code: "SLUG_TAKEN" })), "Slug already in use");
  assert.equal(apiErrorDiagnostic({ detail: [{ loc: ["body", "mobile"], msg: "Field required" }] }), "mobile: Field required");
  assert.equal(apiErrorDiagnostic(new Error("Upload failed")), "Upload failed");
  assert.equal(apiErrorDiagnostic(undefined), undefined);
  assert.equal(apiErrorDiagnostic({}), undefined);
  assert.equal(apiErrorDiagnostic(new ApiResponseError(502, "<html>Bad Gateway</html>")), undefined);
});
