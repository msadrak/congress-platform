import type { TranslationDictionary } from "../../lib/i18n";
import type { LocalScanResult } from "../../lib/scannerEngine";
import { Icon, type IconName } from "../ui/Icon";
import { rejectionLabel, takeoverKind, type ScannerCopy, type TakeoverKind } from "./copy";

const ICON: Record<TakeoverKind, IconName> = {
  admitted: "check",
  provisional: "hourglass",
  duplicate: "copy",
  rejected: "x",
};

/**
 * Full-bleed verdict over the scanning stage. Each state differs by colour, icon AND words; it never blocks the
 * manual-entry field or the hardware reader, so the next badge can be presented immediately.
 */
export function ResultTakeover({ result, t, copy }: { result: LocalScanResult; t: TranslationDictionary; copy: ScannerCopy }) {
  const kind = takeoverKind(result);
  const statusText =
    kind === "admitted" ? t.statusConfirmedAdmitted : kind === "provisional" ? t.statusProvisionalAdmitted : t.statusRejected;

  return (
    <div role="alert" aria-live="assertive" className={`scanner-takeover scanner-takeover--${kind}`}>
      <div className="scanner-takeover-inner">
        <div className="scanner-takeover-icon" aria-hidden="true">
          <Icon name={ICON[kind]} size={kind === "admitted" ? 52 : 44} strokeWidth={kind === "admitted" ? 2.6 : 2.2} />
        </div>

        {kind === "duplicate" ? (
          <>
            <p className="scanner-takeover-eyebrow">{statusText}</p>
            <h2 className="scanner-takeover-title">{copy.duplicateTitle}</h2>
          </>
        ) : (
          <h2 className="scanner-takeover-title">{statusText}</h2>
        )}

        {result.ticket ? (
          <div className="scanner-takeover-person">
            <p className="scanner-takeover-name">{result.ticket.attendee_name}</p>
            <p className="scanner-takeover-tier">
              <span>{t.tierLabel}:</span> <span className="font-semibold">{result.ticket.ticket_tier_name}</span>
            </p>
          </div>
        ) : null}

        {/* The duplicate title already says why; its reason chip would only repeat it (the log keeps the reason). */}
        {result.rejection_reason && kind !== "duplicate" && (
          <p className="scanner-takeover-reason">{rejectionLabel(t, result.rejection_reason) ?? t.reasonInvalidTicket}</p>
        )}
      </div>
    </div>
  );
}
