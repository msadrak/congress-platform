import QRCode from "react-qr-code";
import type { AttendeeTicketDetail } from "../../api/client";
import { passCopy } from "../../copy/pass";
import type { AttendeeLocale, TranslationDictionary } from "../../lib/i18n";
import { isCancelledStatus } from "../../lib/attendeePasses";
import { formatPassDateRange, formatPassIssuedDate } from "../../lib/passDates";
import { CongressSignature } from "../brand/CongressSignature";
import { Icon } from "../ui/Icon";

export type PassCardTicket = Pick<
  AttendeeTicketDetail,
  "id" | "event_name" | "event_slug" | "event_location" | "event_starts_at" | "event_ends_at" | "ticket_tier_name" | "attendee_name" | "qr_secret" | "created_at"
> & {
  /** The ticket's real status; a pass without one (organizer preview) reads as valid. */
  status?: string;
  /**
   * The congress's IANA zone: the card's dates are read in it. Missing (a pass saved before the server sent it, or
   * the organizer preview) means the device's own zone.
   */
  event_timezone?: string | null;
};

interface DigitalPassCardProps {
  ticket: PassCardTicket;
  locale: AttendeeLocale;
  /** No longer read: the card's words are in `copy/pass.ts`. Callers may drop it. */
  t?: TranslationDictionary;
  /** Confirmed by the server in this session (not an offline copy or a rejected session). Kept for the preview. */
  verified?: boolean;
  /** Offers the print button (paper backup) when set. */
  onPrint?: () => void;
  /** Opens the full-screen QR when the QR is tapped. */
  onExpand?: () => void;
}

/**
 * Digital credential, QR first: the scannable code, then whose pass it is (holder, tier, status), then the congress.
 * Prints black on white.
 */
export function DigitalPassCard({ ticket, locale, onPrint, onExpand }: DigitalPassCardProps) {
  const copy = passCopy[locale].card;
  const cancelled = isCancelledStatus(ticket.status ?? "active");
  const qr = (
    <QRCode
      value={ticket.qr_secret}
      size={256}
      level="H"
      viewBox="0 0 256 256"
      fgColor="#000000"
      bgColor="#FFFFFF"
      className="block h-56 w-56 select-none min-[380px]:h-64 min-[380px]:w-64"
    />
  );
  return (
    <article aria-labelledby="ticket-title" className="print-pass at-pass mx-auto w-full max-w-[440px] overflow-hidden shape-arc-lg shadow-pop lg:mx-0">
      <div aria-hidden="true" className="at-print-hide pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 overflow-hidden">
        <CongressSignature seed={ticket.event_slug} tone="ink" className="size-full" />
        <div className="absolute inset-0 bg-linear-to-b from-surface-ink/40 via-surface-ink/80 to-surface-ink" />
      </div>
      <div aria-hidden="true" className="at-print-hide h-[3px] bg-[image:var(--grad-aiteb)]" />

      <div className="flex min-h-11 items-center justify-between gap-3 px-5 pt-4 sm:px-6">
        <span className="text-xs font-semibold text-ink-300">{copy.title}</span>
        {onPrint && !cancelled && (
          <button
            type="button"
            onClick={onPrint}
            className="at-print-hide press -me-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-300 transition-colors hover:bg-white/10 hover:text-white cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid max-md:hidden print:hidden"
            title={copy.print}
            aria-label={copy.print}
          >
            <Icon name="print" size={20} />
          </button>
        )}
      </div>

      {/* QR first and large: black modules on a pure white plate with a quiet zone */}
      <div className="flex flex-col items-center gap-4 px-5 pt-3 pb-6 sm:px-6">
        {cancelled ? (
          <div
            data-testid="pass-qr-cancelled"
            className="grid h-64 w-64 place-items-center rounded-[20px] border-2 border-dashed border-white/25 p-6 text-center text-sm text-ink-300"
          >
            <span className="space-y-2">
              <Icon name="x-circle" size={36} className="mx-auto text-status-danger-solid" />
              <span className="block">{copy.cancelledQr}</span>
            </span>
          </div>
        ) : onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            aria-label={copy.expandQr}
            title={copy.expandQr}
            className="at-qr-plate press relative cursor-zoom-in p-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-aiteb-orchid"
          >
            {qr}
            <span
              aria-hidden="true"
              data-testid="pass-qr-expand"
              className="at-print-hide absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/5 text-black/55"
            >
              <Icon name="arrow-up-right" size={14} />
            </span>
          </button>
        ) : (
          <div className="at-qr-plate p-5">{qr}</div>
        )}

        {/* Whose pass: holder and tier right under the QR, with the real status */}
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <span dir="auto" className="max-w-full break-words text-xl font-semibold tracking-[-0.02em] text-white">{ticket.attendee_name}</span>
          <span className="flex flex-wrap items-center justify-center gap-2">
            <span dir="auto" className="text-sm font-medium text-ink-300">{ticket.ticket_tier_name}</span>
            <span
              data-testid="pass-status"
              className={`at-pass-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                cancelled ? "bg-status-danger-bg text-status-danger-text ring-status-danger-border" : "bg-white/10 text-white ring-white/15"
              }`}
            >
              <span aria-hidden="true" className={`at-pass-chip-dot size-2 rounded-full ${cancelled ? "bg-status-danger-solid" : "bg-status-success-solid"}`} />
              {cancelled ? copy.cancelled : copy.valid}
            </span>
          </span>
        </div>
      </div>

      <div aria-hidden="true" className="at-perf" />

      {/* Stub: the congress and the pass reference */}
      <div className="space-y-4 px-5 pt-5 pb-6 sm:px-6">
        <div className="space-y-2">
          <h1 id="ticket-title" className="text-lg font-semibold leading-snug tracking-[-0.02em] text-white text-balance">
            {ticket.event_name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-300">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="calendar" size={14} />
              {formatPassDateRange(ticket.event_starts_at, ticket.event_ends_at, locale, ticket.event_timezone)}
            </span>
            {ticket.event_location && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon name="pin" size={14} />
                <span className="break-words">{ticket.event_location}</span>
              </span>
            )}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-5 border-t border-white/10 pt-4">
          <div className="min-w-0 space-y-1">
            <span className="block text-[11px] font-medium text-ink-400">{copy.issued}</span>
            <span className="block text-sm font-semibold text-white">{formatPassIssuedDate(ticket.created_at, locale, ticket.event_timezone)}</span>
          </div>
          <div className="min-w-0 space-y-1">
            <span className="block text-[11px] font-medium text-ink-400">{copy.passId}</span>
            {/* LTR bidi isolation for the Latin reference code */}
            <span className="block font-mono text-sm font-semibold tracking-[0.08em] text-white">
              <bdi dir="ltr">{ticket.id.slice(0, 13).toUpperCase()}</bdi>
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
