# SSH proxy deployment (full notes)

**Start here:** [PROXY-QUICK-START.md](./PROXY-QUICK-START.md) — same workflow as DrGibi (`setup` → `verify` → `deploy`).

This page is optional background.

## Picture

```
Your server ──SSH──► bastion ──► internet

On the server:
  SOCKS :1080     →  docker pull / docker build base images
  HTTP  :8118     →  npm and uv inside docker build (via gost → SOCKS)
```

With **ParsPack CDN**, running Caddy does **not** need the bridge for Let’s Encrypt; keep `install-service` for builds and pulls. See [CDN.md](./CDN.md).

## Files

| File | Role |
|------|------|
| `deploy/proxy/congress-proxy.sh` | Single entry point (like `drgibi-proxy.sh`) |
| `deploy/proxy/congress-proxy.conf` | Bastion host, SSH port, SOCKS port (copy from `.example`) |
| `.staging/staging.env` | App secrets and `CONGRESS_PERSISTENT_DATA_ROOT` |

## Bare server (before `/opt/congress-platform` exists)

```bash
scp deploy/proxy/congress-proxy.sh deploy/proxy/congress-proxy.conf.example root@SERVER:/root/
# on server: cp example → congress-proxy.conf, edit, chmod +x, then setup + install Docker/Node
```

Then clone the repo with `congress-proxy.sh run git clone …` and copy `congress-proxy.conf` into `deploy/proxy/`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ssh to … failed` | Fix `congress-proxy.conf`; test SSH by hand |
| `verify` / build: cannot reach `:8118` | `deploy/proxy/congress-proxy.sh firewall` (root) |
| `docker pull` hangs | `start` or `install-service`; `enable` (Docker SOCKS) |
| `DeadlineExceeded` on build | `enable`, `verify`, `pull-bases`, retry `deploy` |
| Build works but SMS breaks | Do not use `containers --api` unless needed; keep `api.sms.ir` direct |

## Turn proxy off

Only if the server gets direct internet:

```bash
deploy/proxy/congress-proxy.sh containers off
deploy/proxy/congress-proxy.sh uninstall-service
deploy/proxy/congress-proxy.sh disable
```
