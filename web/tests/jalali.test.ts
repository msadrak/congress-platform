import test from "node:test";
import assert from "node:assert/strict";
import { gregorianToJalali, isValidJalali, jalaliToGregorian } from "../src/lib/jalali.ts";

test("known dates of the official calendar", () => {
  const known: [[number, number, number], [number, number, number]][] = [
    [[1405, 8, 1], [2026, 10, 23]],
    [[1405, 1, 1], [2026, 3, 21]],
    [[1404, 1, 1], [2025, 3, 21]],
    [[1403, 1, 1], [2024, 3, 20]],
    [[1403, 12, 30], [2025, 3, 20]],
    [[1399, 1, 1], [2020, 3, 20]],
    [[1357, 11, 22], [1979, 2, 11]],
    [[1400, 10, 11], [2022, 1, 1]],
  ];
  for (const [jalali, gregorian] of known) {
    assert.deepEqual(jalaliToGregorian(...jalali), gregorian, `${jalali.join("/")} → ${gregorian.join("-")}`);
    assert.deepEqual(gregorianToJalali(...gregorian), jalali, `${gregorian.join("-")} → ${jalali.join("/")}`);
  }
});

test("every day from 1380 to 1430 round-trips and the calendar is contiguous", () => {
  let previous: number | null = null;
  for (let jy = 1380; jy <= 1430; jy += 1) {
    for (let jm = 1; jm <= 12; jm += 1) {
      for (let jd = 1; jd <= 31; jd += 1) {
        if (!isValidJalali(jy, jm, jd)) continue;
        const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
        assert.deepEqual(gregorianToJalali(gy, gm, gd), [jy, jm, jd]);
        const day = Date.UTC(gy, gm - 1, gd) / 86_400_000;
        if (previous !== null) assert.equal(day, previous + 1, `${jy}/${jm}/${jd} follows the previous day`);
        previous = day;
      }
    }
  }
});

test("isValidJalali knows month lengths and leap years", () => {
  assert.ok(isValidJalali(1405, 6, 31));
  assert.ok(!isValidJalali(1405, 7, 31));
  assert.ok(isValidJalali(1403, 12, 30));
  assert.ok(!isValidJalali(1404, 12, 30));
  assert.ok(isValidJalali(1408, 12, 30));
  for (const [y, m, d] of [[1405, 0, 1], [1405, 13, 1], [1405, 1, 0], [1405.5, 1, 1]]) assert.ok(!isValidJalali(y, m, d));
});
