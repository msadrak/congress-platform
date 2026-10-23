import { useEffect } from "react";

export const APP_TITLE = "AI Teb";

/** "<page> · <context>", or "<page> · AI Teb" without a context (a congress, booth or event name). */
export function pageTitle(page: string, context?: string | null): string {
  const scope = context?.trim();
  return `${page} · ${scope ? scope : APP_TITLE}`;
}

/**
 * Names the browser tab while the page is open. Nothing changes while `page` is still unknown
 * (loading); on unmount the previous title returns, and the next page sets its own in the same commit.
 */
export function usePageTitle(page: string | null | undefined, context?: string | null): void {
  const title = page ? pageTitle(page, context) : null;
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
