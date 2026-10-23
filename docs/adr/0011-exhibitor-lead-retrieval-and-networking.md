# 0011: Unified Exhibition Lead Retrieval and Attendee Networking

## Context
Following registration and attendance tracking, congresses require two interaction surfaces:
1. Exhibitors paying for booths need to capture qualified sales leads by scanning visitor badges.
2. Attendees want to exchange contact cards with peers and save exhibition booth materials digitally without carrying physical paper brochures.

## Decision
We leverage the polymorphic `EntityQR` engine established in ADR-0008 across both engagement surfaces:
1. **Symmetric Entity QR Resolution:**
   - **Exhibitor scans Attendee:** Resolves attendee identity, creates an enriched `Lead` record with notes, rating (Hot/Warm/Cold), and tags, and exports to CSV.
   - **Attendee scans Booth QR:** Resolves booth identity, opens the company profile with brochure download links, and bookmarks into "My Visited Booths".
   - **Attendee scans Attendee:** Resolves peer identity, creates a `Connection` record in "My Network", and offers an instant vCard (`.vcf`) download.
2. **Privacy & Disclosure Boundaries:**
   - Exhibitor badge scans yield full business card disclosure (Name, Organization, Title, Mobile).
   - Peer-to-peer badge scans yield professional details (Name, Organization, Title) with opt-in mobile number sharing.
   - (Amended by ADR 0012: the contact detail is the mobile number; e-mail no longer exists.)

## Consequences
- No new barcode formats or scanner hardware required; all interactions run on the same 128-bit CSPRNG `EntityQR` tokens.
- Exhibitors get immediate value through self-service CSV lead exports.

## Status / Implementation notes (2026-10-23)

The three scan surfaces exist as described; the disclosure rule for exhibitors changed.

- **Exhibitor contact needs consent (supersedes "full business card disclosure" in point 2):** a lead shows the
  attendee's mobile only when the attendee turned on `users.share_contact_with_exhibitors` (migration `0023`, default
  **off**, editable in the attendee profile). Without it the lead carries name, organization and title only, in the
  booth portal, the lead search and the CSV export (`backend/app/routes/leads.py`); search by mobile digits matches
  only consenting attendees.
- **Leads:** captured by booth staff (`POST /api/booths/{booth_id}/leads/scan`), rated HOT/WARM/COLD (a database CHECK
  since migration `0021`), soft-deleted and restored (`leads.deleted_at`, migration `0027`; scanning the attendee again
  restores the lead), searchable with cursor paging, exported as CSV (optionally including deleted leads).
  `leads.event_id` is NOT NULL with same-event foreign keys to the booth and the ticket (ADR 0018). Every lead export is
  written to the congress organizer's audit log (ADR 0016).
- **Booth staff:** added by mobile number and invited by SMS (`staff_invite`); removing a staff member deletes the
  assignment, and leads keep who captured them.
- **Attendee scans a booth:** the booth standee QR opens the booth page and saves a bookmark in one tap. Bookmarks and
  peer networking require an **active ticket for that congress** (`require_active_ticket`, `backend/app/routes/booths.py`).
- **Attendee scans an attendee:** creates a Connection in My Network with private notes; the mobile is shared only with
  the peer's own consent (`share_contact_with_peers`, migration `0010`); the vCard escapes every value. Network scans
  are throttled per user (120 scans and 20 failed scans per 15 minutes, `backend/app/routes/network.py`).
- An exhibitor portal rework (server-side search, trash with undo, offline lead queue) is in the unmerged
  `ws/b6b-exhibitor` branch.
