import QRCode from "react-qr-code";
import type { AttendeeTicketDetail } from "../../../api/client";
import type { AttendeeLocale } from "../../../lib/i18n";
import { LinkButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { networkCopy } from "../attendeeCopy";

export type MyPass =
  | { status: "loading" }
  | { status: "ready"; pass: Pick<AttendeeTicketDetail, "id" | "qr_secret" | "attendee_name" | "ticket_tier_name"> | null; fromCache: boolean }
  | { status: "unavailable" };

/** "My code": the attendee's own pass QR, for a colleague to scan into their network. */
export function MyCodePanel({ myPass, locale, registerTo }: { myPass: MyPass; locale: AttendeeLocale; registerTo: string }) {
  const c = networkCopy[locale];
  if (myPass.status === "loading") return <div role="status" aria-label={c.myCode} className="skeleton mx-auto h-72 w-full max-w-xs rounded-2xl" />;
  const pass = myPass.status === "ready" ? myPass.pass : null;
  if (!pass) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-border-strong p-5">
        <p className="flex items-start gap-2 text-sm leading-relaxed text-text-secondary">
          <Icon name={myPass.status === "unavailable" ? "wifi-off" : "ticket"} size={18} className="mt-0.5 shrink-0 text-ink-400" />
          {myPass.status === "unavailable" ? c.loadFailed : c.myCodeNoPass}
        </p>
        {myPass.status === "ready" && (
          <LinkButton to={registerTo} variant="primary" size="md">
            <Icon name="ticket" size={17} />
            {c.getPass}
          </LinkButton>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:gap-8 sm:text-start">
      <figure className="shrink-0 rounded-2xl border border-border-default bg-white p-4 shadow-soft">
        <QRCode value={pass.qr_secret} size={208} level="H" title={c.myCode} />
      </figure>
      <div className="min-w-0 space-y-2">
        <p className="text-lg font-semibold leading-snug text-text-primary break-words">{pass.attendee_name}</p>
        <p className="text-sm text-text-muted break-words">{pass.ticket_tier_name}</p>
        <p className="max-w-sm text-sm leading-relaxed text-text-secondary">{c.myCodeLead}</p>
        {myPass.status === "ready" && myPass.fromCache && (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-status-warning-text">
            <Icon name="wifi-off" size={14} />
            {c.myCodeOffline}
          </p>
        )}
      </div>
    </div>
  );
}
