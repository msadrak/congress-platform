import test from "node:test";
import assert from "node:assert/strict";
import { asciiDigits, formatMobile, mobileSearchDigits, normalizeIranMobile, telHref } from "../src/lib/mobile.ts";

test("every common spelling of a mobile number normalizes to 09xxxxxxxxx (same rules as the API)", () => {
  for (const raw of [
    "09121234567",
    "9121234567",
    "+989121234567",
    "989121234567",
    "00989121234567",
    "0912 123 4567",
    "0912-123-4567",
    "(0912) 123.4567",
    "۰۹۱۲۱۲۳۴۵۶۷",
    "٠٩١٢١٢٣٤٥٦٧",
    "+۹۸ ۹۱۲ ۱۲۳ ۴۵۶۷",
    "‎0912‌1234567",
  ]) {
    assert.equal(normalizeIranMobile(raw), "09121234567", raw);
  }
});

test("landlines, short, long and foreign numbers are refused", () => {
  for (const raw of ["", "0912123456", "091212345678", "02112345678", "8121234567", "+19121234567", "0912abc4567", "+"]) {
    assert.equal(normalizeIranMobile(raw), null, raw);
  }
});

test("search digits accept partial numbers only", () => {
  assert.equal(mobileSearchDigits("4567"), "4567");
  assert.equal(mobileSearchDigits("۰۹۱۲ ۱۲۳"), "0912123");
  assert.equal(mobileSearchDigits("123"), null);
  assert.equal(mobileSearchDigits("Dr. Ali"), null);
});

test("display and link helpers", () => {
  assert.equal(asciiDigits("کد ۴۸۲۹۱۳"), "کد 482913");
  assert.equal(formatMobile("09121234567"), "0912 123 4567");
  assert.equal(formatMobile("09121234567", "fa"), "۰۹۱۲ ۱۲۳ ۴۵۶۷");
  assert.equal(telHref("09121234567"), "tel:+989121234567");
  assert.equal(telHref("09121234567", "sms"), "sms:+989121234567");
});
