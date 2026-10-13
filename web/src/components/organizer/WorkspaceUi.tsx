import type { ReactNode } from "react";
import type { EventTimeStatus } from "../../lib/organizerWorkspace";
import { Badge } from "../ui/Badge";
import { Icon, type IconName } from "../ui/Icon";

/** Presentational building blocks shared by the Organizer workspace pages. No data, no effects. */

const STATUS_LABEL: Record<EventTimeStatus, { fa: string; en: string }> = {
  upcoming: { fa: "در پیش‌رو", en: "Upcoming" },
  "in-progress": { fa: "در حال برگزاری", en: "In progress" },
  ended: { fa: "پایان‌یافته", en: "Ended" },
};

export function EventStatusBadge({ status, isRtl, size = "sm" }: { status: EventTimeStatus; isRtl: boolean; size?: "sm" | "md" }) {
  const variant = status === "in-progress" ? "success" : status === "upcoming" ? "info" : "neutral";
  return (
    <Badge variant={variant} size={size} dot={status === "in-progress"}>
      {STATUS_LABEL[status][isRtl ? "fa" : "en"]}
    </Badge>
  );
}

/** Two-digit mono index used to number workspace sections ("01", "02" …) in Latin digits by design. */
export function SectionIndex({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span aria-hidden="true" className={`font-mono text-[0.6875rem] font-medium text-aiteb-indigo ${className}`.trim()}>
      {String(n).padStart(2, "0")}
    </span>
  );
}

interface SectionHeaderProps {
  index?: number;
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  as?: "h1" | "h2";
  titleId?: string;
}

/** Editorial page/section header: numbered eyebrow, display title, hairline with a brand lead-in. */
export function SectionHeader({ index, eyebrow, title, description, action, as: Heading = "h1", titleId }: SectionHeaderProps) {
  return (
    <header className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-2.5 text-xs font-semibold text-text-muted">
            {index !== undefined && <SectionIndex n={index} />}
            <span>{eyebrow}</span>
          </p>
          <Heading
            id={titleId}
            className={`font-display text-text-primary tracking-[-0.03em] ${Heading === "h1" ? "text-[1.75rem] sm:text-[2.125rem] font-[680] leading-[1.12]" : "text-xl sm:text-2xl font-[660] leading-tight"}`}
          >
            {title}
          </Heading>
          {description && <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      <div className="rule-arc" aria-hidden="true" />
    </header>
  );
}

/** Result of the last change: polite `status`, or assertive `alert` for failures. */
export function Notice({
  tone,
  children,
  onDismiss,
  dismissLabel,
}: {
  tone: "ok" | "error";
  children: ReactNode;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  const error = tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed motion-safe:animate-pop ${
        error
          ? "border-status-danger-border bg-status-danger-bg text-status-danger-text"
          : "border-status-success-border bg-status-success-bg text-status-success-text"
      }`}
    >
      <Icon name={error ? "alert" : "check-circle"} size={18} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{children}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="-my-1 -me-1.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg px-3.5 py-3 text-sm leading-relaxed text-status-danger-text"
    >
      <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Label wraps its control, so every field is programmatically named without id plumbing. */
export function Field({
  label,
  required = false,
  hint,
  className = "",
  children,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block">
        <span className="ui-label">
          {label}
          {required && (
            <span aria-hidden="true" className="ms-1 text-status-danger-solid">
              *
            </span>
          )}
        </span>
        {children}
      </label>
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{hint}</p>}
    </div>
  );
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 border-t border-border-subtle pt-5 sm:flex-row sm:justify-end">{children}</div>;
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="relative overflow-hidden shape-arc border border-dashed border-border-strong bg-surface-panel px-6 py-10 text-center sm:py-14">
      <div aria-hidden="true" className="pointer-events-none absolute -end-20 -top-20 size-48 rounded-full border border-action-subtle-border" />
      <div aria-hidden="true" className="pointer-events-none absolute -end-10 -top-10 size-28 rounded-full border border-action-subtle-border" />
      <div className="relative mx-auto max-w-md space-y-3">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-aiteb-lavender text-aiteb-indigo">
          <Icon name={icon} size={24} />
        </span>
        <p className="text-base font-bold text-text-primary">{title}</p>
        {children && <div className="text-sm leading-relaxed text-text-secondary">{children}</div>}
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}

/** Capacity / rate meter. `value` is a percentage (0–100), announced as a progressbar. */
export function Meter({
  value,
  label,
  tone = "default",
  size = "md",
  className = "",
}: {
  value: number;
  label: string;
  tone?: "default" | "full" | "muted";
  size?: "md" | "lg";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      data-tone={tone === "default" ? undefined : tone}
      data-size={size === "lg" ? "lg" : undefined}
      className={`org-meter ${className}`.trim()}
    >
      <span style={{ inlineSize: `${pct}%` }} />
    </div>
  );
}

/** Small labelled metadata item for typeset columns (label above, value below). */
export function MetaItem({ label, children, className = "" }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <dt className="text-[0.6875rem] font-semibold text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-text-primary break-words">{children}</dd>
    </div>
  );
}
