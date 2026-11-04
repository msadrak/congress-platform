import type { ReactNode } from "react";

interface EditorialSectionProps {
  id: string;
  headingId: string;
  /** Organizer-written small text above the heading; nothing when the organizer wrote none. */
  eyebrow?: ReactNode;
  /** Platform copy, or organizer text wrapped in `<Bidi>` so it keeps its own direction. */
  title: ReactNode;
  /** Organizer-written lead under the heading. */
  lead?: ReactNode;
  /** `start` = heading aligned with the reading edge (default), `center` = centered heading column. */
  align?: "start" | "center";
  /** Shown at the end of the heading row on wide screens (badges, small actions). */
  aside?: ReactNode;
  children: ReactNode;
}

/** A page section: heading (with the organizer's eyebrow and lead when written), then the content at full width. */
export function EditorialSection({ id, headingId, eyebrow, title, lead, align = "start", aside, children }: EditorialSectionProps) {
  const centered = align === "center";
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-24 space-y-6 sm:space-y-8">
      <div className={`flex flex-col gap-4 ${centered ? "items-center text-center" : "lg:flex-row lg:items-end lg:justify-between"}`}>
        <div className={`max-w-3xl space-y-2 ${centered ? "flex flex-col items-center" : ""}`}>
          {eyebrow && <p className="text-meta font-semibold text-text-muted">{eyebrow}</p>}
          <h2 id={headingId} className="text-title font-bold text-text-primary text-balance break-words sm:text-title-lg">
            {title}
          </h2>
          {lead && <div className="max-w-2xl text-body text-text-secondary">{lead}</div>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
