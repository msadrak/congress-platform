import test from "node:test";
import assert from "node:assert/strict";
import { boothSignInPath, safeNextPath, signInPath } from "../src/lib/safeRedirect.ts";

const FALLBACK = "/c/spring/my-congress";

test("accepts attendee portal, congress page, booth and legacy routes", () => {
  for (const path of [
    "/c/spring/my-ticket",
    "/c/spring/details",
    "/e/spring",
    "/e/spring/booths/3f2c9a7e-1111-4222-8333-444455556666",
    "/booth/3f2c9a7e-1111-4222-8333-444455556666",
    "/my-tickets",
    "/my-network",
  ]) {
    assert.equal(safeNextPath(path, FALLBACK), path);
  }
});

test("drops query and fragment from an allowed path", () => {
  assert.equal(safeNextPath("/c/spring/my-profile?x=1#top", FALLBACK), "/c/spring/my-profile");
});

test("rejects external, protocol-relative, scheme and backslash destinations", () => {
  for (const unsafe of [
    "https://evil.example/c/spring/my-ticket",
    "//evil.example/c/spring/my-ticket",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "c/spring/my-ticket",
    "/c/spring/my-ticket\n/evil",
    "",
  ]) {
    assert.equal(safeNextPath(unsafe, FALLBACK), FALLBACK, unsafe);
  }
  assert.equal(safeNextPath(null, FALLBACK), FALLBACK);
  assert.equal(safeNextPath(undefined, FALLBACK), FALLBACK);
});

test("rejects routes outside the attendee allow-list and traversal tricks", () => {
  for (const unsafe of [
    "/organizer",
    "/scan/abc",
    "/booth/abc/leads",
    "/booth/abc/sign-in",
    "/booth/%2e%2e",
    "/c/spring/sign-in",
    "/c/spring/unknown",
    "/c/spring/my-ticket/extra",
    "/c/../organizer",
    "/c/spring/../../organizer",
    "/c/sp%2Fring/my-ticket",
    "/e/spring/booths/%2e%2e",
  ]) {
    assert.equal(safeNextPath(unsafe, FALLBACK), FALLBACK, unsafe);
  }
});

test("signInPath encodes the return destination", () => {
  assert.equal(signInPath("spring", "/c/spring/my-ticket"), "/c/spring/sign-in?next=%2Fc%2Fspring%2Fmy-ticket");
  assert.equal(signInPath(undefined, "/my-tickets"), "/sign-in?next=%2Fmy-tickets");
});

test("boothSignInPath returns to that booth", () => {
  assert.equal(boothSignInPath("b-1"), "/booth/b-1/sign-in?next=%2Fbooth%2Fb-1");
});
