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
   - Exhibitor badge scans yield full business card disclosure (Name, Organization, Title, Email).
   - Peer-to-peer badge scans yield professional details (Name, Organization, Title) with opt-in email sharing.

## Consequences
- No new barcode formats or scanner hardware required; all interactions run on the same 128-bit CSPRNG `EntityQR` tokens.
- Exhibitors get immediate value through self-service CSV lead exports.
