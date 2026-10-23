import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";
import { useUiCopy } from "./uiCopy";

export interface PageHeaderProps {
  title: ReactNode;
  /** One meta line (≤ 80 characters): a date, a count, a status. */
  meta?: ReactNode;
  /** The page's actions, at the end; one primary at most. */
  actions?: ReactNode;
  /** A back link above the title; `label` defaults to «بازگشت» / "Back". */
  back?: { to: string; label?: string };
  titleId?: string;
  className?: string;
}

/** Page title block: optional back link, the h1, one meta line, actions at the end. No eyebrow, index or rule. */
export function PageHeader({ title, meta, actions, back, titleId, className = "" }: PageHeaderProps) {
  const { ref, copy } = useUiCopy<HTMLElement>();
  return (
    <header ref={ref} className={`space-y-2 ${className}`.trim()}>
      {back && (
        <Link
          to={back.to}
          className="-ms-1 inline-flex min-h-11 items-center gap-1.5 rounded-control px-1 text-body-sm font-semibold text-text-secondary hover:text-text-primary"
        >
          <Icon name="arrow-left" size={18} />
          {back.label ?? copy.back}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 id={titleId} className="text-title sm:text-title-lg font-bold leading-tight tracking-tight text-text-primary text-balance">
            {title}
          </h1>
          {meta && <div className="text-body-sm text-text-secondary">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export interface SectionHeaderProps {
  title: ReactNode;
  /** One optional line under the title. */
  description?: ReactNode;
  /** Trailing action or meta (a count, a button). */
  action?: ReactNode;
  id?: string;
  as?: "h2" | "h3";
  className?: string;
}

/** Section title (18/700) with an optional action at the end. No eyebrow, index or rule. */
export function SectionHeader({ title, description, action, id, as: Heading = "h2", className = "" }: SectionHeaderProps) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-4 gap-y-2 ${className}`.trim()}>
      <div className="min-w-0 space-y-1">
        <Heading id={id} className="text-title-sm font-bold tracking-tight text-text-primary">
          {title}
        </Heading>
        {description && <p className="max-w-2xl text-body-sm leading-relaxed text-text-secondary">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
