/**
 * Badge scans typed into the reception desk search box. A barcode gun (or a camera) delivers the badge's QR
 * code; the desk resolves it to the ticket instead of searching names. Shares its normal form and key mapping
 * with the gate scanner (scannerInput.ts), so a Persian keyboard layout cannot garble a scanned code.
 */
import { hidCharacter, normalizeScannedCode } from "./scannerInput.ts";

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

/** Keys of one gun scan arrive this close together; a person typing is far slower. */
const BURST_GAP_MS = 60;
const BURST_MIN_LENGTH = 8;

/**
 * Collects a barcode gun's key burst in the search box from the physical keys (`hidCharacter`), so the code is
 * read correctly even while the box shows the Persian letters a Persian layout made of it. `enter` returns the
 * burst's code when the keys came as fast as a gun types them, else null (a person typed: search as usual).
 */
export class KeyBurst {
  private chars = "";
  private last = -Infinity;
  private slow = false;

  key(e: { code?: string; key: string; shiftKey?: boolean }, now: number): void {
    const character = hidCharacter(e);
    if (character === null) return;
    if (this.chars && now - this.last > BURST_GAP_MS) this.slow = true;
    if (!this.chars) this.slow = false;
    this.chars += character;
    this.last = now;
  }

  enter(now: number): string | null {
    const fast = !this.slow && this.chars.length >= BURST_MIN_LENGTH && now - this.last <= BURST_GAP_MS * 2;
    const code = fast ? badgeCode(this.chars) : null;
    this.reset();
    return code;
  }

  reset(): void {
    this.chars = "";
    this.last = -Infinity;
    this.slow = false;
  }
}
