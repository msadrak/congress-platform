# ParsPack CDN — cache rules for Congress Platform

Configure these in the **ParsPack panel** for `congress.aiteb.app`. Turn on **Respect Origin Cache-Control** (مطابق با هدر Cache-Control مبدا).

The origin only accepts traffic from ParsPack address ranges when `cdn parspack` is applied (`CONGRESS_CDN_ONLY=on`, same idea as DrGibi's gateway). Visitors must use the CDN hostname, not the server's IP.

## Cache rules

| Path pattern | CDN action | Origin header |
|---|---|---|
| `/api/*` | **Bypass** | `Cache-Control: no-store` (set by Caddy) |
| `/organizer*`, `/platform*`, `/scan/*`, `/booth/*` | **Bypass** | SPA `no-cache` |
| `/assets/*` | Cache 1 year | `immutable` (Vite hashed bundles) |
| `/e/*` (public congress pages) | Bypass or max 60s | `no-cache` on HTML shell |
| `/`, `/index.html`, `/sw.js`, `/manifest.webmanifest` | Bypass or max 60s | `no-cache` |
| `/api/ready`, `/api/health` | **Bypass** | probes |

Notes:

- **Do not cache** ticket flows, sign-in, organizer console, scanner PWA, or booth portals.
- **Upload limit:** request bodies up to **8 MB** (Page Studio images). Ensure the CDN allows at least that for `POST`/`PUT` to `/api/*`.
- **WebSockets:** not used on this stack; no extra rule needed.

## Verification (after CDN SSL is active)

```bash
curl -sI https://congress.aiteb.app/api/ready | grep -iE '^(HTTP|cache-control)'
curl -sI https://congress.aiteb.app/assets/ | grep -iE '^(HTTP|cache-control)'   # after first deploy
curl -sI https://congress.aiteb.app/ | grep -iE '^(HTTP|cache-control)'
```

Direct hit on the origin IP (should fail once CDN mode + firewall are on):

```bash
curl -sI --resolve congress.aiteb.app:443:YOUR_SERVER_IP https://congress.aiteb.app/ | head -3
# expect 403 from Caddy and/or timeout if configure-firewall-cdn.sh is applied
```

## After each deploy

1. Purge `https://congress.aiteb.app/index.html` and any changed public event path under `/e/…` if HTML was cached too aggressively.
2. Do **not** purge `/assets/*` unless necessary (filenames are content-hashed).

See also [CDN.md](./CDN.md) for origin TLS and `stack.mjs cdn` commands.
