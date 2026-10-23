import type { ReactNode } from "react";
import type { EventTimeStatus } from "../../lib/organizerWorkspace";
import { organizerSharedCopy } from "../../copy/organizerShared";
import { Badge } from "../ui/Badge";
import { Notice } from "../ui/Notice";
import { PageHeader, SectionHeader as UiSectionHeader } from "../ui/PageHeader";

/**
 * Building blocks of the Organizer workspace pages, now thin wrappers over the shared `components/ui`
 * primitives. The old names and props stay so call sites compile; new code imports from `components/ui`.
 */

export { Field } from "../ui/Field";
export { EmptyState } from "../ui/StateBlock";
export { MetaItem } from "../ui/MetaList";
export { Notice } from "../ui/Notice";

export function EventStatusBadge({ status, isRtl, size = "sm" }: { status: EventTimeStatus; isRtl: boolean; size?: "sm" | "md" }) {
  const variant = status === "in-progress" ? "success" : status === "upcoming" ? "info" : "neutral";
  return (
    <Badge variant={variant} size={size} dot={status === "in-progress"}>
      {(isRtl ? organizerSharedCopy.fa : organizerSharedCopy.en).eventStatus[status]}
    </Badge>
  );
}

/**
 * Two-digit mono index ("01", "02" …).
 * @deprecated Section indexes are being removed (UX plan, org §3); UX-Z deletes this.
 */
export function SectionIndex({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span aria-hidden="true" className={`font-mono text-[0.6875rem] font-medium text-aiteb-indigo ${className}`.trim()}>
      {String(n).padStart(2, "0")}
    </span>
  );
}

interface SectionHeaderProps {
  title: ReactNode;
  /** The section's one primary action (or a small group, such as a filter), at the end. */
  action?: ReactNode;
  /** `h1` (default) is the page title; `h2` a section inside a page. */
  as?: "h1" | "h2";
  titleId?: string;
  /** @deprecated Not shown: section indexes are removed. */
  index?: number;
  /** @deprecated Not shown: the console already names the congress / organizer. */
  eyebrow?: ReactNode;
  /** @deprecated Not shown: headers carry no description paragraph. */
  description?: ReactNode;
}

/** Page or section header: the title and one action slot. No index, eyebrow, description or rule. */
export function SectionHeader({ title, action, as = "h1", titleId }: SectionHeaderProps) {
  if (as === "h2") return <UiSectionHeader title={title} action={action} id={titleId} />;
  return <PageHeader title={title} actions={action} titleId={titleId} />;
}

/** A failure inside a form or section, announced assertively. */
export function FormAlert({ children }: { children: ReactNode }) {
  return <Notice tone="danger">{children}</Notice>;
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 border-t border-border-subtle pt-5 sm:flex-row sm:justify-end">{children}</div>;
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
