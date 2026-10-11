# 07 — Congress-Day Operational Runbook & Incident Response

**Audience:** Congress Operations Lead, Venue Gate Supervisors, Front Desk Staff  
**Evaluation Date:** 2026-10-10  
**Standard:** Zero Data Loss / Rapid Attendee Throughput / Truthful Operational Safety  

---

## 1. Timeline & Operational Checklist

### T-24 Hours: Pre-Event Infrastructure Check
- [ ] Backend health check responds 200 OK (`GET /docs` or `/api/events`).
- [ ] Database backup executed (`pg_dump -Fc congress_production > backup_pre_event.dump`).
- [ ] Event ticket tiers and quotas locked.
- [ ] Check-in points established: Main Entrance (`MULTI_ENTRY`), Catering/Lunch (`SINGLE_USE`), Workshops (`TIER_RESTRICTED`), Auditorium (`CAPACITY_CAPPED`).
- [ ] Exhibition booths created; staff assignment emails sent.

### T-2 Hours: Hardware & Device Pairing Station
- [ ] Power on all scanner tablets and gate laptops; connect to venue primary Wi-Fi.
- [ ] Open `/scan/:pointId` on each device.
- [ ] Enter Point-Scoped Scanner Token minted from Organizer Console.
- [ ] Confirm device displays: **"Online"** (Green dot) and **"Manifest: X tickets cached"**.
- [ ] Verify audio chimes: Click speaker icon and scan a test badge to verify `playSuccessChime()` is audible.
- [ ] Test Front Desk station (`/organizer/events/:id/desk`): Register synthetic walk-in test attendee and test thermal printer output.

---

## 2. Gate Operations & Visual Feedback Guide

Scanner operators must be trained to recognize the 3 primary feedback states:

```text
┌────────────────────────────────────────────────────────┐
│ [GREEN] CONFIRMED ADMITTED                             │
│ Checkmark icon | High double-chime                     │
│ Meaning: Authoritative entry confirmed by database.   │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ [AMBER] PROVISIONAL OFFLINE ADMISSION                  │
│ Clock icon | Mid-tone chime                            │
│ Meaning: Local admission approved; pending sync.       │
│ Action: Allow attendee to enter; tablet will sync.     │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ [RED] REJECTED ADMISSION                               │
│ Cross icon | Low buzz tone                             │
│ Reasons:                                               │
│ - ALREADY_ADMITTED: Duplicate pass (already entered).   │
│ - TIER_NOT_ALLOWED: Pass not permitted at this gate.   │
│ - CAPACITY_REACHED: Hall or room is full.              │
│ - NOT_IN_LOCAL_MANIFEST: Absent from offline cache.   │
│ - INVALID_TICKET: Unrecognized or forged barcode.      │
│ Action: Direct attendee to Front Desk for resolution. │
└────────────────────────────────────────────────────────┘
```

---

## 3. Incident Response Playbooks

### Playbook A: Complete Venue Wi-Fi / Internet Failure
*Symptoms:* Scanner status turns to amber "Offline"; pending queue counter starts incrementing.
1. **DO NOT PANIC:** The scanner station is designed for offline operation.
2. **DO NOT REFRESH OR CLOSE BROWSER TABS:** Active queues are buffered in browser IndexedDB.
3. **Continue Scanning:** Valid tickets in the local manifest will be admitted as **Provisional (Amber)**.
4. **Resolution:** When venue Wi-Fi restores, the tablet automatically syncs queued scans in batches of 50 every 5 seconds.

### Playbook B: Attendee Presents "NOT_IN_LOCAL_MANIFEST" Error
*Symptoms:* Red screen displaying: *"کد در حافظه آفلاین گیت یافت نشد (نیاز به استعلام آنلاین یا میز پذیرش)"*.
1. **Diagnosis:** Attendee registered online or walk-in very recently, after the scanner disconnected from Wi-Fi.
2. **Action 1:** If scanner tablet has temporary cellular hotspot access, connect briefly to auto-refresh manifest.
3. **Action 2:** Otherwise, direct attendee to the Front Desk station where live internet connectivity can confirm their registration and issue a printed pass.

### Playbook C: Tablet Battery Depletion / Device Swap
*Symptoms:* Battery dying; need to switch to spare tablet.
1. Before turning off dying tablet, check the header counter: **"Offline Buffer: X scans queued"**.
2. If `X > 0`, tether tablet to a supervisor phone hotspot for 15 seconds until buffer reaches `0`.
3. Power on spare tablet, open `/scan/:pointId`, enter scanner token, and load manifest.
4. Place dying tablet on charging station.

### Playbook D: Capacity Reached at Room / Auditorium
*Symptoms:* Red screen displaying: *"ظرفیت سالن تکمیل است (CAPACITY_REACHED)"*.
1. **Action:** Hold the queue. Inform waiting attendees that the room has reached maximum licensed seating capacity.
2. **Supervisor Action:** If attendees leave through exit doors, adjust capacity count in Organizer Console or await automatic departures.

---

## 4. End-of-Day Closeout Procedure

1. **Verify All Queues Flushed:** Inspect every scanner tablet; ensure `Offline Buffer: 0 scans queued` across all gates.
2. **Review Conflicts:** Open Conflict Review Drawer on each device; review any server collisions and click *"Acknowledge Conflict ✓"*.
3. **Unpair Devices:** Click *"Disconnect Device"* on all tablets to invalidate temporary local sessions.
4. **Export Final Records:**
   - From Organizer Console: Download `attendance.csv` (contains full audit trail of all scans, UTC timestamps, and rejection reasons).
   - From Exhibitor Portal: Ensure exhibitors export their lead CSV files.
5. **Database Archive:** Run post-event PostgreSQL dump and retain cold backup.
