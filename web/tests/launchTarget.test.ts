import { strict as assert } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOME_SCREEN_START_URL,
  OPERATOR_LAUNCH_KEY,
  chooseLaunchPath,
  handleHomeScreenLaunch,
  homeScreenCleanPath,
  isHomeScreenLaunch,
  isOperatorRoute,
  pickScannerPoint,
  readDeviceLaunchState,
  readOperatorLaunch,
  recordOperatorLaunch,
  scannerLaunchPath,
  type LaunchEnv,
  type LaunchPass,
} from "../src/lib/launchTarget.ts";
import { CACHED_TICKETS_KEY_PREFIX } from "../src/lib/ticketCache.ts";
import { LINK_PASS_KEY_PREFIX } from "../src/lib/linkPass.ts";
import { ATTENDEE_TOKEN_STORAGE } from "../src/api/client.ts";

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
    storage: overrides.storage,
    now: overrides.now,
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

const NOW = Date.parse("2026-10-23T08:00:00.000Z");
const DAY = 86_400_000;
const pass = (slug: string, over: Partial<LaunchPass> = {}): LaunchPass => ({
  slug,
  endsAt: new Date(NOW + 3 * DAY).toISOString(),
  status: "active",
  ...over,
});
const device = (over: Partial<Parameters<typeof chooseLaunchPath>[0]> = {}): Parameters<typeof chooseLaunchPath>[0] => ({
  scannerPointId: null,
  passes: [],
  operator: null,
  hasAttendeeIdentity: false,
  ...over,
});

describe("launchTarget — what the home-screen icon opens", () => {
  it("is the home page when nothing is stored on the device", () => {
    assert.equal(chooseLaunchPath(device(), NOW), null);
  });

  it("opens the pass of the one upcoming or live congress the attendee holds a pass for", () => {
    const state = device({ passes: [pass("alpha")], hasAttendeeIdentity: true });
    assert.equal(chooseLaunchPath(state, NOW), "/c/alpha/my-ticket");
    // Several passes for the same congress are still one congress.
    assert.equal(chooseLaunchPath(device({ passes: [pass("alpha"), pass("alpha")], hasAttendeeIdentity: true }), NOW), "/c/alpha/my-ticket");
  });

  it("opens My Congress when passes belong to several congresses", () => {
    assert.equal(chooseLaunchPath(device({ passes: [pass("alpha"), pass("beta")], hasAttendeeIdentity: true }), NOW), "/me");
  });

  it("does not count cancelled passes or congresses that already ended", () => {
    const cancelled = pass("alpha", { status: "cancelled" });
    const ended = pass("old", { endsAt: new Date(NOW - DAY).toISOString() });
    assert.equal(chooseLaunchPath(device({ passes: [cancelled], hasAttendeeIdentity: true }), NOW), "/me");
    assert.equal(chooseLaunchPath(device({ passes: [ended], hasAttendeeIdentity: true }), NOW), "/me");
    assert.equal(chooseLaunchPath(device({ passes: [cancelled, ended, pass("beta")], hasAttendeeIdentity: true }), NOW), "/c/beta/my-ticket");
  });

  it("counts a congress with an unreadable end date as still ahead, like the pass pages do", () => {
    assert.equal(chooseLaunchPath(device({ passes: [pass("alpha", { endsAt: "garbage" })], hasAttendeeIdentity: true }), NOW), "/c/alpha/my-ticket");
  });

  it("opens My Congress for a signed-in device that holds no usable pass yet", () => {
    assert.equal(chooseLaunchPath(device({ hasAttendeeIdentity: true }), NOW), "/me");
  });

  it("never builds the path from a slug that is not made of slug characters", () => {
    assert.equal(chooseLaunchPath(device({ passes: [pass("../me"), pass("a/b"), pass("")], hasAttendeeIdentity: true }), NOW), "/me");
  });

  it("a paired scanner phone keeps opening its own point, whatever else is stored", () => {
    const state = device({
      scannerPointId: "p1",
      passes: [pass("alpha")],
      hasAttendeeIdentity: true,
      operator: { kind: "booth", path: "/booth/b1", at: NOW },
    });
    assert.equal(chooseLaunchPath(state, NOW), "/scan/p1");
  });

  it("reopens the last booth or desk when there is no pass to show", () => {
    assert.equal(chooseLaunchPath(device({ operator: { kind: "booth", path: "/booth/b1", at: NOW } }), NOW), "/booth/b1");
    assert.equal(chooseLaunchPath(device({ operator: { kind: "desk", path: "/reception/e1", at: NOW } }), NOW), "/reception/e1");
    // Booth staff sign in with an attendee token: it must not turn their icon into My Congress.
    const staff = device({ hasAttendeeIdentity: true, operator: { kind: "booth", path: "/booth/b1", at: NOW } });
    assert.equal(chooseLaunchPath(staff, NOW), "/booth/b1");
  });

  it("an upcoming pass still wins over the last booth or desk", () => {
    const state = device({ passes: [pass("alpha")], hasAttendeeIdentity: true, operator: { kind: "desk", path: "/reception/e1", at: NOW } });
    assert.equal(chooseLaunchPath(state, NOW), "/c/alpha/my-ticket");
  });

  it("leaves scanner records to the scanner credentials", () => {
    assert.equal(chooseLaunchPath(device({ operator: { kind: "scan", path: "/scan/p9", at: NOW } }), NOW), null);
  });
});

function memoryStorage(entries: Record<string, string> = {}): Storage & { reads: number } {
  const map = new Map(Object.entries(entries));
  return {
    reads: 0,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem(key: string) {
      this.reads += 1;
      return map.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  } as unknown as Storage & { reads: number };
}

const jwt = (sub: string) => `e30.${Buffer.from(JSON.stringify({ sub, exp: 4_102_444_800 })).toString("base64url")}.sig`;
const cachedTicket = (slug: string, over: Record<string, unknown> = {}) => ({
  id: `ticket-${slug}`,
  event_slug: slug,
  event_ends_at: new Date(NOW + 3 * DAY).toISOString(),
  status: "active",
  ...over,
});
const cacheEntry = (userId: string, tickets: unknown[], expiresAt = NOW + DAY) => ({
  [`${CACHED_TICKETS_KEY_PREFIX}${userId}`]: JSON.stringify({ userId, cachedAt: NOW - DAY, expiresAt, tickets }),
});
const linkPassEntry = (slug: string, ticketId = "t-link-1") => ({
  [`${LINK_PASS_KEY_PREFIX}${ticketId}`]: JSON.stringify({
    savedAt: NOW,
    pass: {
      ticket_id: ticketId,
      status: "active",
      qr_secret: "qr",
      expires_at: new Date(NOW + 30 * DAY).toISOString(),
      event: { slug, ends_at: new Date(NOW + 3 * DAY).toISOString() },
      attendee: { full_name: "Sara" },
    },
  }),
});

describe("launchTarget — reading what this device holds (localStorage only, so it works offline)", () => {
  it("finds nothing on a device that was never used", () => {
    assert.deepEqual(readDeviceLaunchState(memoryStorage(), NOW), { passes: [], operator: null, hasAttendeeIdentity: false });
    assert.deepEqual(readDeviceLaunchState(null, NOW), { passes: [], operator: null, hasAttendeeIdentity: false });
  });

  it("reads the signed-in attendee's cached passes", () => {
    const storage = memoryStorage({ [ATTENDEE_TOKEN_STORAGE]: jwt("user-1"), ...cacheEntry("user-1", [cachedTicket("alpha")]) });
    const state = readDeviceLaunchState(storage, NOW);
    assert.equal(state.hasAttendeeIdentity, true);
    assert.deepEqual(state.passes, [{ slug: "alpha", endsAt: new Date(NOW + 3 * DAY).toISOString(), status: "active" }]);
  });

  it("still reads the cached passes after the cache's own 7-day clock ran out: the pass page decides what to show", () => {
    const storage = memoryStorage({ [ATTENDEE_TOKEN_STORAGE]: jwt("user-1"), ...cacheEntry("user-1", [cachedTicket("alpha")], NOW - DAY) });
    assert.equal(chooseLaunchPath({ scannerPointId: null, ...readDeviceLaunchState(storage, NOW) }, NOW), "/c/alpha/my-ticket");
  });

  it("never reads another owner's cached passes", () => {
    const storage = memoryStorage({ [ATTENDEE_TOKEN_STORAGE]: jwt("user-2"), ...cacheEntry("user-1", [cachedTicket("alpha")]) });
    const state = readDeviceLaunchState(storage, NOW);
    assert.deepEqual(state.passes, []);
    assert.equal(state.hasAttendeeIdentity, true);
  });

  it("without a token, cached passes do not count (the cache is unreadable without its owner)", () => {
    const state = readDeviceLaunchState(memoryStorage(cacheEntry("user-1", [cachedTicket("alpha")])), NOW);
    assert.deepEqual(state, { passes: [], operator: null, hasAttendeeIdentity: false });
  });

  it("reads link passes, which need no sign-in", () => {
    const state = readDeviceLaunchState(memoryStorage(linkPassEntry("alpha")), NOW);
    assert.equal(state.hasAttendeeIdentity, true);
    assert.deepEqual(state.passes.map((p) => p.slug), ["alpha"]);
  });

  it("combines cached account passes and link passes", () => {
    const storage = memoryStorage({ [ATTENDEE_TOKEN_STORAGE]: jwt("user-1"), ...cacheEntry("user-1", [cachedTicket("alpha")]), ...linkPassEntry("beta") });
    assert.equal(chooseLaunchPath({ scannerPointId: null, ...readDeviceLaunchState(storage, NOW) }, NOW), "/me");
  });

  it("ignores malformed entries and still counts the stored token", () => {
    const storage = memoryStorage({
      [ATTENDEE_TOKEN_STORAGE]: jwt("user-1"),
      [`${CACHED_TICKETS_KEY_PREFIX}user-1`]: "{not json",
      [`${LINK_PASS_KEY_PREFIX}x`]: "42",
    });
    const state = readDeviceLaunchState(storage, NOW);
    assert.deepEqual(state.passes, []);
    assert.equal(state.hasAttendeeIdentity, true);
    const odd = memoryStorage({
      [ATTENDEE_TOKEN_STORAGE]: jwt("user-1"),
      ...cacheEntry("user-1", [null, 7, { event_slug: 5 }, cachedTicket("alpha", { status: 3 }), cachedTicket("beta")]),
    });
    assert.deepEqual(readDeviceLaunchState(odd, NOW).passes.map((p) => p.slug), ["beta"]);
  });

  it("treats a token that is not a JWT as a session with no readable cache", () => {
    const state = readDeviceLaunchState(memoryStorage({ [ATTENDEE_TOKEN_STORAGE]: "opaque" }), NOW);
    assert.deepEqual(state, { passes: [], operator: null, hasAttendeeIdentity: true });
  });

  it("never throws when storage does", () => {
    const hostile = {
      get length(): number {
        throw new Error("denied");
      },
      key: () => {
        throw new Error("denied");
      },
      getItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    assert.deepEqual(readDeviceLaunchState(hostile, NOW), { passes: [], operator: null, hasAttendeeIdentity: false });
  });
});

describe("launchTarget — the last booth or desk used on this device", () => {
  it("round-trips a recorded booth or desk", () => {
    const storage = memoryStorage();
    recordOperatorLaunch("booth", "/booth/b-1", NOW, storage);
    assert.deepEqual(readOperatorLaunch(storage), { kind: "booth", path: "/booth/b-1", at: NOW });
    recordOperatorLaunch("desk", "/reception/3f2a9c10-aaaa", NOW + 1, storage);
    assert.deepEqual(readOperatorLaunch(storage), { kind: "desk", path: "/reception/3f2a9c10-aaaa", at: NOW + 1 });
    recordOperatorLaunch("scan", "/scan/p1", NOW + 2, storage);
    assert.equal(readOperatorLaunch(storage)?.kind, "scan");
    assert.ok(JSON.parse(storage.getItem(OPERATOR_LAUNCH_KEY) ?? "null"));
  });

  it("refuses a path that does not belong to the tool, and never stores it", () => {
    const storage = memoryStorage();
    for (const [kind, path] of [
      ["booth", "/organizer"],
      ["booth", "/booth/../me"],
      ["booth", "https://evil.test/booth/b1"],
      ["booth", "//evil.test"],
      ["desk", "/booth/b1"],
      ["desk", "/reception/a/b"],
      ["scan", "/scan/a b"],
    ] as const) {
      recordOperatorLaunch(kind, path, NOW, storage);
    }
    assert.equal(readOperatorLaunch(storage), null);
    assert.equal(storage.getItem(OPERATOR_LAUNCH_KEY), null);
  });

  it("does not trust what it reads back (the path ends up in the address bar)", () => {
    for (const raw of [
      "{not json",
      "null",
      JSON.stringify({ kind: "desk", path: "//evil.test", at: NOW }),
      JSON.stringify({ kind: "booth", path: "/booth/b1" }),
      JSON.stringify({ kind: "kiosk", path: "/booth/b1", at: NOW }),
      JSON.stringify({ kind: "booth", path: "/reception/e1", at: NOW }),
    ]) {
      assert.equal(readOperatorLaunch(memoryStorage({ [OPERATOR_LAUNCH_KEY]: raw })), null, raw);
    }
  });

  it("never throws when storage does", () => {
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    assert.equal(readOperatorLaunch(hostile), null);
    assert.doesNotThrow(() => recordOperatorLaunch("booth", "/booth/b1", NOW, hostile));
  });
});

describe("launchTarget — operator routes (where the app-update prompt stays out of the way)", () => {
  it("is true for the scanner, booth and desk, with or without a sub-path", () => {
    for (const path of ["/scan", "/scan/p1", "/booth/b1", "/booth/b1/sign-in", "/reception", "/reception/e/alpha", "/reception/e1"]) {
      assert.equal(isOperatorRoute(path), true, path);
    }
  });

  it("is false for everything else, including look-alike prefixes", () => {
    for (const path of ["/", "/me", "/c/alpha/my-ticket", "/t/abc", "/e/alpha", "/organizer", "/platform", "/boothx", "/scanner", "/receptionist"]) {
      assert.equal(isOperatorRoute(path), false, path);
    }
  });
});

describe("launchTarget — handleHomeScreenLaunch picks the device's destination", () => {
  const owner = { [ATTENDEE_TOKEN_STORAGE]: jwt("user-1") };

  it("opens the pass of the one upcoming congress, before the app renders and with no network", async () => {
    const storage = memoryStorage({ ...owner, ...cacheEntry("user-1", [cachedTicket("alpha")]) });
    const { env, calls } = fakeEnv({ storage, now: () => NOW, readScannerCredentials: () => Promise.resolve([]) });
    assert.equal(await handleHomeScreenLaunch(env), "/c/alpha/my-ticket");
    assert.deepEqual(calls.replaced, ["/c/alpha/my-ticket"]);
  });

  it("opens My Congress when the passes belong to several congresses", async () => {
    const storage = memoryStorage({ ...owner, ...cacheEntry("user-1", [cachedTicket("alpha"), cachedTicket("beta")]) });
    const { env, calls } = fakeEnv({ storage, now: () => NOW, readScannerCredentials: () => Promise.resolve([]) });
    assert.equal(await handleHomeScreenLaunch(env), "/me");
    assert.deepEqual(calls.replaced, ["/me"]);
  });

  it("lands on the clean home address when nothing is stored", async () => {
    const { env, calls } = fakeEnv({ storage: memoryStorage(), now: () => NOW, readScannerCredentials: () => Promise.resolve([]) });
    assert.equal(await handleHomeScreenLaunch(env), null);
    assert.deepEqual(calls.replaced, ["/"]);
  });

  it("a paired scanner still opens its own point first", async () => {
    const storage = memoryStorage({ ...owner, ...cacheEntry("user-1", [cachedTicket("alpha")]) });
    const { env, calls } = fakeEnv({ storage, now: () => NOW });
    assert.equal(await handleHomeScreenLaunch(env), "/scan/p1");
    assert.deepEqual(calls.replaced, ["/scan/p1"]);
  });

  it("reopens the last booth when the device holds no pass", async () => {
    const storage = memoryStorage({ ...owner });
    recordOperatorLaunch("booth", "/booth/b-7", NOW, storage);
    const { env, calls } = fakeEnv({ storage, now: () => NOW, readScannerCredentials: () => Promise.resolve([]) });
    assert.equal(await handleHomeScreenLaunch(env), "/booth/b-7");
    assert.deepEqual(calls.replaced, ["/booth/b-7"]);
  });

  it("a storage failure while looking for a scanner does not hide the pass", async () => {
    const storage = memoryStorage({ ...owner, ...cacheEntry("user-1", [cachedTicket("alpha")]) });
    const { env, calls } = fakeEnv({ storage, now: () => NOW, readScannerCredentials: () => Promise.reject(new Error("IndexedDB is not supported.")) });
    assert.equal(await handleHomeScreenLaunch(env), "/c/alpha/my-ticket");
    assert.deepEqual(calls.replaced, ["/c/alpha/my-ticket"]);
  });

  it("an ordinary visit reads no storage at all", async () => {
    const storage = memoryStorage({ ...owner, ...cacheEntry("user-1", [cachedTicket("alpha")]) });
    const { env, calls } = fakeEnv({ search: "", storage, now: () => NOW });
    assert.equal(await handleHomeScreenLaunch(env), null);
    assert.deepEqual(calls, { replaced: [], reads: 0 });
    assert.equal(storage.reads, 0);
  });
});
