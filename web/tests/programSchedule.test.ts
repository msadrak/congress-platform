import test from "node:test";
import assert from "node:assert/strict";
import { distinctValues, groupSessionsByDay, initialDayKey, liveAndNext, localDayKey } from "../src/lib/programSchedule.ts";

// Local wall-clock times, so the tests hold in any time zone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();
const s = (id: string, day: number, from: number, to: number) => ({ id, starts_at: at(day, from), ends_at: at(day, to) });

const program = [s("d2-late", 19, 14, 15), s("d1-b", 18, 11, 12), s("d1-a", 18, 9, 10), s("d2-early", 19, 9, 11), s("d3", 20, 15, 17)];

test("sessions are grouped by local day, in time order", () => {
  const days = groupSessionsByDay(program);
  assert.deepEqual(days.map((d) => d.key), ["2026-11-18", "2026-11-19", "2026-11-20"]);
  assert.deepEqual(days.map((d) => d.sessions.map((x) => x.id)), [["d1-a", "d1-b"], ["d2-early", "d2-late"], ["d3"]]);
  assert.deepEqual(groupSessionsByDay([]), []);
});

test("grouping does not reorder the caller's array", () => {
  const copy = [...program];
  groupSessionsByDay(program);
  assert.deepEqual(program, copy);
});

test("the day key is the local calendar day", () => {
  assert.equal(localDayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(localDayKey(new Date(2026, 0, 6, 0, 0)), "2026-01-06");
});

test("now and next are only shown on a program day", () => {
  const during = Date.parse(at(19, 10));
  assert.deepEqual(liveAndNext(program, during), { live: [program[3]], next: program[0] });
  const between = Date.parse(at(19, 12));
  assert.deepEqual(liveAndNext(program, between), { live: [], next: program[0] });
  // A session's end is exclusive: at 11:00 the 9–11 session is over.
  assert.deepEqual(liveAndNext(program, Date.parse(at(19, 11)))?.live, []);
  assert.equal(liveAndNext(program, Date.parse(at(19, 16))), null, "day over");
  assert.equal(liveAndNext(program, Date.parse(at(21, 10))), null, "no program that day");
});

test("the program opens on today, else the next day to come, else the first", () => {
  const days = groupSessionsByDay(program);
  assert.equal(initialDayKey(days, Date.parse(at(19, 8))), "2026-11-19");
  assert.equal(initialDayKey(days, Date.parse(at(1, 8))), "2026-11-18");
  assert.equal(initialDayKey(days, Date.parse(at(30, 8))), "2026-11-18");
  assert.equal(initialDayKey([], 0), null);
});

test("tracks and halls are listed once, trimmed, without blanks", () => {
  assert.deepEqual(distinctValues(["پنل", " کارگاه ", null, "", "پنل", undefined, "Keynote"]), ["پنل", "کارگاه", "Keynote"]);
});
