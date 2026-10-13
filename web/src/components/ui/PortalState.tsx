import type { ComponentType, ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Icon, type IconName } from "./Icon";

/**
 * Route element for congress-scoped pages: remounts the page per slug, so state and late
 * responses from one congress can never appear in another.
 */
export function CongressRoute({ page: Page }: { page: ComponentType }) {
  const { slug } = useParams<{ slug: string }>();
  return <Page key={slug} />;
}

type PanelTone = "neutral" | "danger";

/** Consistent loading / empty / error panel for portal pages. */
export function StatusPanel({ tone = "neutral", icon, title, children }: { tone?: PanelTone; icon: IconName; title: string; children?: ReactNode }) {
  const danger = tone === "danger";
  return (
    <div
      role={danger ? "alert" : "status"}
      className={`relative overflow-hidden shape-arc border p-7 sm:p-10 text-center ${danger ? "bg-status-danger-bg border-status-danger-border" : "bg-surface-panel border-border-default shadow-soft"}`}
    >
      <div aria-hidden="true" className={`pointer-events-none absolute -top-24 -end-24 size-56 rounded-full border ${danger ? "border-status-danger-border" : "border-action-subtle-border"}`} />
      <div aria-hidden="true" className={`pointer-events-none absolute -top-14 -end-14 size-36 rounded-full border ${danger ? "border-status-danger-border" : "border-action-subtle-border"}`} />
      <div className="relative mx-auto max-w-md space-y-3">
        <span className={`mx-auto grid size-14 place-items-center rounded-2xl ${danger ? "bg-white text-status-danger-text shadow-soft" : "bg-aiteb-lavender text-aiteb-indigo"}`}>
          <Icon name={icon} size={26} />
        </span>
        <p className={`text-lg font-bold ${danger ? "text-status-danger-text" : "text-text-primary"}`}>{title}</p>
        {children && <div className="text-sm leading-relaxed text-text-secondary space-y-4">{children}</div>}
      </div>
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4">
      <div className="skeleton h-40 shape-arc" />
      <div className="grid grid-cols-2 gap-4">
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" />
      </div>
      <div className="skeleton h-16 rounded-2xl" />
    </div>
  );
}
