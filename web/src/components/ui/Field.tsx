import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { fieldWiring } from "./fieldA11y";
import { Icon } from "./Icon";
import { useUiCopy } from "./uiCopy";

export interface FieldProps {
  label: ReactNode;
  /** A constraint the label can't express. Hidden while `error` is shown. */
  hint?: ReactNode;
  /** Validation message; replaces the hint and marks the control `aria-invalid`. */
  error?: ReactNode;
  required?: boolean;
  /** Adds «(اختیاری)» / "(optional)" after the label. */
  optional?: boolean;
  className?: string;
  /** One control (`TextInput`, `Select`, `Textarea`, a native input …). It receives `id`, `aria-describedby` and `aria-invalid`. */
  children: ReactNode;
}

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" };

/**
 * A labelled form field. The label wraps the control, so it is named even when the control ignores `id`;
 * the hint or error line below is linked through `aria-describedby`.
 */
export function Field({ label, hint, error, required = false, optional = false, className = "", children }: FieldProps) {
  const generatedId = useId();
  const { ref, copy } = useUiCopy<HTMLSpanElement>();
  const hasError = error !== undefined && error !== null && error !== false && error !== "";
  const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== "";

  let control = children;
  let wiring = fieldWiring({ id: generatedId, hasHint, hasError, required });
  if (isValidElement<ControlProps>(children)) {
    const own = children.props;
    wiring = fieldWiring({ id: own.id ?? generatedId, hasHint, hasError, required, describedBy: own["aria-describedby"] });
    const invalid = hasError ? true : own["aria-invalid"];
    control = cloneElement(children as ReactElement<ControlProps>, { ...wiring.controlProps, "aria-invalid": invalid });
  }

  return (
    <div className={className}>
      <label className="block">
        <span ref={ref} className="ui-label">
          {label}
          {required && (
            <span aria-hidden="true" className="ms-1 text-status-danger-solid">
              *
            </span>
          )}
          {optional && <span className="ms-1 font-normal text-text-muted">{copy.optional}</span>}
        </span>
        {control}
      </label>
      {wiring.errorId ? (
        <p id={wiring.errorId} className="mt-1.5 flex items-start gap-1.5 text-meta leading-relaxed text-status-danger-text">
          <Icon name="alert" size={16} className="mt-0.5" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      ) : (
        wiring.hintId && (
          <p id={wiring.hintId} className="mt-1.5 text-caption leading-relaxed text-text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
