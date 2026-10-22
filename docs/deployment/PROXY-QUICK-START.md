# Congress deployment with proxy: quick reference

Use this when the server has **no direct internet** but can SSH to the bastion (the one in DrGibi's `drgibi-proxy.conf`). It is the same method, with the same command names, as DrGibi's `drgibi-proxy.sh`.

## One script

`deploy/proxy/congress-proxy.sh` is the single entry point. Configure it once:

```bash
cd /opt/congress-platform
cp deploy/proxy/congress-proxy.conf.example deploy/proxy/congress-proxy.conf
nano deploy/proxy/congress-proxy.conf     # PROXY_SERVER, PROXY_SSH_PORT, PROXY_PORT: same values as drgibi-proxy.conf
chmod +x deploy/proxy/congress-proxy.sh
deploy/proxy/congress-proxy.sh config
```

The bastion must accept this server's SSH key. Test it with `ssh -p PORT user@bastion exit`.

## One time

```bash
deploy/proxy/congress-proxy.sh setup      # proxychains4, gost, Docker daemon proxy (restarts Docker once)
deploy/proxy/congress-proxy.sh verify     # every line green
```

## Every deploy

```bash
cd /opt/congress-platform
deploy/proxy/congress-proxy.sh git pull
deploy/proxy/congress-proxy.sh deploy
```

`deploy` opens the tunnel, builds the images through it, migrates and starts the stack (`stack.mjs up`), runs `stack.mjs check`, then closes the tunnel. Run it as root: it also opens the firewall from `docker0` to the build proxy.

## Commands

| Command | What it does |
|---|---|
| `config` | Show the settings in use |
| `setup` | One time: proxychains4, gost, Docker daemon proxy |
| `verify` | Check everything, including a live test through the tunnel |
| `git <args>` | git through the tunnel: `git pull`, `git fetch`, `git clone …` |
| `deploy` | Build and start the app through the tunnel, then the health check |
| `enable` / `disable` / `status` | Docker daemon proxy on or off; what is running |
| `start-tunnel` / `stop-tunnel` / `test-tunnel` | Keep the tunnel open for manual work; live test only |
| `run <command>` | Any command through the tunnel (`curl`, `apt-get`, `npm`, …) |
| `stack <args>` | `node scripts/staging/stack.mjs <args>` with the build proxy |
| `print-env` | Export lines for the current shell (after `start-tunnel`) |

## Files

| File | Purpose |
|---|---|
| `deploy/proxy/congress-proxy.sh` | Tunnel, Docker proxy, build proxy, git, deploy |
| `deploy/proxy/congress-proxy.conf` | Bastion, ports, `CONGRESS_EXTRA_NO_PROXY` (git-ignored; copied from `.example`) |
| `.staging/staging.env` | App settings and secrets |

**If a build step cannot download** (`npm ci`, `uv sync`), run `verify`. If it says *Build containers cannot reach …*, run the command as root.

**ParsPack CDN in front?** The proxy is only for pulls and builds; Caddy never needs it ([CDN.md](./CDN.md)).

How it works, a bare server, troubleshooting and upgrading from the previous script: [PROXY.md](./PROXY.md).
