/**
 * Badge scans typed into the reception desk search box. A barcode gun (or a camera) delivers the badge's QR
 * code; the desk resolves it to the ticket instead of searching names. Shares its normal form
 * with the gate scanner (scannerInput.ts).
 */
import { normalizeScannedCode } from "./scannerInput.ts";

/** A badge code: one word of 16–64 Latin letters and digits (pass QR secrets are 26 base32 characters). */
const BADGE_CODE = /^[a-z0-9]{16,64}$/;

/**
 * The scanned badge code in `raw`, normalized like the scanner and the server (`normalize_qr_secret`), or null
 * when `raw` reads as a name or a mobile number (spaces, Persian letters, too short) rather than a badge.
 */
export function badgeCode(raw: string): string | null {
  const code = normalizeScannedCode(raw);
  return BADGE_CODE.test(code) ? code : null;
}
