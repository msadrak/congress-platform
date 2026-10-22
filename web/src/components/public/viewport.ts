/**
 * Minimum height of a first-screen hero: the small viewport (`svh`, browser toolbars shown) minus the
 * sticky public header (`h-16` + 1px border + the top safe-area inset, see `PublicLayout`). Header plus
 * hero then fill exactly one screen; taller content still grows instead of being clipped.
 */
export const BELOW_HEADER_MIN_H = "min-h-[calc(100svh-4rem-1px-env(safe-area-inset-top,0px))]";
