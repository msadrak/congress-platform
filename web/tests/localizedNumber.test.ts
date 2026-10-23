import test from "node:test";
import assert from "node:assert/strict";
import { formatLocalizedNumber } from "../src/lib/i18n.ts";

// CLDR's Persian symbols: group «٬» U+066C, decimal «٫» U+066B, minus U+2212 behind a left-to-right mark.
const GROUP = "\u066C";
const DECIMAL = "\u066B";
const MINUS = "\u200E\u2212";

test("Persian numbers use Persian digits and the Persian thousands separator", () => {
  assert.equal(formatLocalizedNumber(0, "fa"), "۰");
  assert.equal(formatLocalizedNumber(5, "fa"), "۵");
  assert.equal(formatLocalizedNumber(999, "fa"), "۹۹۹");
  assert.equal(formatLocalizedNumber(1000, "fa"), `۱${GROUP}۰۰۰`);
  assert.equal(formatLocalizedNumber(5000, "fa"), `۵${GROUP}۰۰۰`);
  assert.equal(formatLocalizedNumber(12345, "fa"), `۱۲${GROUP}۳۴۵`);
});

test("large Persian numbers group every three digits", () => {
  assert.equal(formatLocalizedNumber(1234567, "fa"), `۱${GROUP}۲۳۴${GROUP}۵۶۷`);
  assert.equal(formatLocalizedNumber(1_000_000_000, "fa"), `۱${GROUP}۰۰۰${GROUP}۰۰۰${GROUP}۰۰۰`);
  assert.equal(formatLocalizedNumber(Number.MAX_SAFE_INTEGER, "fa"), `۹${GROUP}۰۰۷${GROUP}۱۹۹${GROUP}۲۵۴${GROUP}۷۴۰${GROUP}۹۹۱`);
});

test("negative Persian numbers carry the minus sign behind a left-to-right mark", () => {
  assert.equal(formatLocalizedNumber(-5, "fa"), `${MINUS}۵`);
  assert.equal(formatLocalizedNumber(-1234, "fa"), `${MINUS}۱${GROUP}۲۳۴`);
  assert.equal(formatLocalizedNumber(-1234567, "fa"), `${MINUS}۱${GROUP}۲۳۴${GROUP}۵۶۷`);
});

test("Persian decimals use the Persian decimal separator, to at most three places", () => {
  assert.equal(formatLocalizedNumber(0.5, "fa"), `۰${DECIMAL}۵`);
  assert.equal(formatLocalizedNumber(1234.5, "fa"), `۱${GROUP}۲۳۴${DECIMAL}۵`);
  assert.equal(formatLocalizedNumber(0.12345, "fa"), `۰${DECIMAL}۱۲۳`);
  assert.equal(formatLocalizedNumber(-1234.5, "fa"), `${MINUS}۱${GROUP}۲۳۴${DECIMAL}۵`);
});

test("a Persian number has no Latin digit, comma or full stop in it", () => {
  for (const value of [0, 7, 1000, 5000, 1234567, -9876543.21, 0.001, 1e12]) {
    const shown = formatLocalizedNumber(value, "fa");
    assert.doesNotMatch(shown, /[0-9,.]/, `${value} -> ${shown}`);
    assert.match(shown, /^[\u200E\u2212\u06F0-\u06F9\u066B\u066C]+$/, `${value} -> ${shown}`);
  }
});

test("English numbers stay Western, grouped with commas", () => {
  assert.equal(formatLocalizedNumber(0, "en"), "0");
  assert.equal(formatLocalizedNumber(5000, "en"), "5,000");
  assert.equal(formatLocalizedNumber(1234567, "en"), "1,234,567");
  assert.equal(formatLocalizedNumber(1234567.891, "en"), "1,234,567.891");
  assert.equal(formatLocalizedNumber(0.5, "en"), "0.5");
  assert.equal(formatLocalizedNumber(-1234, "en"), "-1,234");
});

/** Runs `body` with `Intl.NumberFormat` replaced, always restoring it. */
function withIntlNumberFormat<T>(replacement: typeof Intl.NumberFormat, body: () => T): T {
  const original = Intl.NumberFormat;
  Object.defineProperty(Intl, "NumberFormat", { value: replacement, configurable: true, writable: true });
  try {
    return body();
  } finally {
    Object.defineProperty(Intl, "NumberFormat", { value: original, configurable: true, writable: true });
  }
}

/** An engine whose `fa-IR` data lacks the Persian symbols: Persian digits, but Latin comma and full stop. */
function latinSeparatorEngine(): typeof Intl.NumberFormat {
  const Real = Intl.NumberFormat;
  const digits = "۰۱۲۳۴۵۶۷۸۹";
  return class extends Real {
    readonly #persian: boolean;
    constructor(locales?: string | string[], options?: Intl.NumberFormatOptions) {
      super(locales === "fa-IR" ? "en-US" : locales, options);
      this.#persian = locales === "fa-IR";
    }
    override format(value: number | bigint): string {
      const shown = super.format(value);
      return this.#persian ? shown.replace(/[0-9]/g, (digit) => digits[Number(digit)] ?? digit) : shown;
    }
  } as typeof Intl.NumberFormat;
}

test("the Persian separator does not depend on the engine's fa-IR data", () => {
  withIntlNumberFormat(latinSeparatorEngine(), () => {
    // The stand-in really does misbehave the way an engine with poor Persian data would ...
    assert.equal(new Intl.NumberFormat("fa-IR").format(5000), "۵,۰۰۰");
    // ... and the formatter still answers with the Persian separators.
    assert.equal(formatLocalizedNumber(5000, "fa"), `۵${GROUP}۰۰۰`);
    assert.equal(formatLocalizedNumber(1234.5, "fa"), `۱${GROUP}۲۳۴${DECIMAL}۵`);
    assert.equal(formatLocalizedNumber(-1234567, "fa"), `${MINUS}۱${GROUP}۲۳۴${GROUP}۵۶۷`);
  });
});

test("numbers that are not finite do not throw", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(typeof formatLocalizedNumber(value, "fa"), "string");
    assert.equal(typeof formatLocalizedNumber(value, "en"), "string");
  }
});

test("when Intl itself is unavailable the number is still shown", () => {
  const broken = function () {
    throw new Error("no Intl");
  } as unknown as typeof Intl.NumberFormat;
  withIntlNumberFormat(broken, () => {
    assert.equal(formatLocalizedNumber(5000, "fa"), "5000");
    assert.equal(formatLocalizedNumber(5000, "en"), "5000");
  });
});
