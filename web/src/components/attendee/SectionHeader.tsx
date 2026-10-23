import type { ReactNode } from "react";
import { SectionHeader as UiSectionHeader } from "../ui/PageHeader";

interface SectionHeaderProps {
  /** Deprecated: section indexes are no longer shown. */
  index?: string;
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Trailing meta (counts, actions). */
  aside?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}

/** Deprecated wrapper over `ui/PageHeader`'s `SectionHeader` (UX-Z removes it). */
export function SectionHeader({ id, title, description, aside, as, className }: SectionHeaderProps) {
  return <UiSectionHeader id={id} title={title} description={description} action={aside} as={as} className={className} />;
}
