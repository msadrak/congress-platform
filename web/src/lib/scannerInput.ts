/**
 * Scanned-code input for the gate scanner: one normal form for every input path (camera, HID barcode
 * gun, manual entry), the HID key mapping that works under any keyboard layout, and the manifest hash.
 */

const LOCAL_DIGITS: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

/**
 * Trimmed, Latin digits, lower case, at most 64 characters: the form the scanner compares, hashes and
 * uploads, exactly as the server normalizes it (`normalize_qr_secret`).
 */
export function normalizeScannedCode(raw: string): string {
  return raw.replace(/[۰-۹٠-٩]/g, (d) => LOCAL_DIGITS[d] ?? d).trim().toLowerCase().slice(0, 64);
}

// US-layout characters for physical keys (KeyboardEvent.code) that are not letters or digits.
const PUNCTUATION: Record<string, [string, string]> = {
  Minus: ["-", "_"], Equal: ["=", "+"], BracketLeft: ["[", "{"], BracketRight: ["]", "}"],
  Backslash: ["\\", "|"], Semicolon: [";", ":"], Quote: ["'", '"'], Backquote: ["`", "~"],
  Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"], Space: [" ", " "],
  NumpadSubtract: ["-", "-"], NumpadAdd: ["+", "+"], NumpadDecimal: [".", "."],
  NumpadDivide: ["/", "/"], NumpadMultiply: ["*", "*"],
};
const SHIFTED_DIGITS = ")!@#$%^&*(";

/**
 * The character a HID barcode gun meant by one key press. Guns send physical key positions, so under a
 * Persian layout the key "a" arrives as "ش": the physical code (US layout) is used whenever it is known,
 * and the typed character (with local digits made Latin) only as a fallback. Null for non-character keys.
 */
export function hidCharacter(e: { code?: string; key: string; shiftKey?: boolean }): string | null {
  const code = e.code ?? "";
  const shift = Boolean(e.shiftKey);
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return shift ? letter[1] : letter[1].toLowerCase();
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return shift && code.startsWith("Digit") ? SHIFTED_DIGITS[Number(digit[1])] : digit[1];
  const punctuation = PUNCTUATION[code];
  if (punctuation) return punctuation[shift ? 1 : 0];
  if (e.key.length === 1) return e.key.replace(/[۰-۹٠-٩]/g, (d) => LOCAL_DIGITS[d] ?? d);
  return null;
}

/** sha256 hex of "<event_id>:<normalized code>", the manifest's lookup key (raw secrets are never cached). */
export async function qrHash(eventId: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${eventId}:${normalizeScannedCode(code)}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
