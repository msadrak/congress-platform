# SSH proxy deployment: how it works

The commands are in [PROXY-QUICK-START.md](./PROXY-QUICK-START.md). This page explains what they do, how to start on a bare server, and what to do when something fails.

## Picture

```
this server ──ssh -D 127.0.0.1:1080──► bastion ──► internet
  ├─ Docker daemon (systemd drop-in) ......... docker pull and the base images of docker build
  ├─ gost HTTP bridge on 172.17.0.1:8118 ..... npm ci / uv sync inside docker build
  └─ proxychains4 ............................ git, curl, apt on this server
```

It is the same design as DrGibi's `drgibi-proxy.sh`:

- **The tunnel is open only while a command needs it.** `deploy`, `git`, `run` and `verify` open it and close it when they end. Nothing runs between deploys, and the running app never uses the proxy. If a tunnel already listens on the SOCKS port (after `start-tunnel`, or DrGibi's tunnel on the same server), it is used and left running.
- **Docker pulls** go through the tunnel because of a systemd drop-in, `/etc/systemd/system/docker.service.d/congress-proxy.conf`, written by `setup` (or `enable`).
- **`npm ci` and `uv sync` inside `docker build`** cannot use a SOCKS proxy, so `gost` (downloaded once, through the tunnel, to `~/.congress-proxy/`) turns HTTP proxy requests into SOCKS. Build containers reach it on the `docker0` address, `http://172.17.0.1:8118`. `deploy` sets `CONGRESS_BUILD_PROXY`, and `stack.mjs up` passes it to the build as `--build-arg HTTP_PROXY=…`; without it, builds go direct. gost listens on `127.0.0.1` and `docker0` only, never on the public address.
- **The `docker compose` client** gets the bridge too (`HTTP_PROXY=http://127.0.0.1:8118`, only for the duration of `deploy`): BuildKit asks the client to fetch the registry token of every image a build uses (`FROM` images, `# syntax=docker/dockerfile:1`). Without it the build fails with `failed to fetch anonymous token … lookup auth.docker.io`. DrGibi exports the same variables.
- **git, curl and apt** on the server run through `proxychains4` with a private configuration written from `congress-proxy.conf`; `/etc/proxychains4.conf` is not touched.
- **Firewall:** UFW usually drops traffic from `docker0` to the host. Run as root, the script adds the same rule DrGibi adds: `iptables -I INPUT -i docker0 -p tcp --dport 8118 -j ACCEPT`.

## What `setup` changes on the server

| Change | Undo |
|---|---|
| Installs `proxychains4` (directly, or through the tunnel when the package mirror is not reachable) | `apt-get remove proxychains4` |
| Downloads `gost` to `~/.congress-proxy/` | Delete the folder |
| Writes the Docker drop-in and restarts Docker once (running containers restart with it) | `congress-proxy.sh disable` |
| Removes what the previous version of the script installed (see [Upgrading](#upgrading-from-the-previous-script)) | — |

## Bare server (before the repository is there)

The script needs only `bash`, `ssh` and `curl` to start.

**1. From your computer**, copy it to the server:

```bash
scp deploy/proxy/congress-proxy.sh deploy/proxy/congress-proxy.conf.example root@SERVER:/root/
```

**2. On the server, as root**, write the settings and run the setup. Docker is not installed yet, so `setup` says so; that is expected.

```bash
cd /root
cp congress-proxy.conf.example congress-proxy.conf
nano congress-proxy.conf
chmod +x congress-proxy.sh
./congress-proxy.sh setup
```

**3. Install Docker and Node 22 through the tunnel**, then send Docker's pulls through it:

```bash
./congress-proxy.sh run sh -c 'curl -fsSL https://get.docker.com | sh'
./congress-proxy.sh run sh -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs'
./congress-proxy.sh enable
```

**4. Clone the repository, move the settings into it and deploy:**

```bash
./congress-proxy.sh git clone git@github.com:drkalani/AITeb-Congress.git /opt/congress-platform
cp congress-proxy.conf /opt/congress-platform/deploy/proxy/
cd /opt/congress-platform
# Write .staging/staging.env from deploy/hosted/.env.hosted.example (HOSTED_STAGING_READINESS.md)
deploy/proxy/congress-proxy.sh verify
deploy/proxy/congress-proxy.sh deploy
```

The GitHub clone needs this server's deploy key on GitHub; the tunnel only carries the connection.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ssh to … failed` | Check `PROXY_SERVER`, `PROXY_SSH_PORT` and the key in `congress-proxy.conf`; try `ssh -p PORT user@bastion exit` by hand |
| The tunnel opens, but every download fails (`curl: (97) connection to proxy closed`) | The bastion refuses forwarding: set `AllowTcpForwarding yes` in its `/etc/ssh/sshd_config` (the first occurrence counts) and restart sshd |
| `verify`: *key login without a password failed* | Every command will ask for the bastion password. Add this server's key to the bastion: `ssh-copy-id -p PORT user@bastion` |
| *Build containers cannot reach http://172.17.0.1:8118* | Run the command as root (it adds the `docker0` rule), or allow it in UFW: `ufw allow in on docker0 to any port 8118 proto tcp` |
| `docker pull` hangs or the build stops with `DeadlineExceeded` | `status`: the Docker daemon proxy must be ON (else `enable`). Then `verify`, and run `deploy` again; layers already built are cached |
| Build fails with `failed to fetch anonymous token` or `lookup auth.docker.io` | The build ran without the proxy: use `congress-proxy.sh deploy` (or `stack <args>`), not plain `stack.mjs up` |
| `docker pull` returns `403 Forbidden` from Docker Hub | The pull went direct, not through the tunnel: `enable`, then check the *Docker pulls images through the tunnel* line of `verify` |
| *Port 8118 is in use on 127.0.0.1 …* | Something else listens on 8118: set `CONGRESS_HTTP_BRIDGE_PORT` in `congress-proxy.conf` |
| Pulls fail on a server that also runs DrGibi | DrGibi's drop-in (`http-proxy.conf`) overrides ours. Use DrGibi's `PROXY_PORT` in `congress-proxy.conf`; `verify` warns about this |
| `git` says `Permission denied (publickey)` | That answer comes from GitHub: the server's deploy key is missing, the tunnel works |

## Upgrading from the previous script

The previous `congress-proxy.sh` kept the tunnel always on (systemd services `congress-proxy-tunnel` and `congress-proxy-bridge`), pointed apt at the bridge (`/etc/apt/apt.conf.d/95congress-proxy`), and could give Caddy and the API a run-time proxy (`containers`). The new script does none of this.

1. `deploy/proxy/congress-proxy.sh setup` once: it stops and removes the two services and the apt file. `congress-proxy.conf` keeps working as it is.
2. Delete `CONGRESS_WEB_PROXY`, `CONGRESS_API_PROXY` and `CONGRESS_RUNTIME_NO_PROXY` from `.staging/staging.env`; nothing reads them any more.
3. `deploy/proxy/congress-proxy.sh deploy`.

Caddy now reaches the internet directly. Behind the ParsPack CDN it requests no certificates, so nothing changes. Without a CDN, on a server without internet, Caddy cannot renew a Let's Encrypt certificate: put the CDN in front ([CDN.md](./CDN.md)).

| Previous command | Now |
|---|---|
| `start` / `stop` | `start-tunnel` / `stop-tunnel` (the old names still work) |
| `run git pull` | `git pull` (`run` still works) |
| `stack up` | `deploy` |
| `test` | `test-tunnel` (or `verify` for everything) |
| `install-service`, `containers`, `firewall`, `pull-bases`, `bootstrap`, `apt-setup` | Removed |

## Turning the proxy off

Only when the server gets direct internet:

```bash
deploy/proxy/congress-proxy.sh disable    # Docker pulls direct again (restarts Docker)
node scripts/staging/stack.mjs up         # builds without the proxy
```
