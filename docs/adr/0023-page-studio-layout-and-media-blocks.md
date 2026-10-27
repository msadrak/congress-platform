# 0023: Page Studio Layout and Media Blocks

**Status:** Accepted (2026-10-27). Implemented on `feature/page-studio-layout-media`: `backend/app/page_document.py`,
`web/src/lib/{pageDocument,pageLinks,markdownLite,markdownEdit,eventAccent}.ts`, `web/src/components/public/page/`,
`web/src/components/organizer/studio/`, `deploy/staging/Caddyfile` (CSP `frame-src`).

## Context
Organizers designing a congress home page could not arrange text in columns, change its size, colour or direction,
embed a video, show several images (photos, sponsors), or link to their channels (Telegram, Instagram, Eitaa, Bale …).
The page is a typed document (Milestone 08, `docs/product/PAGE_STUDIO_MILESTONE_RESULT.md`): every section is a
curated component, text is plain or Markdown-lite, and no HTML, CSS or script is stored. That guarantee keeps the page
safe and legible and must survive the new freedom.

## Decision
1. **More curated section types, not free markup.** `columns` (2–4 texts, equal or one wider, plain or cards, each with an
   optional icon, image and link button), `video`, `gallery` (photos or a logo wall, items optionally linked) and
   `links` (community, channel and contact links). The call to action can also open a link (`target: "url"`).
2. **A section style on every section**, as tokens: `background` none/subtle/accent/ink, `width` normal/narrow,
   `align` start/center, `text_size` sm/md/lg, `direction` auto/rtl/ltr. The ink band re-declares the Tailwind colour
   tokens for its subtree, so every block works on it unchanged. Passes, exhibitors and the call to action keep their
   own look (no band).
3. **Direction per paragraph.** Prose blocks read in the script most of their letters use (an English sentence naming a
   Persian speaker stays left-to-right); `direction` forces one for the whole section.
4. **Markdown-lite grows** (headings, numbered lists, quotes, dividers, `*italic*`, `==highlight==`, mailto/tel links)
   and the studio writes it through a toolbar (Ctrl/Cmd+B, I, K), so organizers never type syntax. Still parsed to data
   and rendered as React text.
5. **Videos are stored as provider + id.** The studio parses any YouTube/Aparat address; the server checks the id
   pattern; the page builds the embed address itself (`youtube-nocookie.com`, Aparat's embed page) and loads the player
   only when the visitor presses play, behind an organizer poster or an accent artwork. A link to the video's own page
   stays for networks that block the player (YouTube is filtered in Iran; the studio says so and suggests Aparat). The
   iframe is sandboxed (no top navigation) and sends `strict-origin-when-cross-origin` referrers, which YouTube requires.
   CSP `frame-src` allows exactly those two hosts; images stay `'self'` (posters come from the media library).
6. **Links are checked twice.** The studio normalises what organizers type (`t.me/x`, an e-mail address, a phone number
   in Persian digits) and guesses the kind from the host; the server accepts only http(s) with a host, `mailto:` an
   address, or `tel:` a number. An invalid link is never stored, so it can never fail a save.
7. **One custom accent colour.** `branding.accent: "custom"` with `accent_color`; the server refuses a colour below 4.5:1
   on white, and the studio darkens a light pick just enough and says so. `eventAccentStyle` now also sets the Tailwind
   `--color-event-accent*` tokens: `@theme` resolves them once at the root, so before this change an organizer's accent
   (curated or not) never reached `text-event-accent` / `bg-event-accent-soft`.

## Consequences
- All additions have defaults, so every stored draft and published page stays valid; no migration.
- **Rollback:** an older release cannot read a page that uses a new section type, style or custom accent (its document
  model rejects unknown fields). After organizers have used them, roll forward rather than back, or expect those pages
  to fail to load until the release returns.
- Images used by columns, galleries and video posters are part of `asset_ids()`: published with the page, and protected
  from deletion while in use.
- Adding a provider means a new id pattern (server and `pageLinks.ts`), an embed address, and a CSP `frame-src` entry.
