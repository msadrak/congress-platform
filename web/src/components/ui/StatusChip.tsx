import type { ReactNode } from "react";
import { Badge, type BadgeSize, type BadgeVariant } from "./Badge";
import { Icon } from "./Icon";
import { useUiCopy, type StatusKey } from "./uiCopy";

const STATUS_TONE: Record<StatusKey, BadgeVariant> = {
  active: "success",
  cancelled: "danger",
  archived: "warning",
  open: "success",
  closed: "neutral",
  full: "warning",
  notOpen: "info",
  ended: "neutral",
  published: "success",
  unpublished: "neutral",
  admitted: "success",
  rejected: "danger",
  queued: "info",
  online: "success",
  offline: "warning",
  accessRemoved: "danger",
};

/**
 * The one status chip: a fixed status word (copy §3.4) with its tone, so «فعال» / "Active" reads the same in
 * every portal. Pass `children` only to override the word.
 */
export function StatusChip({ status, size = "md", children }: { status: StatusKey; size?: BadgeSize; children?: ReactNode }) {
  const { ref, copy } = useUiCopy<HTMLSpanElement>();
  const live = status === "active" || status === "online";
  return (
    <Badge ref={ref} variant={STATUS_TONE[status]} size={size} dot={live} icon={status === "archived" ? <Icon name="lock" size={12} /> : undefined}>
      {children ?? copy.status[status]}
    </Badge>
  );
}
