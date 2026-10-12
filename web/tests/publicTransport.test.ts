import { strict as assert } from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { it } from "node:test";
import { createApiClient } from "../src/api/client.ts";

it("all public and credential-entry endpoints omit Authorization with every credential stored", async () => {
  const stored = { congress_attendee_token: "fixture-user", congress_organizer_api_key: "fixture-organizer", congress_desk_token_event: "fixture-desk", congress_scanner_tokens: "fixture-scanner" };
  const previous = ["window", "localStorage", "sessionStorage"].map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const requests: Request[] = [];
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { pathname: "/organizer/events/event/desk" } } });
    for (const key of ["localStorage", "sessionStorage"]) Object.defineProperty(globalThis, key, { configurable: true, value: { getItem: (name: keyof typeof stored) => stored[name] } });
    const client = createApiClient({ kind: "anonymous" }, { baseUrl: "http://fixture.test", fetch: async (request) => { requests.push(request); return Response.json({}); } });
    await client.GET("/api/public/events/{slug}", { params: { path: { slug: "fixture" } }, headers: { aUtHoRiZaTiOn: "Bearer conflicting-fixture" } });
    await client.GET("/api/public/events/{slug}/booths/{booth_id}", { params: { path: { slug: "fixture", booth_id: "booth" } } });
    await client.POST("/api/auth/register", { body: { email: "fixture@example.test", password: "fixture-password", full_name: "Fixture User" } });
    await client.POST("/api/auth/login", { body: { email: "fixture@example.test", password: "fixture-password" } });
    await client.POST("/api/events/{event_id}/desk/login", { params: { path: { event_id: "event" } }, body: { email: "fixture@example.test", password: "fixture-password" } });
    assert.equal(requests.length, 5);
    for (const request of requests) assert.equal(request.headers.has("authorization"), false);
  } finally {
    ["window", "localStorage", "sessionStorage"].forEach((key, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

it("bookmark list/create/delete use only selected User and retain exact unauthorized response without retry", async () => {
  const received: { method?: string; authorized: boolean }[] = [];
  const server = createServer((request, response) => {
    received.push({ method: request.method, authorized: request.headers.authorization === "Bearer selected-fixture-user" });
    response.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    response.end(JSON.stringify({ detail: "Invalid authorization token" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const client = createApiClient({ kind: "user", token: "selected-fixture-user" }, { baseUrl: `http://127.0.0.1:${address.port}` });
    const options = { params: { path: { booth_id: "fixture-booth" } } };
    for (const result of [await client.GET("/api/attendees/me/bookmarks/booths"), await client.POST("/api/attendees/me/bookmarks/booths/{booth_id}", options), await client.DELETE("/api/attendees/me/bookmarks/booths/{booth_id}", options)]) {
      assert.equal(result.response.status, 401);
      assert.deepEqual(result.error, { detail: "Invalid authorization token" });
    }
    assert.deepEqual(received, [{ method: "GET", authorized: true }, { method: "POST", authorized: true }, { method: "DELETE", authorized: true }]);
  } finally {
    const closed = once(server, "close");
    server.close();
    await closed;
  }
});
