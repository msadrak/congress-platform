# Independent Congress Platform

A scalable event management platform for organizing, ticketing, and operating large-scale congresses, conferences, and conventions.

## Language

**Event**:
A scheduled congress, conference, or convention managed on the platform.
_Avoid_: Company, show, meeting

**Organizer**:
An organization or administrative body that owns, configures, and manages one or more events.
_Avoid_: Admin, host, client

**Organizer Member**:
A User who signs in to one Organizer's console with their own mobile number and a Role, instead of sharing the Organizer's API key (ADR 0016). The API key remains, for integrations, and acts as an owner.
_Avoid_: Admin, staff account, sub-user

**Role**:
What an Organizer Member may do in the console: owner (everything, including members), manager (setup, participants, exports, activity), staff (reception, scanners, participant lookup) or viewer (setup and aggregate analytics, no personal data). One table on the server decides it for every organizer route (ADR 0016).
_Avoid_: Permission level, access level

**Audit log**:
The append-only record of who did what for an Organizer: console changes, desk operator actions, export downloads and the platform admin's actions on the Organizer (ADR 0016). Shown to managers and owners as Activity.
_Avoid_: History, changelog

**User**:
An authenticated account on the platform identified by an Iranian mobile number, proven by a one-time SMS code (ADR 0012).
_Avoid_: Member (except Organizer Member), login, profile, account

**Buyer**:
_Not implemented (see ADR 0003 status)._ A User who would place an Order for tickets and allocate them to others. Today every ticket is reserved by, and bound to, the User who holds it; there is no buyer separate from the attendee.
_Avoid_: Customer, purchaser

**Attendee**:
An individual person with an authenticated User account who holds an activated Ticket and attends the event.
_Avoid_: Customer, guest; Participant except for the organizer's register (see Participant)

**Order**:
_Not implemented (see ADR 0003 status)._ A transaction that would reserve one or more free tickets for an event. Today a reservation creates exactly one Ticket for the signed-in User (one per User per event); there is no order record.
_Avoid_: Purchase, payment, cart

**Claim Link**:
_Not implemented (see ADR 0003 and ADR 0005 status)._ A secure one-time link through which a Buyer's ticket would be claimed by its attendee. Not to be confused with the Short link, which opens an existing ticket's pass.
_Avoid_: Invite link, transfer link

**Ticket**:
A digital entitlement issued to an attendee granting admission to an event or specific sessions.
_Avoid_: voucher, registration (when referring to the ticket). In English domain text and code, keep Ticket (the record) and pass (what the attendee shows: QR, holder, tier) apart. The Persian UI does not: it calls the reserved ticket and its pass both «کارت ورود» (see Persian UI terms).

**Ticket Tier**:
A free admission category of an event with a quota (`ticket_tiers`), optionally with its own sales window; every Ticket belongs to one.
_Avoid_: Ticket type, class, category (in the domain model)

**Self-Registration**:
The online process where a prospective attendee registers their own account and receives a ticket.
_Avoid_: Public registration, web signup

**Participant**:
One registration (Ticket) of an event as the organizer's register lists it: the ticket holder together with the registration's own copy of their name, organization and title (`tickets.attendee_*`), which the organizer can correct without touching the person's User account; the mobile number stays on the account. Managed on the organizer's Participants page (edit, cancel, reissue, transfer, export, delete a mistaken registration; ADR 0017, merged on `integration/upgrade`, not yet on `main`). Use only for the organizer's register and its exports; elsewhere the person is an Attendee.
_Avoid_: Registrant, delegate, guest

**Desk Registration**:
The on-site process where front-desk staff registers an attendee in person and issues their ticket.
_Avoid_: Walk-in registration, manual entry, admin signup

**Entity QR**:
A unique, secure identifier and QR payload that can be bound to any platform entity (Attendee, Booth, Hall, Session).
_Avoid_: Barcode, token, QR code (when referring to the domain concept rather than the visual image)

**Short link**:
The short address (`/t/{code}`, ADR 0015) in a ticket confirmation SMS. Its 10-character code belongs to one Ticket, expires 30 days after the event, and can be revoked; opening it shows that ticket's Link pass.
_Avoid_: Claim Link, magic link, URL shortener

**Link pass**:
The read-only view of a ticket's pass (QR, holder, tier, status) opened from a Short link without a sign-in code, kept on the device until the link expires (ADR 0015). It grants nothing else: networking and the profile still need a sign-in.
_Avoid_: Guest ticket, anonymous ticket

**Check-In Point**:
A designated physical station or gate (Hall, Booth, Dining/Catering, Main Entrance) that scans QR codes and evaluates an Admission Policy.
_Avoid_: Gate, turnstile, scanner, checkpoint

**Admission Policy**:
A configurable rule set enforced at a Check-In Point (such as single-scan for catering, multi-entry, or capacity limit).
_Avoid_: Gate rule, scan constraint, access limit

**Check-In**:
The verified admission event of an attendee at a Check-In Point.
_Avoid_: Entry, scan (as an entity), arrival

**Admission Window**:
The span within which a single-use Check-In Point admits a ticket once: the whole event, or each calendar day in the event's time zone (e.g. one lunch per day). Every Check-In records the window it fell in (ADR 0010).
_Avoid_: Meal slot, service period

**Occupancy**:
The people inside a Check-In Point that records entries and exits: per ticket, the latest accepted entry or exit decides. A capped point with occupancy caps the people inside, not the cumulative admissions (ADR 0010).
_Avoid_: Current admissions, headcount (for cumulative admissions)

**Session Door**:
A Check-In Point linked to a programme session; its admissions are the session's attendance (ADR 0004).
_Avoid_: Hall scanner

**Exhibitor**:
A commercial organization, company, or sponsor presenting products and services at an event from one or more Booths. In the planned Partner model, an Exhibitor is the kind of Partner that operates Booths.
_Avoid_: Vendor, seller; Partner when the Booth-operating organization is meant

**Partner**:
_Planned, not implemented (portal redesign D06, FINDING-05)._ A commercial or institutional organization affiliated with an event (exhibitor, sponsor, institutional or scientific partner), possibly without a Booth. Today only Exhibitors with Booths exist: the access API's `PARTNER` role means Booth staff, and its `partner_ids` list is always empty.
_Avoid_: Vendor, supplier

**Booth**:
A physical exhibition stall or space assigned to an Exhibitor, represented by an Entity QR code.
_Avoid_: Stall, stand, station

**Lead**:
A commercial contact record generated when an Exhibitor scans an Attendee's Entity QR, enriched with qualifiers and notes.
_Avoid_: Contact (in commercial context), prospect, scan record

**Connection**:
A mutual networking contact established when one Attendee scans another Attendee's Entity QR badge.
_Avoid_: Friend, peer, lead (in personal context)

**Digital Brochure**:
Informational documents, links, and resources published on an Exhibitor's Booth page.
_Avoid_: Flyer, PDF, marketing material

**Badge**:
The physical identification credential printed for an attendee upon on-site check-in.
_Avoid_: Tag, card, nameplate

**Session**:
A scheduled presentation, keynote, workshop, panel, or class in an event's program, with a start and end time, optionally held in a Hall and labelled with a Track (ADR 0014).
_Avoid_: Lecture, talk, meeting

**Track**:
The category label of a session (for example "Seminar", "Workshop", "Exhibition") that attendees filter the program by; a free-text label, not a place.
_Avoid_: Stream, channel

**Hall**:
A room or space of the venue where sessions are held, listed in the event's venue directory with directions for attendees. Informational only; a Hall that scans tickets also needs its own Check-In Point.
_Avoid_: Room (in the domain model), auditorium, stage

**Entrance**:
A way into the venue listed in the event's venue directory with directions for attendees. Informational only; the gate that scans tickets there is a Check-In Point.
_Avoid_: Gate (when meaning the place), door, entry

**Coded error**:
An API error that carries a stable machine-readable `code` (for example `TIER_SOLD_OUT`, `LINK_EXPIRED`) next to its English `detail`; clients decide on the code and show a localized message, never the English text (`docs/CODING_STANDARDS.md` §2.F).
_Avoid_: Error string, error message (when the code is meant)

## Persian UI terms

Decided by the product owner (2026-10-23). Use them in every Persian string of the app, in SMS wording and in Persian
documentation. `web/tests/glossary.test.ts` guards the spellings it can check mechanically.

| Concept | Persian in the UI | Avoid |
|---|---|---|
| Ticket Tier | «نوع کارت ورود» (plural «انواع کارت ورود») | «رده» |
| Ticket and its pass, as the attendee sees them | «کارت ورود», for both the reserved ticket and the pass that shows its QR. «بلیت» only where "ticket" is unavoidable | «بلیط» (misspelling, never) |
| Session | «جلسه» | «نشست» |
| Check-In Point | «نقطه ورود» | «گیت»، «گیت بازرسی» |
| QR code | «کد QR» | a transliteration of "QR" |
| Walk-in (Desk Registration) | «ثبت‌نام حضوری» | |
