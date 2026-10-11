import React from "react";

interface SkipLinkProps {
  targetId?: string;
  children?: React.ReactNode;
}

export function SkipLink({ targetId = "main-content", children = "Skip to main content" }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-50 focus:px-4 focus:py-2.5 focus:bg-surface-panel focus:text-text-primary focus:border focus:border-border-default focus:rounded-lg focus:shadow-md focus:outline-2 focus:outline-action-primary text-sm font-medium"
    >
      {children}
    </a>
  );
}
