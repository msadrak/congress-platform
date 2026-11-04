import { strict as assert } from "node:assert/strict";
import { describe, it } from "node:test";
import { createWakeLock } from "../src/hooks/useWakeLock.ts";

interface FakeSentinel {
  released: boolean;
  release(): Promise<void>;
}

function fakeEnvironment(options: { visible?: boolean; supported?: boolean; refuse?: boolean } = {}) {
  const sentinels: FakeSentinel[] = [];
  const listeners = new Set<() => void>();
  const pending: Array<() => void> = [];
  let hold = false;
  const doc = {
    visibilityState: options.visible === false ? "hidden" : "visible",
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener);
    },
  };
  const calls = { requests: 0, types: [] as string[] };
  const nav =
    options.supported === false
      ? ({} as Record<string, never>)
      : {
          wakeLock: {
            request(type: string): Promise<FakeSentinel> {
              calls.requests += 1;
              calls.types.push(type);
              if (options.refuse) return Promise.reject(new DOMException("battery saver", "NotAllowedError"));
              const sentinel: FakeSentinel = {
                released: false,
                release() {
                  sentinel.released = true;
                  return Promise.resolve();
                },
              };
              sentinels.push(sentinel);
              if (hold) return new Promise<FakeSentinel>((resolve) => pending.push(() => resolve(sentinel)));
              return Promise.resolve(sentinel);
            },
          },
        };
  return {
    doc,
    nav,
    calls,
    sentinels,
    listenerCount: () => listeners.size,
    /** The tab was hidden (the browser released the lock) or shown again. */
    setVisibility(state: "visible" | "hidden") {
      doc.visibilityState = state;
      if (state === "hidden") for (const sentinel of sentinels) sentinel.released = true;
      for (const listener of [...listeners]) listener();
    },
    holdNextRequest() {
      hold = true;
    },
    settle() {
      hold = false;
      for (const resolve of pending.splice(0)) resolve();
    },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("wake lock — keeping the screen on while a QR or a scan screen is up", () => {
  it("asks for a screen wake lock when started on a visible page", async () => {
    const env = fakeEnvironment();
    const lock = createWakeLock(env.nav, env.doc);
    lock.start();
    await flush();
    assert.deepEqual(env.calls.types, ["screen"]);
  });

  it("does nothing where the API does not exist", async () => {
    const env = fakeEnvironment({ supported: false });
    const lock = createWakeLock(env.nav, env.doc);
    lock.start();
    await flush();
    assert.equal(env.calls.requests, 0);
    assert.equal(env.listenerCount(), 0);
    assert.doesNotThrow(() => lock.stop());
  });

  it("waits while the page is hidden and asks once it is visible", async () => {
    const env = fakeEnvironment({ visible: false });
    const lock = createWakeLock(env.nav, env.doc);
    lock.start();
    await flush();
    assert.equal(env.calls.requests, 0);
    env.setVisibility("visible");
    await flush();
    assert.equal(env.calls.requests, 1);
  });

  it("takes the lock again when the person comes back (the browser drops it when the tab is hidden)", async () => {
    const env = fakeEnvironment();
    const lock = createWakeLock(env.nav, env.doc);
    lock.start();
    await flush();
    env.setVisibility("hidden");
    await flush();
    assert.equal(env.calls.requests, 1);
    env.setVisibility("visible");
    await flush();
    assert.equal(env.calls.requests, 2);
  });

  it("does not ask again while the lock it holds is still live", async () => {
    const env = fakeEnvironment();
    const lock = createWakeLock(env.nav, env.doc);
    lock.start();
    await flush();
    env.setVisibility("visible");
    await flush();
    assert.equal(env.calls.requests, 1);
  });

  it("starting twice registers one listener and one request", async () => {
    const env = fakeEnvironment();
    const lock = createWakeLock(env.nav, env.doc);
    lock.start();
    lock.start();
    await flush();
    assert.equal(env.listenerCount(), 1);
    assert.equal(env.calls.requests, 1);
  });

  it("stop releases the lock and stops listening", async () => {
    const env = fakeEnvironment();
    const lock = createWakeLock(env.nav, env.doc);
    lock.start();
    await flush();
    lock.stop();
    await flush();
    assert.equal(env.sentinels[0].released, true);
    assert.equal(env.listenerCount(), 0);
    env.setVisibility("visible");
    await flush();
    assert.equal(env.calls.requests, 1);
  });

  it("releases a lock that was granted after stop (the screen closed while the request was pending)", async () => {
    const env = fakeEnvironment();
    env.holdNextRequest();
    const lock = createWakeLock(env.nav, env.doc);
    lock.start();
    await flush();
    lock.stop();
    env.settle();
    await flush();
    assert.equal(env.sentinels[0].released, true);
  });

  it("carries on when the browser refuses (battery saver, permissions policy) and tries again on return", async () => {
    const env = fakeEnvironment({ refuse: true });
    const lock = createWakeLock(env.nav, env.doc);
    assert.doesNotThrow(() => lock.start());
    await flush();
    env.setVisibility("visible");
    await flush();
    assert.equal(env.calls.requests, 2);
  });

  it("can be started again after a stop", async () => {
    const env = fakeEnvironment();
    const lock = createWakeLock(env.nav, env.doc);
    lock.start();
    await flush();
    lock.stop();
    await flush();
    lock.start();
    await flush();
    assert.equal(env.calls.requests, 2);
    assert.equal(env.sentinels[1].released, false);
  });
});
