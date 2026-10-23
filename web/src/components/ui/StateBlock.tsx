import type { ReactNode } from "react";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./Spinner";
import { useUiCopy } from "./uiCopy";

export type StateKind = "empty" | "error" | "offline" | "forbidden";

const KIND_ICON: Record<StateKind, IconName> = { empty: "layers", error: "alert", offline: "wifi-off", forbidden: "lock" };

export interface StateBlockProps {
  kind?: StateKind;
  /** Defaults to the kind's icon. */
  icon?: IconName;
  /** What is missing or what failed; rendered as a heading. */
  title: ReactNode;
  /** One optional line, only when the action is not obvious. */
  body?: ReactNode;
  /** Same as `body` (the older `EmptyState` API). */
  children?: ReactNode;
  /** One action, usually a single Button. */
  action?: ReactNode;
  /** Heading level inside the page (default 2); 1 when the state is the whole page (a failed or missing page). */
  headingLevel?: 1 | 2 | 3;
  className?: string;
}

/**
 * Empty, error, offline and forbidden states: icon tile, a heading, one optional line, one action.
 * Errors are announced (`role="alert"`). No decoration.
 */
export function StateBlock({ kind = "empty", icon, title, body, children, action, headingLevel = 2, className = "" }: StateBlockProps) {
  const Heading = (["h1", "h2", "h3"] as const)[headingLevel - 1];
  const alarming = kind === "error";
  const text = body ?? children;
  return (
    <div
      role={alarming ? "alert" : undefined}
      className={`rounded-card border border-border-default bg-surface-panel px-6 py-8 text-center sm:py-10 ${className}`.trim()}
    >
      <div className="mx-auto max-w-md space-y-3">
        <span
          className={`mx-auto grid size-12 place-items-center rounded-control ${
            alarming ? "bg-status-danger-bg text-status-danger-text" : "bg-aiteb-lavender text-aiteb-indigo"
          }`}
        >
          <Icon name={icon ?? KIND_ICON[kind]} size={24} />
        </span>
        <Heading className="text-title-sm font-bold text-text-primary">{title}</Heading>
        {text && <div className="text-body-sm leading-relaxed text-text-secondary space-y-4">{text}</div>}
        {action && <div className="flex justify-center pt-2">{action}</div>}
      </div>
    </div>
  );
}

/** Nothing here yet: title (what is missing) + one primary action. */
export function EmptyState(props: Omit<StateBlockProps, "kind">) {
  return <StateBlock kind="empty" {...props} />;
}

export interface ErrorStateProps extends Omit<StateBlockProps, "kind" | "title"> {
  /** What failed («فهرست بارگذاری نشد»); defaults to «بارگذاری نشد» / "Couldn't load". */
  title?: ReactNode;
  /** Shows the «تلاش دوباره» / "Try again" button (unless `action` is given). */
  onRetry?: () => void;
  retryLabel?: string;
  /** `offline` swaps the icon for the offline one. */
  offline?: boolean;
}

/** A failed load: the network sentence by default and a retry button. Announced as an alert. */
export function ErrorState({ title, body, children, onRetry, retryLabel, action, offline = false, ...rest }: ErrorStateProps) {
  const { ref, copy } = useUiCopy<HTMLSpanElement>();
  const retry = onRetry ? (
    <Button type="button" variant="secondary" icon="sync" onClick={onRetry}>
      {retryLabel ?? copy.retry}
    </Button>
  ) : undefined;
  return (
    <>
      <span ref={ref} hidden />
      <StateBlock
        kind="error"
        icon={offline ? "wifi-off" : undefined}
        title={title ?? copy.errorTitle}
        body={body ?? children ?? copy.errorBody}
        action={action ?? retry}
        {...rest}
      />
    </>
  );
}

/** Loading: a spinner and its status text, announced politely. */
export function LoadingState({ label, className = "" }: { label?: string; className?: string }) {
  const { ref, copy } = useUiCopy<HTMLDivElement>();
  return (
    <div ref={ref} role="status" className={`flex min-h-40 flex-col items-center justify-center gap-3 text-body-sm text-text-muted ${className}`.trim()}>
      <Spinner size={24} className="text-action-primary" />
      <span>{label ?? copy.loading}</span>
    </div>
  );
}
