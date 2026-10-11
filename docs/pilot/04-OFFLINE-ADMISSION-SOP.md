# 04 — Standard Operating Procedure (SOP): Gate Check-In & Offline Admission

**Audience:** Gate Operators, Room Monitors, Front Desk Staff, Venue Supervisors  
**Evaluation Date:** 2026-10-11  
**Operational Target:** Zero Physical Unauthorized Entry / Zero Panic Under Outages  
**Classification:** APPROVED OPERATIONAL SPECIFICATION  

---

## 1. Quick Reference: Visual & Auditory Feedback Card

Gate staff must react based on screen color, icon, and chime tone:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 🟢 GREEN — CONFIRMED ADMITTED (ورود مجاز و تایید شده)                 │
│ Icon: ✓ Checkmark | Sound: High double-chime                           │
│ Physical Action: ALLOW ATTENDEE TO ENTER IMMEDIATELY.                  │
│ Meaning: Central database has authoritatively recorded admission.      │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 🟡 AMBER — PROVISIONAL OFFLINE (پذیرش مشروط آفلاین)                    │
│ Icon: ⏳ Clock | Sound: Mid-tone chime                                 │
│ Physical Action:                                                       │
│ - General Gates (Main Entrance / Lunch): ALLOW ATTENDEE TO ENTER.     │
│ - Capacity Gates (Auditorium / Capped Halls): HOLD ATTENDEE!           │
│ Meaning: Valid in local cache; recorded on tablet; pending server sync.│
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 🔴 RED — ADMISSION REJECTED (ورود غیرمجاز - رد شد)                     │
│ Icon: ✕ Cross | Sound: Low error buzz                                  │
│ Physical Action: DO NOT ADMIT. DIRECT ATTENDEE PER REASON BELOW.       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Rejection Reasons & Staff Action Guide

| Screen Error Message (فارسی / English) | Underlying Root Cause | Required Gate Staff Action |
|:---|:---|:---|
| **بلیط قبلاً مصرف شده است (ورود تکراری)**<br>`ALREADY_ADMITTED` | The ticket was already used at this single-entry gate (e.g. lunch catering). | **Deny Entry.** Inform attendee: *"این کارت قبلاً برای این بخش ثبت ورود شده است."* If disputed, direct to Front Desk. |
| **ظرفیت سالن تکمیل است**<br>`CAPACITY_REACHED` | The maximum authorized seating capacity for this room has been reached. | **Deny Entry.** Inform attendee: *"ظرفیت سالن تکمیل است؛ لطفاً تا خروج سایر حاضرین منتظر بمانید."* |
| **کنترل ظرفیت در حالت آفلاین مسدود است**<br>`CAPACITY_UNAVAILABLE_OFFLINE` | The gate is offline and cannot guarantee global room capacity across multiple doors. | **Hold Queue.** Call Gate Supervisor to verify physical chairs available before manual override. |
| **رده بلیط مجاز به ورود از این گیت نیست**<br>`TIER_NOT_ALLOWED` | Attendee holds a General ticket attempting entry to a VIP/Faculty hall. | **Deny Entry.** Inform attendee: *"این کارت مجاز به ورود به این بخش اختصاصی نیست."* Direct to general seating. |
| **کد در حافظه آفلاین گیت یافت نشد**<br>`NOT_IN_LOCAL_MANIFEST` | Attendee registered very recently while the scanner tablet was disconnected. | **Do Not Accuse of Forgery.** Inform attendee: *"اطلاعات شما در حافظه آفلاین این گیت ثبت نشده است؛ لطفاً جهت استعلام به میز پذیرش مراجعه نمایید."* |
| **کیوآرکد نامعتبر است**<br>`INVALID_TICKET` | Code is unreadable, corrupted, or from another congress platform. | **Deny Entry.** Direct attendee to Front Desk for badge replacement. |

---

## 3. Strict Capacity Policy for `CAPACITY_CAPPED` Gates

*Safety Notice:* For auditoriums, workshops, and halls with strict fire-code limits:
1. **Default Fail-Closed Rule:** If internet connection is lost, the gate scanner **automatically blocks admissions** with `CAPACITY_UNAVAILABLE_OFFLINE`.
2. **Rationale:** A disconnected Door A cannot know how many people entered through Door B. Allowing automatic entry risks severe overcrowding and fire safety violations.
3. **Emergency Supervisor Override Procedure:**
   - Step 1: Gate supervisor confers by two-way radio with the room monitor inside the hall.
   - Step 2: Room monitor physically confirms empty seats exist (e.g. *"50 seats remaining"*).
   - Step 3: Supervisor authorizes gate staff to admit attendees provisionally up to the verbally confirmed seat count.

---

## 4. End-of-Shift Conflict Resolution

At the conclusion of each event session:
1. Reconnect all scanner tablets to Wi-Fi.
2. Observe the **"Offline Buffer: X scans queued"** indicator decrease to `0`.
3. If the amber **"Reconciliation Conflicts"** drawer expands:
   - Review each listed scan (indicates an attendee admitted provisionally who was rejected by the server, e.g. duplicate badge used at another gate).
   - Note the attendee name and ticket ID in the incident log.
   - Click *"Acknowledge Conflict ✓"* to clear the operator warning.
   - The permanent record remains preserved in the central audit database.
