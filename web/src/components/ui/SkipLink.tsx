import React from "react";

interface SkipLinkProps {
  targetId?: string;
  children?: React.ReactNode;
}

export function SkipLink({ targetId = "main-content", children = "Skip to main content" }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[60] focus:px-4 focus:py-2.5 focus:bg-surface-ink focus:text-white focus:rounded-xl focus:shadow-pop focus:outline-2 focus:outline-offset-2 focus:outline-aiteb-orchid text-sm font-semibold"
    >
      {children}
    </a>
  );
}
