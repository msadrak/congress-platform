/**
 * Solar Hijri (Jalali, «شمسی») ⇄ Gregorian calendar dates, by the arithmetic 33-year cycle (the algorithm of
 * jdf / jalaali). It agrees with the official Iranian calendar for 1343–1473 AP (1964–2094), far wider than
 * any timetable needs. Pure; no dependency.
 */

const GREGORIAN_DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

const div = (a: number, b: number) => Math.trunc(a / b);

function isGregorianLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** [year, month, day] in the Gregorian calendar for a Jalali date (not validated: see `isValidJalali`). */
export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  const y = jy + 1595;
  let days = -355668 + 365 * y + div(y, 33) * 8 + div((y % 33) + 3, 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    days -= 1;
    gy += 100 * div(days, 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    gy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const monthLengths = [31, isGregorianLeap(gy) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 12 && gd > monthLengths[gm]) {
    gd -= monthLengths[gm];
    gm += 1;
  }
  return [gy, gm + 1, gd];
}

/** [year, month, day] in the Jalali calendar for a Gregorian date. */
export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + GREGORIAN_DAYS_BEFORE_MONTH[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  return days < 186 ? [jy, 1 + div(days, 31), 1 + (days % 31)] : [jy, 7 + div(days - 186, 30), 1 + ((days - 186) % 30)];
}

/** True when the Jalali date exists (Esfand has 30 days only in leap years). */
export function isValidJalali(jy: number, jm: number, jd: number): boolean {
  if (!Number.isInteger(jy) || jm < 1 || jm > 12 || jd < 1 || jd > (jm <= 6 ? 31 : 30)) return false;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const [ry, rm, rd] = gregorianToJalali(gy, gm, gd);
  return ry === jy && rm === jm && rd === jd;
}
