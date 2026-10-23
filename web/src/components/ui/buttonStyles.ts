/**
 * One button look for every portal. Variants: primary, secondary, ghost, danger. Sizes follow the control
 * tokens: sm 40, md 48 (default), lg 56. Every size uses the 12 px control radius.
 * `tone="ink"` adapts all variants to the dark ink surfaces (scanner, organizer rail).
 *
 * Deprecated aliases kept so existing call sites compile (UX-Z removes them): `outline` → secondary,
 * `light` → primary on ink, `xl` → lg, and `ink` (a dark button on a light surface).
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "ink" | "light";
export type ButtonSize = "sm" | "md" | "lg" | "xl";
export type ButtonTone = "default" | "ink";

type CoreVariant = "primary" | "secondary" | "ghost" | "danger";

const lightSurface: Record<CoreVariant, string> = {
  primary: "bg-action-primary text-text-inverse border border-transparent shadow-soft hover:bg-action-hover active:bg-action-active",
  secondary:
    "bg-surface-panel text-text-primary border border-border-default shadow-soft hover:border-border-strong hover:bg-surface-panel-subtle",
  ghost: "bg-transparent text-text-secondary border border-transparent hover:text-text-primary hover:bg-surface-panel-subtle",
  danger: "bg-status-danger-solid text-white border border-transparent shadow-soft hover:brightness-95 active:brightness-90",
};

const inkSurface: Record<CoreVariant, string> = {
  primary: "bg-white text-surface-ink border border-transparent hover:bg-aiteb-lavender",
  secondary: "bg-white/8 text-white border border-white/20 hover:bg-white/14",
  ghost: "bg-transparent text-white/75 border border-transparent hover:text-white hover:bg-white/8",
  danger: "bg-status-danger-solid text-white border border-transparent hover:brightness-110",
};

/** The dark "ink" button used on light surfaces; kept as-is until its call sites migrate. */
const legacyInk = "bg-surface-ink text-white border border-transparent shadow-soft hover:bg-ink-800 active:bg-ink-950";

const sizeStyles: Record<"sm" | "md" | "lg", string> = {
  sm: "min-h-(--control-sm) px-3.5 py-1 gap-1.5 text-body-sm",
  md: "min-h-(--control-md) px-4 py-1.5 gap-2 text-body-sm",
  lg: "min-h-(--control-lg) px-5 py-2 gap-2.5 text-body",
};

/** Icon size that matches each button size. */
export const buttonIconSize: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20, xl: 20 };

// No outline colour here: the global :focus-visible rule supplies --focus-ring (orchid inside .surface-ink).
const baseStyles =
  "relative inline-flex items-center justify-center text-center font-semibold rounded-control select-none whitespace-nowrap cursor-pointer transition-[background-color,border-color,color,filter] duration-150 motion-reduce:transition-none disabled:opacity-55 disabled:cursor-not-allowed aria-busy:cursor-progress";

function variantClass(variant: ButtonVariant, tone: ButtonTone): string {
  if (variant === "ink") return legacyInk;
  if (variant === "light") return inkSurface.primary;
  const core: CoreVariant = variant === "outline" ? "secondary" : variant;
  return (tone === "ink" ? inkSurface : lightSurface)[core];
}

export function buttonClassName({
  variant = "primary",
  size = "md",
  tone = "default",
  isFullWidth = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  tone?: ButtonTone;
  isFullWidth?: boolean;
  className?: string;
}): string {
  const sizeClass = sizeStyles[size === "xl" ? "lg" : size];
  return `${baseStyles} ${variantClass(variant, tone)} ${sizeClass} ${isFullWidth ? "w-full" : ""} ${className}`.trim();
}

/** Square icon-only button: 44×44 (`md`), or 40×40 (`sm`) for dense desktop rows. */
export function iconButtonClassName({
  variant = "ghost",
  size = "md",
  tone = "default",
  className = "",
}: {
  variant?: "ghost" | "secondary";
  size?: "sm" | "md";
  tone?: ButtonTone;
  className?: string;
}): string {
  const box = size === "sm" ? "size-10" : "size-11";
  return `${baseStyles} ${variantClass(variant, tone)} ${box} shrink-0 p-0 ${className}`.trim();
}

/**
 * State attributes for a button. A loading button stays focusable and keeps its width; it reports
 * `aria-busy` and ignores activation until the work finishes.
 */
export function buttonStateProps({ loading = false, disabled = false }: { loading?: boolean; disabled?: boolean }): {
  "aria-busy"?: true;
  "aria-disabled"?: true;
  disabled?: true;
} {
  if (disabled) return { disabled: true, ...(loading ? { "aria-busy": true } : {}) };
  if (loading) return { "aria-busy": true, "aria-disabled": true };
  return {};
}
