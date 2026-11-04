import type { ScannerCopy } from "../../copy/scanner";
import type { LocalScanResult } from "../../lib/scannerEngine";
import { VerdictBanner } from "../operator/VerdictBanner";
import { verdictView } from "./copy";

/**
 * The verdict over the whole stage: colour, icon and one word, then the name with its pass type and a short reason.
 * It never blocks the manual field or the barcode gun, so the next pass can be presented at once.
 */
export function ScanVerdict({ result, locale, copy }: { result: LocalScanResult; locale: "fa" | "en"; copy: ScannerCopy }) {
  const view = verdictView(result, copy);
  const ticket = result.ticket;
  return (
    <div className="scanner-takeover" data-testid="scanner-verdict" data-tone={view.tone}>
      <VerdictBanner
        locale={locale}
        layout="stage"
        tone={view.tone}
        title={view.title}
        name={ticket?.attendee_name}
        meta={ticket?.ticket_tier_name ? <span className="scanner-tier-chip">{ticket.ticket_tier_name}</span> : undefined}
        reason={view.reason}
      />
    </div>
  );
}
