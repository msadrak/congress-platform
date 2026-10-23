import { useId, useState } from "react";
import { boothCopy } from "../../copy/booth";
import { formatLocalizedNumber, type AttendeeLocale } from "../../lib/i18n";
import { maskedCode, type QueuedLeadScan } from "../../lib/leadQueue";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { queueFailureText } from "./boothText";
import { leadClock } from "./leadTime";
import type { LeadQueueState } from "./useLeadQueue";

interface PendingSyncPanelProps {
  queue: LeadQueueState;
  locale: AttendeeLocale;
}

/**
 * Scans captured offline that have not reached the server, as one collapsed row («۲ اسکن در انتظار ارسال · ارسال»)
 * that opens into one line per scan: time, the last four characters of the code, its state and its actions.
 * The full badge code is never shown: it is the attendee's gate credential.
 */
export function PendingSyncPanel({ queue, locale }: PendingSyncPanelProps) {
  const text = boothCopy[locale];
  const listId = useId();
  const [open, setOpen] = useState(false);
  const { scans, online, sendingId } = queue;
  if (scans.length === 0) return null;
  const anyPending = scans.some((scan) => scan.state === "pending");
  const anyFailed = scans.some((scan) => scan.state === "failed");

  const stateOf = (scan: QueuedLeadScan) => {
    if (sendingId === scan.id) return { tone: "info" as const, label: text.syncing };
    if (scan.state === "failed" && scan.failure) return { tone: "danger" as const, label: queueFailureText(scan.failure, locale) };
    if (!online) return { tone: "muted" as const, label: text.waiting };
    if (scan.attempts > 0) return { tone: "muted" as const, label: text.retryAt(leadClock(scan.next_attempt_at, locale)) };
    return { tone: "muted" as const, label: text.syncing };
  };

  return (
    <section
      data-testid="pending-sync"
      className={`rounded-card border ${anyFailed ? "border-status-danger-border bg-status-danger-bg/50" : "border-status-warning-border bg-status-warning-bg/60"}`}
    >
      <div className="flex items-center gap-2 pe-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2 ps-4 text-start text-body-sm font-semibold text-text-primary cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring rounded-card"
        >
          <Icon name={anyFailed ? "alert" : "hourglass"} size={17} className={anyFailed ? "text-status-danger-text" : "text-status-warning-text"} />
          <span className="min-w-0 flex-1 truncate">{text.pendingCount(formatLocalizedNumber(scans.length, locale))}</span>
          <Icon name="chevron-down" size={18} className={`text-text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </button>
        {online && anyPending && (
          <Button type="button" variant="secondary" size="sm" icon="sync" loading={sendingId !== null} onClick={queue.syncNow} className="shrink-0">
            {text.syncNow}
          </Button>
        )}
      </div>
      {open && (
        <ul id={listId} className="space-y-1.5 px-2 pb-2">
          {scans.map((scan) => {
            const state = stateOf(scan);
            const code = maskedCode(scan.qr_secret);
            return (
              <li
                key={scan.id}
                data-testid="pending-scan"
                data-state={sendingId === scan.id ? "sending" : scan.state}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-surface-panel py-1.5 ps-3 pe-1.5 text-body-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-text-secondary">{leadClock(scan.queued_at, locale)}</span>
                  <span aria-hidden="true" className="mx-1.5 text-text-muted">·</span>
                  <span className="text-text-primary">
                    {text.code}{" "}
                    <bdi dir="ltr" className="font-mono">{code}</bdi>
                  </span>
                  <span
                    className={`mt-0.5 block ${
                      state.tone === "danger" ? "font-medium text-status-danger-text" : state.tone === "info" ? "text-status-info-text" : "text-text-muted"
                    }`}
                  >
                    {state.label}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  {scan.state === "failed" && (
                    <Button type="button" variant="ghost" size="sm" disabled={!online} onClick={() => queue.retry(scan.id)}>
                      {text.retryItem}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={sendingId === scan.id}
                    onClick={() => queue.discard(scan.id)}
                    aria-label={text.discardItemOf(code)}
                  >
                    {text.discardItem}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
