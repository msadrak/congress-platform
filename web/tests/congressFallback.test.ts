import test from "node:test";
import assert from "node:assert/strict";
import { congressFallbackPath } from "../src/lib/congressFallback.ts";

const TICKET = "/c/spring/my-ticket";
const HOME = "/c/spring/my-congress";

test("a pass link cut short by an SMS lands on the pass", () => {
  for (const rest of ["my-tic", "my-tic…", "my-tic...", "my-t", "my-ticke.", "my-tic%E2%80%A6", "my-ticket…", "MY-TIC", "my-tic…/"]) {
    assert.equal(congressFallbackPath("spring", rest), TICKET, rest);
  }
});

test("any other unknown address lands on the congress home", () => {
  for (const rest of ["", "…", "...", "my-c", "my-congres", "tickets", "my-ticketing", "x/my-ticket", "%E2%80%A6", "%"]) {
    assert.equal(congressFallbackPath("spring", rest), HOME, rest);
  }
});

test("the slug is kept and encoded", () => {
  assert.equal(congressFallbackPath("a b", "my-tic"), "/c/a%20b/my-ticket");
});
