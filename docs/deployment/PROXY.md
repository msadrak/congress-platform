# Deploying through an SSH proxy (server without direct internet)

Use this when the Ubuntu server cannot reach Docker Hub, GitHub, npm, PyPI or the Ubuntu mirrors directly, but can open an SSH connection to a server outside (the same bastion DrGibi uses). It is the same design as `DrGibi-Deploy-ML/drgibi-proxy.sh`, reduced to what Congress needs.

```
server --ssh -D--> bastion --> internet
   |-- SOCKS 127.0.0.1:1080 ........ Docker image pulls (dockerd)
   `-- HTTP bridge (gost) :8118 ..... apt, curl, git over https, the npm / uv steps of `docker build`,
                                      and the running Caddy container (host.docker.internal:8118)
```

Three things use the proxy:

| What | How | When |
|---|---|---|
| Docker image pulls | dockerd, SOCKS | on every pull or build (tunnel must be up) |
| Image builds (`npm ci`, `uv sync`) | HTTP bridge, build arguments | on every build (tunnel must be up) |
| **Running containers** | HTTP bridge through `host.docker.internal`, set in `.staging/staging.env` | **always**: Caddy requests and renews its certificate, and fetches OCSP, months after a deploy |

Because the last row has no deploy to start the tunnel, the tunnel and the bridge run as **systemd services** (`install-service`): always on, restarted on failure, started at boot.

- **Caddy (`web`)** gets `CONGRESS_WEB_PROXY`. Its traffic to the API (`api`, `db`, `web`, private networks) stays direct through `NO_PROXY`, and the loopback health check ignores the proxy.
- **The API** gets nothing by default (`CONGRESS_API_PROXY` empty). Its only outbound call is `api.sms.ir`, an Iranian service that may refuse the proxy's foreign address. Use `containers --api` only if the API must reach something through the proxy, and then list `api.sms.ir` in `CONGRESS_EXTRA_NO_PROXY` so SMS stays direct.
- **Let's Encrypt validation itself is inbound** (it connects to ports 80/443 of your server), so it does not use the proxy; only Caddy's requests to the CA's API do. Ports 80 and 443 must still be open to the internet.
- The bridge listens on `127.0.0.1` and on the Docker bridge address only, never on the public address. The firewall rule allows the Docker networks (`172.16.0.0/12`) to reach it.

## Files

| File | Purpose |
|---|---|
| `deploy/proxy/congress-proxy.sh` | Tunnel, bridge, apt/Docker settings, and `stack` (runs `stack.mjs` with the build proxy) |
| `deploy/proxy/congress-proxy.conf.example` | Copy to `congress-proxy.conf` (git-ignored) and edit |
| `scripts/staging/stack.mjs` | `up` adds the proxy build arguments only when `CONGRESS_BUILD_PROXY` is set; nothing changes without it |

## Step by step (as root)

**1. From your own computer, copy the two files to the bare server** (the script needs only `bash` and `ssh`):

```bash
scp deploy/proxy/congress-proxy.sh deploy/proxy/congress-proxy.conf.example root@SERVER_IP:/root/
```

**2. On the server, write the settings.** Use the values from DrGibi's `drgibi-proxy.conf` (`PROXY_SERVER`, `PROXY_SSH_PORT`, `PROXY_PORT`):

```bash
cd /root
cp congress-proxy.conf.example congress-proxy.conf
nano congress-proxy.conf
chmod +x congress-proxy.sh
```

The server needs an SSH key that the bastion accepts: `ssh-keygen -t ed25519`, then add `~/.ssh/id_ed25519.pub` to the bastion's `authorized_keys`. Test with `ssh -p PORT user@bastion exit`.

**3. Open the tunnel and prepare apt:**

```bash
./congress-proxy.sh bootstrap
./congress-proxy.sh test
```

`bootstrap` opens the tunnel, downloads `gost` through it, points apt at the bridge and installs `proxychains4`. `test` must not print an error for the SOCKS and bridge lines (the build-container line needs Docker, so it appears after step 4).

**4. Install Docker, Git and Node through the proxy** (the tunnel must be up: `./congress-proxy.sh start`):

```bash
eval "$(./congress-proxy.sh env)"          # this shell now uses the bridge
curl -fsSL https://get.docker.com | sh
apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
./congress-proxy.sh docker-setup           # Docker pulls images through the tunnel (restarts Docker once)
./congress-proxy.sh test
```

**5. Download the code.** With a public https URL, the `env` line above is enough (`git clone https://...`). With the private SSH URL, run git through the tunnel:

```bash
./congress-proxy.sh run git clone git@github.com:drkalani/AITeb-Congress.git /opt/congress-platform
cp /root/congress-proxy.conf /opt/congress-platform/deploy/proxy/
```

**6. Write `.staging/staging.env`** exactly as in the normal server guide (domain `congress.aiteb.app`, `deploy/hosted/.env.hosted.example`).

**7. Keep the tunnel always on, and let Caddy use it for the certificate:**

```bash
cd /opt/congress-platform
deploy/proxy/congress-proxy.sh install-service   # tunnel + bridge, restart on failure, start at boot
deploy/proxy/congress-proxy.sh containers        # Caddy uses the proxy (writes .staging/staging.env)
```

`install-service` needs a bastion key that works without a password (the services start without a keyboard). If you added `CONGRESS_EXTRA_NO_PROXY` to `congress-proxy.conf`, set it before `containers`.

**8. Build and start through the proxy:**

```bash
deploy/proxy/congress-proxy.sh deploy
deploy/proxy/congress-proxy.sh test
```

`deploy` runs `stack.mjs up` (pulls, builds, migrates, starts) and then `stack.mjs check`. Any other command works the same way: `deploy/proxy/congress-proxy.sh stack start`. `test` checks the tunnel, npm, PyPI, the Let's Encrypt directory, and that containers on the Compose network can reach `host.docker.internal:8118`.

**9. Watch the certificate being issued:**

```bash
node scripts/staging/stack.mjs logs web
curl -I https://congress.aiteb.app/api/ready
```

Look for "certificate obtained successfully". Errors that mention `proxyconnect` mean the container cannot reach the bridge: see Troubleshooting. Certificate renewal later uses the same path, so `systemctl status congress-proxy-tunnel congress-proxy-bridge` must stay `active`.

## Updating later

```bash
cd /opt/congress-platform
deploy/proxy/congress-proxy.sh run git pull
deploy/proxy/congress-proxy.sh deploy
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ssh to ... failed` | Check `PROXY_SERVER`, `PROXY_SSH_PORT`, the key. Try the `ssh` command by hand. |
| `containers ... can NOT reach host.docker.internal:8118`, or Caddy logs `proxyconnect tcp` | Run `./congress-proxy.sh firewall` as root (allows the Docker networks only; UFW or iptables), then `status`: the bridge service must be active. Recreate Caddy after changing settings: `stack start`. |
| Caddy logs `proxyconnect tcp: ... no such host` for `host.docker.internal` | The container was not recreated with the new compose file: `deploy/proxy/congress-proxy.sh stack start`. |
| Certificate request times out | The tunnel is down or the bastion cannot reach the CA: `./congress-proxy.sh test` (Let's Encrypt line). |
| SMS fails after `containers --api` | `api.sms.ir` is going through the proxy. Add it to `CONGRESS_EXTRA_NO_PROXY`, run `containers --api` again, then `stack start`. |
| `build containers can NOT reach ...:8118` | Run `./congress-proxy.sh firewall` as root. |
| `docker pull` hangs | The tunnel is down: `./congress-proxy.sh status`, then `start`. The daemon proxy needs it for every pull. |
| `npm ci` or `uv sync` fails with connection errors | Run builds through `congress-proxy.sh stack up`, not plain `stack.mjs up`. |
| Tunnel drops during a long build | Run it again; layers already built are cached. `ServerAliveInterval` is already set. |

## Switching the proxy off

```bash
./congress-proxy.sh containers off      # Caddy and the API go direct again
deploy/proxy/congress-proxy.sh stack start
./congress-proxy.sh uninstall-service   # (or `stop` to pause the services until the next boot)
./congress-proxy.sh docker-off          # Docker pulls directly again (restarts Docker)
./congress-proxy.sh apt-off
```

Do these in this order: with the proxy removed first, Caddy would be left pointing at a bridge that no longer exists.
