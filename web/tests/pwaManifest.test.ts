import { strict as assert } from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { HOME_SCREEN_START_URL } from "../src/lib/launchTarget.ts";
import { webManifest } from "../pwa-manifest.ts";

const PUBLIC_DIR = join(import.meta.dirname, "..", "public");

describe("web app manifest", () => {
  it("does not lock the screen orientation: scanners sit in cases and stands in either orientation", () => {
    assert.equal(webManifest.orientation, "any");
  });

  it("keeps the installed app's identity stable while the start URL changes", () => {
    // Without an explicit id the identity is derived from start_url, so changing start_url would turn
    // every existing home-screen install into a different app.
    assert.equal(webManifest.id, "/");
  });

  it("starts at the home-screen launch URL that the launch step recognises, inside the scope", () => {
    assert.equal(webManifest.start_url, HOME_SCREEN_START_URL);
    assert.equal(webManifest.scope, "/");
    assert.ok(webManifest.start_url?.startsWith(webManifest.scope ?? "/"));
  });

  it("is a standalone app with the brand colours", () => {
    assert.equal(webManifest.display, "standalone");
    assert.equal(webManifest.theme_color, "#0E0C2B");
    assert.equal(webManifest.background_color, "#0E0C2B");
  });

  it("ships every declared icon, including a maskable one", () => {
    const icons = webManifest.icons ?? [];
    assert.ok(icons.some((icon) => icon.purpose === "maskable"), "a maskable icon");
    assert.ok(icons.some((icon) => icon.sizes === "192x192") && icons.some((icon) => icon.sizes === "512x512"));
    for (const icon of icons) {
      assert.ok(existsSync(join(PUBLIC_DIR, icon.src)), `${icon.src} exists in public/`);
    }
  });
});
