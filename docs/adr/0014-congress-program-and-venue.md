# 0014: Congress Program and Venue Directory as Operational Data

## Context
Attendees need the congress program (which session, when, in which hall) and directions to the venue's entrances
and halls on their phones, and organizers need to maintain both while the congress runs: a talk moves to another
hall, a keynote starts late. Page Studio (migration `0013`) already has an editorial agenda section, but everything in
Page Studio reaches visitors only through Publish, a deliberate step meant for presentation copy. The platform also
already has Check-In Points, which are scanning stations, not places attendees look up.

## Decision
1. **Two event-scoped tables** (migration `0018`): `venue_places` (kind `entrance` or `hall`, name, directions,
   position) and `event_sessions` (title, Track label, speakers, description, optional hall, start and end). Deleting a
   hall keeps its sessions without a hall; deleting an event removes both.
2. **Operational, not editorial**: like ticket tiers and booths, the program and the venue directory are live for
   attendees as soon as the organizer saves them, with no publish step. They are part of the public event payload
   (`GET /api/public/events/{slug}`: `venue`, `sessions`) and of the organizer's page preview. An unpublished event
   still answers 404 publicly, program included.
3. **The Page Studio agenda section stays editorial** copy published with the page; it is not generated from, nor kept
   in sync with, the program.
4. **Venue places are not Check-In Points**: they admit nobody and have no Entity QR. A hall or entrance that scans
   tickets is configured separately as a Check-In Point.
5. **Timetable import** (`POST /api/events/{event_id}/sessions/import`) is all-or-nothing: rows are validated before
   anything is saved and errors name the 1-based row. Hall names match this event's halls trimmed and
   case-insensitively; unknown names create a hall. `replace` removes the existing program in the same transaction.

## Consequences
- An edit to the program is visible to attendees immediately; there is no draft of the program to review first.
- A Track is a free-text label, so spelling variants become separate filter values; organizers fix them by editing.
- Hall names from an import can create near-duplicate halls (a typo is a new hall); the organizer merges them by
  moving sessions and deleting the extra hall.

## Status / Implementation notes (2026-10-23)

Implemented as decided, and extended by the events/program workstream (B4, migration `0024`).

- **Event time zone:** `events.timezone` (an IANA name, default `Asia/Tehran`, validated against the zone database in
  `backend/app/routes/events.py`). Program days and analytics (ADR 0020) use the event's wall clock.
- **Program validation:** a session must lie within the event's days in its time zone (`event_day_window`), and
  `ends_at >= starts_at` is a database CHECK (`ck_event_sessions_time_order`). The all-or-nothing import still names
  the failing rows.
- **Spreadsheet timetables:** the organizer console reads CSV saved from Excel and accepts Solar Hijri (Jalali) dates
  such as `1405/08/11 09:00`, converting them to Gregorian before calling the import API (`web/src/lib/sessionCsv.ts`,
  `jalali.ts`); the API itself takes ISO times.
- **Schedule files (client issue 1):** besides structured sessions, the organizer can upload the program as a PDF or an
  image (`program_files`, `backend/app/routes/program_files.py`). Like the program they are operational: live for
  attendees once saved, behind the published page. PDFs are checked by magic bytes and images re-encoded like Page
  Studio images; files are stored under server-generated names in the media root (at most 8,000,000 bytes) and served
  with `nosniff` and a sandboxing Content-Security-Policy.
- **Archived events are read-only** for the program, the venue directory and the schedule files (`WritableEventDep`).
- Attendee side: the program explorer (day tabs, track and hall filters, search, personal agenda, per-session `.ics`)
  and the program and venue on the public page `/e/:slug`.
