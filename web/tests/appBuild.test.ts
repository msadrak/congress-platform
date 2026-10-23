import test from "node:test";
import assert from "node:assert/strict";
import { APP_BUILD, SCANNER_APP_VERSION, SCANNER_PROTOCOL, scannerProtocol } from "../src/lib/appBuild.ts";

test("without a build define the app is 'dev', and the scanner version names protocol and build", () => {
  assert.equal(APP_BUILD, "dev");
  assert.equal(SCANNER_APP_VERSION, `${SCANNER_PROTOCOL}+dev`);
  assert.ok(SCANNER_APP_VERSION.length <= 40);
});

test("the protocol part of a reported version", () => {
  assert.equal(scannerProtocol("web-scanner/2+abc123def0"), "web-scanner/2");
  assert.equal(scannerProtocol("web-scanner/2"), "web-scanner/2");
  assert.equal(scannerProtocol(null), null);
});
