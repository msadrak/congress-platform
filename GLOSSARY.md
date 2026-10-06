# Independent Congress Platform

A scalable event management platform for organizing, ticketing, and operating large-scale congresses, conferences, and conventions.

## Language

**Event**:
A scheduled congress, conference, or convention managed on the platform.
_Avoid_: Company, show, meeting

**Organizer**:
An organization or administrative body that owns, configures, and manages one or more events.
_Avoid_: Admin, host, client

**User**:
An authenticated account on the platform identified by an email address and credentials.
_Avoid_: Member, login, profile, account

**Buyer**:
A User who places an Order for tickets and manages ticket allocations.
_Avoid_: Customer, purchaser

**Attendee**:
An individual person with an authenticated User account who holds an activated Ticket and attends the event.
_Avoid_: Participant, customer, guest

**Order**:
A transaction reserving one or more free tickets for an event.
_Avoid_: Purchase, payment, cart

**Ticket**:
A digital entitlement issued to an attendee granting admission to an event or specific sessions.
_Avoid_: Pass, voucher, registration (when referring to the ticket)

**Self-Registration**:
The online process where a prospective attendee registers their own account and receives a ticket.
_Avoid_: Public registration, web signup

**Desk Registration**:
The on-site process where front-desk staff registers an attendee in person and issues their ticket.
_Avoid_: Walk-in registration, manual entry, admin signup

**Entity QR**:
A unique, secure identifier and QR payload that can be bound to any platform entity (Attendee, Booth, Hall, Session).
_Avoid_: Barcode, token, QR code (when referring to the domain concept rather than the visual image)

**Check-In Point**:
A designated physical station or gate (Hall, Booth, Dining/Catering, Main Entrance) that scans QR codes and evaluates an Admission Policy.
_Avoid_: Gate, turnstile, scanner, checkpoint

**Admission Policy**:
A configurable rule set enforced at a Check-In Point (such as single-scan for catering, multi-entry, or capacity limit).
_Avoid_: Gate rule, scan constraint, access limit

**Check-In**:
The verified admission event of an attendee at a Check-In Point.
_Avoid_: Entry, scan (as an entity), arrival

**Badge**:
The physical identification credential printed for an attendee upon on-site check-in.
_Avoid_: Tag, card, nameplate

**Session**:
A scheduled presentation, keynote, workshop, or panel occurring within an event track and hall.
_Avoid_: Lecture, talk, meeting

**Track**:
A thematic or physical grouping of sessions across halls and schedules.
_Avoid_: Stream, channel
