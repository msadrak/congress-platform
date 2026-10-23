import { strict as assert } from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  NETWORK_FAILURE_CODE,
  createApiClient,
  isNetworkFailure,
  localizedApiError,
  registerUnauthorizedHandler,
} from "../src/api/client.ts";
import { networkErrorMessage } from "../src/lib/errorMessages.ts";

const offline = {
  baseUrl: "http://fixture.test",
  fetch: async (): Promise<Response> => {
    throw new TypeError("Failed to fetch");
  },
};
const answering = (status: number) => ({
  baseUrl: "http://fixture.test",
  fetch: async () => Response.json({ detail: "x" }, { status }),
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
function record(kind: "organizer" | "user"): string[] {
  const heard: string[] = [];
  cleanups.push(registerUnauthorizedHandler(kind, (token) => heard.push(token)));
  return heard;
}

describe("401 middleware", () => {
  it("hands the exact token that was sent to the handler registered for its kind", async () => {
    const organizer = record("organizer");
    const user = record("user");
    await createApiClient({ kind: "organizer", token: "key-1" }, answering(401)).GET("/api/events");
    assert.deepEqual(organizer, ["key-1"]);
    assert.deepEqual(user, []);
  });

  it("ignores other statuses and anonymous requests", async () => {
    const organizer = record("organizer");
    await createApiClient({ kind: "organizer", token: "key-1" }, answering(403)).GET("/api/events");
    await createApiClient({ kind: "organizer", token: "key-1" }, answering(200)).GET("/api/events");
    await createApiClient({ kind: "anonymous" }, answering(401)).GET("/api/events");
    assert.deepEqual(organizer, []);
  });

  it("an explicit onUnauthorized replaces the registered handler; null silences it", async () => {
    const organizer = record("organizer");
    const own: string[] = [];
    await createApiClient({ kind: "organizer", token: "key-1" }, { ...answering(401), onUnauthorized: (t) => own.push(t) }).GET("/api/events");
    await createApiClient({ kind: "organizer", token: "key-2" }, { ...answering(401), onUnauthorized: null }).GET("/api/events");
    assert.deepEqual(own, ["key-1"]);
    assert.deepEqual(organizer, []);
  });

  it("looks the handler up when the response arrives, and unregistering only removes its own", async () => {
    const client = createApiClient({ kind: "organizer", token: "key-1" }, answering(401));
    const first = record("organizer");
    const heard: string[] = [];
    const unregisterSecond = registerUnauthorizedHandler("organizer", (t) => heard.push(t));
    cleanups.push(unregisterSecond);
    await client.GET("/api/events");
    assert.deepEqual(first, []);
    assert.deepEqual(heard, ["key-1"]);
  });
});

describe("network failures", () => {
  it("throw by default", async () => {
    await assert.rejects(createApiClient({ kind: "organizer", token: "key-1" }, offline).GET("/api/events"), TypeError);
  });

  it('"result" resolves to a recognisable 503 that no handler hears and that reads as the network message', async () => {
    const organizer = record("organizer");
    const { data, error, response } = await createApiClient(
      { kind: "organizer", token: "key-1" },
      { ...offline, networkErrors: "result" },
    ).GET("/api/events");
    assert.equal(data, undefined);
    assert.equal(response.status, 503);
    assert.equal(isNetworkFailure(response), true);
    assert.equal((error as { code?: string }).code, NETWORK_FAILURE_CODE);
    assert.equal(localizedApiError(error, "fa"), networkErrorMessage.fa);
    assert.equal(localizedApiError(error, "en"), networkErrorMessage.en);
    assert.deepEqual(organizer, []);
  });

  it("a real 503 from the server is not a network failure", async () => {
    const { response } = await createApiClient({ kind: "organizer", token: "key-1" }, { ...answering(503), networkErrors: "result" }).GET("/api/events");
    assert.equal(isNetworkFailure(response), false);
  });

  it("an aborted request stays an abort", async () => {
    const aborting = {
      baseUrl: "http://fixture.test",
      networkErrors: "result" as const,
      fetch: async (): Promise<Response> => {
        throw new DOMException("aborted", "AbortError");
      },
    };
    await assert.rejects(createApiClient({ kind: "organizer", token: "key-1" }, aborting).GET("/api/events"), { name: "AbortError" });
  });
});
