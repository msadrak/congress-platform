import type { ComponentType, ReactNode } from "react";
import { useParams } from "react-router-dom";

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
export function StatusPanel({ tone = "neutral", icon, title, children }: { tone?: PanelTone; icon: string; title: string; children?: ReactNode }) {
  const toneClass = tone === "danger"
    ? "bg-status-danger-bg text-status-danger-text border-status-danger-border"
    : "bg-surface-panel text-text-secondary border-border-default";
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-2xl border p-6 sm:p-8 text-center space-y-3 ${toneClass}`}>
      <div className="text-3xl" aria-hidden="true">{icon}</div>
      <p className="text-base font-bold text-text-primary">{title}</p>
      {children && <div className="text-sm leading-relaxed space-y-3">{children}</div>}
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4 animate-pulse">
      <div className="h-28 rounded-2xl bg-surface-panel border border-border-default" />
      <div className="h-20 rounded-2xl bg-surface-panel border border-border-default" />
    </div>
  );
}
