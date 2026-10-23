import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * A new page opens at its top. Back/forward (POP) is left to the browser's own scroll restoration,
 * and a link with a hash is left to the page, which scrolls to its anchor once the section exists
 * (e.g. CongressDetails "#program"). Query- or hash-only changes on the same page never move the scroll.
 */
export function useScrollToTop(): void {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const lastPath = useRef(pathname);
  useLayoutEffect(() => {
    const newPage = lastPath.current !== pathname;
    lastPath.current = pathname;
    if (!newPage || navigationType === "POP") return;
    if (hash) {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" });
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname, hash, navigationType]);
}
