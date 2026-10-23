import { strict as assert } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOME_SCREEN_START_URL,
  handleHomeScreenLaunch,
  homeScreenCleanPath,
  isHomeScreenLaunch,
  pickScannerPoint,
  scannerLaunchPath,
  type LaunchEnv,
} from "../src/lib/launchTarget.ts";

describe("launchTarget — recognising a home-screen launch", () => {
  it("the manifest start URL is itself recognised as a launch", () => {
    const url = new URL(HOME_SCREEN_START_URL, "https://example.test");
    assert.equal(isHomeScreenLaunch({ pathname: url.pathname, search: url.search }), true);
  });

  it("needs the marker on the root path; ordinary visits are left alone", () => {
    assert.equal(isHomeScreenLaunch({ pathname: "/", search: "" }), false);
    assert.equal(isHomeScreenLaunch({ pathname: "/", search: "?source=other" }), false);
    assert.equal(isHomeScreenLaunch({ pathname: "/", search: "?x=1&source=pwa" }), true);
    // An in-app link or a shared URL that merely carries the marker deeper in the app is not a launch.
    assert.equal(isHomeScreenLaunch({ pathname: "/scan/p1", search: "?source=pwa" }), false);
    assert.equal(isHomeScreenLaunch({ pathname: "/me", search: "?source=pwa" }), false);
  });

  it("drops only the marker when cleaning the address, keeping other parameters and the hash", () => {
    assert.equal(homeScreenCleanPath({ pathname: "/", search: "?source=pwa", hash: "" }), "/");
    assert.equal(homeScreenCleanPath({ pathname: "/", search: "?x=1&source=pwa", hash: "#top" }), "/?x=1#top");
  });
});

describe("launchTarget — choosing the scanner point to reopen", () => {
  it("is null when the device was never paired as a scanner", () => {
    assert.equal(pickScannerPoint([]), null);
  });

  it("returns the only paired point", () => {
    assert.equal(pickScannerPoint([{ pointId: "p1", stored_at: "2026-10-01T10:00:00.000Z" }]), "p1");
  });

  it("prefers the most recently paired point", () => {
    assert.equal(
      pickScannerPoint([
        { pointId: "old", stored_at: "2026-10-01T10:00:00.000Z" },
        { pointId: "new", stored_at: "2026-10-05T10:00:00.000Z" },
        { pointId: "mid", stored_at: "2026-10-03T10:00:00.000Z" },
      ]),
      "new"
    );
  });

  it("still reopens a point whose pairing time is unreadable, but ranks it last", () => {
    assert.equal(pickScannerPoint([{ pointId: "only", stored_at: "garbage" }]), "only");
    assert.equal(
      pickScannerPoint([
        { pointId: "undated" },
        { pointId: "dated", stored_at: "2026-10-01T10:00:00.000Z" },
      ]),
      "dated"
    );
  });

  it("ignores entries that are not usable point ids (the path is built from this value)", () => {
    assert.equal(pickScannerPoint([null, 42, "x", {}, { pointId: 7 }, { pointId: "" }]), null);
    assert.equal(pickScannerPoint([{ pointId: "../me" }, { pointId: "a/b" }, { pointId: "a b" }, { pointId: "a?b" }]), null);
    assert.equal(pickScannerPoint([{ pointId: "x".repeat(65) }]), null);
    assert.equal(pickScannerPoint([{ pointId: "../me" }, { pointId: "p-1_a" }]), "p-1_a");
  });

  it("builds the scanner path from the id", () => {
    assert.equal(scannerLaunchPath("3f2a9c10-aaaa"), "/scan/3f2a9c10-aaaa");
  });
});

function fakeEnv(overrides: Partial<LaunchEnv> & { search?: string; pathname?: string } = {}) {
  const calls: { replaced: string[]; reads: number } = { replaced: [], reads: 0 };
  const env: LaunchEnv = {
    location: { pathname: overrides.pathname ?? "/", search: overrides.search ?? "?source=pwa", hash: "" },
    replaceUrl: (path) => {
      calls.replaced.push(path);
    },
    readScannerCredentials:
      overrides.readScannerCredentials ??
      (() => {
        calls.reads += 1;
        return Promise.resolve([{ pointId: "p1", stored_at: "2026-10-05T10:00:00.000Z" }]);
      }),
    timeoutMs: overrides.timeoutMs ?? 500,
  };
  return { env, calls };
}

describe("launchTarget — handleHomeScreenLaunch", () => {
  it("does nothing, and reads no storage, for an ordinary visit", async () => {
    const { env, calls } = fakeEnv({ search: "" });
    assert.equal(await handleHomeScreenLaunch(env), null);
    assert.deepEqual(calls, { replaced: [], reads: 0 });
  });

  it("does nothing off the root path even with the marker", async () => {
    const { env, calls } = fakeEnv({ pathname: "/scan/other" });
    assert.equal(await handleHomeScreenLaunch(env), null);
    assert.deepEqual(calls, { replaced: [], reads: 0 });
  });

  it("moves a paired scanner phone to its point before the app renders", async () => {
    const { env, calls } = fakeEnv();
    assert.equal(await handleHomeScreenLaunch(env), "/scan/p1");
    assert.deepEqual(calls.replaced, ["/scan/p1"]);
  });

  it("lands an unpaired device on the clean home address", async () => {
    const { env, calls } = fakeEnv({ readScannerCredentials: () => Promise.resolve([]) });
    assert.equal(await handleHomeScreenLaunch(env), null);
    assert.deepEqual(calls.replaced, ["/"]);
  });

  it("never blocks start-up on a storage error", async () => {
    const { env, calls } = fakeEnv({ readScannerCredentials: () => Promise.reject(new Error("IndexedDB is not supported.")) });
    assert.equal(await handleHomeScreenLaunch(env), null);
    assert.deepEqual(calls.replaced, ["/"]);
  });

  it("never blocks start-up on storage that does not answer", async () => {
    const { env, calls } = fakeEnv({ readScannerCredentials: () => new Promise(() => {}), timeoutMs: 20 });
    const started = Date.now();
    assert.equal(await handleHomeScreenLaunch(env), null);
    assert.ok(Date.now() - started < 1000, "gave up after the timeout");
    assert.deepEqual(calls.replaced, ["/"]);
  });
});
