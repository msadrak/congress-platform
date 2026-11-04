import type { VerdictTone } from "../../copy/operator";
import type { ScannerCopy } from "../../copy/scanner";
import { formatClock } from "../../lib/format";
import type { LocalScanResult } from "../../lib/scannerEngine";

/** Presentation helpers of the gate scanner; its words live in `copy/scanner.ts`. */

/**
 * The wording of a rejection code, or null for a code the scanner has none for. A device rejection the server
 * recorded as `LOCAL_REJECTED:<reason>` reads as "rejected on this device" plus the wording of its reason.
 */
export function rejectionLabel(copy: ScannerCopy, reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.startsWith("LOCAL_REJECTED:")) {
    const inner = rejectionLabel(copy, reason.slice("LOCAL_REJECTED:".length));
    return inner ? copy.localRejected(inner) : null;
  }
  return Object.hasOwn(copy.reason, reason) ? copy.reason[reason as keyof ScannerCopy["reason"]] : null;
}

/** The point's entry rule as one chip: a daily single-use point reads «هر روز یک بار». */
export function policyLabel(copy: ScannerCopy, policyType: string, resetWindow: string | null | undefined): string | null {
  if (policyType === "SINGLE_USE" && resetWindow === "DAY") return copy.dailyWindow;
  return Object.hasOwn(copy.policy, policyType) ? copy.policy[policyType as keyof ScannerCopy["policy"]] : null;
}

/**
 * 24 h wall-clock time with seconds for logs and readouts («۰۹:۳۴:۲۶» / "09:34:26"), on the congress's clock
 * when its zone is given. Without a locale the digits stay Latin, as before.
 */
export function clockTime(iso: string, locale: "fa" | "en" = "en", timeZone?: string | null): string {
  return formatClock(iso, locale, timeZone);
}

export interface VerdictView {
  tone: Exclude<VerdictTone, "info">;
  /** Replaces the tone's word (an exit recorded offline). */
  title?: string;
  reason?: string;
}

/** What the verdict banner shows for a scan: a duplicate is a rejection with its own look. */
export function verdictView(result: LocalScanResult, copy: ScannerCopy): VerdictView {
  if (result.status === "ADMITTED") {
    if (result.direction === "OUT") return { tone: "exit", title: result.is_provisional ? copy.exitOffline : undefined };
    return { tone: result.is_provisional ? "admitted-offline" : "admitted" };
  }
  const reason = rejectionLabel(copy, result.rejection_reason) ?? copy.reason.INVALID_TICKET;
  return { tone: result.rejection_reason === "ALREADY_ADMITTED" ? "duplicate" : "rejected", reason };
}
