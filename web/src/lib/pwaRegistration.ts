/**
 * PWA Service Worker registration and update lifecycle.
 *
 * Architecture:
 * - registerType: 'prompt' — the operator explicitly decides when to apply
 *   a new app version, preventing mid-shift code swaps.
 * - The Service Worker precaches the app shell (HTML, JS, CSS, SVG).
 * - Operational data (manifests, scans, conflicts) lives exclusively in IndexedDB
 *   and is NEVER touched by SW cache eviction or updates.
 * - API responses are NEVER cached by the Service Worker.
 * - Bearer tokens remain in sessionStorage/memory, never in Cache Storage.
 */

import { registerSW } from 'virtual:pwa-register';

export interface PWAUpdateState {
  needRefresh: boolean;
  applyUpdate: () => void;
}

let updateCallback: ((state: PWAUpdateState) => void) | null = null;

/**
 * Subscribe to PWA update notifications.
 * Returns an unsubscribe function.
 */
export function onPWAUpdate(cb: (state: PWAUpdateState) => void): () => void {
  updateCallback = cb;
  return () => {
    if (updateCallback === cb) updateCallback = null;
  };
}

// Register the SW once on module load.
// `registerSW` from vite-plugin-pwa returns a function to trigger the update.
const updateSW = registerSW({
  onNeedRefresh() {
    updateCallback?.({
      needRefresh: true,
      applyUpdate: () => {
        // Tell the waiting SW to activate
        updateSW(true);
      },
    });
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
