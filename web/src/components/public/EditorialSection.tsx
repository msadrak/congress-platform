import type { ReactNode } from "react";
import { indexLabel, type PublicLocale } from "./copy";

interface EditorialSectionProps {
  id: string;
  headingId: string;
  index: number;
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  locale: PublicLocale;
  /** `split` = 4/8 editorial columns, `stack` = heading above full-width content. */
  layout?: "split" | "stack";
  aside?: ReactNode;
  children: ReactNode;
}

/** Numbered editorial section: mono index, small eyebrow, confident heading. */
export function EditorialSection({ id, headingId, index, eyebrow, title, lead, locale, layout = "split", aside, children }: EditorialSectionProps) {
  const n = indexLabel(index, locale);
  const head = (
    <div className="space-y-4">
      <p className="flex items-center gap-3">
        <span className="pub-index">{n}</span>
        <span className="text-xs font-semibold text-text-muted">{eyebrow}</span>
      </p>
      <h2 id={headingId} className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] leading-[1.08] text-text-primary rtl:leading-[1.4]">
        {title}
      </h2>
      {lead && <div className="max-w-md text-base leading-relaxed text-text-secondary">{lead}</div>}
    </div>
  );

  if (layout === "stack") {
    return (
      <section id={id} aria-labelledby={headingId} className="reveal scroll-mt-24 space-y-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          {head}
          {aside}
        </div>
        {children}
      </section>
    );
  }

  return (
    <section id={id} aria-labelledby={headingId} className="reveal scroll-mt-24 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
      <div className="lg:col-span-4">
        <div className="lg:sticky lg:top-28 space-y-6">
          {head}
          {aside}
        </div>
      </div>
      <div className="lg:col-span-8 min-w-0">{children}</div>
    </section>
  );
}
