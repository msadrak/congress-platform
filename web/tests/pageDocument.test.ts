import test from "node:test";
import assert from "node:assert/strict";
import {
  addSection,
  documentDiff,
  localized,
  moveSection,
  normalizeDocument,
  referencedImages,
  removeSection,
  sameDocument,
  sectionAnchor,
  standardDocument,
} from "../src/lib/pageDocument.ts";
import { parseInline, parseMarkdownLite, safeHref } from "../src/lib/markdownLite.ts";

test("missing translations fall back to the other language, then to the platform default", () => {
  assert.equal(localized({ fa: "همایش", en: "Congress" }, "en"), "Congress");
  assert.equal(localized({ fa: "همایش", en: "  " }, "en"), "همایش");
  assert.equal(localized({ fa: "", en: "Congress" }, "fa"), "Congress");
  assert.equal(localized({ fa: " ", en: "" }, "fa"), null);
});

test("an API document with omitted defaults normalises to a complete document", () => {
  const doc = normalizeDocument({
    version: 1,
    primary_locale: "auto",
    sections: [
      { type: "about", id: "about", visible: true },
      { type: "faq", id: "faq-1", visible: false, items: [{ question: { fa: "؟", en: "" } }] },
      { type: "passes", id: "passes", visible: true },
      { type: "exhibitors", id: "exhibitors", visible: true },
    ],
  });
  assert.deepEqual(doc.hero.title, { fa: "", en: "" });
  assert.equal(doc.branding.accent, "auto");
  const faq = doc.sections[1];
  assert.equal(faq.type, "faq");
  if (faq.type === "faq") assert.deepEqual(faq.items[0], { question: { fa: "؟", en: "" }, answer: { fa: "", en: "" } });
});

test("core sections cannot be removed; added blocks get unique ids and land after the anchor", () => {
  const doc = standardDocument();
  assert.equal(removeSection(doc, "passes"), doc);
  const first = addSection(doc, "faq", "about");
  const second = addSection(first.doc, "faq", "about");
  assert.equal(first.id, "faq-1");
  assert.equal(second.id, "faq-2");
  assert.deepEqual(second.doc.sections.map((s) => s.id), ["about", "faq-2", "faq-1", "highlights", "passes", "exhibitors"]);
  assert.deepEqual(removeSection(second.doc, "faq-1").sections.map((s) => s.id), ["about", "faq-2", "highlights", "passes", "exhibitors"]);
  assert.equal(addSection(doc, "passes").doc, doc, "core sections are never added twice");
});

test("reordering moves one step and stops at the ends", () => {
  const doc = standardDocument();
  assert.deepEqual(moveSection(doc, "passes", -1).sections.map((s) => s.id), ["about", "passes", "highlights", "exhibitors"]);
  assert.equal(moveSection(doc, "about", -1), doc);
  assert.equal(moveSection(doc, "exhibitors", 1), doc);
});

test("a stale-save conflict is summarised by what the other saved version changes", () => {
  const mine = standardDocument();
  assert.deepEqual(documentDiff(mine, mine), { hero: false, branding: false, seo: false, order: false, added: [], removed: [], changed: [] });

  const withFaq = addSection(mine, "faq", "about");
  const theirs = moveSection(
    { ...withFaq.doc, hero: { ...withFaq.doc.hero, subtitle: { fa: "", en: "Other editor" } } },
    "passes",
    -1,
  );
  const highlights = theirs.sections.find((s) => s.id === "highlights");
  assert.ok(highlights);
  const edited = { ...theirs, sections: theirs.sections.map((s) => (s.id === "highlights" ? { ...s, visible: false } : s)) };
  const diff = documentDiff(mine, edited);
  assert.equal(diff.hero, true);
  assert.equal(diff.branding, false);
  assert.equal(diff.seo, false);
  assert.equal(diff.order, true);
  assert.deepEqual(diff.added.map((s) => s.id), ["faq-1"]);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed.map((s) => s.id), ["highlights"]);
  assert.deepEqual(documentDiff(withFaq.doc, mine).removed.map((s) => s.id), ["faq-1"]);
});

test("historic anchors survive so existing #passes / #exhibition links keep working", () => {
  const ids = standardDocument().sections.map(sectionAnchor);
  assert.deepEqual(ids, ["about", "section-highlights", "passes", "exhibition"]);
});

test("every image reference is found, wherever it is used", () => {
  let doc = standardDocument();
  doc = { ...doc, branding: { ...doc.branding, logo_asset_id: "logo" }, hero: { ...doc.hero, cover_asset_id: "cover" } };
  const withImage = addSection(doc, "image_text");
  const withSpeakers = addSection(withImage.doc, "speakers");
  const sections = withSpeakers.doc.sections.map((s) =>
    s.type === "image_text" ? { ...s, image_asset_id: "photo" } : s.type === "speakers" ? { ...s, items: [{ ...s.items[0], photo_asset_id: "face" }] } : s,
  );
  assert.deepEqual([...referencedImages({ ...withSpeakers.doc, sections })].sort(), ["cover", "face", "logo", "photo"]);
});

test("unsaved-change detection compares content, not identity", () => {
  assert.ok(sameDocument(standardDocument(), standardDocument()));
  assert.ok(!sameDocument(standardDocument(), moveSection(standardDocument(), "passes", 1)));
});

test("markdown-lite keeps HTML as text and only links http(s)", () => {
  const blocks = parseMarkdownLite("Hello <b>world</b> **now**\n\n- one\n- [two](https://example.org/x)\n\n[bad](javascript:alert(1))");
  assert.deepEqual(blocks[0], {
    kind: "paragraph",
    lines: [[{ kind: "text", text: "Hello <b>world</b> " }, { kind: "strong", text: "now" }]],
  });
  assert.deepEqual(blocks[1], {
    kind: "list",
    items: [[{ kind: "text", text: "one" }], [{ kind: "link", text: "two", href: "https://example.org/x" }]],
  });
  assert.deepEqual(blocks[2], { kind: "paragraph", lines: [[{ kind: "text", text: "[bad](javascript:alert(1))" }]] });
  assert.equal(safeHref("data:text/html,<script>"), null);
  assert.deepEqual(parseInline("Persian **پررنگ** text"), [
    { kind: "text", text: "Persian " },
    { kind: "strong", text: "پررنگ" },
    { kind: "text", text: " text" },
  ]);
});
