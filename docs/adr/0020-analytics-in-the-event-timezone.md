# 0020: Attendance Analytics in SQL, on the Event's Clock

**Status:** Accepted (2026-10-23). Implemented by the analytics workstream (C5, `backend/app/routes/analytics.py`); the
event time zone column comes from migration `0024` (ADR 0014 status notes).

## Context
The organizer's attendance dashboard loaded ticket and scan rows into Python and grouped them there, so its cost grew
with the congress, and it bucketed scans by UTC hour. An Iranian congress reads its day on Tehran time (UTC+03:30), so
UTC buckets put a morning arrival peak in the wrong hour and could split one congress day across two dates. The CSV
exports built the whole file in memory and did not share the dashboard's filters, so an export did not match what the
organizer was looking at.

## Decision
1. **Every number is a PostgreSQL aggregate** (`GROUP BY`): registrations per tier and status, unique admitted
   attendees, scans admitted and rejected per point, catering counts and hourly buckets. The dashboard costs the same
   handful of statements at any size; no ticket or scan row is loaded into Python.
2. **The event's wall clock is the unit of time.** Scans are bucketed by local date and hour with
   `scanned_at AT TIME ZONE <events.timezone>` (default `Asia/Tehran`, an IANA name validated when the event is saved),
   and PostgreSQL also computes each local time's UTC offset, so the API needs no time-zone database of its own. Every
   response states its `timezone`; hourly buckets carry the local day, `"HH:00"` and an ISO 8601 `starts_at` with the
   event's offset. The day picker lists every day from the event's first to its last (up to 62 days) plus any other day
   with scans.
3. **One set of filters** (`AnalyticsFilters`: check-in point, ticket tier, `from_time`/`to_time`, local `day`) scopes
   the dashboard and both exports alike. A naive `from_time`/`to_time` means the event's local time, an aware one an
   instant; both bounds are inclusive; `day` is midnight to midnight on the event's clock. A reversed range answers
   `400 ANALYTICS_RANGE_INVALID`.
4. **Streamed CSV exports** from a server-side cursor in batches of 1,000 rows, each in its own session (the request's
   may close while the body streams), with a UTF-8 BOM for Excel and every cell sanitised against formula injection:
   - `GET /api/events/{event_id}/analytics/export-csv`: every scan matching the filters, newest first, with both
     `Scanned At (UTC)` and `Scanned At (<zone>)`;
   - `GET /api/events/{event_id}/analytics/registrations-csv`: one row per ticket in any status; the tier filter picks
     tickets, the point and date filters scope the admission columns.
5. Endpoints: `GET /api/events/{event_id}/analytics/attendance` for the dashboard; aggregate analytics are readable by
   the viewer role, the exports need manager and are written to the audit log (ADR 0016).

## Consequences
- Charts and exports agree with each other and with the organizer's own clock; changing an event's time zone changes how
  its existing scans are bucketed (stored instants stay UTC).
- Correctness depends on PostgreSQL's time-zone data being current (it ships with the `postgres` image).
- `CAPACITY_CAPPED` and catering numbers count admissions, not occupancy (ADR 0010 status notes); per-day single-use
  windows and IN/OUT occupancy are in the unmerged `ws/c1-gate-rules` branch, which will extend this module.
- Large exports no longer hold the whole file in memory. They are still subject to the API's statement timeout
  (ADR 0018); exports at real congress size have not been load-tested.
