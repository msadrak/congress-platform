# Congress + SSH proxy — quick start (same idea as DrGibi)

Use this when the Ubuntu server has **no direct internet** but can SSH to your **bastion** (the same host/port/key as `drgibi-proxy.conf`).

## What the script does (simple)

| Piece | Port | Who uses it |
|-------|------|-------------|
| **SSH tunnel (SOCKS)** | `127.0.0.1:1080` | Docker when it **pulls** images |
| **HTTP bridge (gost)** | `172.17.0.1:8118` | **`docker build`** (`npm ci`, `uv sync`) |

You do **not** need to remember ports day to day. Use **`congress-proxy.sh`** for everything.

**ParsPack CDN on `congress.aiteb.app`?** The proxy is only for **pulls and builds**. Caddy does **not** need the proxy for certificates (`containers off` — see [CDN.md](./CDN.md)).

---

## Configure once

```bash
cd /opt/congress-platform   # or copy the script to /root on a bare server first
cp deploy/proxy/congress-proxy.conf.example deploy/proxy/congress-proxy.conf
nano deploy/proxy/congress-proxy.conf   # same PROXY_SERVER / PROXY_SSH_PORT as DrGibi
chmod +x deploy/proxy/congress-proxy.sh
deploy/proxy/congress-proxy.sh config
```

Bastion must accept your server’s SSH key (`ssh -p PORT user@bastion exit`).

---

## One-time on the server

```bash
# 1) Proxy stack (tunnel, gost, apt, Docker daemon SOCKS)
deploy/proxy/congress-proxy.sh setup

# 2) Install Docker + Node if not already there (tunnel must be up: deploy/proxy/congress-proxy.sh start)
eval "$(deploy/proxy/congress-proxy.sh env)"
# … install docker, git, node 22 …

# 3) App secrets
#    Copy deploy/hosted/.env.hosted.example → .staging/staging.env (domain, SMS, CONGRESS_PERSISTENT_DATA_ROOT)

# 4) Tunnel always on (for pulls/builds; safe with CDN)
deploy/proxy/congress-proxy.sh install-service
deploy/proxy/congress-proxy.sh firewall

# 5) CDN (recommended for congress.aiteb.app)
deploy/proxy/congress-proxy.sh containers off
node scripts/staging/stack.mjs cdn parspack --offline   # after CDN.md DNS steps
```

Check everything:

```bash
deploy/proxy/congress-proxy.sh verify
```

All lines should be green. If “build containers cannot reach …:8118”, run `deploy/proxy/congress-proxy.sh firewall` as root and `verify` again.

---

## Every deploy (normal workflow)

Same three steps as DrGibi: **verify → deploy**.

```bash
cd /opt/congress-platform
deploy/proxy/congress-proxy.sh verify
deploy/proxy/congress-proxy.sh deploy
```

`deploy` = build images through the bridge, migrate, start, then `stack.mjs check`.

**Update code:**

```bash
deploy/proxy/congress-proxy.sh run git pull
deploy/proxy/congress-proxy.sh deploy
```

---

## Command cheat sheet (DrGibi names)

| DrGibi | Congress | Meaning |
|--------|----------|---------|
| `./drgibi-proxy.sh setup` | `deploy/proxy/congress-proxy.sh setup` | One-time: tunnel tools + apt + Docker SOCKS |
| `./drgibi-proxy.sh enable` | `deploy/proxy/congress-proxy.sh enable` | Turn on Docker daemon proxy only |
| `./drgibi-proxy.sh verify` | `deploy/proxy/congress-proxy.sh verify` | Health check |
| `./drgibi-proxy.sh deploy` | `deploy/proxy/congress-proxy.sh deploy` | Build + start app |
| `./drgibi-proxy.sh status` | `deploy/proxy/congress-proxy.sh status` | What is on/off |
| `./drgibi-proxy.sh print-env` | `deploy/proxy/congress-proxy.sh print-env` | Export hints for this shell |

Other Congress commands: `stack up`, `stack start`, `pull-bases` (slow tunnel), `run git …`, `containers` / `containers off`.

---

## If `docker pull` fails with `403 Forbidden` (Docker Hub)

Congress **does not use `docker.io` for builds** anymore: API runtime reuses `ghcr.io/astral-sh/uv`, Node comes from `public.ecr.aws/docker/library`, Caddy from `mirror.gcr.io`. Run:

```bash
deploy/proxy/congress-proxy.sh pull-bases
deploy/proxy/congress-proxy.sh deploy
```

If a mirror still fails, retry `pull-bases` or load images from another machine (`docker save` / `docker load`).

## If build fails with `DeadlineExceeded`

The tunnel or Docker SOCKS is usually not ready:

```bash
deploy/proxy/congress-proxy.sh status    # SOCKS + bridge + “Docker daemon proxy ON”
deploy/proxy/congress-proxy.sh enable    # if Docker proxy was OFF
deploy/proxy/congress-proxy.sh verify
deploy/proxy/congress-proxy.sh pull-bases
deploy/proxy/congress-proxy.sh deploy    # retry; cached layers help
```

More detail: [PROXY.md](./PROXY.md).
