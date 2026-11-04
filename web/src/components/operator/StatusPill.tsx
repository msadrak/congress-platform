import { operatorCopy, type OperatorLocale, type OperatorStatus } from "../../copy/operator";
import { formatLocalizedNumber } from "../../lib/i18n";
import { Icon, type IconName } from "../ui/Icon";

export interface StatusPillProps {
  locale: OperatorLocale;
  status: OperatorStatus;
  /** Scans or leads waiting to send (`queued`, and `offline` when > 0) or open conflicts (`conflicts`). */
  count?: number;
  /** Replaces the count part after the state word, e.g. the offline time left or «فقط مشاهده». */
  detail?: string;
  /** Ink surface (scanner) or light surface (desk, booth). */
  tone?: "light" | "ink";
  /** Makes the pill a button, e.g. conflicts → open the conflicts sheet, update → reload. */
  onClick?: () => void;
}

type PillLook = "ok" | "warn" | "busy" | "danger" | "muted" | "action";

const LOOK: Record<OperatorStatus, { icon: IconName; look: PillLook }> = {
  online: { icon: "wifi", look: "ok" },
  offline: { icon: "wifi-off", look: "warn" },
  syncing: { icon: "sync", look: "busy" },
  queued: { icon: "upload", look: "busy" },
  conflicts: { icon: "alert", look: "danger" },
  archived: { icon: "lock", look: "muted" },
  update: { icon: "download", look: "action" },
};

const LIGHT: Record<PillLook, string> = {
  ok: "border-status-success-border bg-status-success-bg text-status-success-text",
  warn: "border-status-warning-border bg-status-warning-bg text-status-warning-text",
  busy: "border-status-info-border bg-status-info-bg text-status-info-text",
  danger: "border-status-danger-border bg-status-danger-bg text-status-danger-text",
  muted: "border-border-default bg-surface-panel-subtle text-text-secondary",
  action: "border-action-subtle-border bg-action-subtle text-action-subtle-text",
};

const INK: Record<PillLook, string> = {
  ok: "border-white/15 bg-white/10 text-status-success-bg",
  warn: "border-status-warning-solid/60 bg-status-warning-solid/20 text-status-warning-bg",
  busy: "border-white/15 bg-white/10 text-status-info-bg",
  danger: "border-status-danger-solid/70 bg-status-danger-solid/25 text-status-danger-bg",
  muted: "border-white/15 bg-white/5 text-ink-200",
  action: "border-aiteb-orchid/50 bg-aiteb-orchid/15 text-aiteb-orchid",
};

/** One word for the state, plus a count in the reader's digits. */
function pillText(locale: OperatorLocale, status: OperatorStatus, count: number | undefined, detail: string | undefined): string {
  const words = operatorCopy[locale].status;
  const n = count ?? 0;
  const shown = formatLocalizedNumber(n, locale);
  switch (status) {
    case "queued":
      return detail ?? words.queued(shown, n);
    case "conflicts":
      return detail ?? words.conflicts(shown, n);
    case "offline":
      if (detail) return words.offline + words.separator + detail;
      return n > 0 ? words.offline + words.separator + words.queued(shown, n) : words.offline;
    default:
      return detail ? words[status] + words.separator + detail : words[status];
  }
}

/** Connection and data state of an operator tool, in the bar: colour + icon + at most two words. */
export function StatusPill({ locale, status, count, detail, tone = "light", onClick }: StatusPillProps) {
  const { icon, look } = LOOK[status];
  const text = pillText(locale, status, count, detail);
  const pill = `inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm font-semibold whitespace-nowrap ${
    tone === "ink" ? INK[look] : LIGHT[look]
  }`;
  const glyph = <Icon name={icon} size={15} strokeWidth={2} className={status === "syncing" ? "motion-safe:animate-spin" : ""} />;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} data-status={status} className="inline-flex min-h-11 items-center rounded-full cursor-pointer">
        <span className={pill}>
          {glyph}
          <span className="truncate">{text}</span>
        </span>
      </button>
    );
  }
  return (
    <span role="status" data-status={status} className={pill}>
      {glyph}
      <span className="truncate">{text}</span>
    </span>
  );
}
