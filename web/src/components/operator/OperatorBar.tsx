import type { ReactNode } from "react";
import { Icon, type IconName } from "../ui/Icon";

export interface OperatorBarProps {
  /** Gate, desk or booth name: the screen's h1, cut to one line (the full name is its tooltip). */
  title: string;
  /** Small second line, e.g. the congress name under a booth name. */
  subtitle?: string;
  /** Tool icon at the start. */
  icon?: IconName;
  /** One chip after the title, e.g. the scanner's entry rule. */
  chip?: ReactNode;
  /** Extra controls before the status, e.g. the booth's «ثبت لید» from 1024 px. */
  actions?: ReactNode;
  /** A `StatusPill`. */
  status?: ReactNode;
  /** An `OperatorMenu`. */
  menu?: ReactNode;
  /** Ink for the scanner, light for the desk and the booth. */
  tone?: "light" | "ink";
}

/** The compact top bar every operator tool shares: 56 px high, under the status bar on notched phones. */
export function OperatorBar({ title, subtitle, icon, chip, actions, status, menu, tone = "light" }: OperatorBarProps) {
  const ink = tone === "ink";
  return (
    <header
      className={`sticky top-0 z-30 border-b pt-safe ${
        ink ? "border-white/10 bg-surface-ink text-white" : "border-border-default bg-surface-panel text-text-primary"
      }`}
    >
      <div className="flex h-14 items-center gap-2 ps-4 pe-2 sm:gap-3 sm:ps-5 sm:pe-3">
        {icon && <Icon name={icon} size={20} className={ink ? "text-aiteb-orchid" : "text-action-primary"} />}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0">
            <h1 dir="auto" className="truncate text-base leading-tight font-bold" title={title}>
              {title}
            </h1>
            {subtitle && (
              <p dir="auto" className={`truncate text-xs leading-tight ${ink ? "text-ink-200" : "text-text-muted"}`} title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
          {chip && <div className="shrink-0">{chip}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        {status && <div className="flex min-w-0 shrink items-center">{status}</div>}
        {menu}
      </div>
    </header>
  );
}
