# Specification: Milestone V2 — Exhibition Lead Retrieval & Attendee Networking

## Problem Statement

At commercial congresses and conferences, physical networking and exhibition booth interactions are burdened by outdated, high-friction paper mechanisms:

1. **Exhibitor Lead Inefficiency:** Companies invest thousands of dollars in booth sponsorships but struggle to capture visitor contacts accurately. Staff collect paper business cards, manually type notes into spreadsheets after the event, or lose critical follow-up context (e.g., whether a prospect needs a quote or a demo).
2. **Paper Brochure Waste:** Attendees carry heavy paper flyers, brochures, and catalogs that are easily lost, discarded, or damaged during travel.
3. **Friction in Peer Networking:** Conference delegates struggle to exchange contact information quickly. Exchanging physical cards or manually typing phone numbers and emails into mobile phones causes social friction, leading to missed professional connections.

## Solution

An integrated **Exhibition Lead Retrieval and Attendee Networking Suite** built on our existing polymorphic **Entity QR** architecture (`FastAPI` backend, `React` web portals, and native `vCard` export):

1. **Exhibitor Booth Lead Retrieval (`/booth/:boothId`):**
   - Organizers provision booths with company profile, stand location, and digital brochure links.
   - The system automatically mints a unique `EntityQR` for each booth.
   - Authorized booth representatives scan visitor badges via mobile camera or USB barcode scanner to capture leads instantly.
   - Leads are enriched with **Interest Rating** (`HOT`, `WARM`, `COLD`), **Follow-up Action Tags** (*"Send Quote"*, *"Schedule Demo"*, *"Send Sample"*, *"General Inquiry"*), and freeform notes.
   - One-click CSV export downloads the complete qualified lead database for CRM import.

2. **Digital Booth Brochures & Bookmarks (`/e/:slug/booths/:boothId`):**
   - Attendees scanning a booth's standee QR code open an optimized company profile.
   - One-tap view or download of the company's digital brochure and product links.
   - One-tap **"Bookmark Booth"** saves the company into the attendee's personal *"My Visited Booths"* list.

3. **Peer-to-Peer Networking & Native Phone Contact Export (`/my-network`):**
   - Attendees scan fellow delegates' personal QR badges to create mutual peer connections.
   - Add private personal notes to each connection (e.g. *"Met during keynote panel"*).
   - Instant one-tap **"Add to Phone Contacts" (`.vcf` vCard)** downloads the contact card directly into the native iOS / Android address book.
   - Privacy-guarded: Public badge scan reveals Name, Organization, and Title; direct email/phone disclosure is opt-in.

---

## User Stories

1. As an event organizer, I want to create and configure exhibition booths under an event with company name, booth number/location, description, website, and digital brochure URL, so that commercial sponsors are set up in the system.
2. As an event organizer, I want each created booth to automatically receive a unique Entity QR code, so that I can print standees and banners for attendees to scan on-site.
3. As an event organizer, I want to assign authorized booth representatives by email, so that company staff have secure access to their dedicated booth portal.
4. As an event organizer, I want booth representatives from Company A to be strictly isolated from Company B, so that commercial lead data remains confidential.
5. As an exhibitor representative, I want to log in and access my company's dedicated Booth Lead Portal (`/booth/:boothId`), so that I can manage our exhibition operations on any phone, tablet, or laptop.
6. As an exhibitor representative, I want to scan visitor attendee badges using my device camera or a USB barcode scanner, so that I can capture leads in under 1 second.
7. As an exhibitor representative, I want scanning a badge to immediately display the attendee's full contact card (Name, Organization, Title, Email), so that I know who I am speaking with.
8. As an exhibitor representative, I want to assign an Interest Rating (`HOT`, `WARM`, `COLD`) to each captured lead, so that our sales team can prioritize follow-ups.
9. As an exhibitor representative, I want to assign Follow-Up Action Tags (e.g. *"Send Quote"*, *"Schedule Demo"*, *"Product Sample"*, *"General Inquiry"*), so that next steps are clearly defined.
10. As an exhibitor representative, I want to add and edit freeform qualification notes for each captured lead, so that important details from our conversation are preserved.
11. As an exhibitor representative, I want to view our booth's live lead feed and search leads by attendee name or rating, so that our booth staff can coordinate during the event.
12. As an exhibitor representative, I want to download a complete CSV export of all captured leads with contact info, ratings, tags, and notes with one click, so that we can import them directly into our CRM.
13. As an attendee, I want to scan an exhibitor's booth standee QR code, so that I can open their digital company profile without typing URLs.
14. As an attendee, I want to view an exhibitor's company description, products, booth location, and website, so that I can review their offerings paperlessly.
15. As an attendee, I want to view or download the exhibitor's digital brochure with a single tap, so that I have their promotional materials saved on my mobile device.
16. As an attendee, I want to bookmark visited booths into my personal "My Visited Booths" list, so that I have an organized record of companies I spoke with.
17. As an attendee, I want to view all my bookmarked booths in my attendee portal at any time, so that I can follow up after the conference.
18. As an attendee, I want to scan a fellow delegate's personal QR badge, so that we can connect professionally without physical paper business cards.
19. As an attendee, I want to view a peer's professional profile (Name, Title, Organization) immediately upon scanning, so that I have their verified credentials.
20. As an attendee, I want to choose whether my email and phone are shared with peers, so that my personal contact information remains under my control.
21. As an attendee, I want to add private personal notes to each peer connection, so that I remember where and why we connected.
22. As an attendee, I want to view all my connections in a dedicated "My Network" list, so that I have an organized digital conference address book.
23. As an attendee, I want to download a standard `.vcf` vCard file for any peer connection with a single tap, so that their contact details are saved directly into my phone's native address book.
24. As a platform administrator, I want exhibitor lead scans and peer connections to resolve against the unified `EntityQR` registry, so that no new barcode formats or scanner hardware are required.

---

## Implementation Decisions

### 1. Data Models (`backend/app/models.py`)
- **`Booth`:**
  - `id`: UUID (PK)
  - `event_id`: UUID, FK(events.id), indexed
  - `name`: String(200)
  - `slug`: String(100), indexed
  - `location`: String(100) (e.g. "Booth B-14, Hall 2")
  - `description`: Text
  - `website_url`: String(500)
  - `brochure_url`: String(500)
  - `created_at`: DateTime(timezone=True)
- **`BoothStaff`:**
  - `id`: UUID (PK)
  - `booth_id`: UUID, FK(booths.id), indexed
  - `user_id`: UUID, FK(users.id), indexed
  - `created_at`: DateTime(timezone=True)
  - Unique constraint: `(booth_id, user_id)`
- **`Lead` (Commercial Exhibitor Lead):**
  - `id`: UUID (PK)
  - `booth_id`: UUID, FK(booths.id), indexed
  - `ticket_id`: UUID, FK(tickets.id), indexed
  - `captured_by_user_id`: UUID, FK(users.id)
  - `rating`: String(16) (`HOT`, `WARM`, `COLD`)
  - `tags`: JSON (list of string tags)
  - `notes`: Text
  - `created_at`: DateTime(timezone=True)
  - `updated_at`: DateTime(timezone=True)
  - Unique constraint: `(booth_id, ticket_id)` (subsequent scans update the existing lead rather than duplicating)
- **`BoothBookmark` (Attendee Saved Booth):**
  - `id`: UUID (PK)
  - `user_id`: UUID, FK(users.id), indexed
  - `booth_id`: UUID, FK(booths.id), indexed
  - `created_at`: DateTime(timezone=True)
  - Unique constraint: `(user_id, booth_id)`
- **`Connection` (Peer-to-Peer Networking):**
  - `id`: UUID (PK)
  - `user_id`: UUID, FK(users.id), indexed (the scanner)
  - `connected_user_id`: UUID, FK(users.id), indexed (the person scanned)
  - `event_id`: UUID, FK(events.id), indexed
  - `private_notes`: Text
  - `created_at`: DateTime(timezone=True)
  - Unique constraint: `(user_id, connected_user_id, event_id)`

### 2. Polymorphic `EntityQR` Integration
- When a `Booth` is created, the system mints an `EntityQR`:
  - `entity_type`: `"booth"`
  - `entity_id`: `booth.id`
  - `secret`: 128-bit CSPRNG Base32 token
- When scanning any QR:
  - If `entity_type == "attendee_ticket"`: resolves to `Ticket` -> `User` profile.
  - If `entity_type == "booth"`: resolves to `Booth` profile.

### 3. API Contracts (`backend/app/routes/`)
- **Booth Management (Organizer):**
  - `POST /api/events/{event_id}/booths`
  - `GET /api/events/{event_id}/booths`
  - `POST /api/booths/{booth_id}/staff` (assign staff by email)
- **Booth Lead Operations (Exhibitor Staff):**
  - `GET /api/booths/{booth_id}`
  - `POST /api/booths/{booth_id}/leads/scan` (captures lead from QR secret)
  - `GET /api/booths/{booth_id}/leads` (list & search leads)
  - `PATCH /api/booths/{booth_id}/leads/{lead_id}` (update rating, tags, notes)
  - `GET /api/booths/{booth_id}/leads/export-csv` (download lead CSV)
- **Public & Attendee Booth Interaction:**
  - `GET /api/events/{event_id}/public/booths/{booth_id}`
  - `POST /api/attendees/me/bookmarks/booths/{booth_id}`
  - `DELETE /api/attendees/me/bookmarks/booths/{booth_id}`
  - `GET /api/attendees/me/bookmarks/booths`
- **Peer Networking:**
  - `POST /api/attendees/me/network/scan` (scan peer's QR secret to connect)
  - `GET /api/attendees/me/network` (list peer connections)
  - `PATCH /api/attendees/me/network/{connection_id}` (update private note)
  - `GET /api/attendees/me/network/{connection_id}/vcard` (returns `text/vcard` download)

### 4. Frontend Views (`web/src/pages/`)
- `/booth/:boothId`: Dedicated Exhibitor Lead Portal (scanner tab, live lead list, qualification drawer, and CSV download).
- `/e/:slug/booths/:boothId`: Public Booth Profile (company overview, brochure viewer/download, bookmark toggle).
- `/my-network`: Attendee Networking Hub (peer scanner, contact cards, private notes, and one-tap `.vcf` vCard download).

---

## Testing Decisions

### Primary Testing Seams
1. **The Public REST API Seam (`httpx.AsyncClient`):**
   - Exercises end-to-end flows over the FastAPI HTTP boundary against PostgreSQL:
     - Booth provisioning and staff authorization.
     - Exhibitor lead capture from attendee QR, qualification edits (rating, tags, notes), and CSV export.
     - Commercial isolation: Booth A staff cannot read or export Booth B leads.
     - Public booth retrieval, brochure access, and bookmarking.
     - Peer-to-peer badge scanning, duplicate connection handling, and RFC-compliant vCard (`.vcf`) generation.
2. **Frontend Type Safety & Unit Tests:**
   - Strict `tsc -b` and Vite production build.
   - Native unit tests verifying vCard parsing and lead qualification state updates.

---

## Out of Scope

- Paid lead retrieval app licenses or in-app payment gates (all lead retrieval is free for authorized booth staff).
- Real-time chat or messaging between attendees (in-person networking only; digital messaging deferred to future phase).
- AI-based match-making or automated peer recommendations.

---

## Further Notes

- **vCard Standard:** The `.vcf` export follows the RFC 6350 (vCard 4.0 / 3.0 compatible) format with UTF-8 encoding:
  ```
  BEGIN:VCARD
  VERSION:3.0
  FN:Dr. Mohammad Rezaei
  ORG:Tehran University of Medical Sciences
  TITLE:Associate Professor
  EMAIL:dr.rezaei@example.com
  END:VCARD
  ```
  This imports directly with zero friction into Apple Contacts, Google Contacts, and Android Address Books.
