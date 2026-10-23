import { useEffect } from "react";

/** The slice of the Screen Wake Lock API this hook uses, so a test can stand in for the browser. */
interface WakeLockHandle {
  readonly released: boolean;
  release(): Promise<void>;
}

interface WakeLockNavigator {
  readonly wakeLock?: { request(type: "screen"): Promise<WakeLockHandle> };
}

interface WakeLockDocument {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Holds a screen wake lock between `start` and `stop`. The browser drops the lock whenever the tab is hidden, so
 * it is asked for again when the person comes back. A refusal (battery saver, permissions policy) is not an
 * error: the screen simply may dim. Where the API does not exist nothing happens.
 */
export function createWakeLock(nav: WakeLockNavigator, doc: WakeLockDocument): { start(): void; stop(): void } {
  let running = false;
  let requesting = false;
  let held: WakeLockHandle | null = null;

  const acquire = async () => {
    if (!running || requesting || doc.visibilityState !== "visible" || (held && !held.released)) return;
    requesting = true;
    try {
      const lock = await nav.wakeLock?.request("screen");
      if (!lock) return;
      if (running) held = lock;
      else void lock.release().catch(() => undefined); // closed while the request was pending
    } catch {
      // refused: the next return to the page asks again
    } finally {
      requesting = false;
    }
  };
  const onVisibility = () => void acquire();

  return {
    start() {
      if (running || !nav.wakeLock) return;
      running = true;
      doc.addEventListener("visibilitychange", onVisibility);
      void acquire();
    },
    stop() {
      if (!running) return;
      running = false;
      doc.removeEventListener("visibilitychange", onVisibility);
      const lock = held;
      held = null;
      void lock?.release().catch(() => undefined);
    },
  };
}

/** Keeps the screen awake while `enabled` (the full-screen pass QR, the live scanner, a booth capture sheet). */
export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") return;
    const lock = createWakeLock(navigator, document);
    lock.start();
    return () => lock.stop();
  }, [enabled]);
}
