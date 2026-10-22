import type { ReactNode } from "react";
import { indexLabel, type PublicLocale } from "./copy";

interface EditorialSectionProps {
  id: string;
  headingId: string;
  index: number;
  eyebrow: ReactNode;
  /** Platform copy, or organizer text wrapped in `<Bidi>` so it keeps its own direction. */
  title: ReactNode;
  lead?: ReactNode;
  locale: PublicLocale;
  /** `start` = heading aligned with the reading edge (default), `center` = centered heading column. */
  align?: "start" | "center";
  /** Shown at the end of the heading row on wide screens (badges, small actions). */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * Numbered editorial section: mono index, small eyebrow, confident heading, then the content at full width
 * underneath on every screen size.
 */
export function EditorialSection({ id, headingId, index, eyebrow, title, lead, locale, align = "start", aside, children }: EditorialSectionProps) {
  const n = indexLabel(index, locale);
  const centered = align === "center";
  return (
    <section id={id} aria-labelledby={headingId} className="reveal scroll-mt-24 space-y-8 sm:space-y-10">
      <div className={`flex flex-col gap-6 ${centered ? "items-center text-center" : "lg:flex-row lg:items-end lg:justify-between"}`}>
        <div className={`max-w-3xl space-y-4 ${centered ? "flex flex-col items-center" : ""}`}>
          <p className="flex items-center gap-3">
            <span className="pub-index">{n}</span>
            <span className="text-xs font-semibold text-text-muted">{eyebrow}</span>
          </p>
          <h2 id={headingId} className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] leading-[1.08] text-text-primary text-balance break-words rtl:leading-[1.4]">
            {title}
          </h2>
          {lead && <div className="max-w-2xl text-base leading-relaxed text-text-secondary">{lead}</div>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
