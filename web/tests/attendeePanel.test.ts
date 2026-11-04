import test from "node:test";
import assert from "node:assert/strict";
import { countdownParts, daysBetween, homePhase, safeTimeZone, zonedDayKey } from "../src/lib/congressPhase.ts";
import { filterSessions, foldSearchText, groupByZonedDay, initialZonedDay, nowAndNext } from "../src/lib/programExplorer.ts";
import { agendaKey, loadAgenda, saveAgenda, toggleAgendaId, type AgendaStorage } from "../src/lib/agenda.ts";
import { appendPage, removeContact, replaceContact, withContactFirst } from "../src/lib/networkList.ts";
import { contactsPhrase } from "../src/components/attendee/attendeeCopy.ts";

const TEHRAN = "Asia/Tehran"; // UTC+03:30, no daylight saving since 2022

// ── Congress phase in the congress's time zone ──────────────────────────────────────────────────────
// 10–12 May 2027, 09:00 Tehran on day one to 17:00 Tehran on day three.
const STARTS = "2027-05-10T05:30:00Z";
const ENDS = "2027-05-12T13:30:00Z";

test("day keys are the calendar day in the given zone", () => {
  // 22:00 UTC on 9 May is already 01:30 on 10 May in Tehran.
  assert.equal(zonedDayKey("2027-05-09T22:00:00Z", TEHRAN), "2027-05-10");
  assert.equal(zonedDayKey("2027-05-09T22:00:00Z", "UTC"), "2027-05-09");
  assert.equal(daysBetween("2027-05-10", "2027-05-12"), 2);
  assert.equal(daysBetween("2027-12-31", "2028-01-01"), 1);
  assert.equal(daysBetween("2027-05-12", "2027-05-10"), -2);
});

test("an unknown time zone falls back to the visitor's zone instead of throwing", () => {
  assert.equal(safeTimeZone("Not/AZone"), undefined);
  assert.equal(safeTimeZone(""), undefined);
  assert.equal(safeTimeZone(TEHRAN), TEHRAN);
  assert.doesNotThrow(() => homePhase(STARTS, ENDS, "Not/AZone", Date.parse(STARTS)));
});

test("before the congress: countdown and calendar days until the opening day", () => {
  const phase = homePhase(STARTS, ENDS, TEHRAN, Date.parse("2027-05-07T05:30:00Z"));
  assert.deepEqual(phase, { kind: "before", msLeft: 3 * 86_400_000, daysLeft: 3 });
  // 23:50 Tehran the evening before: one calendar day left although only ~9 hours remain.
  const eve = homePhase(STARTS, ENDS, TEHRAN, Date.parse("2027-05-09T20:20:00Z"));
  assert.equal(eve?.kind, "before");
  assert.equal(eve?.kind === "before" && eve.daysLeft, 1);
  // 00:30 Tehran on the opening day: the same calendar day.
  const morning = homePhase(STARTS, ENDS, TEHRAN, Date.parse("2027-05-09T21:00:00Z"));
  assert.equal(morning?.kind === "before" && morning.daysLeft, 0);
});

test("during the congress: the day number follows the venue's calendar", () => {
  assert.deepEqual(homePhase(STARTS, ENDS, TEHRAN, Date.parse(STARTS)), { kind: "during", day: 1, totalDays: 3 });
  // 01:00 Tehran on 11 May is 21:30 UTC on 10 May: day two at the venue.
  assert.deepEqual(homePhase(STARTS, ENDS, TEHRAN, Date.parse("2027-05-10T21:30:00Z")), { kind: "during", day: 2, totalDays: 3 });
  assert.deepEqual(homePhase(STARTS, ENDS, TEHRAN, Date.parse(ENDS)), { kind: "during", day: 3, totalDays: 3 });
});

test("after the congress, and unusable timestamps", () => {
  assert.deepEqual(homePhase(STARTS, ENDS, TEHRAN, Date.parse(ENDS) + 1), { kind: "after" });
  assert.equal(homePhase("soon", ENDS, TEHRAN, 0), null);
  assert.equal(homePhase(STARTS, "", TEHRAN, 0), null);
});

test("countdown parts never go negative", () => {
  assert.deepEqual(countdownParts(((2 * 24 + 5) * 60 + 7) * 60_000 + 59_000), { days: 2, hours: 5, minutes: 7 });
  assert.deepEqual(countdownParts(-5), { days: 0, hours: 0, minutes: 0 });
});

// ── Program: days, filters, search, now/next ─────────────────────────────────────────────────────────
const session = (id: string, startsAt: string, endsAt: string, extra: Partial<{ title: string; track: string; hall_name: string; speakers: string; description: string }> = {}) => ({
  id,
  title: extra.title ?? id,
  track: extra.track ?? "",
  hall_name: extra.hall_name ?? "",
  speakers: extra.speakers ?? "",
  description: extra.description ?? "",
  starts_at: startsAt,
  ends_at: endsAt,
});
const program = [
  session("late-night", "2027-05-10T20:45:00Z", "2027-05-10T21:15:00Z", { track: "Imaging", hall_name: "Hall B" }), // 00:15 on 11 May in Tehran
  session("keynote", "2027-05-10T05:30:00Z", "2027-05-10T06:30:00Z", { title: "Opening Keynote", track: "Plenary", hall_name: "Main Hall", speakers: "Dr. Karimi" }),
  session("imaging", "2027-05-10T07:00:00Z", "2027-05-10T08:00:00Z", { title: "کاربرد هوش مصنوعی در تصویربرداری", track: "Imaging", hall_name: "Hall B" }),
  session("day3", "2027-05-12T06:00:00Z", "2027-05-12T07:00:00Z", { title: "Closing", track: "Plenary", hall_name: "Main Hall" }),
];

test("sessions are grouped by the congress's calendar day, in time order", () => {
  const days = groupByZonedDay(program, TEHRAN);
  assert.deepEqual(days.map((d) => d.key), ["2027-05-10", "2027-05-11", "2027-05-12"]);
  assert.deepEqual(days[0].sessions.map((s) => s.id), ["keynote", "imaging"]);
  assert.deepEqual(days[1].sessions.map((s) => s.id), ["late-night"]);
  // In UTC the late session belongs to the first day.
  assert.deepEqual(groupByZonedDay(program, "UTC")[0].sessions.map((s) => s.id), ["keynote", "imaging", "late-night"]);
});

test("the first day shown is today, else the next program day, else the first", () => {
  const days = groupByZonedDay(program, TEHRAN);
  assert.equal(initialZonedDay(days, Date.parse("2027-05-11T08:00:00Z"), TEHRAN), "2027-05-11");
  assert.equal(initialZonedDay(days, Date.parse("2027-04-01T08:00:00Z"), TEHRAN), "2027-05-10");
  assert.equal(initialZonedDay(days, Date.parse("2027-06-01T08:00:00Z"), TEHRAN), "2027-05-10");
  assert.equal(initialZonedDay([], 0, TEHRAN), null);
});

test("search folds Persian and Arabic letters, digits and the zero-width non-joiner", () => {
  assert.equal(foldSearchText("  كاربرد ي ۱۲  "), "کاربرد ی 12");
  assert.equal(foldSearchText("تصویر‌برداری"), "تصویر برداری");
  assert.equal(foldSearchText("Opening KEYNOTE"), "opening keynote");
});

test("filters combine track, hall, search and the agenda", () => {
  const ids = (list: { id: string }[]) => list.map((s) => s.id);
  assert.deepEqual(ids(filterSessions(program, { track: "Imaging" })), ["late-night", "imaging"]);
  assert.deepEqual(ids(filterSessions(program, { hall: "Main Hall", track: "Plenary" })), ["keynote", "day3"]);
  assert.deepEqual(ids(filterSessions(program, { query: "karimi" })), ["keynote"]);
  assert.deepEqual(ids(filterSessions(program, { query: "هوش مصنوعي" })), ["imaging"]);
  assert.deepEqual(ids(filterSessions(program, { onlyIds: ["day3", "keynote"] })), ["keynote", "day3"]);
  assert.deepEqual(ids(filterSessions(program, { onlyIds: [] })), []);
  assert.deepEqual(ids(filterSessions(program, { track: null, hall: null, query: "  " })), ids(program));
});

test("now and next: running sessions and the next to start, on any later day", () => {
  const during = nowAndNext(program, Date.parse("2027-05-10T06:00:00Z"));
  assert.deepEqual(during.live.map((s) => s.id), ["keynote"]);
  assert.equal(during.next?.id, "imaging");
  const gap = nowAndNext(program, Date.parse("2027-05-11T10:00:00Z"));
  assert.deepEqual(gap.live, []);
  assert.equal(gap.next?.id, "day3");
  assert.equal(nowAndNext(program, Date.parse("2027-06-01T00:00:00Z")).next, null);
});

// ── Personal agenda storage ──────────────────────────────────────────────────────────────────────────
function memoryStorage(): AgendaStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

test("the agenda is stored per attendee and congress", () => {
  const storage = memoryStorage();
  assert.equal(saveAgenda(storage, "user-1", "event-a", ["s1", "s2", "s1"]), true);
  assert.deepEqual(loadAgenda(storage, "user-1", "event-a"), ["s1", "s2"]);
  assert.deepEqual(loadAgenda(storage, "user-2", "event-a"), []);
  assert.deepEqual(loadAgenda(storage, "user-1", "event-b"), []);
  assert.equal(agendaKey("user-1", "event-a"), "congress_agenda_user-1_event-a");
});

test("storage errors and corrupt values never throw", () => {
  const broken: AgendaStorage = {
    getItem: () => {
      throw new DOMException("denied", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
  };
  assert.deepEqual(loadAgenda(broken, "u", "e"), []);
  assert.equal(saveAgenda(broken, "u", "e", ["s1"]), false);
  assert.deepEqual(loadAgenda(null, "u", "e"), []);
  assert.equal(saveAgenda(undefined, "u", "e", []), false);
  const storage = memoryStorage();
  for (const raw of ["{", '"s1"', '{"a":1}', "[1, null, \"\", \"ok\"]"]) {
    storage.data[agendaKey("u", "e")] = raw;
    assert.deepEqual(loadAgenda(storage, "u", "e"), raw.includes("ok") ? ["ok"] : []);
  }
});

test("toggling adds and removes a session", () => {
  assert.deepEqual(toggleAgendaId(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleAgendaId(["a", "b"], "a"), ["b"]);
});

// ── Network list ─────────────────────────────────────────────────────────────────────────────────────
test("pages append without duplicates and a new contact goes first", () => {
  const c = (id: string, name = id) => ({ id, name });
  assert.deepEqual(appendPage([c("a"), c("b")], [c("b"), c("c")]).map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(withContactFirst([c("a"), c("b"), c("c")], c("b", "B!")), [c("b", "B!"), c("a"), c("c")]);
  assert.deepEqual(withContactFirst([c("a")], c("z")).map((x) => x.id), ["z", "a"]);
  assert.deepEqual(replaceContact([c("a"), c("b")], c("b", "new")), [c("a"), c("b", "new")]);
  assert.deepEqual(removeContact([c("a"), c("b")], "a"), [c("b")]);
});

test("a zero count is a sentence, not a bare zero", () => {
  assert.equal(contactsPhrase(0, "fa"), "هنوز مخاطبی ندارید");
  assert.equal(contactsPhrase(0, "en"), "No contacts yet");
  assert.equal(contactsPhrase(3, "fa"), "۳ مخاطب");
  assert.equal(contactsPhrase(1, "en"), "1 contact");
  assert.equal(contactsPhrase(12, "en"), "12 contacts");
});
