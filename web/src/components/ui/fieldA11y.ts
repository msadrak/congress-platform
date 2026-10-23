/** The ids and ARIA wiring between a field's control, its hint and its error line. */
export interface FieldWiring {
  hintId?: string;
  errorId?: string;
  controlProps: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
    "aria-required"?: true;
  };
}

/**
 * The error replaces the hint (never both), and the control is described by whichever is shown.
 * Ids the control already carries are kept, so call sites that address the control by id keep working.
 */
export function fieldWiring({
  id,
  hasHint,
  hasError,
  required = false,
  describedBy,
}: {
  id: string;
  hasHint: boolean;
  hasError: boolean;
  required?: boolean;
  /** An `aria-describedby` the control already has; it is kept in front. */
  describedBy?: string;
}): FieldWiring {
  const errorId = hasError ? `${id}-error` : undefined;
  const hintId = !hasError && hasHint ? `${id}-hint` : undefined;
  const describedby = [describedBy, errorId ?? hintId].filter(Boolean).join(" ");
  return {
    hintId,
    errorId,
    controlProps: {
      id,
      ...(describedby ? { "aria-describedby": describedby } : {}),
      ...(hasError ? { "aria-invalid": true as const } : {}),
      ...(required ? { "aria-required": true as const } : {}),
    },
  };
}
