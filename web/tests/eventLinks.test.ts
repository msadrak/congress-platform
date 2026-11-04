import test from "node:test";
import assert from "node:assert/strict";
import { buildIcs, escapeIcsText, foldIcsLine, icsDate, icsFileName, mapSearchLinks } from "../src/lib/eventLinks.ts";

const encoder = new TextEncoder();

test("times are written in UTC without separators or milliseconds", () => {
  assert.equal(icsDate("2026-11-18T05:30:00Z"), "20261118T053000Z");
  assert.equal(icsDate("2026-11-18T09:00:00.123+03:30"), "20261118T053000Z");
  assert.throws(() => icsDate("not a date"), RangeError);
});

test("text values escape backslash, semicolon, comma and line breaks", () => {
  assert.equal(escapeIcsText("a\\b;c,d\ne\r\nf"), "a\\\\b\\;c\\,d\\ne\\nf");
  assert.equal(escapeIcsText("تهران، مرکز همایش"), "تهران، مرکز همایش");
});

test("long Persian lines fold at 75 octets between whole characters", () => {
  const line = `SUMMARY:${"کنگره سالانه انجمن قلب ایران ".repeat(6)}`;
  const folded = foldIcsLine(line);
  const parts = folded.split("\r\n");
  assert.ok(parts.length > 1);
  parts.forEach((part, i) => {
    assert.ok(encoder.encode(part).length <= 75, `line ${i} is ${encoder.encode(part).length} octets`);
    if (i > 0) assert.ok(part.startsWith(" "));
  });
  // Unfolding gives back the original line, so no character was split.
  assert.equal(folded.replace(/\r\n /g, ""), line);
  assert.equal(foldIcsLine("SHORT:x"), "SHORT:x");
});

test("the calendar file is one VEVENT with CRLF endings and every field", () => {
  const ics = buildIcs({
    uid: "event-cardio@congress",
    title: "سی‌ودومین کنگره, قلب",
    startsAt: "2026-11-18T05:30:00Z",
    endsAt: "2026-11-20T13:30:00Z",
    location: "تهران; رازی",
    description: "سه روز",
    url: "https://congress.example/e/cardio",
    stamp: new Date("2026-10-01T00:00:00Z"),
  });
  assert.ok(ics.endsWith("\r\n"));
  const unfolded = ics.replace(/\r\n /g, "");
  for (const expected of [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:event-cardio@congress",
    "DTSTAMP:20261001T000000Z",
    "DTSTART:20261118T053000Z",
    "DTEND:20261120T133000Z",
    "SUMMARY:سی‌ودومین کنگره\\, قلب",
    "LOCATION:تهران\\; رازی",
    "DESCRIPTION:سه روز\\n\\nhttps://congress.example/e/cardio",
    "URL:https://congress.example/e/cardio",
    "END:VEVENT",
    "END:VCALENDAR",
  ]) {
    assert.ok(unfolded.split("\r\n").includes(expected), `missing ${expected}`);
  }
  assert.ok(!/(?<!\r)\n/.test(ics), "bare LF line ending");
});

test("optional fields are left out when empty", () => {
  const ics = buildIcs({ uid: "u", title: "T", startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-01T01:00:00Z" });
  assert.ok(!ics.includes("LOCATION:"));
  assert.ok(!ics.includes("DESCRIPTION:"));
  assert.ok(!ics.includes("URL:"));
});

test("the download name is derived from the slug", () => {
  assert.equal(icsFileName("cardio-2026"), "cardio-2026.ics");
  assert.equal(icsFileName("../x y"), "x-y.ics");
  assert.equal(icsFileName("///"), "congress.ics");
});

test("map links search the address in Neshan, Balad and Google Maps", () => {
  const links = mapSearchLinks("  تهران،  مرکز همایش رازی ");
  assert.deepEqual(links.map((l) => l.provider), ["neshan", "balad", "google"]);
  const q = encodeURIComponent("تهران، مرکز همایش رازی");
  assert.equal(links[0].href, `https://neshan.org/maps/search/${q}`);
  assert.equal(links[1].href, `https://balad.ir/search?query=${q}`);
  assert.equal(links[2].href, `https://www.google.com/maps/search/?api=1&query=${q}`);
  assert.deepEqual(mapSearchLinks("   "), []);
  // Reserved characters cannot break out of the query.
  assert.ok(mapSearchLinks("A&B #1")[2].href.endsWith("query=A%26B%20%231"));
});
