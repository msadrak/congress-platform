import React from "react";

export type BadgeVariant = "brand" | "neutral" | "success" | "warning" | "danger" | "info" | "ink" | "accent";
export type BadgeSize = "sm" | "md";

const variantStyles: Record<BadgeVariant, string> = {
  brand: "bg-action-subtle text-action-primary border-action-subtle-border",
  neutral: "bg-surface-panel-subtle text-text-secondary border-border-default",
  success: "bg-status-success-bg text-status-success-text border-status-success-border",
  warning: "bg-status-warning-bg text-status-warning-text border-status-warning-border",
  danger: "bg-status-danger-bg text-status-danger-text border-status-danger-border",
  info: "bg-status-info-bg text-status-info-text border-status-info-border",
  ink: "bg-surface-ink text-white border-transparent",
  accent: "bg-event-accent-soft text-event-accent border-event-accent/20",
};

const dotStyles: Record<BadgeVariant, string> = {
  brand: "bg-action-primary",
  neutral: "bg-ink-400",
  success: "bg-status-success-solid",
  warning: "bg-status-warning-solid",
  danger: "bg-status-danger-solid",
  info: "bg-status-info-solid",
  ink: "bg-aiteb-orchid",
  accent: "bg-event-accent",
};

// 12 px text in both sizes: Persian is never set below 12 px.
const sizeStyles: Record<BadgeSize, string> = {
  sm: "h-5 px-2 gap-1",
  md: "h-6 px-2.5 gap-1.5",
};

export interface BadgeProps extends React.ComponentProps<"span"> {
  variant?: BadgeVariant;
  /** `md` 24 px (default), `sm` 20 px inside dense rows. */
  size?: BadgeSize;
  icon?: React.ReactNode;
  /** Leading status dot (live/active states). */
  dot?: boolean;
}

/** A short status or category label (≤ 10 characters): a pill, 12 px semibold, optional dot or icon. */
export function Badge({ variant = "brand", size = "md", icon, dot = false, className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center text-caption font-semibold leading-none rounded-full border whitespace-nowrap ${variantStyles[variant]} ${sizeStyles[size]} ${className}`.trim()}
      {...props}
    >
      {dot && <span aria-hidden="true" className={`size-1.5 rounded-full ${dotStyles[variant]}`} />}
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}
