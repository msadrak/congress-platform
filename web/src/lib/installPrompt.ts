/**
 * "Add to home screen" for the three installable surfaces: the attendee's pass, the gate scanner and the booth
 * panel (`InstallHint` is the one component). Chromium browsers fire `beforeinstallprompt` once, early, often
 * before the page is open, so the event is kept here from app start (imported by main.tsx). Safari on iOS has no
 * such event: the hint shows the steps instead. Whether the person dismissed the hint is remembered per persona.
 *
 * Who is offered it, and where, is decided in one place (`installOffer`): never on the public pages, the
 * organizer or platform consoles or the desk, never in the installed app, never after a dismissal.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

/** The attendee's key, unchanged from before the scanner and booth had a hint of their own. */
export const INSTALL_HINT_DISMISSED_KEY = "congress_install_hint_dismissed";

export type InstallPersona = "attendee" | "scanner" | "booth";

export function installDismissedKey(persona: InstallPersona): string {
  return persona === "attendee" ? INSTALL_HINT_DISMISSED_KEY : `${INSTALL_HINT_DISMISSED_KEY}_${persona}`;
}

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

/**
 * iOS browsers that can add a page to the home screen: Safari, and Chrome, Firefox or Edge from iOS 16.4. The
 * in-app browsers of messengers and social apps are plain web views (no "Safari/" in their user agent) with no
 * share sheet entry, so they are offered nothing.
 */
export function isIosInstallBrowser(userAgent: string, maxTouchPoints = 0): boolean {
  if (!isIosDevice(userAgent, maxTouchPoints) || !/Safari\//.test(userAgent)) return false;
  if (!/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)) return true;
  const version = /OS (\d+)_(\d+)/.exec(userAgent);
  if (!version) return false;
  const major = Number(version[1]);
  return major > 16 || (major === 16 && Number(version[2]) >= 4);
}

/** The pages each persona's row may appear on: the pass, the scanner, the booth panel (not its sign-in). */
const INSTALL_PATHS: Record<InstallPersona, RegExp> = {
  attendee: /^\/(?:c\/[^/]+\/my-ticket|t\/[^/]+)\/?$/,
  scanner: /^\/scan(?:\/[^/]+)?\/?$/,
  booth: /^\/booth\/[^/]+\/?$/,
};

export function installAllowedOnPath(persona: InstallPersona, pathname: string): boolean {
  return INSTALL_PATHS[persona].test(pathname);
}

export interface InstallContext {
  persona: InstallPersona;
  pathname: string;
  userAgent: string;
  maxTouchPoints: number;
  /** The browser fired `beforeinstallprompt` and has not been used yet. */
  promptable: boolean;
  standalone: boolean;
  dismissed: boolean;
  /** A touch phone: `(pointer: coarse)` and narrower than a tablet. */
  phone: boolean;
}

/** `"prompt"`: offer the browser's own dialog. `"ios"`: show the share-sheet steps. `null`: offer nothing. */
export type InstallOffer = "prompt" | "ios" | null;

/**
 * What the install row offers. The attendee's pass and the booth panel are for phones; the scanner is also
 * offered on a tablet or in desktop Chrome, which can install it.
 */
export function installOffer(context: InstallContext): InstallOffer {
  if (context.dismissed || context.standalone || !installAllowedOnPath(context.persona, context.pathname)) return null;
  if (context.persona !== "scanner" && !context.phone) return null;
  if (context.promptable) return "prompt";
  return isIosInstallBrowser(context.userAgent, context.maxTouchPoints) ? "ios" : null;
}

const PHONE_QUERY = "(pointer: coarse) and (max-width: 767px)";

/** `useSyncExternalStore` subscription for rotating or resizing between a phone and a larger screen. */
export function subscribePhone(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function isPhone(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
}
