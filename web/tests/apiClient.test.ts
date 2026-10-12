import { strict as assert } from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { describe, it } from "node:test";
import {
  ApiContextError,
  ApiResponseError,
  createApiClient,
  createDeskApiClient,
  createScannerApiClient,
  unwrapApiResponse,
  type ApiAuthority,
} from "../src/api/client.ts";

const desk: ApiAuthority = { kind: "desk", token: "explicit-desk", eventId: "event-a" };
const scanner: ApiAuthority = {
  kind: "scanner", token: "explicit-scanner", eventId: "event-a", pointId: "point-a",
};

function captureTransport() {
  const requests: Request[] = [];
  return {
    requests,
    options: {
      baseUrl: "http://fixture.test",
      fetch: async (request: Request) => {
        requests.push(request);
        return Response.json({ fixture: "received" });
      },
    },
  };
}

// Stored alternatives are deliberately different from the supplied authorities.
function installBrowserFixture() {
  const stored = {
    congress_organizer_api_key: "stored-organizer",
    congress_attendee_token: "stored-user",
    "congress_desk_token_event-a": "stored-desk-a",
    "congress_desk_token_event-b": "stored-desk-b",
    congress_scanner_tokens: "stored-scanner",
  };
  const location = { pathname: "/organizer/events/event-b/desk" };
  const names = ["window", "localStorage", "sessionStorage", "indexedDB"];
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const forbidden = () => { throw new Error("The explicit client must not access browser credentials"); };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
  for (const name of names.slice(1)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: { stored, getItem: forbidden, setItem: forbidden, removeItem: forbidden, open: forbidden },
    });
  }
  return {
    location,
    stored,
    restore() {
      names.forEach((name, index) => {
        const descriptor = previous[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    },
  };
}

describe("explicit-authority API transport", () => {
  for (const authority of [
    { kind: "anonymous" },
    { kind: "user", token: "explicit-user" },
    { kind: "organizer", token: "explicit-organizer" },
    desk,
    scanner,
  ] satisfies ApiAuthority[]) {
    it(`${authority.kind} sends only its supplied authority despite stored alternatives and pathname changes`, async () => {
      const fixture = installBrowserFixture();
      const before = { ...fixture.stored };
      const transport = captureTransport();
      try {
        const client = createApiClient(authority, transport.options);
        for (const pathname of ["/organizer/events/event-b", "/e/public", "/scan/point-b"]) {
          fixture.location.pathname = pathname;
          if (authority.kind === "desk") {
            await client.GET("/api/events/{event_id}/desk/me", { params: { path: { event_id: "event-a" } } });
          } else if (authority.kind === "scanner") {
            await client.GET("/api/checkin-points/{point_id}/manifest", { params: { path: { point_id: "point-a" } } });
          } else {
            await client.GET("/api/public/events/{slug}", {
              params: { path: { slug: "public" } },
              headers: { Authorization: "Bearer unwanted-override" },
            });
          }
        }
        assert.equal(transport.requests.length, 3);
        const expected = authority.kind === "anonymous" ? null : `Bearer ${authority.token}`;
        for (const request of transport.requests) assert.equal(request.headers.get("authorization"), expected);
        assert.deepEqual(fixture.stored, before);
      } finally {
        fixture.restore();
      }
    });
  }

  it("explicit null is anonymous; undefined and incomplete protected contexts refuse transport", async () => {
    const fixture = installBrowserFixture();
    const transport = captureTransport();
    try {
      await createApiClient(null, transport.options).POST("/api/auth/login", {
        body: { email: "fixture@example.test", password: "fixture-password" },
      });
      assert.equal(transport.requests[0].headers.has("authorization"), false);
      const incomplete = [
        undefined,
        { kind: "user", token: "" },
        { kind: "organizer", token: "  " },
        { kind: "desk", token: "desk", eventId: "" },
        { kind: "scanner", token: "scanner", eventId: "", pointId: "point-a" },
        { kind: "scanner", token: "scanner", eventId: "event-a", pointId: "" },
      ];
      for (const authority of incomplete) {
        // Exercise untyped runtime callers, without manufacturing a valid typed context.
        assert.throws(() => Reflect.apply(createApiClient, undefined, [authority, transport.options]), ApiContextError);
      }
      assert.equal(transport.requests.length, 1);
    } finally {
      fixture.restore();
    }
  });

  it("desk event A cannot acquire an event B adapter or dispatch an event B request", async () => {
    const transport = captureTransport();
    assert.throws(() => createDeskApiClient(desk, "event-b", transport.options), ApiContextError);
    assert.throws(() => createDeskApiClient(desk, "", transport.options), ApiContextError);
    const client = createDeskApiClient(desk, "event-a", transport.options);
    await assert.rejects(client.GET("/api/events/{event_id}/desk/me", {
      params: { path: { event_id: "event-b" } },
    }), ApiContextError);
    await assert.rejects(client.GET("/api/auth/me"), ApiContextError);
    assert.equal(transport.requests.length, 0);
    await client.GET("/api/events/{event_id}/desk/me", { params: { path: { event_id: "event-a" } } });
    assert.equal(transport.requests[0].headers.get("authorization"), "Bearer explicit-desk");
  });

  it("scanner rejects either mismatched scope and refuses a different or absent request point", async () => {
    const transport = captureTransport();
    assert.throws(() => createScannerApiClient(scanner, { eventId: "event-b", pointId: "point-a" }, transport.options), ApiContextError);
    assert.throws(() => createScannerApiClient(scanner, { eventId: "event-a", pointId: "point-b" }, transport.options), ApiContextError);
    const client = createScannerApiClient(scanner, { eventId: "event-a", pointId: "point-a" }, transport.options);
    await assert.rejects(client.GET("/api/checkin-points/{point_id}/manifest", {
      params: { path: { point_id: "point-b" } },
    }), ApiContextError);
    await assert.rejects(client.GET("/api/auth/me"), ApiContextError);
    assert.equal(transport.requests.length, 0);
    await client.GET("/api/checkin-points/{point_id}/manifest", { params: { path: { point_id: "point-a" } } });
    assert.equal(transport.requests[0].headers.get("authorization"), "Bearer explicit-scanner");
  });

  it("organizer operational mode is explicitly selected and remains resource-bound", async () => {
    const transport = captureTransport();
    const authority: ApiAuthority = { kind: "organizer", token: "deliberate-organizer" };
    const deskClient = createDeskApiClient(authority, "event-a", transport.options);
    await deskClient.GET("/api/events/{event_id}/desk/me", { params: { path: { event_id: "event-a" } } });
    await assert.rejects(deskClient.GET("/api/events/{event_id}/desk/me", { params: { path: { event_id: "event-b" } } }), ApiContextError);
    const scannerClient = createScannerApiClient(authority, { eventId: "event-a", pointId: "point-a" }, transport.options);
    await scannerClient.GET("/api/checkin-points/{point_id}/manifest", { params: { path: { point_id: "point-a" } } });
    assert.equal(transport.requests.length, 2);
    for (const request of transport.requests) assert.equal(request.headers.get("authorization"), "Bearer deliberate-organizer");
  });

  for (const status of [401, 403, 404]) {
    it(`consumer observes HTTP ${status} across a real HTTP transport without fallback, retry or storage mutation`, async () => {
      const fixture = installBrowserFixture();
      const before = { ...fixture.stored };
      const received: (string | undefined)[] = [];
      const server = createServer((request, response) => {
        received.push(request.headers.authorization);
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: `Fixture HTTP ${status}` }));
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const client = createDeskApiClient(desk, "event-a", { baseUrl: `http://127.0.0.1:${address.port}` });
        const result = await client.GET("/api/events/{event_id}/desk/me", { params: { path: { event_id: "event-a" } } });
        assert.equal(result.response.status, status);
        assert.throws(() => unwrapApiResponse(result), (error: unknown) => {
          assert.ok(error instanceof ApiResponseError);
          assert.equal(error.status, status);
          assert.equal(error.message, `Fixture HTTP ${status}`);
          assert.deepEqual(error.body, { detail: `Fixture HTTP ${status}` });
          return true;
        });
        assert.deepEqual(received, ["Bearer explicit-desk"]);
        assert.deepEqual(fixture.stored, before);
      } finally {
        server.close();
        await once(server, "close");
        fixture.restore();
      }
    });
  }

  it("successful consumer data and network failures propagate without synthetic status or retry", async () => {
    const transport = captureTransport();
    const result = await createApiClient({ kind: "user", token: "explicit-user" }, transport.options).GET("/api/auth/me");
    assert.deepEqual(unwrapApiResponse(result), { fixture: "received" });
    const offline = new TypeError("fixture offline");
    let attempts = 0;
    const client = createApiClient({ kind: "user", token: "explicit-user" }, {
      baseUrl: "http://fixture.test",
      fetch: async () => { attempts += 1; throw offline; },
    });
    await assert.rejects(client.GET("/api/auth/me"), (error: unknown) => error === offline);
    assert.equal(attempts, 1);
  });
});

describe("scanner authority without an event context (opaque device token)", () => {
  it("stays bound to its point, sends exactly its token and still rejects a blank event", async () => {
    const transport = captureTransport();
    const client = createScannerApiClient({ kind: "scanner", token: "opaque-device", pointId: "point-a" }, { pointId: "point-a" }, transport.options);
    await client.GET("/api/checkin-points/{point_id}/manifest", { params: { path: { point_id: "point-a" } } });
    await assert.rejects(client.GET("/api/checkin-points/{point_id}/manifest", { params: { path: { point_id: "point-b" } } }), ApiContextError);
    assert.equal(transport.requests.length, 1);
    assert.equal(transport.requests[0].headers.get("authorization"), "Bearer opaque-device");
    assert.throws(() => createScannerApiClient({ kind: "scanner", token: "opaque-device", pointId: "point-a", eventId: "  " }, { pointId: "point-a" }, transport.options), ApiContextError);
  });
});

describe("legacy credential heuristic removal", () => {
  it("the API module exposes no helper that guesses a credential from storage or pathname", async () => {
    const clientModule = await import("../src/api/client.ts");
    assert.equal("getApiClient" in clientModule, false);
    assert.equal(typeof clientModule.createApiClient, "function");
    // An omitted authority is rejected instead of being resolved from stored credentials.
    assert.throws(() => Reflect.apply(clientModule.createApiClient, undefined, [undefined]), ApiContextError);
  });
});
