import test from "node:test";
import assert from "node:assert/strict";
import { BOOTH_DESCRIPTION_MAX, draftProblems, isWebLink, profileBody, refusedFields } from "../src/lib/boothPage.ts";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, imageFileProblem } from "../src/lib/imageUpload.ts";

test("a picked logo is checked for its type and size before it is sent", () => {
  assert.equal(imageFileProblem({ type: "image/png", size: 1024 }), null);
  assert.equal(imageFileProblem({ type: "image/webp", size: MAX_IMAGE_BYTES }), null);
  assert.equal(imageFileProblem({ type: "image/jpeg", size: MAX_IMAGE_BYTES + 1 }), "size");
  assert.equal(imageFileProblem({ type: "image/svg+xml", size: 10 }), "type");
  assert.equal(imageFileProblem({ type: "", size: 10 }), "type");
  assert.equal(imageFileProblem({ type: "image/png", size: 0 }), "empty");
  assert.equal(IMAGE_ACCEPT, "image/png,image/jpeg,image/webp");
});

test("booth links are empty or absolute http(s) addresses of at most 500 characters", () => {
  for (const ok of ["", "  ", "https://example.com", "http://example.com/a.pdf", " https://example.com "]) assert.equal(isWebLink(ok), true, ok);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "example.com", "https://exa mple.com", `https://${"a".repeat(500)}.com`]) {
    assert.equal(isWebLink(bad), false, bad);
  }
});

test("the draft names the fields the API would refuse, and the body carries only the three page fields", () => {
  const draft = { description: "x".repeat(BOOTH_DESCRIPTION_MAX + 1), website_url: "ftp://x", brochure_url: "" };
  assert.deepEqual(draftProblems(draft), ["description", "website_url"]);
  assert.deepEqual(draftProblems({ description: " ok ", website_url: "", brochure_url: "https://b.example" }), []);
  assert.deepEqual(profileBody({ description: " About ", website_url: " https://a.example ", brochure_url: "" }), {
    description: "About",
    website_url: "https://a.example",
    brochure_url: "",
  });
});

test("a 422 answer marks its fields; coded and other errors mark none", () => {
  const validation = {
    detail: [
      { loc: ["body", "brochure_url"], msg: "Value error" },
      { loc: ["body", "website_url"], msg: "Value error" },
      { loc: ["body", "name"], msg: "Extra inputs are not permitted" },
    ],
  };
  assert.deepEqual(refusedFields(validation), ["website_url", "brochure_url"]);
  assert.deepEqual(refusedFields({ detail: "Booth not found", code: "BOOTH_NOT_FOUND" }), []);
  assert.deepEqual(refusedFields(undefined), []);
  assert.deepEqual(refusedFields({ detail: [{ msg: "x" }] }), []);
});
