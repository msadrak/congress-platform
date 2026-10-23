import type { ReactNode } from "react";

/** One label/value pair; use inside a `<dl>` (MetaList renders one for you). */
export function MetaItem({ label, children, dir, className = "" }: { label: ReactNode; children: ReactNode; dir?: "ltr" | "rtl" | "auto"; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <dt className="text-caption font-semibold text-text-muted">{label}</dt>
      <dd dir={dir} className="mt-1 text-body-sm font-medium text-text-primary break-words">
        {children}
      </dd>
    </div>
  );
}

export interface MetaListItem {
  label: ReactNode;
  value: ReactNode;
  /** `ltr` for codes, URLs and mobile numbers inside a Persian page. */
  dir?: "ltr" | "rtl" | "auto";
}

const COLUMNS = { 1: "", 2: "min-[480px]:grid-cols-2", 3: "min-[480px]:grid-cols-2 lg:grid-cols-3", 4: "min-[480px]:grid-cols-2 lg:grid-cols-4" } as const;

/** Label-over-value facts in a grid; one column below 480 px. */
export function MetaList({ items, columns = 2, className = "" }: { items: readonly MetaListItem[]; columns?: 1 | 2 | 3 | 4; className?: string }) {
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-4 ${COLUMNS[columns]} ${className}`.trim()}>
      {items.map((item, index) => (
        <MetaItem key={index} label={item.label} dir={item.dir}>
          {item.value}
        </MetaItem>
      ))}
    </dl>
  );
}
