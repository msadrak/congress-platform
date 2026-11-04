import React from "react";
import { Link, type LinkProps } from "react-router-dom";
import { buttonClassName, buttonIconSize, buttonStateProps, iconButtonClassName, type ButtonSize, type ButtonTone, type ButtonVariant } from "./buttonStyles";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";

interface ButtonLookProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** `ink` adapts the variant to dark ink surfaces. */
  tone?: ButtonTone;
  isFullWidth?: boolean;
  /** Leading icon (mirrors in RTL when it is directional). */
  icon?: IconName;
  /** Trailing icon, e.g. `arrow-right` on a call to action. */
  iconEnd?: IconName;
}

function ButtonContent({ icon, iconEnd, size = "md", loading = false, children }: Pick<ButtonLookProps, "icon" | "iconEnd" | "size"> & { loading?: boolean; children?: React.ReactNode }) {
  const iconSize = buttonIconSize[size];
  const body = (
    <>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={iconSize} />}
    </>
  );
  if (!loading) return body;
  // Keep the label's width: hide it in place and lay the spinner over it.
  return (
    <>
      <span className="invisible inline-flex items-center gap-[inherit]">{body}</span>
      <span className="absolute inset-0 grid place-items-center">
        <Spinner size={size === "sm" ? 16 : 24} />
      </span>
    </>
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonLookProps {
  /** Shows a spinner, sets `aria-busy` and ignores clicks; the button keeps its width and focus. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", tone, isFullWidth = false, icon, iconEnd, loading = false, disabled, className = "", onClick, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={buttonClassName({ variant, size, tone, isFullWidth, className })}
      {...props}
      {...buttonStateProps({ loading, disabled })}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      <ButtonContent icon={icon} iconEnd={iconEnd} size={size} loading={loading}>
        {children}
      </ButtonContent>
    </button>
  );
});

export interface LinkButtonProps extends LinkProps, ButtonLookProps {}

export function LinkButton({ variant = "primary", size = "md", tone, isFullWidth = false, icon, iconEnd, className = "", children, ...props }: LinkButtonProps) {
  return (
    <Link className={buttonClassName({ variant, size, tone, isFullWidth, className })} {...props}>
      <ButtonContent icon={icon} iconEnd={iconEnd} size={size}>
        {children}
      </ButtonContent>
    </Link>
  );
}

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Accessible name; required because the button shows no text. */
  label: string;
  variant?: "ghost" | "secondary";
  /** `md` 44×44 (default), `sm` 40×40 for dense desktop rows. */
  size?: "sm" | "md";
  tone?: ButtonTone;
}

/** A square icon-only button with a required accessible name. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "ghost", size = "md", tone, className = "", type = "button", ...props },
  ref
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={iconButtonClassName({ variant, size, tone, className })} {...props}>
      <Icon name={icon} size={size === "sm" ? 18 : 20} />
    </button>
  );
});
