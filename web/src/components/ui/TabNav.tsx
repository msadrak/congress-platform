import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface TabNavItem {
  to: string;
  label: ReactNode;
  icon?: IconName;
  /** Match the path exactly (for an index tab whose path prefixes the others). */
  end?: boolean;
}

/**
 * Route tabs: links with an underline on the current one (`aria-current="page"`). On a narrow screen the
 * row scrolls sideways and fades out at its logical end.
 */
export function TabNav({ items, label, className = "" }: { items: readonly TabNavItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={`border-b border-border-subtle ${className}`.trim()}>
      <ul className="-mb-px flex overflow-x-auto pe-8 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] rtl:[mask-image:linear-gradient(to_left,black_calc(100%-2rem),transparent)]">
        {items.map((item) => (
          <li key={item.to} className="shrink-0">
            <NavLink
              to={item.to}
              end={item.end}
              className="relative inline-flex min-h-11 items-center gap-2 px-3 text-body-sm font-semibold whitespace-nowrap text-text-muted transition-colors hover:text-text-primary aria-[current=page]:text-text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full aria-[current=page]:after:bg-action-primary"
            >
              {item.icon && <Icon name={item.icon} size={18} />}
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
