# 01 — Supported Pilot Scope & Release Boundaries

**Evaluation Date:** 2026-10-11  
**Release Tag:** `v1.0.0-pilot.1`  
**Deployment Target:** Controlled On-Premise / Single-Event Browser Pilot  
**Classification:** VERIFIED & BOUNDED  

---

## 1. Executive Summary

This document defines the strict, versioned functional boundaries for the initial **Congress Management Platform Controlled Pilot**. To prevent scope creep and eliminate release-blocking risks, the pilot is explicitly bounded to a **browser-first, web-native deployment**.

Advanced cross-platform extensions that remain under development are explicitly marked as **EXCLUDED FROM PILOT** and do not block pilot execution for the planned venue.

---

## 2. Release Capability Matrix

| Capability Area | Component / Endpoint | Pilot Status | Justification / Prerequisites |
|:---|:---|:---|:---|
| **Public Event Discovery** | `/`, `/e/:slug` | **INCLUDED (SUPPORTED)** | Fully tested; responsive across 360–1440px; free ticket reservation supported. |
| **Exhibition Showcase** | `/e/:slug/booths/:id` | **INCLUDED (SUPPORTED)** | Public profiles, digital brochure links, and attendee bookmarking verified. |
| **Attendee Pass Portal** | `/my-tickets` | **INCLUDED (SUPPORTED)** | High-contrast SVG QR pass with quiet zone; user-scoped offline caching in `localStorage`. |
| **Attendee Networking** | `/my-network` | **INCLUDED (SUPPORTED)** | Peer camera badge scanning; privacy toggle (`share_contact_with_peers`); RFC-compliant `.vcf` export. |
| **Organizer Console** | `/organizer`, `/organizer/events/:id` | **INCLUDED (SUPPORTED)** | Multi-event listing; tier quotas; check-in point creation; booth assignment. |
| **Real-Time Analytics** | `/organizer/events/:id/analytics` | **INCLUDED (SUPPORTED)** | Attendance KPIs; gate throughput breakdown; hardened CSV export with UTF-8 BOM. |
| **Exhibitor Lead Portal** | `/booth/:boothId` | **INCLUDED (SUPPORTED)** | Web camera scanner; lead qualification drawer (HOT/WARM/COLD); CRM CSV export. |
| **Front Desk Station** | `/organizer/events/:id/desk` | **INCLUDED (SUPPORTED)** | 200ms debounced live attendee lookup; rapid walk-in ticket minting; print badge modal. |
| **Web Gate Scanner** | `/scan/:pointId` | **INCLUDED (SUPPORTED)** | High-Contrast Operational Mode; 5 operational zones; multi-modal input; audio/visual feedback. |
| **Offline Cold-Start PWA** | Service Worker boot | **EXCLUDED (Issue #25)** | Requires initial online session to load application shell and ticket manifest into IndexedDB. |
| **Native Flutter Scanner** | iOS / Android App | **EXCLUDED (Issue #22)** | Native ML Kit camera platform channels remain under development; web scanner is canonical. |
| **Unrestricted Offline Capacity** | `CAPACITY_CAPPED` Gates | **EXCLUDED (RESTRICTED)** | Disconnected gates cannot guarantee global room capacity; defaults to fail-closed without override. |
| **Paid Ticket Transactions** | Payment Gateway Seam | **EXCLUDED (FUTURE)** | System explicitly designed for free congress registration and walk-in accreditation. |

---

## 3. Operational Pilot Constraints

For the controlled pilot, the following operational constraints are binding:
1. **Pilot Sizing Envelope:** Maximum 1,000 registered attendees, 10 active check-in points, and 50 exhibition booths.
2. **Network Environment:** The venue operations team must provide an initial Wi-Fi or cellular hotspot connection at station startup to pair scanner tablets and download the ticket manifest snapshot.
3. **Hardware Platform:** Web scanner stations run on standard modern evergreen browsers (Google Chrome on Android/Windows, Safari on iPadOS).
4. **Physical Entry Policy:** Nontechnical gate operators must adhere strictly to the Standard Operating Procedure (SOP) outlined in `docs/pilot/04-OFFLINE-ADMISSION-SOP.md`.
