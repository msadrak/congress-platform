import type { ComponentType, ReactNode } from "react";
import { useParams } from "react-router-dom";
import type { IconName } from "./Icon";
import { StateBlock } from "./StateBlock";

/**
 * Route element for congress-scoped pages: remounts the page per slug, so state and late
 * responses from one congress can never appear in another.
 */
export function CongressRoute({ page: Page }: { page: ComponentType }) {
  const { slug } = useParams<{ slug: string }>();
  return <Page key={slug} />;
}

type PanelTone = "neutral" | "danger";

/**
 * Loading / empty / error panel for portal pages. Deprecated wrapper over `StateBlock` (UX-Z removes it):
 * a `danger` panel is an announced error; any other is a polite status.
 */
export function StatusPanel({ tone = "neutral", icon, title, children }: { tone?: PanelTone; icon: IconName; title: string; children?: ReactNode }) {
  if (tone === "danger") return <StateBlock kind="error" icon={icon} title={title} body={children} />;
  return (
    <div role="status">
      <StateBlock kind="empty" icon={icon} title={title} body={children} />
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4">
      <div className="skeleton h-40 rounded-card" />
      <div className="grid grid-cols-2 gap-4">
        <div className="skeleton h-24 rounded-card" />
        <div className="skeleton h-24 rounded-card" />
      </div>
      <div className="skeleton h-16 rounded-card" />
    </div>
  );
}
