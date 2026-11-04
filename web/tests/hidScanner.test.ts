import { strict as assert } from "node:assert/strict";
import { describe, it } from "node:test";
import { createHidScanner, createRepeatFilter, type HidKeyEvent } from "../src/hooks/useHidScanner.ts";

const BODY = { tagName: "BODY" };
const INPUT = { tagName: "INPUT" };
const EDITABLE_DIV = { tagName: "DIV", isContentEditable: true };

type FakeKey = HidKeyEvent & { prevented: number; stopped: number };

function physical(character: string): { code: string; key: string } {
  if (/[a-z]/i.test(character)) return { code: `Key${character.toUpperCase()}`, key: character };
  if (/[0-9]/.test(character)) return { code: `Digit${character}`, key: character };
  throw new Error(`no physical key for ${character}`);
}

function press(character: string, over: Partial<HidKeyEvent> = {}): FakeKey {
  const event: FakeKey = {
    ...physical(character),
    shiftKey: false,
    target: BODY,
    prevented: 0,
    stopped: 0,
    preventDefault() {
      event.prevented += 1;
    },
    stopPropagation() {
      event.stopped += 1;
    },
    ...over,
  };
  return event;
}

const enter = (over: Partial<HidKeyEvent> = {}) => press("a", { code: "Enter", key: "Enter", ...over });

/** Types `text` with `gap` ms between keys starting at `start`; returns the events and the time of the last key. */
function type(scanner: ReturnType<typeof createHidScanner>, text: string, gap: number, start = 1000, over: Partial<HidKeyEvent> = {}) {
  const events: FakeKey[] = [];
  let now = start;
  for (const character of text) {
    const event = press(character, over);
    scanner.handle(event, now);
    events.push(event);
    now += gap;
  }
  return { events, end: now - gap };
}

function collector() {
  const codes: string[] = [];
  return { codes, scanner: createHidScanner((code) => codes.push(code)) };
}

describe("hid scanner — a barcode gun's burst", () => {
  it("delivers the code at Enter and swallows the burst's keys and the closing Enter", () => {
    const { codes, scanner } = collector();
    const { events, end } = type(scanner, "q7w3e5r1t9y2", 10);
    const closing = enter();
    scanner.handle(closing, end + 15);
    assert.deepEqual(codes, ["q7w3e5r1t9y2"]);
    // The first key cannot be known to be part of a burst; every later key is held back on a page with no field.
    assert.deepEqual(events.slice(1).map((e) => e.prevented), Array(events.length - 1).fill(1));
    assert.equal(closing.prevented, 1);
    assert.equal(closing.stopped, 1);
  });

  it("needs at least 8 keys: a shorter fast run is not a scan and its Enter is left alone", () => {
    const { codes, scanner } = collector();
    const { end } = type(scanner, "abc1234", 10);
    const closing = enter();
    scanner.handle(closing, end + 15);
    assert.deepEqual(codes, []);
    assert.equal(closing.prevented, 0);
  });

  it("reads exactly 8 keys as a code", () => {
    const { codes, scanner } = collector();
    const { end } = type(scanner, "abcd1234", 10);
    scanner.handle(enter(), end + 15);
    assert.deepEqual(codes, ["abcd1234"]);
  });

  it("lets slow typing through untouched: no code, no key held back, Enter passes", () => {
    const { codes, scanner } = collector();
    const { events, end } = type(scanner, "q7w3e5r1t9y2", 150);
    const closing = enter();
    scanner.handle(closing, end + 150);
    assert.deepEqual(codes, []);
    assert.equal(events.reduce((n, e) => n + e.prevented, 0), 0);
    assert.equal(closing.prevented, 0);
  });

  it("a slow gap starts a new run: keys typed before it are never glued onto the code", () => {
    const { codes, scanner } = collector();
    type(scanner, "q7w3e5", 10, 1000);
    const { end } = type(scanner, "r1t9y2u4i6", 10, 1000 + 5 * 10 + 200);
    scanner.handle(enter(), end + 15);
    assert.deepEqual(codes, ["r1t9y2u4i6"]);
  });

  it("a stray key before a scan does not spoil it", () => {
    const { codes, scanner } = collector();
    scanner.handle(press("x"), 500);
    const { end } = type(scanner, "q7w3e5r1t9y2", 10, 5000);
    scanner.handle(enter(), end + 15);
    assert.deepEqual(codes, ["q7w3e5r1t9y2"]);
  });

  it("a stalled scan is never delivered as the whole code", () => {
    const { codes, scanner } = collector();
    type(scanner, "q7w3e5r1t9y2", 10, 1000);
    const { end } = type(scanner, "u4i6", 10, 1000 + 11 * 10 + 300);
    scanner.handle(enter(), end + 15);
    assert.deepEqual(codes, []);
  });

  it("ignores a held key's auto-repeat", () => {
    const { codes, scanner } = collector();
    const { events, end } = type(scanner, "aaaaaaaaaaaa", 30, 1000, { repeat: true });
    const closing = enter();
    scanner.handle(closing, end + 30);
    assert.deepEqual(codes, []);
    assert.equal(events.reduce((n, e) => n + e.prevented, 0), 0);
    assert.equal(closing.prevented, 0);
  });

  it("an Enter that comes long after the last key is the person's, not the gun's", () => {
    const { codes, scanner } = collector();
    const { end } = type(scanner, "q7w3e5r1t9y2", 10);
    const closing = enter();
    scanner.handle(closing, end + 500);
    assert.deepEqual(codes, []);
    assert.equal(closing.prevented, 0);
  });

  it("two scans in a row each deliver their own code", () => {
    const { codes, scanner } = collector();
    const first = type(scanner, "aaaa1111bbbb", 10, 1000);
    scanner.handle(enter(), first.end + 15);
    const second = type(scanner, "cccc2222dddd", 10, 3000);
    scanner.handle(enter(), second.end + 15);
    assert.deepEqual(codes, ["aaaa1111bbbb", "cccc2222dddd"]);
  });

  it("reads the physical keys, so a Persian layout cannot garble the code", () => {
    const { codes, scanner } = collector();
    let now = 1000;
    for (const [code, key] of [["KeyA", "ش"], ["Digit1", "۱"], ["KeyB", "ذ"], ["Digit2", "۲"], ["KeyC", "ز"], ["Digit3", "۳"], ["KeyD", "ی"], ["Digit4", "۴"]]) {
      scanner.handle(press("a", { code, key }), now);
      now += 10;
    }
    scanner.handle(enter(), now + 5);
    assert.deepEqual(codes, ["a1b2c3d4"]);
  });

  it("normalises like the scanner does: lower case, at most 64 characters", () => {
    const { codes, scanner } = collector();
    let now = 1000;
    for (const character of "ABCD1234") {
      scanner.handle(press(character, { shiftKey: /[A-Z]/.test(character) }), now);
      now += 10;
    }
    scanner.handle(enter(), now + 5);
    assert.deepEqual(codes, ["abcd1234"]);
  });

  it("is not thrown off by a Shift key press inside the burst", () => {
    const { codes, scanner } = collector();
    let now = 1000;
    for (const character of "AB12CD34") {
      scanner.handle(press("a", { code: "ShiftLeft", key: "Shift" }), now);
      scanner.handle(press(character, { shiftKey: /[A-Z]/.test(character) }), now + 3);
      now += 10;
    }
    scanner.handle(enter(), now + 5);
    assert.deepEqual(codes, ["ab12cd34"]);
  });

  it("ignores shortcuts (Ctrl, Cmd, Alt) entirely", () => {
    const { codes, scanner } = collector();
    const { events, end } = type(scanner, "q7w3e5r1t9y2", 10, 1000, { ctrlKey: true });
    const closing = enter();
    scanner.handle(closing, end + 15);
    assert.deepEqual(codes, []);
    assert.equal(events.reduce((n, e) => n + e.prevented, 0), 0);
    assert.equal(closing.prevented, 0);
  });
});

describe("hid scanner — a focused field", () => {
  it("lets the first keys reach the field (a person typing fast must never lose a character), then holds the burst back", () => {
    const { codes, scanner } = collector();
    const { events, end } = type(scanner, "q7w3e5r1t9y2", 10, 1000, { target: INPUT });
    const closing = enter({ target: INPUT });
    scanner.handle(closing, end + 15);
    assert.deepEqual(events.slice(0, 3).map((e) => e.prevented), [0, 0, 0]);
    assert.deepEqual(events.slice(3).map((e) => e.prevented), Array(events.length - 3).fill(1));
    assert.deepEqual(codes, ["q7w3e5r1t9y2"]);
    assert.equal(closing.prevented, 1);
  });

  it("never holds back a person's quick two- or three-key roll in a field", () => {
    for (const target of [INPUT, EDITABLE_DIV, { tagName: "TEXTAREA" }, { tagName: "SELECT" }]) {
      const { codes, scanner } = collector();
      const { events } = type(scanner, "the", 30, 1000, { target });
      assert.equal(events.reduce((n, e) => n + e.prevented, 0), 0, target.tagName);
      assert.deepEqual(codes, []);
    }
  });

  it("a person typing at their own pace in a field is never interfered with", () => {
    const { codes, scanner } = collector();
    const { events, end } = type(scanner, "helloworld", 110, 1000, { target: INPUT });
    const closing = enter({ target: INPUT });
    scanner.handle(closing, end + 110);
    assert.equal(events.reduce((n, e) => n + e.prevented, 0), 0);
    assert.equal(closing.prevented, 0);
    assert.deepEqual(codes, []);
  });
});

describe("hid scanner — reset", () => {
  it("forgets a half-finished burst", () => {
    const { codes, scanner } = collector();
    type(scanner, "q7w3e5r1", 10);
    scanner.reset();
    scanner.handle(enter(), 1100);
    assert.deepEqual(codes, []);
  });
});

describe("repeat filter — the same code seen again while the camera stays on it", () => {
  it("lets the first sighting through and swallows the same value for 3 s", () => {
    const filter = createRepeatFilter();
    assert.equal(filter.accept("badge-a", 0), true);
    assert.equal(filter.accept("badge-a", 1000), false);
    assert.equal(filter.accept("badge-a", 2999), false);
  });

  it("keeps swallowing while the badge stays in view, and accepts it again 3 s after it was last seen", () => {
    const filter = createRepeatFilter();
    assert.equal(filter.accept("badge-a", 0), true);
    assert.equal(filter.accept("badge-a", 2000), false);
    assert.equal(filter.accept("badge-a", 4000), false);
    assert.equal(filter.accept("badge-a", 7000), true);
  });

  it("accepts a different value at once", () => {
    const filter = createRepeatFilter();
    assert.equal(filter.accept("badge-a", 0), true);
    assert.equal(filter.accept("badge-b", 100), true);
    assert.equal(filter.accept("badge-b", 200), false);
  });

  it("takes the window as a parameter and can be reset", () => {
    const filter = createRepeatFilter(500);
    assert.equal(filter.accept("x", 0), true);
    assert.equal(filter.accept("x", 400), false);
    assert.equal(filter.accept("x", 900), true);
    filter.reset();
    assert.equal(filter.accept("x", 901), true);
  });
});
