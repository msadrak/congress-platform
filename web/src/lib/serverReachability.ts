/**
 * Is the server really reachable? `navigator.onLine` only says the device has a network interface: on venue
 * Wi-Fi behind a captive portal, or with the edge up and the API down, it stays true while every request
 * fails or comes back as somebody else's HTML. Reachable means a real round trip to our own API.
 *
 * - `probeServer()` asks `/api/health` once and classifies the answer.
 * - `serverReachability` (a monitor) probes while somebody listens — on a slow cadence while online, a fast
 *   one while not, immediately when the browser reports a connectivity change or the page is shown again —
 *   and publishes the verdict for `useSyncExternalStore`.
 * - `hooks/useServerReachability.ts` is the React binding.
 *
 * Adopting it in the scanner (`GateScanner.tsx`, owned by workstream C1): keep `noteServerContact` as the
 * fast path (every real request is better evidence than a probe) and use the monitor for the idle case
 * and for the reason shown to the operator — `captive-portal` means "sign in to the venue Wi-Fi",
 * `server-error` means the network is fine and the platform is not, `offline` means no connection.
 *
 * No React, no storage, no globals at import time: the module loads in plain Node for its tests.
 */

export type ProbeStatus = "online" | "offline" | "captive-portal" | "server-error";
export type ReachabilityStatus = "unknown" | ProbeStatus;

export interface ProbeResult {
  status: ProbeStatus;
  /** The HTTP status when an answer arrived, null when there was none or it was a redirect. */
  httpStatus: number | null;
}

/** Cheap and public: the process is up and answering through the edge; it touches nothing else. */
export const HEALTH_URL = "/api/health";
export const PROBE_TIMEOUT_MS = 6_000;

export interface ProbeOptions {
  fetch?: typeof fetch;
  url?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** One round trip to the health endpoint. Never rejects. */
export async function probeServer(options: ProbeOptions = {}): Promise<ProbeResult> {
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const controller = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), options.timeoutMs ?? PROBE_TIMEOUT_MS);
  const abortWithCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortWithCaller, { once: true });
  try {
    const response = await doFetch(options.url ?? HEALTH_URL, {
      cache: "no-store",
      // A portal that redirects to its login page must show up as a redirect, not be followed to a 200.
      redirect: "manual",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    // Awaited here so a body that stalls after the headers is cut off by the same timeout.
    return await classify(response);
  } catch {
    return { status: "offline", httpStatus: null };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortWithCaller);
  }
}

async function classify(response: Response): Promise<ProbeResult> {
  if (response.type === "opaqueredirect") return { status: "captive-portal", httpStatus: null };
  const httpStatus = response.status;
  if (httpStatus === 511) return { status: "captive-portal", httpStatus };
  // The edge answered but the API is down or throttling: the network is fine, the platform is not.
  if (httpStatus === 429 || httpStatus >= 500) return { status: "server-error", httpStatus };
  // Nothing of ours answers /api/health with a 4xx or a redirect: something on the path does.
  if (!response.ok) return { status: "captive-portal", httpStatus };
  const text = await response.text();
  return { status: isHealthBody(text) ? "online" : "captive-portal", httpStatus };
}

/** Our own answer, not a sign-in page or another service's JSON that happens to be a 200. */
function isHealthBody(text: string): boolean {
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && "status" in body && body.status === "ok";
  } catch {
    return false;
  }
}

// ── Monitor ────────────────────────────────────────────────────────────────────────────────────────

/** `since` is when the status last changed, so the snapshot stays the same object between equal probes. */
export interface ReachabilitySnapshot {
  readonly status: ReachabilityStatus;
  readonly since: number | null;
}

export interface MonitorEnv {
  probe(): Promise<ProbeResult>;
  now(): number;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  /** `navigator.onLine`: false is trusted (no interface, nothing to ask), true proves nothing. */
  isBrowserOnline(): boolean;
  isVisible(): boolean;
  /** Calls back when connectivity may have changed or the page came back; returns the remover. */
  listen(onWake: () => void): () => void;
}

export interface MonitorTiming {
  onlineIntervalMs: number;
  retryIntervalMs: number;
}

export const DEFAULT_MONITOR_TIMING: MonitorTiming = { onlineIntervalMs: 30_000, retryIntervalMs: 8_000 };

export interface ReachabilityMonitor {
  getSnapshot(): ReachabilitySnapshot;
  /** The first listener starts probing, the last one to leave stops everything. */
  subscribe(listener: () => void): () => void;
  /** Probe now (one request however many callers ask at once) and resolve to the new snapshot. */
  check(): Promise<ReachabilitySnapshot>;
}

export function createReachabilityMonitor(
  env?: MonitorEnv,
  timing: MonitorTiming = DEFAULT_MONITOR_TIMING
): ReachabilityMonitor {
  let resolvedEnv: MonitorEnv | null = env ?? null;
  const getEnv = () => (resolvedEnv ??= browserMonitorEnv());

  let snapshot: ReachabilitySnapshot = { status: "unknown", since: null };
  const listeners = new Set<() => void>();
  let running = false;
  /** Bumped on stop: an answer to a probe from an earlier run is dropped. */
  let generation = 0;
  let inFlight: Promise<ReachabilitySnapshot> | null = null;
  let timer: number | null = null;
  let stopListening: (() => void) | null = null;

  function publish(status: ProbeStatus) {
    if (snapshot.status === status) return;
    snapshot = { status, since: getEnv().now() };
    for (const listener of [...listeners]) listener();
  }

  function clearTimer() {
    if (timer === null) return;
    getEnv().clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    const current = getEnv();
    if (!running || !current.isVisible()) return;
    const wait = snapshot.status === "online" ? timing.onlineIntervalMs : timing.retryIntervalMs;
    timer = current.setTimeout(() => {
      timer = null;
      // Hidden pages do not poll; becoming visible wakes the monitor again.
      if (getEnv().isVisible()) void check();
    }, wait);
  }

  function check(): Promise<ReachabilitySnapshot> {
    if (inFlight) return inFlight;
    const current = getEnv();
    const run = generation;
    if (!current.isBrowserOnline()) {
      publish("offline");
      schedule();
      return Promise.resolve(snapshot);
    }
    const attempt: Promise<ReachabilitySnapshot> = (async () => {
      let result: ProbeResult;
      try {
        result = await current.probe();
      } catch {
        result = { status: "offline", httpStatus: null };
      }
      if (run === generation) {
        publish(result.status);
        schedule();
      }
      return snapshot;
    })().finally(() => {
      if (inFlight === attempt) inFlight = null;
    });
    inFlight = attempt;
    return attempt;
  }

  function wake() {
    if (!running) return;
    clearTimer();
    if (getEnv().isVisible()) void check();
  }

  function start() {
    running = true;
    stopListening = getEnv().listen(wake);
    void check();
  }

  function stop() {
    running = false;
    generation += 1;
    inFlight = null;
    clearTimer();
    stopListening?.();
    stopListening = null;
  }

  return {
    getSnapshot: () => snapshot,
    check,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        if (listeners.delete(listener) && listeners.size === 0) stop();
      };
    },
  };
}

function browserMonitorEnv(): MonitorEnv {
  return {
    probe: () => probeServer(),
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle),
    isBrowserOnline: () => navigator.onLine !== false,
    isVisible: () => document.visibilityState !== "hidden",
    listen: (onWake) => {
      const onVisibility = () => {
        if (document.visibilityState === "visible") onWake();
      };
      window.addEventListener("online", onWake);
      window.addEventListener("offline", onWake);
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        window.removeEventListener("online", onWake);
        window.removeEventListener("offline", onWake);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    },
  };
}

/** The app-wide monitor. Nothing runs until a component (or the scanner) subscribes. */
export const serverReachability: ReachabilityMonitor = createReachabilityMonitor();
