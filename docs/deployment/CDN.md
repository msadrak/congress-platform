# Deploying behind a CDN (ParsPack)

The CDN shows visitors its own free certificate (Let's Encrypt, renewed by ParsPack), so this server never asks Let's Encrypt for one. The CDN connects to this server (the **origin**).

```
visitor --HTTPS (ParsPack certificate)--> ParsPack CDN --HTTPS or HTTP--> Caddy --> API
```

Good to know:

- **No certificate problems at the origin.** No ACME, no outbound proxy for Caddy, and Let's Encrypt never has to reach this server from abroad. The SSH proxy is still needed for Docker, npm and PyPI at **build** time (`docs/deployment/PROXY-QUICK-START.md`).
- **The CDN's IP is not the visitor's IP.** The API throttles per visitor address (100 logins / 15 min, 10 admin-token tries, 50 organizer-key tries). Without the steps below every visitor looks like one of ParsPack's few servers, and a busy venue locks itself out. `stack.mjs cdn parspack` fixes this: only connections from ParsPack's published ranges may state the visitor's address, and it is read from the right of the header, so a value a visitor types in is ignored.
- **API answers are never cached** by the CDN (`Cache-Control: no-store`, unless the API sets its own header, as it does for public images and page heads).

## Settings (all in `.staging/staging.env`, written by `stack.mjs cdn ...`)

| Variable | Meaning |
|---|---|
| `CONGRESS_CDN=on` | Read the visitor address from the header, from trusted connections only |
| `CONGRESS_TRUSTED_PROXIES` | The CDN's address ranges (space separated; from `https://parspack.com/cdnips.txt`) |
| `CONGRESS_CLIENT_IP_HEADER` | Header carrying the visitor address (default `X-Forwarded-For`; check with `cdn check`) |
| `CONGRESS_CDN_ONLY=on` | Public internet gets 403 unless from ParsPack ranges (on by default after `cdn parspack`; loopback/private nets still allowed, like DrGibi) |
| `CONGRESS_ORIGIN_TLS=off` | Plain-HTTP origin (option B); the site address then starts with `http://` |

## How this matches DrGibi

| DrGibi | Congress |
|---|---|
| `drgibi-gateway/cdnips.txt` + `cdn_real_ip.conf` | `deploy/staging/cdn/cdnips.txt` + `CONGRESS_TRUSTED_PROXIES` in Caddy |
| `real_ip_header X-Forwarded-For; real_ip_recursive on` | `trusted_proxies_strict` + `X-Forwarded-For` (`cdn-on.caddy`) |
| `is_trusted_source` → else 403 "Direct access denied. Please use the CDN." | `CONGRESS_CDN_ONLY=on` (`cdn-gate-on.caddy`, same message) |
| Staging: `stage-dev/gateway-cdn-open.conf` | `cdn parspack --allow-direct` or `cdn only off` |
| `scripts/configure_firewall.sh` CDN chain on 80/443 | `deploy/staging/cdn/configure-firewall-cdn.sh` |
| DrGibi `docs/CDN_SEO_CACHE_RULES.md` | [CDN_CACHE_RULES.md](./CDN_CACHE_RULES.md) |

## Commands

```bash
node scripts/staging/stack.mjs cdn status                 # what is set, and anything inconsistent
node scripts/staging/stack.mjs cdn sync                   # refresh deploy/staging/cdn/cdnips.txt from parspack.com (commit to git)
node scripts/staging/stack.mjs cdn origin https           # option A: Caddy's own certificate on the origin (recommended)
node scripts/staging/stack.mjs cdn origin http            # option B: plain HTTP origin
node scripts/staging/stack.mjs cdn parspack               # CDN on + CDN_ONLY on (DrGibi default); updates vendored list when online
node scripts/staging/stack.mjs cdn parspack --offline     # use deploy/staging/cdn/cdnips.txt only (typical on the server)
node scripts/staging/stack.mjs cdn parspack --allow-direct  # staging: do not set CDN_ONLY (like DrGibi open gateway)
node scripts/staging/stack.mjs cdn parspack --file path     # custom list file
node scripts/staging/stack.mjs cdn parspack --header X-Real-IP
node scripts/staging/stack.mjs cdn check                  # did Caddy find the visitor's address?
node scripts/staging/stack.mjs cdn only on|off            # toggle direct-access gate only
node scripts/staging/stack.mjs cdn off                    # back to direct visitors
sudo deploy/staging/cdn/configure-firewall-cdn.sh         # host: only ParsPack may hit Docker 80/443 (DrGibi DOCKER-USER)
```

The list is checked before it is used: anything that is not an address or range is refused, and so is a range wider than /16 (IPv4) or /32 (IPv6), because a wrong list that said `0.0.0.0/0` would make every visitor "trusted".

## Step by step

**1. In the ParsPack panel**

1. Add the domain `congress.aiteb.app` to the CDN. Origin = your server's public IP, port **443** (option A) or **80** (option B).
2. Change the domain's DNS as ParsPack tells you, so visitors reach the CDN, not the server.
3. CDN → **SSL** → *Free certificate* → install. Wait until it shows **Verified**. It can take hours; if not, open a ticket "فعال‌نشدن SSL برای CDN" ([ParsPack docs](https://docs.parspack.com/cdn/security/)).
4. CDN → origin/network settings: origin protocol **HTTPS** for option A (**HTTP** for option B). Turn on *Always use HTTPS*. Leave HSTS off for now ([docs](https://docs.parspack.com/cdn/other-settings/)).
5. Configure cache rules: [CDN_CACHE_RULES.md](./CDN_CACHE_RULES.md) (bypass `/api/*`, respect origin headers).
6. Make sure the CDN does not block uploads: the app accepts bodies up to 8 MB.

**2. On the server** (the web image must be rebuilt first: it contains the new Caddy files)

```bash
cd /opt/congress-platform
deploy/proxy/congress-proxy.sh git pull
nano .staging/staging.env                         # set CONGRESS_HSTS=off for now
deploy/proxy/congress-proxy.sh deploy             # rebuilds the web image and starts

node scripts/staging/stack.mjs cdn origin https   # option A (or: cdn origin http)
node scripts/staging/stack.mjs cdn parspack --offline   # vendored ranges + CDN mode (no fetch needed)
sudo deploy/staging/cdn/configure-firewall-cdn.sh       # host firewall (DrGibi-style)
```

**3. Check it**

```bash
curl -I https://congress.aiteb.app/api/ready      # 200, certificate issued by Let's Encrypt via ParsPack
node scripts/staging/stack.mjs cdn check          # shows "OK: ... visitor address ... read from the header"
```

Open the site from a phone on mobile data, run `cdn check` again and look for that phone's address in the *visitor* column. **If it shows the CDN's address in both columns, the header or the ranges are wrong**: the message says which, and `cdn parspack --header <name>` fixes the name.

**4. Staging without CDN** (DrGibi `gateway-cdn-open.conf` equivalent)

```bash
node scripts/staging/stack.mjs cdn parspack --allow-direct
# or: node scripts/staging/stack.mjs cdn only off
```

`cdn parspack` already sets `CDN_ONLY=on` in production; use `--allow-direct` only while testing before DNS points at ParsPack.

**5. Later:** when everything works for a few days, set `CONGRESS_HSTS=on` in `.staging/staging.env` and run `stack.mjs start`. Re-run `cdn parspack` now and then (for example monthly): if ParsPack adds ranges, visitors behind them would otherwise be counted as the CDN.

## Which origin option?

| | Option A: origin HTTPS (default) | Option B: origin HTTP |
|---|---|---|
| ParsPack origin protocol / port | HTTPS / 443 | HTTP / 80 |
| Caddy | its own certificate (`tls internal`) | no certificate, no redirect |
| Hop CDN → server | encrypted (not authenticated) | **not encrypted**: logins and tokens cross the network in clear |
| Use when | always, first | ParsPack refuses the origin's own certificate (5xx / "SSL handshake" errors) |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Caddy does not start after the switch | `stack.mjs logs web`. `stack.mjs cdn status` lists inconsistent settings; the web image must have been rebuilt (`congress-proxy.sh deploy`) |
| ParsPack shows 5xx / handshake error with option A | Try `cdn origin http` and set ParsPack's origin protocol to HTTP |
| Everyone is counted as one visitor | `cdn check`; then `cdn parspack --header <name>` or re-run `cdn parspack` |
| 403 when opening the site by IP | `cdn only on` is set; use the domain, or `cdn only off` |
| `cdn parspack` cannot fetch the list | Download `https://parspack.com/cdnips.txt` elsewhere, copy it over, use `--file` |

## Not covered

- `/platform` and `/api/organizers` stay unreachable through the proxy (`CONGRESS_ADMIN_ALLOW=127.0.0.1/32`): use `stack.mjs organizer ...` on the server, as before. A CDN address can never pass that check.
- The header name ParsPack uses is not documented in what I could find; `cdn check` shows what arrives, so it is confirmed by the first real request.
