import { strict as assert } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createReachabilityMonitor,
  HEALTH_URL,
  probeServer,
  type MonitorEnv,
  type ProbeResult,
} from "../src/lib/serverReachability.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status: number) =>
  new Response("<html><body>Sign in to the venue Wi-Fi</body></html>", { status, headers: { "content-type": "text/html" } });

/** What `fetch(..., { redirect: "manual" })` returns when a captive portal answers with a redirect. */
function opaqueRedirect(): Response {
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, "type", { value: "opaqueredirect" });
  return response;
}

const answering = (response: Response): typeof fetch => () => Promise.resolve(response);

describe("probeServer — a real API round trip, not navigator.onLine", () => {
  it("is online only when our health endpoint answers with its own JSON", async () => {
    assert.deepEqual(await probeServer({ fetch: answering(json(200, { status: "ok" })) }), { status: "online", httpStatus: 200 });
  });

  it("asks the health endpoint without cookies, caches or redirects", async () => {
    let seen: { url: string; init: RequestInit | undefined } | null = null;
    const spy: typeof fetch = (input, init) => {
      seen = { url: String(input), init };
      return Promise.resolve(json(200, { status: "ok" }));
    };
    await probeServer({ fetch: spy });
    assert.ok(seen);
    const { url, init } = seen as { url: string; init: RequestInit | undefined };
    assert.equal(url, HEALTH_URL);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
  });

  it("recognises a portal that answers 200 with its own sign-in page", async () => {
    assert.deepEqual(await probeServer({ fetch: answering(html(200)) }), { status: "captive-portal", httpStatus: 200 });
  });

  it("recognises JSON that is not ours (a transparent proxy or portal API)", async () => {
    assert.equal((await probeServer({ fetch: answering(json(200, { login: "required" })) })).status, "captive-portal");
    assert.equal((await probeServer({ fetch: answering(json(200, { status: "unavailable" })) })).status, "captive-portal");
    assert.equal((await probeServer({ fetch: answering(json(200, null)) })).status, "captive-portal");
  });

  it("recognises a portal that redirects the request to its login page", async () => {
    assert.deepEqual(await probeServer({ fetch: answering(opaqueRedirect()) }), { status: "captive-portal", httpStatus: null });
  });

  it("recognises 511 Network Authentication Required", async () => {
    assert.equal((await probeServer({ fetch: answering(html(511)) })).status, "captive-portal");
  });

  it("treats a 4xx from something else on the path as interception, not as our API", async () => {
    assert.equal((await probeServer({ fetch: answering(html(403)) })).status, "captive-portal");
    assert.equal((await probeServer({ fetch: answering(html(404)) })).status, "captive-portal");
  });

  it("separates a reachable edge with an unhealthy or throttled API from a missing network", async () => {
    for (const status of [429, 500, 502, 503, 504]) {
      assert.deepEqual(await probeServer({ fetch: answering(json(status, { detail: "x" })) }), { status: "server-error", httpStatus: status });
    }
  });

  it("is offline when the request cannot be made at all", async () => {
    const failing: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    assert.deepEqual(await probeServer({ fetch: failing }), { status: "offline", httpStatus: null });
  });

  it("is offline when nothing answers within the timeout", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const started = Date.now();
    assert.equal((await probeServer({ fetch: hanging, timeoutMs: 20 })).status, "offline");
    assert.ok(Date.now() - started < 1000);
  });

  it("is offline when the body stalls after the headers arrived", async () => {
    const stalled: typeof fetch = (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    assert.equal((await probeServer({ fetch: stalled, timeoutMs: 20 })).status, "offline");
  });

  it("gives up when the caller aborts", async () => {
    const controller = new AbortController();
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const pending = probeServer({ fetch: hanging, timeoutMs: 5000, signal: controller.signal });
    controller.abort();
    assert.equal((await pending).status, "offline");
  });
});

// ── The monitor: scheduling, single flight, wake-ups ───────────────────────────────────────────────

class FakeEnv {
  now = 1_000;
  online = true;
  visible = true;
  probes: ProbeResult[] = [];
  probeCalls = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private nextId = 1;
  private wakers = new Set<() => void>();
  private release: Array<() => void> = [];

  env: MonitorEnv = {
    probe: () => {
      this.probeCalls += 1;
      const result = this.probes.shift() ?? { status: "online", httpStatus: 200 };
      const { promise, resolve } = Promise.withResolvers<ProbeResult>();
      this.release.push(() => resolve(result));
      return promise;
    },
    now: () => this.now,
    setTimeout: (fn, ms) => {
      const id = this.nextId++;
      this.timers.set(id, { at: this.now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => {
      this.timers.delete(handle);
    },
    isBrowserOnline: () => this.online,
    isVisible: () => this.visible,
    listen: (onWake) => {
      this.wakers.add(onWake);
      return () => {
        this.wakers.delete(onWake);
      };
    },
  };

  /** Let the in-flight probe answer, then let the monitor process the answer. */
  async answer() {
    const next = this.release.shift();
    next?.();
    await flush();
  }
  async advance(ms: number) {
    this.now += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.now) {
        this.timers.delete(id);
        timer.fn();
      }
    }
    await flush();
  }
  wake() {
    for (const waker of [...this.wakers]) waker();
  }
  get pendingTimers() {
    return this.timers.size;
  }
  get listening() {
    return this.wakers.size;
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};
const TIMING = { onlineIntervalMs: 30_000, retryIntervalMs: 8_000 };

describe("createReachabilityMonitor", () => {
  it("starts unknown, and does no work until somebody listens", async () => {
    const fake = new FakeEnv();
    const monitor = createReachabilityMonitor(fake.env, TIMING);
    assert.deepEqual(monitor.getSnapshot(), { status: "unknown", since: null });
    await flush();
    assert.equal(fake.probeCalls, 0);
    assert.equal(fake.listening, 0);
  });

  it("probes on the first subscriber and publishes the verdict", async () => {
    const fake = new FakeEnv();
    const monitor = createReachabilityMonitor(fake.env, TIMING);
    let notified = 0;
    monitor.subscribe(() => {
      notified += 1;
    });
    assert.equal(fake.probeCalls, 1);
    await fake.answer();
    assert.deepEqual(monitor.getSnapshot(), { status: "online", since: 1_000 });
    assert.equal(notified, 1);
  });

  it("keeps the same snapshot object while the verdict does not change", async () => {
    const fake = new FakeEnv();
    const monitor = createReachabilityMonitor(fake.env, TIMING);
    let notified = 0;
    monitor.subscribe(() => {
      notified += 1;
    });
    await fake.answer();
    const first = monitor.getSnapshot();
    await fake.advance(30_000);
    await fake.answer();
    assert.equal(monitor.getSnapshot(), first, "useSyncExternalStore needs a stable snapshot");
    assert.equal(notified, 1);
  });

  it("re-checks on a slow cadence while online and a fast one while not", async () => {
    const fake = new FakeEnv();
    fake.probes = [{ status: "online", httpStatus: 200 }, { status: "captive-portal", httpStatus: 200 }, { status: "online", httpStatus: 200 }];
    const monitor = createReachabilityMonitor(fake.env, TIMING);
    monitor.subscribe(() => {});
    await fake.answer();
    await fake.advance(29_999);
    assert.equal(fake.probeCalls, 1, "not yet");
    await fake.advance(1);
    await fake.answer();
    assert.equal(fake.probeCalls, 2);
    assert.equal(monitor.getSnapshot().status, "captive-portal");
    await fake.advance(8_000);
    await fake.answer();
    assert.equal(fake.probeCalls, 3, "retry interval after a failure");
    assert.equal(monitor.getSnapshot().status, "online");
  });

  it("answers concurrent checks with one request", async () => {
    const fake = new FakeEnv();
    const monitor = createReachabilityMonitor(fake.env, TIMING);
    monitor.subscribe(() => {});
    const a = monitor.check();
    const b = monitor.check();
    assert.equal(fake.probeCalls, 1);
    await fake.answer();
    assert.equal(await a, await b);
  });

  it("probes straight away when the browser reports it is back online (the moment a portal shows up)", async () => {
    const fake = new FakeEnv();
    fake.probes = [{ status: "online", httpStatus: 200 }, { status: "captive-portal", httpStatus: null }];
    const monitor = createReachabilityMonitor(fake.env, TIMING);
    monitor.subscribe(() => {});
    await fake.answer();
    fake.wake();
    await fake.answer();
    assert.equal(fake.probeCalls, 2);
    assert.equal(monitor.getSnapshot().status, "captive-portal");
  });

  it("says offline without a request when the browser itself reports no connection", async () => {
    const fake = new FakeEnv();
    fake.online = false;
    const monitor = createReachabilityMonitor(fake.env, TIMING);
    monitor.subscribe(() => {});
    await flush();
    assert.equal(fake.probeCalls, 0);
    assert.equal(monitor.getSnapshot().status, "offline");
  });

  it("does not poll while the page is hidden and resumes when it is shown again", async () => {
    const fake = new FakeEnv();
    const monitor = createReachabilityMonitor(fake.env, TIMING);
    monitor.subscribe(() => {});
    await fake.answer();
    fake.visible = false;
    await fake.advance(60_000);
    assert.equal(fake.probeCalls, 1, "no background polling");
    fake.visible = true;
    fake.wake();
    await fake.answer();
    assert.equal(fake.probeCalls, 2);
  });

  it("stops completely when the last listener leaves, and ignores an answer that arrives afterwards", async () => {
    const fake = new FakeEnv();
    const monitor = createReachabilityMonitor(fake.env, TIMING);
    const first = monitor.subscribe(() => {});
    const second = monitor.subscribe(() => {});
    assert.equal(fake.probeCalls, 1, "a second listener shares the first one's probe");
    first();
    assert.equal(fake.listening, 1);
    second();
    assert.equal(fake.listening, 0);
    assert.equal(fake.pendingTimers, 0);
    await fake.answer();
    assert.equal(monitor.getSnapshot().status, "unknown", "late answer from a stopped monitor is dropped");
    assert.equal(fake.pendingTimers, 0, "and it does not re-arm the timer");
  });

  it("starts again for a later listener", async () => {
    const fake = new FakeEnv();
    const monitor = createReachabilityMonitor(fake.env, TIMING);
    monitor.subscribe(() => {})();
    await fake.answer();
    monitor.subscribe(() => {});
    assert.equal(fake.probeCalls, 2);
    await fake.answer();
    assert.equal(monitor.getSnapshot().status, "online");
  });

  it("turns an unexpected probe failure into offline instead of an unhandled rejection", async () => {
    const fake = new FakeEnv();
    const failing: MonitorEnv = { ...fake.env, probe: () => Promise.reject(new Error("boom")) };
    const monitor = createReachabilityMonitor(failing, TIMING);
    monitor.subscribe(() => {});
    await flush();
    assert.equal(monitor.getSnapshot().status, "offline");
  });
});
