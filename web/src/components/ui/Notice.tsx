import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { useUiCopy } from "./uiCopy";

/** `ok` / `error` are the older organizer names for `success` / `danger`. */
export type NoticeTone = "info" | "success" | "warning" | "danger" | "ok" | "error";

type CoreTone = "info" | "success" | "warning" | "danger";

const TONE: Record<CoreTone, { box: string; icon: IconName }> = {
  info: { box: "border-status-info-border bg-status-info-bg text-status-info-text", icon: "info" },
  success: { box: "border-status-success-border bg-status-success-bg text-status-success-text", icon: "check-circle" },
  warning: { box: "border-status-warning-border bg-status-warning-bg text-status-warning-text", icon: "alert" },
  danger: { box: "border-status-danger-border bg-status-danger-bg text-status-danger-text", icon: "alert" },
};

export interface NoticeProps {
  tone?: NoticeTone;
  /** Optional bold first line. */
  title?: ReactNode;
  children?: ReactNode;
  /** One action (a small Button or link) at the end. */
  action?: ReactNode;
  /** Shows a ✕ button. */
  onDismiss?: () => void;
  /** Accessible name of the ✕; defaults to «بستن» / "Close". */
  dismissLabel?: string;
  /** Replaces the tone's icon. */
  icon?: IconName;
  className?: string;
}

/**
 * An inline message box. Danger is announced assertively (`role="alert"`); every other tone politely
 * (`role="status"`). Render it only while it applies.
 */
export function Notice({ tone = "info", title, children, action, onDismiss, dismissLabel, icon, className = "" }: NoticeProps) {
  const core: CoreTone = tone === "ok" ? "success" : tone === "error" ? "danger" : tone;
  const { ref, copy } = useUiCopy<HTMLDivElement>();
  return (
    <div
      ref={ref}
      role={core === "danger" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-control border px-4 py-3 text-body-sm leading-relaxed ${TONE[core].box} ${className}`.trim()}
    >
      <Icon name={icon ?? TONE[core].icon} size={18} className="mt-0.5" />
      <div className="min-w-0 flex-1 break-words">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel ?? copy.close}
          className="-my-2 -me-2 grid size-10 shrink-0 cursor-pointer place-items-center rounded-full opacity-75 transition-opacity hover:opacity-100"
        >
          <Icon name="x" size={18} />
        </button>
      )}
    </div>
  );
}
