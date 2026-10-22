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
