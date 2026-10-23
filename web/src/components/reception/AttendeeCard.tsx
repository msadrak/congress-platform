import type { RefObject } from "react";
import type { AttendeeDetailCard } from "../../api/client";
import { formatMobile } from "../../lib/mobile";
import { codeFontClass, formatLocalizedDate, formatLocalizedNumber, type AttendeeLocale, type TranslationDictionary } from "../../lib/i18n";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { ReceptionPass, TicketStatusChip } from "./ReceptionPass";
import { ResendPassSms, type ResendOutcome } from "./ResendPassSms";
import type { CardState } from "./deskTypes";

interface AttendeeCardProps {
  review: CardState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  eventName: string | undefined;
  /** The issuance dialog's pass is the printable one while it is open. */
  printable: boolean;
  onRetry: (ticketId: string) => void;
  onClose: () => void;
  onPrint: () => void;
  onNext: () => void;
  onResend: (ticketId: string) => Promise<ResendOutcome>;
  statusLabels: Record<string, string>;
  locale: AttendeeLocale;
  t: TranslationDictionary;
  isRtl: boolean;
}

/** The selected attendee: pass, details, gate history and the desk's actions. */
export function AttendeeCard({ review, headingRef, eventName, printable, onRetry, onClose, onPrint, onNext, onResend, statusLabels, locale, t, isRtl }: AttendeeCardProps) {
  if (review.status === "idle") {
    return (
      <div className="rx-detail-idle flex-col items-center justify-center gap-4 shape-arc-lg border border-dashed border-border-strong bg-surface-panel/50 p-8 text-center">
        <span aria-hidden="true" className="grid size-16 place-items-center rounded-2xl bg-surface-panel text-event-accent shadow-soft ring-1 ring-border-default">
          <Icon name="id-card" size={30} strokeWidth={1.5} />
        </span>
        <p className="text-base font-semibold text-text-primary">{isRtl ? "شرکت‌کننده‌ای انتخاب نشده است" : "No attendee selected"}</p>
        <p className="max-w-xs text-sm leading-relaxed text-text-secondary">
          {isRtl ? "یک نفر را از فهرست انتخاب کنید تا کارت ورود و سوابق تردد او اینجا نمایش داده شود." : "Choose someone from the list to see their pass and gate history here."}
        </p>
      </div>
    );
  }
  return (
    <section aria-labelledby="review-heading" className="@container overflow-hidden shape-arc-lg border border-border-default bg-surface-panel shadow-lift">
      <div aria-hidden="true" className="h-[3px] bg-[image:var(--grad-aiteb)]" />
      {review.status === "loading" && (
        <div role="status" className="space-y-5 p-5 sm:p-6">
          <p className="text-sm text-text-muted">{isRtl ? "در حال بارگذاری کارت..." : "Loading pass..."}</p>
          <div className="skeleton h-8 w-2/3" />
          <div className="grid gap-5 @xl:grid-cols-2">
            <div className="skeleton h-72 shape-arc" />
            <div className="space-y-3">
              <div className="skeleton h-5" />
              <div className="skeleton h-5 w-4/5" />
              <div className="skeleton h-5 w-3/5" />
            </div>
          </div>
        </div>
      )}
      {review.status === "error" && (
        <div role="alert" className="space-y-5 p-6 sm:p-8">
          <span aria-hidden="true" className="grid size-12 place-items-center rounded-2xl bg-status-danger-bg text-status-danger-text">
            <Icon name="alert" size={24} />
          </span>
          <h2 id="review-heading" className="text-lg font-semibold text-status-danger-text">{review.message}</h2>
          <div className="flex flex-wrap gap-2.5">
            <Button type="button" variant="primary" size="lg" onClick={() => onRetry(review.ticketId)}>
              <Icon name="sync" size={18} />
              <span>{isRtl ? "تلاش مجدد" : "Retry"}</span>
            </Button>
            <Button type="button" variant="secondary" size="lg" onClick={onClose}>{isRtl ? "بستن" : "Close"}</Button>
          </div>
        </div>
      )}
      {review.status === "ready" && (
        <ReadyCard
          card={review.card}
          headingRef={headingRef}
          eventName={eventName}
          printable={printable}
          onPrint={onPrint}
          onNext={onNext}
          onResend={onResend}
          statusLabels={statusLabels}
          locale={locale}
          t={t}
          isRtl={isRtl}
        />
      )}
    </section>
  );
}

interface ReadyCardProps {
  card: AttendeeDetailCard;
  headingRef: RefObject<HTMLHeadingElement | null>;
  eventName: string | undefined;
  printable: boolean;
  onPrint: () => void;
  onNext: () => void;
  onResend: (ticketId: string) => Promise<ResendOutcome>;
  statusLabels: Record<string, string>;
  locale: AttendeeLocale;
  t: TranslationDictionary;
  isRtl: boolean;
}

function ReadyCard({ card, headingRef, eventName, printable, onPrint, onNext, onResend, statusLabels, locale, t, isRtl }: ReadyCardProps) {
  const issuedByLabel = t.issuedByLabel.replace(/[:：]\s*$/, "");
  return (
    <>
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 space-y-1.5">
            <p className="eyebrow">{isRtl ? "شرکت‌کننده انتخاب‌شده" : "Selected attendee"}</p>
            <h2 id="review-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold leading-tight tracking-[-0.03em] text-text-primary break-words focus:outline-none sm:text-[1.75rem]">
              {card.attendee_name}
            </h2>
            <p className="text-sm text-text-secondary">
              <span className="font-semibold text-event-accent">{card.ticket_tier_name}</span>
              {card.title && <span> · {card.title}</span>}
            </p>
          </div>
          <TicketStatusChip status={card.status} label={statusLabels[card.status] ?? card.status} size="md" />
        </div>

        <div className="grid grid-cols-1 items-start gap-5 @xl:grid-cols-2">
          <div className="rounded-2xl bg-surface-panel-subtle p-2 @sm:p-4">
            <ReceptionPass
              pass={{ qr: card.qr_secret, name: card.attendee_name, tier: card.ticket_tier_name, org: card.organization, ticketId: card.ticket_id }}
              isRtl={isRtl}
              eventName={eventName}
              printable={printable}
            />
          </div>
          <div className="min-w-0 space-y-5">
            <dl className="divide-y divide-border-subtle border-y border-border-subtle text-sm">
              {card.attendee_mobile && (
                <div className="grid gap-0.5 py-2.5">
                  <dt className="text-xs text-text-muted">{isRtl ? "موبایل" : "Mobile"}</dt>
                  <dd className={`truncate ${codeFontClass(formatMobile(card.attendee_mobile, locale))} text-[13px] text-text-primary`}><bdi dir="ltr">{formatMobile(card.attendee_mobile, locale)}</bdi></dd>
                </div>
              )}
              {card.organization && (
                <div className="grid gap-0.5 py-2.5">
                  <dt className="text-xs text-text-muted">{isRtl ? "سازمان" : "Organization"}</dt>
                  <dd className="text-text-primary break-words">{card.organization}</dd>
                </div>
              )}
              {card.issued_by && (
                <div className="grid gap-0.5 py-2.5">
                  <dt className="text-xs text-text-muted">{issuedByLabel}</dt>
                  <dd className="font-semibold text-text-primary">{card.issued_by}</dd>
                </div>
              )}
              <div className="grid gap-0.5 py-2.5">
                <dt className="text-xs text-text-muted">{isRtl ? "تاریخ ثبت" : "Registered"}</dt>
                <dd className="text-text-primary tabular">{formatLocalizedDate(card.created_at, locale)}</dd>
              </div>
            </dl>

            <div className="space-y-2.5">
              <h3 className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                <span className="flex items-center gap-2"><Icon name="gate" size={15} />{isRtl ? "سوابق تردد و اسکن‌های گیت" : "Check-In Scan History"}</span>
                <span className={`${codeFontClass(formatLocalizedNumber(card.scan_history.length, locale))} tabular`}>{formatLocalizedNumber(card.scan_history.length, locale)}</span>
              </h3>
              {card.scan_history.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border-default px-3 py-4 text-center text-xs text-text-muted">{isRtl ? "هنوز هیچ ترددی برای این کارت ثبت نشده است." : "No gate scans recorded yet."}</p>
              ) : (
                <ol className="max-h-48 overflow-y-auto">
                  {card.scan_history.map((scan, i) => (
                    <li key={`${scan.checkin_point_name}-${scan.scanned_at}-${i}`} className="relative ms-1 flex items-center justify-between gap-3 border-s border-border-default py-2 ps-4 text-xs">
                      <span aria-hidden="true" className={`absolute -start-[4.5px] top-1/2 size-2 -translate-y-1/2 rounded-full ring-2 ring-surface-panel ${scan.status === "ADMITTED" ? "bg-status-success-solid" : "bg-status-danger-solid"}`} />
                      <span className="min-w-0">
                        <span className="block font-semibold text-text-primary break-words">{scan.checkin_point_name}</span>
                        <span className="text-[11px] text-text-muted tabular">{formatLocalizedDate(scan.scanned_at, locale)}</span>
                      </span>
                      <Badge variant={scan.status === "ADMITTED" ? "success" : "danger"} size="sm">
                        {scan.status === "ADMITTED" ? (isRtl ? "ورود" : "Admitted") : isRtl ? "رد شد" : "Refused"}
                      </Badge>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t border-border-subtle bg-surface-panel-subtle/70 p-4 sm:p-5 print:hidden">
        <div className="flex flex-col-reverse gap-2.5 @md:flex-row">
          <Button type="button" variant="secondary" size="lg" className="whitespace-normal @md:flex-1" onClick={onPrint}>
            <Icon name="print" size={19} />
            <span>{t.printPassAction}</span>
          </Button>
          <Button type="button" variant="primary" size="lg" className="whitespace-normal @md:flex-[1.35]" onClick={onNext}>
            <span>{t.nextAttendeeAction}</span>
            <Icon name="arrow-right" size={19} />
          </Button>
        </div>
        {card.attendee_mobile && card.status === "active" && (
          <ResendPassSms
            key={card.ticket_id}
            mobile={card.attendee_mobile}
            locale={locale}
            isRtl={isRtl}
            onResend={() => onResend(card.ticket_id)}
          />
        )}
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-text-muted">
          <Icon name="info" size={14} className="mt-px" />
          <span>{isRtl ? "چاپ از مرورگر انجام می‌شود و کارت جدیدی صادر نمی‌کند. ورود به همایش را همچنان اسکنر گیت ثبت می‌کند." : "Printing uses the browser and issues nothing new. Admission is still recorded by the gate scanner."}</span>
        </p>
      </div>
    </>
  );
}
