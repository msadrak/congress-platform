export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "ink" | "light" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-action-primary text-text-inverse border border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(14_12_43/0.25),0_8px_18px_-10px_rgb(32_0_205/0.7)] hover:bg-action-hover active:bg-action-active",
  secondary:
    "bg-surface-panel text-text-primary border border-border-default shadow-soft hover:border-border-strong hover:bg-surface-panel-subtle",
  outline:
    "bg-transparent text-action-primary border border-action-subtle-border hover:bg-action-subtle hover:border-action-primary/40",
  ghost:
    "bg-transparent text-text-secondary border border-transparent hover:text-text-primary hover:bg-surface-panel-subtle",
  ink:
    "bg-surface-ink text-white border border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_8px_18px_-10px_rgb(14_12_43/0.8)] hover:bg-ink-800 active:bg-ink-950",
  light:
    "bg-white text-surface-ink border border-transparent shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)] hover:bg-aiteb-lavender",
  danger:
    "bg-status-danger-solid text-white border border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_8px_18px_-10px_rgb(222_26_80/0.7)] hover:brightness-95 active:brightness-90",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "text-[13px] px-3 py-1.5 min-h-[36px] rounded-lg gap-1.5 font-semibold",
  md: "text-sm px-4 py-2.5 min-h-[44px] rounded-[10px] gap-2 font-semibold",
  lg: "text-[15px] px-5 py-3 min-h-[50px] rounded-xl gap-2.5 font-semibold",
  xl: "text-base px-6 py-4 min-h-[58px] rounded-2xl gap-3 font-bold",
};

const baseStyles =
  "relative inline-flex items-center justify-center text-center select-none whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform,filter] duration-200 ease-[var(--ease-arc)] motion-safe:active:scale-[0.98] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-55 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer";

export function buttonClassName({
  variant = "primary",
  size = "md",
  isFullWidth = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isFullWidth?: boolean;
  className?: string;
}): string {
  return `${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${isFullWidth ? "w-full" : ""} ${className}`.trim();
}
