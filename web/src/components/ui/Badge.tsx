import React from "react";

export type BadgeVariant = "brand" | "neutral" | "success" | "warning" | "danger" | "info";
export type BadgeSize = "sm" | "md";

const variantStyles: Record<BadgeVariant, string> = {
  brand: "bg-action-subtle text-action-primary border-action-subtle-border",
  neutral: "bg-surface-panel-subtle text-text-secondary border-border-default",
  success: "bg-status-success-bg text-status-success-text border-status-success-border",
  warning: "bg-status-warning-bg text-status-warning-text border-status-warning-border",
  danger: "bg-status-danger-bg text-status-danger-text border-status-danger-border",
  info: "bg-status-info-bg text-status-info-text border-status-info-border",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "text-[11px] px-2 py-0.5",
  md: "text-xs px-2.5 py-1",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: React.ReactNode;
}

export function Badge({
  variant = "brand",
  size = "md",
  icon,
  className = "",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full border ${variantStyles[variant]} ${sizeStyles[size]} ${className}`.trim()}
      {...props}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}
