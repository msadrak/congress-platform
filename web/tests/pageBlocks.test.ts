import test from "node:test";
import assert from "node:assert/strict";
import { contrastOnWhite, eventAccent, legibleAccent, MIN_ACCENT_CONTRAST } from "../src/lib/eventAccent.ts";
import { applyFormat, type FormatAction, type TextEdit } from "../src/lib/markdownEdit.ts";
import { parseInline, parseMarkdownLite } from "../src/lib/markdownLite.ts";
import { accentOf, addSection, normalizeDocument, referencedImages, standardDocument } from "../src/lib/pageDocument.ts";
import { detectLinkKind, linkDisplay, normalizeLink, parseVideoUrl, safeLinkHref, videoEmbedUrl } from "../src/lib/pageLinks.ts";
import { textDirection } from "../src/components/public/page/sectionFormat.ts";

test("video addresses organizers paste are reduced to provider and id", () => {
  const yt = { provider: "youtube", id: "dQw4w9WgXcQ" };
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    "youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    assert.deepEqual(parseVideoUrl(url), yt, url);
  }
  assert.deepEqual(parseVideoUrl("https://www.aparat.com/v/Xy12z"), { provider: "aparat", id: "Xy12z" });
  assert.deepEqual(parseVideoUrl("aparat.com/v/Xy12z/عنوان-ویدیو"), { provider: "aparat", id: "Xy12z" });
  assert.deepEqual(parseVideoUrl("https://www.aparat.com/video/video/embed/videohash/Xy12z/vt/frame"), { provider: "aparat", id: "Xy12z" });
  for (const bad of ["", "hello", "https://vimeo.com/123456", "https://youtube.com/watch?v=short", "https://www.aparat.com/", "javascript:alert(1)"]) {
    assert.equal(parseVideoUrl(bad), null, bad);
  }
  assert.equal(videoEmbedUrl("youtube", "dQw4w9WgXcQ").startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), true);
});

test("links are normalised to http(s), mailto: or tel:, and their kind is recognised", () => {
  assert.equal(normalizeLink("t.me/congress"), "https://t.me/congress");
  assert.equal(normalizeLink(" https://instagram.com/x "), "https://instagram.com/x");
  assert.equal(normalizeLink("info@example.org"), "mailto:info@example.org");
  assert.equal(normalizeLink("۰۲۱ ۱۲۳۴ ۵۶۷۸"), "tel:021 1234 5678");
  assert.equal(normalizeLink("+98 912 000 0000"), "tel:+98 912 000 0000");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "not a link", "localhost", "ftp://files.example.org", "mailto:nobody"]) {
    assert.equal(normalizeLink(bad), null, bad);
  }
  assert.equal(detectLinkKind("https://t.me/congress"), "telegram");
  assert.equal(detectLinkKind("https://www.instagram.com/congress"), "instagram");
  assert.equal(detectLinkKind("https://eitaa.com/congress"), "eitaa");
  assert.equal(detectLinkKind("https://ble.ir/congress"), "bale");
  assert.equal(detectLinkKind("https://wa.me/989120000000"), "whatsapp");
  assert.equal(detectLinkKind("https://x.com/congress"), "x");
  assert.equal(detectLinkKind("mailto:a@b.co"), "email");
  assert.equal(detectLinkKind("tel:+98"), "phone");
  assert.equal(detectLinkKind("https://congress.example.org"), "website");
  assert.equal(linkDisplay("https://www.t.me/congress/"), "t.me/congress");
  assert.equal(linkDisplay("tel:+98 21"), "+98 21");
  assert.equal(safeLinkHref("javascript:alert(1)"), null);
  assert.equal(safeLinkHref("tel:+98 21 1234"), "tel:+98211234");
});

test("markdown-lite reads headings, numbered lists, quotes, dividers, italics and highlights", () => {
  const blocks = parseMarkdownLite("## Program\nIntro line\n۳. third\n4. fourth\n\n> said\n> twice\n\n---\n\n* bullet\n### Small");
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["heading", "paragraph", "ordered", "quote", "divider", "list", "heading"],
  );
  assert.deepEqual(blocks[0], { kind: "heading", level: 3, text: [{ kind: "text", text: "Program" }] });
  assert.equal(blocks[2].kind === "ordered" && blocks[2].start, 3);
  assert.equal(blocks[3].kind === "quote" && blocks[3].lines.length, 2);
  assert.equal(blocks[6].kind === "heading" && blocks[6].level, 4);
  assert.deepEqual(parseInline("a *b* **c** ==d== [e](mailto:x@y.org) [f](tel:+9821)"), [
    { kind: "text", text: "a " },
    { kind: "em", text: "b" },
    { kind: "text", text: " " },
    { kind: "strong", text: "c" },
    { kind: "text", text: " " },
    { kind: "mark", text: "d" },
    { kind: "text", text: " " },
    { kind: "link", text: "e", href: "mailto:x@y.org" },
    { kind: "text", text: " " },
    { kind: "link", text: "f", href: "tel:+9821" },
  ]);
  // A lone asterisk or "2 * 3" is not emphasis.
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ kind: "text", text: "2 * 3 * 4" }]);
});

const at = (value: string, start: number, end = start): TextEdit => ({ value, start, end });
const run = (edit: TextEdit, action: FormatAction) => applyFormat(edit, action, "text");

test("the toolbar wraps and unwraps inline styles around the selection", () => {
  const bold = run(at("say hello now", 4, 9), "bold");
  assert.deepEqual(bold, { value: "say **hello** now", start: 6, end: 11 });
  assert.deepEqual(run(bold, "bold"), { value: "say hello now", start: 4, end: 9 });
  assert.deepEqual(run(at("ab", 1), "highlight"), { value: "a==text==b", start: 3, end: 7 });
  // Spaces in the selection stay outside the markers.
  assert.equal(run(at("x word y", 1, 7), "italic").value, "x *word* y");
});

test("the toolbar prefixes lines, numbers lists, toggles, and inserts links and dividers", () => {
  const list = run(at("one\ntwo\n\nthree", 0, 7), "bullets");
  assert.equal(list.value, "- one\n- two\n\nthree");
  assert.equal(run(list, "bullets").value, "one\ntwo\n\nthree");
  assert.equal(run(at("one\ntwo", 0, 7), "numbered").value, "1. one\n2. two");
  assert.equal(run(at("- item", 2), "heading").value, "## item", "a heading replaces the bullet");
  const link = run(at("see site", 4, 8), "link");
  assert.equal(link.value, "see [site](https://)");
  assert.equal(link.value.slice(link.start, link.end), "https://");
  assert.equal(run(at("above", 5), "divider").value, "above\n\n---\n\n");
  assert.equal(run(at("", 0), "divider").value, "---\n\n");
});

test("a custom accent is darkened just enough to be legible on white", () => {
  assert.equal(legibleAccent("#0B6E4F"), "#0B6E4F");
  const yellow = legibleAccent("#ffd400");
  assert.ok(yellow && yellow !== "#FFD400");
  assert.ok(yellow && contrastOnWhite(yellow) >= MIN_ACCENT_CONTRAST);
  assert.equal(legibleAccent("red"), null);
  // The same WCAG values the backend computes (backend/app/page_document.py contrast_on_white).
  assert.ok(Math.abs(contrastOnWhite("#2000CD") - 10.81) < 0.01);
  assert.ok(Math.abs(contrastOnWhite("#777777") - 4.48) < 0.01);
  const accent = eventAccent("slug", "#0B6E4F");
  assert.equal(accent.name, "custom");
  assert.equal(accent.accent, "#0B6E4F");
  assert.equal(accentOf({ accent: "custom", accent_color: "#0B6E4F" }), "#0B6E4F");
  assert.equal(accentOf({ accent: "custom", accent_color: null }), "auto");
  assert.equal(accentOf({ accent: "magenta", accent_color: "#0B6E4F" }), "magenta");
  assert.equal(accentOf(undefined), "auto");
});

test("prose direction follows the script most of the text is written in, unless forced", () => {
  assert.equal(textDirection("Keynote by دکتر احمدی on AI in medicine").dir, "ltr");
  assert.equal(textDirection("سخنرانی دربارهٔ AI در پزشکی").dir, "rtl");
  assert.equal(textDirection("2026").dir, "ltr");
  assert.equal(textDirection("Hello", "rtl").dir, "rtl");
  assert.deepEqual(textDirection("سلام", "ltr"), { dir: "ltr", lang: "en" });
});

test("new blocks normalise with defaults and report every image they use", () => {
  const doc = normalizeDocument({
    version: 1,
    primary_locale: "auto",
    sections: [
      { type: "about", id: "about" },
      { type: "video", id: "video-1", video_id: "Xy12z", poster_asset_id: "poster" },
      { type: "gallery", id: "gallery-1", items: [{ image_asset_id: "logo" }] },
      { type: "columns", id: "columns-1", style: { background: "ink" }, items: [{ image_asset_id: "photo" }] },
      { type: "passes", id: "passes" },
      { type: "exhibitors", id: "exhibitors" },
    ],
  });
  assert.deepEqual(doc.sections[0].style, { background: "none", width: "normal", align: "start", text_size: "md", direction: "auto" });
  assert.equal(doc.sections[3].style.background, "ink");
  assert.equal(doc.sections[3].style.direction, "auto");
  const video = doc.sections[1];
  assert.ok(video.type === "video" && video.provider === "aparat" && video.layout === "full");
  assert.deepEqual([...referencedImages(doc)].sort(), ["logo", "photo", "poster"]);

  let next = standardDocument();
  for (const type of ["columns", "video", "gallery", "links"] as const) next = addSection(next, type).doc;
  assert.deepEqual(next.sections.slice(-4).map((s) => s.id), ["columns-1", "video-1", "gallery-1", "links-1"]);
  const columns = next.sections.find((s) => s.type === "columns");
  assert.equal(columns?.type === "columns" && columns.items.length, 2);
});
