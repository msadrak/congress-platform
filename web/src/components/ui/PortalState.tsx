import type { ComponentType } from "react";
import { useParams } from "react-router-dom";

/**
 * Route element for congress-scoped pages: remounts the page per slug, so state and late
 * responses from one congress can never appear in another.
 */
export function CongressRoute({ page: Page }: { page: ComponentType }) {
  const { slug } = useParams<{ slug: string }>();
  return <Page key={slug} />;
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
