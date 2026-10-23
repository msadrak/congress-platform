import { useEffect, useRef } from "react";
import { hidCharacter, normalizeScannedCode } from "../lib/scannerInput.ts";

/** Keys of one gun scan arrive this close together; a person typing is far slower. */
const BURST_GAP_MS = 60;
/** Shorter fast runs are not a scan (pass QR secrets are 26 characters). */
const BURST_MIN_LENGTH = 8;
/** The closing Enter follows the last key at once; a later Enter is the person's. */
const ENTER_GAP_MS = BURST_GAP_MS * 2;
/**
 * From which key of a fast run the keys are held back. The first keys cannot be known to be a scan yet, so they
 * reach the page; in a text field they must, because a person typing fast rolls two or three keys within 60 ms
 * and must never lose a character. Callers that keep a field focused clear it in `onCode`.
 */
const HOLD_FROM_KEY_ON_PAGE = 2;
const HOLD_FROM_KEY_IN_FIELD = 4;

interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/** The part of a `KeyboardEvent` the burst detector reads; a test can build one by hand. */
export interface HidKeyEvent {
  code?: string;
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  target?: KeyTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
}

function isEditable(target: KeyTarget | null | undefined): boolean {
  return Boolean(target?.isContentEditable) || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
}

function isEnter(event: HidKeyEvent): boolean {
  return event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter";
}

/**
 * Recognises a USB or Bluetooth barcode gun, which types the code as a burst of keys and ends with Enter: at
 * least 8 keys, each less than 60 ms after the one before, then Enter. Characters come from the physical keys
 * (`hidCharacter`), so a Persian keyboard layout cannot garble a code. While a burst is under way its keys are
 * held back so nothing lands in a field, and the closing Enter is swallowed. Slow typing, shortcuts and a held
 * key's auto-repeat are never touched. A gap longer than 60 ms starts a new run, so a stray key or a stalled
 * scan can never be glued onto the next code.
 */
export function createHidScanner(onCode: (code: string) => void): { handle(event: HidKeyEvent, now: number): void; reset(): void } {
  let chars = "";
  let last = -Infinity;

  const reset = () => {
    chars = "";
    last = -Infinity;
  };

  return {
    reset,
    handle(event, now) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isEnter(event)) {
        const code = chars.length >= BURST_MIN_LENGTH && now - last <= ENTER_GAP_MS ? normalizeScannedCode(chars) : "";
        reset();
        if (!code) return;
        event.preventDefault();
        event.stopPropagation();
        onCode(code);
        return;
      }
      const character = hidCharacter(event);
      if (character === null) return;
      if (now - last > BURST_GAP_MS) chars = "";
      chars += character;
      last = now;
      if (chars.length >= (isEditable(event.target) ? HOLD_FROM_KEY_IN_FIELD : HOLD_FROM_KEY_ON_PAGE)) event.preventDefault();
    },
  };
}

/** Calls `onCode` for every barcode-gun scan on the page (window level, before any field sees the keys). */
export function useHidScanner(onCode: (code: string) => void, enabled = true): void {
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!enabled) return;
    const scanner = createHidScanner((code) => onCodeRef.current(code));
    const onKeyDown = (event: KeyboardEvent) => {
      scanner.handle(
        {
          code: event.code,
          key: event.key,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          repeat: event.repeat,
          target: event.target instanceof HTMLElement ? event.target : null,
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation(),
        },
        performance.now(),
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}

/**
 * Drops a code the camera keeps seeing: the same value is accepted again only once it has been out of view for
 * `windowMs` (every sighting, accepted or not, restarts the wait), so one badge held in front of a running camera
 * is captured once. A different value is accepted at once.
 */
export function createRepeatFilter(windowMs = 3000): { accept(value: string, now: number): boolean; reset(): void } {
  let value: string | null = null;
  let seen = -Infinity;
  return {
    accept(next, now) {
      const repeat = next === value && now - seen < windowMs;
      value = next;
      seen = now;
      return !repeat;
    },
    reset() {
      value = null;
      seen = -Infinity;
    },
  };
}
