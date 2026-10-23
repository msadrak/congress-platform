import { useEffect, useState, type RefObject } from "react";
import type { AttendeeDetailCard } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { deskCopy } from "../../copy/desk";
import type { VerdictTone } from "../../copy/operator";
import { admitReasonText, badgeAffiliation, badgePrintState } from "../../lib/deskBadge";
import { codeFontClass, formatDate, formatMobile, formatNumber } from "../../lib/format";
import type { AttendeeLocale } from "../../lib/i18n";
import { VerdictBanner } from "../operator/VerdictBanner";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Field } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { Textarea } from "../ui/Input";
import { MetaList, type MetaListItem } from "../ui/MetaList";
import { Notice } from "../ui/Notice";
import { RowActions, type RowAction } from "../ui/RowActions";
import { StatusChip } from "../ui/StatusChip";
import { AdmitControls, EditDialog, TransferDialog, type DeskCardActions, type ResendOutcome } from "./DeskActions";
import { PrintableBadge } from "./PrintableBadge";
import type { CardState } from "./deskTypes";

interface AttendeeCardProps {
  review: CardState;
  headingRef: RefObject<HTMLHeadingElement | null>;
  eventName: string | undefined;
  /** The issuance dialog's pass is the printable one while it is open. */
  printable: boolean;
  onRetry: (ticketId: string) => void;
  /** «بعدی»: closes the card and returns to the search. */
  onNext: () => void;
  /** Records the print, then opens the browser's print dialog; resolves to a message to show, or null. */
  onPrint: (card: AttendeeDetailCard) => Promise<string | null>;
  /** Admission, registration changes and printing; null (an archived congress) hides the action bar. */
  actions: DeskCardActions | null;
  /** No connection: the action bar stays, disabled, with one line saying so. */
  offline: boolean;
  /** localStorage key of the last check-in point used at this desk. */
  pointStorageKey: string;
  /** A one-line success notice (toast). */
  onNotice: (text: string) => void;
  locale: AttendeeLocale;
  /** The congress's IANA zone: times on the card are shown on its clock. */
  timeZone: string;
}

/** The selected attendee: name, status, print state, details, and the desk's actions in a bar pinned to the bottom. */
export function AttendeeCard({ review, headingRef, eventName, printable, onRetry, onNext, onPrint, actions, offline, pointStorageKey, onNotice, locale, timeZone }: AttendeeCardProps) {
  const c = deskCopy[locale];
  const common = commonCopy[locale];
  if (review.status === "idle") {
    return <p className="rx-idle text-body-sm text-text-muted">{c.nobodySelected}</p>;
  }
  if (review.status === "loading") {
    return (
      <div role="status" className="rx-card space-y-4 p-4 sm:p-6">
        <p className="sr-only">{c.loadingCard}</p>
        <div className="skeleton h-8 w-2/3" />
        <div className="skeleton h-5 w-1/3" />
        <div className="skeleton h-24" />
      </div>
    );
  }
  if (review.status === "error") {
    return (
      <div className="rx-card space-y-4 p-4 sm:p-6">
        <Notice tone="danger">{review.message}</Notice>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" size="lg" icon="sync" onClick={() => onRetry(review.ticketId)}>
            {common.retry}
          </Button>
          <Button type="button" variant="secondary" size="lg" onClick={onNext}>
            {common.close}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <ReadyCard
      key={review.card.ticket_id}
      card={review.card}
      headingRef={headingRef}
      eventName={eventName}
      printable={printable}
      onNext={onNext}
      onPrint={onPrint}
      actions={actions}
      offline={offline}
      pointStorageKey={pointStorageKey}
      onNotice={onNotice}
      locale={locale}
      timeZone={timeZone}
    />
  );
}

type ReadyCardProps = Omit<AttendeeCardProps, "review" | "onRetry"> & { card: AttendeeDetailCard };

interface Verdict {
  tone: VerdictTone;
  reason: string;
}

/** A clock time today, else day and time; always on the congress's clock. */
function scanTime(iso: string, locale: AttendeeLocale, timeZone: string): string {
  const today = formatDate(Date.now(), "long", locale, timeZone) === formatDate(iso, "long", locale, timeZone);
  return formatDate(iso, today ? "time" : "dayTime", locale, timeZone);
}

function ReadyCard({ card, headingRef, eventName, printable, onNext, onPrint, actions, offline, pointStorageKey, onNotice, locale, timeZone }: ReadyCardProps) {
  const c = deskCopy[locale];
  const active = card.status === "active";
  // Defensive defaults: a card from an older API has no print record.
  const printState = badgePrintState({ print_count: card.print_count ?? 0, needs_reprint: Boolean(card.needs_reprint) });
  const [printing, setPrinting] = useState(false);
  const [admitting, setAdmitting] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"edit" | "transfer" | null>(null);
  /** The optional reason typed into the cancel confirmation; it goes into the audit trail. */
  const [cancelReason, setCancelReason] = useState("");
  // Details start open where there is room for them (kiosk and desktop), folded on phones and tablets.
  const [detailsOpen, setDetailsOpen] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(min-width: 1024px)").matches === true);

  // The admit verdict stays for 3 s, like the gate's.
  useEffect(() => {
    if (!verdict) return;
    const timer = setTimeout(() => setVerdict(null), 3000);
    return () => clearTimeout(timer);
  }, [verdict]);

  const print = async () => {
    setPrinting(true);
    setError(null);
    const message = await onPrint(card);
    setPrinting(false);
    if (message) setError(message);
  };
  const admit = async (pointId: string) => {
    if (!actions) return;
    setAdmitting(true);
    setError(null);
    setVerdict(null);
    const result = await actions.admit(card.ticket_id, pointId);
    setAdmitting(false);
    if ("verdict" in result) {
      const { status, rejection_reason, checkin_point_name } = result.verdict;
      if (status === "ADMITTED") setVerdict({ tone: "admitted", reason: checkin_point_name });
      else setVerdict({ tone: rejection_reason === "ALREADY_ADMITTED" ? "duplicate" : "rejected", reason: admitReasonText(rejection_reason, locale) });
    } else if (result.error) {
      setError(result.error);
    }
  };
  const run = async (action: () => Promise<string | null>, done: string) => {
    setError(null);
    const message = await action();
    if (message) setError(message);
    else onNotice(done);
  };
  const resend = async () => {
    if (!actions || !card.attendee_mobile) return;
    setError(null);
    const mobile = formatMobile(card.attendee_mobile, locale);
    let outcome: ResendOutcome;
    try {
      outcome = await actions.resend(card.ticket_id);
    } catch {
      outcome = { kind: "error", message: commonCopy[locale].network };
    }
    if (outcome.kind === "result") {
      const { status, test_mode } = outcome.data;
      if (status === "sent") onNotice(test_mode ? c.resentTestMode(mobile) : c.resent(mobile));
      else if (status === "unknown") onNotice(c.resendUnknown);
      else setError(c.resendRefused);
    } else if (outcome.kind === "throttled") {
      onNotice(c.resendThrottled(formatNumber(outcome.retryAfter, locale)));
    } else if (outcome.kind === "error") {
      setError(outcome.message);
    }
  };

  const canAct = Boolean(actions) && active;
  const points = actions?.checkinPoints ?? [];
  const printFirst = printState !== "printed";
  const nextIsPrimary = !canAct || (!printFirst && points.length === 0);
  const menu: RowAction[] = [];
  if (actions && canAct) {
    if (card.attendee_mobile) menu.push({ label: c.resend, icon: "mail", disabled: offline, onSelect: () => void resend() });
    menu.push({ label: c.edit, icon: "note", disabled: offline, onSelect: () => setDialog("edit") });
    menu.push({ label: c.transfer, icon: "share", disabled: offline, onSelect: () => setDialog("transfer") });
    menu.push({
      label: c.reissue,
      icon: "sync",
      disabled: offline,
      destructive: { title: c.reissueTitle, description: c.reissueBody, confirmLabel: c.reissue },
      onSelect: () => void run(() => actions.reissue(card.ticket_id), c.reissued),
    });
    menu.push({
      label: c.cancelPass,
      icon: "x-circle",
      disabled: offline,
      destructive: {
        title: c.cancelTitle,
        description: c.cancelBody,
        confirmLabel: c.cancelPass,
        body: (
          <Field label={c.cancelReason} optional>
            <Textarea rows={2} maxLength={300} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
          </Field>
        ),
      },
      onSelect: () => {
        const reason = cancelReason.trim();
        setCancelReason("");
        void run(() => actions.cancel(card.ticket_id, reason), c.cancelled);
      },
    });
  }

  const mobile = card.attendee_mobile ? formatMobile(card.attendee_mobile, locale) : "";
  const facts: MetaListItem[] = [];
  if (mobile) facts.push({ label: c.mobile, value: <bdi dir="ltr" className={codeFontClass(mobile)}>{mobile}</bdi> });
  if (card.organization) facts.push({ label: c.organization, value: card.organization });
  if (card.title) facts.push({ label: c.jobTitle, value: card.title });
  if (card.issued_by) facts.push({ label: c.issuedBy, value: card.issued_by });
  facts.push({ label: c.registered, value: formatDate(card.created_at, "long", locale, timeZone) });

  const affiliation = badgeAffiliation(card.title, card.organization);
  return (
    <section aria-labelledby="review-heading" className="rx-card">
      <div className="rx-card-body space-y-4 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <h2 id="review-heading" ref={headingRef} tabIndex={-1} className="text-title leading-tight font-bold break-words text-text-primary focus:outline-none">
              {card.attendee_name}
            </h2>
            {affiliation && <p className="text-body-sm text-text-secondary">{affiliation}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={active ? "active" : "cancelled"} />
              <Badge variant="accent">{card.ticket_tier_name}</Badge>
            </div>
          </div>
          <IconButton icon="x" label={commonCopy[locale].close} onClick={onNext} className="md:hidden" />
        </div>

        {canAct && printFirst && (
          <p data-testid="badge-print-state" className={`flex items-center gap-2 text-body-sm font-semibold ${printState === "stale" ? "text-status-warning-text" : "text-text-secondary"}`}>
            <Icon name={printState === "stale" ? "alert" : "print"} size={17} />
            <span>{printState === "never" ? c.notPrinted : c.needsReprint}</span>
          </p>
        )}
        {card.status !== "active" && card.cancelled_reason && <p className="text-body-sm text-text-secondary">{c.cancelledReason(card.cancelled_reason)}</p>}

        {verdict && (
          <div data-testid="desk-admit-verdict">
            <VerdictBanner locale={locale} tone={verdict.tone} reason={verdict.reason} layout="inline" />
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}

        <details open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)} className="group rounded-control border border-border-default">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-body-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span>{c.details}</span>
            <Icon name="chevron-down" size={18} className="text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="space-y-5 border-t border-border-subtle p-4">
            <MetaList items={facts} />
            <div className="space-y-2">
              <h3 className="text-caption font-semibold text-text-muted">{c.history}</h3>
              {card.scan_history.length === 0 ? (
                <p className="text-body-sm text-text-muted">{c.noHistory}</p>
              ) : (
                <ol className="divide-y divide-border-subtle" data-testid="scan-history">
                  {card.scan_history.map((scan, i) => (
                    <li key={`${scan.checkin_point_name}-${scan.scanned_at}-${i}`} className="flex items-center gap-3 py-2 text-body-sm">
                      <span className="shrink-0 font-semibold tabular text-text-primary">{scanTime(scan.scanned_at, locale, timeZone)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-text-primary">{scan.checkin_point_name}</span>
                        {scan.recorded_by && <span className="block text-caption text-text-muted">{c.atDesk(scan.recorded_by)}</span>}
                      </span>
                      <Badge variant={scan.status === "ADMITTED" ? "success" : "danger"} size="sm">
                        {scan.status === "ADMITTED" ? c.historyAdmitted : c.historyRefused}
                      </Badge>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </details>

        <PrintableBadge
          badge={{ qr: card.qr_secret, name: card.attendee_name, title: card.title, organization: card.organization, tier: card.ticket_tier_name }}
          eventName={eventName}
          printable={printable && active}
          locale={locale}
        />
      </div>

      {actions && (
        <div className="rx-actionbar print:hidden" data-testid="desk-action-bar">
          {offline && canAct && (
            <p className="mb-2 flex items-center gap-2 text-body-sm font-semibold text-status-warning-text">
              <Icon name="wifi-off" size={17} />
              <span>{c.offline}</span>
            </p>
          )}
          {canAct && (
            <div className="rx-actionbar-main">
              <Button
                type="button"
                variant={printFirst ? "primary" : "secondary"}
                size="lg"
                icon="print"
                disabled={offline}
                loading={printing}
                onClick={() => void print()}
                className={printFirst ? "rx-primary" : ""}
              >
                {printState === "never" ? c.print : c.reprint}
              </Button>
              {actions && (
                <AdmitControls
                  points={points}
                  storageKey={pointStorageKey}
                  primary={!printFirst}
                  disabled={offline}
                  busy={admitting}
                  onAdmit={(pointId) => void admit(pointId)}
                  locale={locale}
                />
              )}
            </div>
          )}
          <div className="rx-actionbar-end">
            <Button type="button" variant={nextIsPrimary ? "primary" : "ghost"} size="lg" iconEnd="arrow-right" onClick={onNext} className={nextIsPrimary ? "min-w-40" : ""}>
              {c.next}
            </Button>
            {menu.length > 0 && <RowActions actions={menu} visible={0} menuLabel={c.moreActions(card.attendee_name)} />}
          </div>
        </div>
      )}

      {actions && dialog === "edit" && (
        <EditDialog
          card={card}
          isOpen
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            const message = await actions.edit(card.ticket_id, body);
            if (!message) {
              setDialog(null);
              onNotice(c.edited);
            }
            return message;
          }}
          locale={locale}
        />
      )}
      {actions && dialog === "transfer" && (
        <TransferDialog
          isOpen
          onClose={() => setDialog(null)}
          onTransfer={async (body) => {
            const message = await actions.transfer(card.ticket_id, body);
            if (!message) {
              setDialog(null);
              onNotice(c.transferred);
            }
            return message;
          }}
          locale={locale}
        />
      )}
    </section>
  );
}
