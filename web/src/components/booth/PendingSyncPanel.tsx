import { codeFontClass, formatLocalizedNumber, type AttendeeLocale } from "../../lib/i18n";
import type { QueuedLeadScan } from "../../lib/leadQueue";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { BoothSpinner } from "./BoothSpinner";
import { boothText, queueFailureText } from "./boothText";
import type { LeadQueueState } from "./useLeadQueue";

function clock(ms: number | string, locale: AttendeeLocale): string {
  try {
    return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  } catch {
    return "";
  }
}

interface PendingSyncPanelProps {
  queue: LeadQueueState;
  locale: AttendeeLocale;
}

/**
 * Scans captured offline that have not reached the server: each one with its state (waiting, sending, next try,
 * or the server's refusal) and what the operator can do about it.
 */
export function PendingSyncPanel({ queue, locale }: PendingSyncPanelProps) {
  const text = boothText(locale);
  const { scans, online, sendingId } = queue;
  if (scans.length === 0) return null;
  const anyPending = scans.some((scan) => scan.state === "pending");

  const stateOf = (scan: QueuedLeadScan) => {
    if (sendingId === scan.id) return { tone: "info" as const, label: text.syncing };
    if (scan.state === "failed" && scan.failure) return { tone: "danger" as const, label: queueFailureText(scan.failure, locale) };
    if (!online) return { tone: "muted" as const, label: text.waiting };
    if (scan.attempts > 0) return { tone: "muted" as const, label: text.retryAt(clock(scan.next_attempt_at, locale)) };
    return { tone: "muted" as const, label: text.syncing };
  };

  return (
    <section
      aria-labelledby="pending-sync-heading"
      data-testid="pending-sync"
      className="rounded-2xl border border-status-warning-border bg-status-warning-bg/60 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="pending-sync-heading" className="flex items-center gap-2 text-[15px] font-bold text-text-primary">
            <Icon name="hourglass" size={17} className="shrink-0 text-status-warning-text" />
            <span>{text.pendingHeading}</span>
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
            {text.pendingCount(formatLocalizedNumber(scans.length, locale))}. {text.pendingDesc}
          </p>
        </div>
        {online && anyPending && (
          <Button type="button" variant="secondary" size="md" disabled={sendingId !== null} onClick={queue.syncNow} className="shrink-0">
            {sendingId ? <BoothSpinner /> : <Icon name="sync" size={16} />}
            <span>{sendingId ? text.syncing : text.syncNow}</span>
          </Button>
        )}
      </div>
      <ul className="mt-3 space-y-2">
        {scans.map((scan) => {
          const state = stateOf(scan);
          return (
            <li
              key={scan.id}
              data-testid="pending-scan"
              data-state={sendingId === scan.id ? "sending" : scan.state}
              className="flex flex-col gap-2 rounded-xl border border-border-default bg-surface-panel p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <span className="booth-meta-label">{text.badgeCode}</span>
                  <bdi dir="ltr" className={`min-w-0 break-all ${codeFontClass(scan.qr_secret)} text-[13px] text-text-primary`}>{scan.qr_secret}</bdi>
                  <span className="text-[12px] text-text-muted">
                    {text.queuedAt} {clock(scan.queued_at, locale)}
                  </span>
                </p>
                <p
                  className={`mt-1 flex items-start gap-1.5 text-[12.5px] leading-relaxed ${
                    state.tone === "danger" ? "font-medium text-status-danger-text" : state.tone === "info" ? "text-status-info-text" : "text-text-muted"
                  }`}
                >
                  <Icon name={state.tone === "danger" ? "alert" : sendingId === scan.id ? "sync" : "clock"} size={14} className="mt-0.5 shrink-0" />
                  <span>{state.label}</span>
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {scan.state === "failed" && (
                  <Button type="button" variant="secondary" size="md" disabled={!online} onClick={() => queue.retry(scan.id)}>
                    <Icon name="sync" size={14} />
                    <span>{text.retryItem}</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  disabled={sendingId === scan.id}
                  onClick={() => queue.discard(scan.id)}
                  aria-label={text.discardItemOf(scan.qr_secret)}
                >
                  <Icon name="x" size={14} />
                  <span>{text.discardItem}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
