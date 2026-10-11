import React from "react";
import { Link, type LinkProps } from "react-router-dom";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-action-primary text-text-inverse hover:bg-action-hover active:bg-action-active shadow-xs border border-transparent",
  secondary:
    "bg-surface-panel text-text-primary hover:bg-surface-panel-subtle border border-border-default shadow-xs",
  outline:
    "bg-transparent text-action-primary hover:bg-action-subtle border border-action-subtle-border",
  ghost:
    "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-panel-subtle border border-transparent",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5 min-h-[36px] rounded-md gap-1.5 font-medium",
  md: "text-sm px-4 py-2.5 min-h-[44px] rounded-lg gap-2 font-medium",
  lg: "text-base px-5 py-3 min-h-[48px] rounded-lg gap-2.5 font-semibold",
};

const baseStyles =
  "inline-flex items-center justify-center text-center select-none transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isFullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", isFullWidth = false, className = "", children, ...props },
  ref
) {
  const fullWidthStyle = isFullWidth ? "w-full" : "";
  const combined = `${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${fullWidthStyle} ${className}`.trim();

  return (
    <button ref={ref} className={combined} {...props}>
      {children}
    </button>
  );
});

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isFullWidth?: boolean;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  isFullWidth = false,
  className = "",
  children,
  ...props
}: LinkButtonProps) {
  const fullWidthStyle = isFullWidth ? "w-full" : "";
  const combined = `${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${fullWidthStyle} ${className}`.trim();

  return (
    <Link className={combined} {...props}>
      {children}
    </Link>
  );
}
