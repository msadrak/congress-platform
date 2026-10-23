/**
 * "Add to home screen" for the pass page. Chromium browsers fire `beforeinstallprompt` once, early, often before
 * the pass page is open, so the event is kept here from app start (imported by main.tsx). Safari on iOS has no
 * such event: the hint shows instructions instead. Whether the attendee dismissed the hint is remembered.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

export const INSTALL_HINT_DISMISSED_KEY = "congress_install_hint_dismissed";

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function isBeforeInstallPrompt(event: Event): event is BeforeInstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    if (!isBeforeInstallPrompt(event)) return;
    // Keep the browser's own mini-infobar away: the pass page offers installation at the right moment.
    event.preventDefault();
    deferred = event;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

/** `useSyncExternalStore` subscription for the availability of the browser's install prompt. */
export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

/** Shows the browser's install dialog; true when the attendee accepted. The event can be used only once. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  notify();
  try {
    await event.prompt();
    return (await event.userChoice).outcome === "accepted";
  } catch {
    return false;
  }
}

/** Already opened from the home screen (nothing to suggest). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav: NavigatorWithStandalone = window.navigator;
  return nav.standalone === true || (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
}

/** iPhone / iPad Safari, where installation is a manual "Add to Home Screen" from the share sheet. */
export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}
