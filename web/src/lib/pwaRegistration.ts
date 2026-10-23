/**
 * PWA Service Worker registration and update lifecycle.
 *
 * Architecture:
 * - registerType: 'prompt' — the user explicitly decides when to apply a new app version (an operator
 *   is never swapped to new code mid-shift). `AppUpdatePrompt` offers it on the attendee and public screens;
 *   the operator screens offer it from their own status pill and menu (`hooks/useAppUpdate.ts`).
 * - The Service Worker precaches the app shell (HTML, JS, CSS, SVG).
 * - Operational data (manifests, scans, conflicts) lives exclusively in IndexedDB
 *   and is NEVER touched by SW cache eviction or updates.
 * - API responses are NEVER cached by the Service Worker.
 * - Bearer tokens remain in sessionStorage/memory, never in Cache Storage.
 * - A launch from the home screen (`/?source=pwa`, the manifest's start_url) is turned into the device's
 *   own destination (its scanner point, the attendee's pass, the last booth or desk, or the plain home page)
 *   before the app renders (see `launchTarget.ts`).
 */

import { registerSW } from 'virtual:pwa-register';
import { handleHomeScreenLaunch } from './launchTarget';

// A new version can be waiting before any component subscribes (found on page load), so the
// fact is kept here rather than only announced.
let updateWaiting = false;
const listeners = new Set<() => void>();

/** For `useSyncExternalStore`: notified when a new app version is installed and waiting. */
export function subscribeToAppUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isAppUpdateWaiting(): boolean {
  return updateWaiting;
}

// Register the SW once on module load.
// `registerSW` from vite-plugin-pwa returns a function to trigger the update.
const updateSW = registerSW({
  onNeedRefresh() {
    updateWaiting = true;
    for (const listener of listeners) listener();
  },
  onOfflineReady() {
    // App shell is cached; scanner can operate offline after next visit
    console.info('[PWA] Offline ready — app shell cached.');
  },
  onRegisteredSW(swUrl, registration) {
    // Check for SW updates every 60 seconds while online
    if (registration) {
      setInterval(() => {
        if (navigator.onLine) {
          registration.update().catch(() => {
            // Silent — next interval will retry
          });
        }
      }, 60_000);
    }
    console.info('[PWA] Service Worker registered:', swUrl);
  },
  onRegisterError(error) {
    console.error('[PWA] Service Worker registration failed:', error);
  },
});

/** Activates the waiting version and reloads the page into it. */
export function applyAppUpdate(): void {
  void updateSW(true);
}

// Top-level await on purpose: main.tsx imports this module before App, so the router is only created once
// the address is final. Ordinary visits settle in a microtask; a home-screen launch waits for one local
// IndexedDB read, capped at 1.5 s. This module must stay ahead of anything that reads `window.location`
// when the router is created (e.g. a module-level `createBrowserRouter`).
await handleHomeScreenLaunch();
