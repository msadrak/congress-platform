import type { ReactNode } from "react";

interface SectionHeaderProps {
  /** Pre-formatted section index ("01" / "۰۱"). */
  index?: string;
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Trailing meta (counts, actions). */
  aside?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}

/** Editorial section heading: mono index, title, optional lede and a hairline with a brand lead-in. */
export function SectionHeader({ index, id, title, description, aside, as: Heading = "h2", className = "" }: SectionHeaderProps) {
  return (
    <div className={`space-y-3 ${className}`.trim()}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-baseline gap-3">
            {index && (
              <span aria-hidden="true" className="font-mono text-xs font-medium text-text-muted tabular">
                {index}
              </span>
            )}
            <Heading id={id} className="text-lg sm:text-xl font-semibold tracking-[-0.02em] text-text-primary">
              {title}
            </Heading>
          </div>
          {description && <p className="text-sm leading-relaxed text-text-secondary max-w-2xl">{description}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <div aria-hidden="true" className="rule-arc" />
    </div>
  );
}
