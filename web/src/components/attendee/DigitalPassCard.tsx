import QRCode from "react-qr-code";
import type { AttendeeTicketDetail } from "../../api/client";
import { formatLocalizedDate, type AttendeeLocale, type TranslationDictionary } from "../../lib/i18n";
import { CongressSignature } from "../brand/CongressSignature";
import { Icon } from "../ui/Icon";
import { formatDateRange } from "./congressTime";
import { Monogram } from "./Monogram";

export type PassCardTicket = Pick<
  AttendeeTicketDetail,
  "id" | "event_name" | "event_slug" | "event_location" | "event_starts_at" | "event_ends_at" | "ticket_tier_name" | "attendee_name" | "qr_secret" | "created_at"
>;

interface DigitalPassCardProps {
  ticket: PassCardTicket;
  locale: AttendeeLocale;
  t: TranslationDictionary;
  /** Confirmed by the server in this session (not an offline copy or a rejected session). */
  verified: boolean;
  /** Offers the print button (paper backup) when set. */
  onPrint?: () => void;
}

/** Digital credential: ink pass with arc corner, scannable QR, perforated stub; prints black on white. */
export function DigitalPassCard({ ticket, locale, t, verified, onPrint }: DigitalPassCardProps) {
  const isRtl = locale === "fa";
  const printLabel = isRtl ? "چاپ کارت ورود" : "Print Pass";
  return (
    <article aria-labelledby="ticket-title" className="print-pass at-pass mx-auto w-full max-w-[440px] overflow-hidden shape-arc-lg shadow-pop lg:mx-0">
      <div aria-hidden="true" className="at-print-hide pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 overflow-hidden">
        <CongressSignature seed={ticket.event_slug} tone="ink" className="size-full" />
        <div className="absolute inset-0 bg-linear-to-b from-surface-ink/30 via-surface-ink/70 to-surface-ink" />
      </div>
      <div aria-hidden="true" className="at-print-hide h-[3px] bg-[image:var(--grad-aiteb)]" />

      {/* Pass head */}
      <div className="space-y-5 px-6 pt-6 sm:px-7 sm:pt-7">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">{t.digitalPassTitle}</span>
          {onPrint && (
            <button
              type="button"
              onClick={onPrint}
              className="at-print-hide press -me-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-300 transition-colors hover:bg-white/10 hover:text-white cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid print:hidden"
              title={printLabel}
              aria-label={printLabel}
            >
              <Icon name="print" size={20} />
            </button>
          )}
        </div>

        <div className="space-y-2.5">
          <h1 id="ticket-title" className="text-2xl font-semibold leading-tight tracking-[-0.03em] text-white text-balance sm:text-[1.75rem]">
            {ticket.event_name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-300">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="calendar" size={14} />
              {formatDateRange(ticket.event_starts_at, ticket.event_ends_at, locale)}
            </span>
            {ticket.event_location && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon name="pin" size={14} />
                <span className="break-words">{ticket.event_location}</span>
              </span>
            )}
          </p>
        </div>

        <span className="at-pass-chip inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15">
          <span aria-hidden="true" className="at-pass-chip-dot size-2 rounded-full bg-status-success-solid shadow-[0_0_0_3px_rgb(11_155_104/0.25)]" />
          {t.activeBadge}
        </span>
      </div>

      {/* High-contrast scannable QR: black modules on a pure white plate with a quiet zone */}
      <div className="flex flex-col items-center gap-4 px-6 pt-7 pb-8 sm:px-7">
        <div className="at-qr-plate p-6">
          <QRCode
            value={ticket.qr_secret}
            size={200}
            level="H"
            viewBox="0 0 256 256"
            fgColor="#000000"
            bgColor="#FFFFFF"
            className="block h-48 w-48 select-none min-[380px]:h-56 min-[380px]:w-56"
          />
        </div>
        <p className="max-w-[34ch] text-center text-xs leading-relaxed text-ink-300">{t.ticketSubtitle}</p>
      </div>

      <div aria-hidden="true" className="at-perf" />

      {/* Stub: holder, tier, reference */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-5 px-6 pt-6 pb-7 sm:px-7">
        <div className="col-span-2 flex items-center gap-3">
          <Monogram name={ticket.attendee_name} seed={ticket.id} size="md" className="at-print-hide" />
          <div className="min-w-0">
            <span className="block text-[11px] font-medium text-ink-400">{isRtl ? "دارنده کارت" : "Pass holder"}</span>
            <span className="block truncate text-lg font-semibold tracking-[-0.02em] text-white">{ticket.attendee_name}</span>
          </div>
        </div>
        <div className="min-w-0 space-y-1 border-t border-white/10 pt-4">
          <span className="block text-[11px] font-medium text-ink-400">{t.tierLabel}</span>
          <span className="block text-sm font-semibold text-white break-words">{ticket.ticket_tier_name}</span>
        </div>
        <div className="min-w-0 space-y-1 border-t border-white/10 pt-4">
          <span className="block text-[11px] font-medium text-ink-400">{isRtl ? "تاریخ ثبت بلیت" : "Issued Date"}</span>
          <span className="block text-sm font-semibold text-white">{formatLocalizedDate(ticket.created_at, locale)}</span>
        </div>
        <div className="col-span-2 flex flex-wrap items-end justify-between gap-3 border-t border-white/10 pt-4">
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-ink-400">{t.ticketIdLabel}</span>
            {/* LTR bidi isolation for the reference code */}
            <span className="block font-mono text-sm font-semibold tracking-[0.08em] text-white">
              <bdi dir="ltr">{ticket.id.slice(0, 13).toUpperCase()}</bdi>
            </span>
          </div>
          {verified && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
              <Icon name="check-circle" size={14} className="text-status-success-solid" />
              {t.syncedNotice}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
