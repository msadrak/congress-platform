/**
 * Iranian mobile numbers, mirroring backend/app/sms/phone.py: the canonical form is `09xxxxxxxxx`.
 * People type Persian or Arabic-Indic digits, spaces, dashes and +98 / 0098 / 98 prefixes; all are accepted.
 */

const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;
// Spaces, dashes, dots, parentheses and bidi/ZWNJ marks from RTL keyboards.
const SEPARATORS = /[\s\-().‌‎‏‪-‮]/g;

/** Replace Persian (۰-۹) and Arabic-Indic (٠-٩) digits with ASCII digits. */
export function asciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= PERSIAN_ZERO ? code - PERSIAN_ZERO : code - ARABIC_ZERO);
  });
}

/** The canonical `09xxxxxxxxx`, or null when the input is not an Iranian mobile number. */
export function normalizeIranMobile(raw: string): string | null {
  let compact = asciiDigits((raw ?? "").replace(SEPARATORS, ""));
  if (compact.startsWith("+")) compact = compact.slice(1);
  if (!/^\d+$/.test(compact)) return null;
  if (compact.startsWith("0098")) compact = compact.slice(4);
  else if (compact.startsWith("98") && compact.length === 12) compact = compact.slice(2);
  else if (compact.startsWith("0")) compact = compact.slice(1);
  if (compact.length !== 10 || !compact.startsWith("9")) return null;
  return `0${compact}`;
}

/** Digits of a search term that look like (part of) a phone number: at least 4 digits and nothing else. */
export function mobileSearchDigits(term: string): string | null {
  const compact = asciiDigits(term.replace(SEPARATORS, "")).replace(/^\+/, "");
  return compact.length >= 4 && /^\d+$/.test(compact) ? compact : null;
}

/** `0912 345 6789`, with Persian digits in the Persian interface. Always render inside an LTR island. */
export function formatMobile(mobile: string, locale: "fa" | "en" = "en"): string {
  const grouped = /^\d{11}$/.test(mobile) ? `${mobile.slice(0, 4)} ${mobile.slice(4, 7)} ${mobile.slice(7)}` : mobile;
  return locale === "fa" ? grouped.replace(/\d/g, (d) => String.fromCharCode(PERSIAN_ZERO + Number(d))) : grouped;
}

/** `tel:` / `sms:` targets in international form, which every phone dials correctly. */
export function telHref(mobile: string, scheme: "tel" | "sms" = "tel"): string {
  const normalized = normalizeIranMobile(mobile);
  return `${scheme}:${normalized ? `+98${normalized.slice(1)}` : mobile}`;
}
