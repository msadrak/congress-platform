import test from "node:test";
import assert from "node:assert/strict";
import { bannerWidth, focusPosition, heroPresentation, layoutForImage } from "../src/lib/heroImage.ts";
import { normalizeDocument, referencedImages, standardDocument, type PageDoc } from "../src/lib/pageDocument.ts";

const wide = { url: "/api/public/media/wide", width: 2400, height: 900 };
const tall = { url: "/api/public/media/tall", width: 1080, height: 1350 };
const images = { wide, tall };
const heroWith = (patch: Partial<PageDoc["hero"]>): PageDoc["hero"] => ({ ...standardDocument().hero, ...patch });

test("documents saved before the banner layout keep rendering: centred focus, no phone image", () => {
  // A payload as stored before: the hero has neither a focal point nor a phone image.
  const legacy = JSON.stringify({
    version: 1,
    primary_locale: "auto",
    hero: { layout: "cover", cover_asset_id: "wide" },
    sections: [
      { type: "about", id: "about", visible: true },
      { type: "passes", id: "passes", visible: true },
      { type: "exhibitors", id: "exhibitors", visible: true },
    ],
  });
  const doc = normalizeDocument(JSON.parse(legacy));
  assert.equal(doc.hero.focal_x, 50);
  assert.equal(doc.hero.focal_y, 50);
  assert.equal(doc.hero.mobile_cover_asset_id, null);
  assert.deepEqual(heroPresentation(doc.hero, images), { layout: "cover", image: wide, mobileImage: null, focus: "50% 50%" });
});

test("an image layout without its image falls back to the signature artwork", () => {
  for (const layout of ["banner", "cover", "split"] as const) {
    assert.equal(heroPresentation(heroWith({ layout }), images).layout, "signature");
    assert.equal(heroPresentation(heroWith({ layout, cover_asset_id: "missing" }), images).layout, "signature");
    assert.equal(heroPresentation(heroWith({ layout, cover_asset_id: "wide" }), images).layout, layout);
  }
  assert.equal(heroPresentation(heroWith({ layout: "signature", cover_asset_id: "wide" }), images).image, null);
});

test("the phone image is used by the cover layout only", () => {
  const hero = heroWith({ cover_asset_id: "wide", mobile_cover_asset_id: "tall", focal_x: 20, focal_y: 75 });
  assert.equal(heroPresentation({ ...hero, layout: "cover" }, images).mobileImage, tall);
  assert.equal(heroPresentation({ ...hero, layout: "banner" }, images).mobileImage, null);
  assert.equal(heroPresentation({ ...hero, layout: "split" }, images).mobileImage, null);
  assert.equal(heroPresentation({ ...hero, layout: "cover" }, images).focus, "20% 75%");
});

test("focus positions are whole percentages within the image", () => {
  assert.equal(focusPosition(0, 100), "0% 100%");
  assert.equal(focusPosition(-5, 140), "0% 100%");
  assert.equal(focusPosition(33.4, Number.NaN), "33% 50%");
});

test("a banner is full width unless that would make it taller than the cap", () => {
  assert.equal(bannerWidth(wide, "min(60svh, 40rem)"), "min(100%, calc(min(60svh, 40rem) * 2.6667))");
  assert.equal(bannerWidth(tall, "30rem"), "min(100%, calc(30rem * 0.8))");
  assert.equal(bannerWidth({ width: 10, height: 0 }, "30rem"), "min(100%, calc(30rem * 1))");
});

test("a first image switches the signature page to the banner; a chosen layout is kept", () => {
  assert.equal(layoutForImage(heroWith({ layout: "signature" }), "wide"), "banner");
  assert.equal(layoutForImage(heroWith({ layout: "signature", cover_asset_id: "tall" }), "wide"), "signature");
  assert.equal(layoutForImage(heroWith({ layout: "cover" }), "wide"), "cover");
  assert.equal(layoutForImage(heroWith({ layout: "banner", cover_asset_id: "wide" }), null), "banner");
});

test("the phone image is a referenced image (published and kept from deletion with the page)", () => {
  const doc = standardDocument();
  assert.deepEqual([...referencedImages({ ...doc, hero: { ...doc.hero, cover_asset_id: "wide", mobile_cover_asset_id: "tall" } })].sort(), ["tall", "wide"]);
});
