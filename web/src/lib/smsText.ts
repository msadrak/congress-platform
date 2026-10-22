/**
 * SMS text helpers for the organizer's SMS panel: placeholder rendering identical to the API
 * (backend/app/sms/templates.py) and an estimate of how many SMS parts a message costs.
 */

const TOKEN = /\{([A-Za-z_]+)\}/g;
// Values are flattened to one line and shortened exactly as the API does before sending.
const MAX_VALUE_LENGTH = 60;

// GSM 03.38 basic character set (plus the extension table, which costs two characters each).
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXTENDED = new Set("^{}\\[~]|€");

export interface SmsSize {
  /** gsm: Latin text, 160 characters per SMS. unicode: Persian (or any non-Latin) text, 70 per SMS. */
  encoding: "gsm" | "unicode";
  characters: number;
  parts: number;
  perPart: number;
}

export function smsSize(text: string): SmsSize {
  const chars = [...text];
  const gsm = chars.every((ch) => GSM_BASIC.has(ch) || GSM_EXTENDED.has(ch));
  const characters = gsm ? chars.reduce((n, ch) => n + (GSM_EXTENDED.has(ch) ? 2 : 1), 0) : chars.length;
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  const parts = characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / multi);
  return { encoding: gsm ? "gsm" : "unicode", characters, parts, perPart: parts > 1 ? multi : single };
}

function clean(value: string): string {
  const flat = value.split(/\s+/).filter(Boolean).join(" ");
  return [...flat].length <= MAX_VALUE_LENGTH ? flat : `${[...flat].slice(0, MAX_VALUE_LENGTH - 1).join("")}…`;
}

/** Fill `{placeholders}`; unknown tokens stay visible so the organizer notices them. */
export function renderSms(body: string, values: Record<string, string>): string {
  return body.replace(TOKEN, (token, name: string) => (name in values ? clean(values[name]) : token));
}

export function placeholdersIn(body: string): string[] {
  return [...new Set([...body.matchAll(TOKEN)].map((m) => m[1]))];
}

export function unknownPlaceholders(body: string, allowed: readonly string[]): string[] {
  return placeholdersIn(body).filter((p) => !allowed.includes(p));
}
