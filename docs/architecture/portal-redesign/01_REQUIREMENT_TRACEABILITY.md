# 01 — Requirement Traceability (CR-01 … CR-11)

| CR | Current capability (verified) | Decisions | Proposed contracts | Required work | Verification criteria |
|---|---|---|---|---|---|
| **CR-01** Public congress landing | `/` platform landing; `/e/:slug` full public congress page + registration (`public.py`) | — | Preserve `/e/:slug` byte-identical | Product decision: whether `/` becomes congress-branded; likely content work only | Public page renders unauthenticated (e2e) |
| **CR-02** Four experiences | All four exist as pages (Organizer console, attendee pages, desk, exhibitor) but without portal identity | D01, D08, D09 | Four portal shells with explicit AuthContext | T3–T4 migration steps | Each portal loads with its own credential; cross-portal 401/403 tests |
| **CR-03** Role-based portal access | Row-presence roles + server authorizers | D02, D09 | `GET /api/me/access` + portal chooser | T1 + chooser UI | S1–S9 scenario tests |
| **CR-04** Clear & secure auth | Five verified mechanisms; heuristic client selection is the weak point | D03, D04 | Explicit credential contract; unified login UX (one screen, credential-type aware) | T3 | Negative scenarios 1–14; no credential cross-attachment test |
| **CR-05** Organizer-managed reception | Implemented (uncommitted): DeskOperator CRUD/revoke, event-locked JWT, attribution | D05 | Preserve implementation; integrate via T0 | T0 (human-approved git integration) | `test_desk_operator_auth.py`, `test_desk_registration.py`, `test_management_lifecycle.py` green |
| **CR-06** Configurable attendee types | Absent | D07 | `AttendeeType` entity + `Ticket.attendee_type_id`; organizer CRUD; assignment at self/desk registration | T2 | Six integrity tests in `01_DOMAIN_MODEL.md` §5 |
| **CR-07** Mobile-first shallow tab nav | Mobile evidence exists; flat routes; only 2 layouts | D08 | Portal shells with tab bars; max 1 level below tab | T4–T5 | 390px screenshot suite per portal |
| **CR-08** Attendee 5 tabs | My Network ✅, My Ticket ✅; Congress Details = PublicEvent content ✅; My Profile = `/api/auth/me` read-only; My Congress missing | D08 | Attendee portal shell: My Congress / My Network / My Ticket / My Profile / Congress Details | T5 (+ optional `PATCH /api/auth/me`) | Five tabs render; offline ticket works inside tab; S7 picker |
| **CR-09** Partner listing in My Congress | Public booth list exists; bookmarks exist | D06 | `Partner` entity + `GET /api/public/events/{slug}/partners`; My Congress consumes | T2, T6 | Partner list includes boothless partners; booth partners unchanged |
| **CR-10** Avoid nested navigation | Flat URL space today; but 3 monolithic pages hide depth in-component | D08, D10 | Decompose OrganizerEventDetail (5 domains) into portal sections; tab shells | T4–T5 | Max nav depth ≤ 2; page-size budget enforced at review |
| **CR-11** Preserve existing capabilities | 131 backend + 28 web tests green; workflows §8 of baseline | D10 | No contract breakage; URL preservation; no QR regeneration | All steps | Full suite green after every transition; Playwright scanner specs pass |

## Gates Self-Review

- **Gate A (Correctness):** no invented mechanisms; identity/role/type/tier separated; event- and partner-scoped permissions addressed. PASS.
- **Gate B (Security):** revocation server-side (desk/scanner); reception cannot self-grant (matrix #3, #12); partner isolation preserved (booth-keyed authorizer reused); scanner creds separate; explicit frontend credential contract; QR secrets untouched. PASS.
- **Gate C (Migration safety):** no ticket regeneration; compatibility strategy per contract; desk work preserved via T0; scanner untouched; additive migrations only. PASS.
- **Gate D (Product):** four portals + public; multi-role chooser; multi-event picker; configurable types; partner categories; five-tab support. PASS.
- **Gate E (Documentation):** D01–D10 explicit; matrix complete (25 permissions, 14 negative tests); uncertainties marked **[OPEN]**/**[ASSUME]**; diagrams consistent; migration steps identifiable; no implementation performed; git state preserved (`git status` unchanged since phase start — verified at start of this phase: same 14 modified + untracked set). PASS.
