import React from "react";
import { Link, type LinkProps } from "react-router-dom";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "./buttonStyles";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isFullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", isFullWidth = false, className = "", children, ...props },
  ref
) {
  return (
    <button ref={ref} className={buttonClassName({ variant, size, isFullWidth, className })} {...props}>
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
  return (
    <Link className={buttonClassName({ variant, size, isFullWidth, className })} {...props}>
      {children}
    </Link>
  );
}
