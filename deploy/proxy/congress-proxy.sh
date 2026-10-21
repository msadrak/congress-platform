#!/usr/bin/env bash
#
# Congress Platform: deploy from a server that has no direct internet, through an SSH tunnel.
#
#   ssh -D (SOCKS, 127.0.0.1)  ->  dockerd image pulls (systemd proxy)
#                              ->  gost HTTP bridge  ->  apt, curl, npm, uv, docker build RUN steps
#
# It needs only bash and ssh to start, so it can be copied to a bare server (scp) before anything else is
# installed. Settings live in congress-proxy.conf next to this file (see congress-proxy.conf.example).
# Run it as root on the server; `./congress-proxy.sh help` lists the commands.
#
# Run-time containers use it too, when asked: `containers` points Caddy (certificate requests, renewals, OCSP)
# at the bridge through host.docker.internal, and `install-service` keeps the tunnel and the bridge running
# permanently (systemd), because renewals happen months after a deploy.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${CONGRESS_PROXY_CONF:-${SCRIPT_DIR}/congress-proxy.conf}"
# shellcheck disable=SC1090
[[ -f "$CONF" ]] && source "$CONF"

: "${PROXY_SERVER:=}"
: "${PROXY_SSH_PORT:=22}"
: "${PROXY_SSH_KEY:=}"
: "${PROXY_PORT:=1080}"
: "${CONGRESS_HTTP_BRIDGE_PORT:=8118}"
: "${CONGRESS_EXTRA_NO_PROXY:=}"
: "${CONGRESS_PROXY_STATE:=${HOME:-/root}/.congress-proxy}"
: "${GOST_RELEASE:=3.2.6}"
if [[ -z "${CONGRESS_ROOT:-}" ]]; then
	if [[ -f "${SCRIPT_DIR}/../../scripts/staging/stack.mjs" ]]; then
		CONGRESS_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
	else
		CONGRESS_ROOT=/opt/congress-platform
	fi
fi

DOCKER_PROXY_DIR=/etc/systemd/system/docker.service.d
DOCKER_PROXY_CONF="${DOCKER_PROXY_DIR}/congress-proxy.conf"
APT_PROXY_CONF=/etc/apt/apt.conf.d/95congress-proxy
GOST="${CONGRESS_PROXY_STATE}/gost"
GOST_PID="${CONGRESS_PROXY_STATE}/gost.pid"
GOST_LOG="${CONGRESS_PROXY_STATE}/gost.log"
SSH_PID="${CONGRESS_PROXY_STATE}/tunnel.pid"
PROXYCHAINS_CONF="${CONGRESS_PROXY_STATE}/proxychains.conf"
SERVICE_TUNNEL=/etc/systemd/system/congress-proxy-tunnel.service
SERVICE_BRIDGE=/etc/systemd/system/congress-proxy-bridge.service

info() { printf '\033[0;34m[proxy]\033[0m %s\n' "$*"; }
ok() { printf '\033[0;32m[ok]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[0;31m[error]\033[0m %s\n' "$*" >&2; }

as_root() {
	if [[ "$(id -u)" -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

tcp_open() {
	local host="$1" port="$2"
	if command -v nc >/dev/null 2>&1; then
		nc -z -w 2 "$host" "$port" >/dev/null 2>&1
	else
		timeout 2 bash -c "exec 3<>/dev/tcp/${host}/${port}" >/dev/null 2>&1
	fi
}

# Address build containers use to reach this host (the default Docker bridge gateway).
docker_gateway() {
	local gw=""
	if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
		gw="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
	fi
	[[ -n "$gw" && "$gw" != "<no value>" ]] || gw=172.17.0.1
	echo "$gw"
}

local_address_exists() {
	ip -4 -o addr show 2>/dev/null | grep -q "inet ${1}/"
}

no_proxy_list() {
	local base="localhost,127.0.0.1,::1,*.local,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16"
	if [[ -n "$CONGRESS_EXTRA_NO_PROXY" ]]; then echo "${base},${CONGRESS_EXTRA_NO_PROXY}"; else echo "$base"; fi
}

host_http_proxy() { echo "http://127.0.0.1:${CONGRESS_HTTP_BRIDGE_PORT}"; }
build_http_proxy() { echo "http://$(docker_gateway):${CONGRESS_HTTP_BRIDGE_PORT}"; }

require_server() {
	if [[ -z "$PROXY_SERVER" || "$PROXY_SERVER" == *YOUR_BASTION* ]]; then
		err "PROXY_SERVER is not set. Copy congress-proxy.conf.example to ${CONF} and edit it."
		exit 1
	fi
}

# ─────────────────────────── tunnel (ssh -D) ───────────────────────────

tunnel_start() {
	require_server
	mkdir -p "$CONGRESS_PROXY_STATE"
	if tcp_open 127.0.0.1 "$PROXY_PORT"; then
		ok "SOCKS already listening on 127.0.0.1:${PROXY_PORT}"
		return 0
	fi
	info "Opening SSH tunnel to ${PROXY_SERVER}:${PROXY_SSH_PORT} (SOCKS 127.0.0.1:${PROXY_PORT})..."
	local -a args=(
		-p "$PROXY_SSH_PORT" -D "127.0.0.1:${PROXY_PORT}" -N -f
		-o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3
		-o StrictHostKeyChecking=accept-new -o ConnectTimeout=20
	)
	[[ -n "$PROXY_SSH_KEY" ]] && args+=(-i "$PROXY_SSH_KEY")
	args+=("$PROXY_SERVER")
	if ! ssh "${args[@]}"; then
		err "ssh to ${PROXY_SERVER} failed. Check the address, the port and your key (try: ssh -p ${PROXY_SSH_PORT} ${PROXY_SERVER})."
		return 1
	fi
	sleep 1
	pgrep -f "ssh .*-D 127.0.0.1:${PROXY_PORT} .*${PROXY_SERVER}" | head -1 >"$SSH_PID" || true
	tcp_open 127.0.0.1 "$PROXY_PORT" || {
		err "Tunnel is not listening on 127.0.0.1:${PROXY_PORT}"
		return 1
	}
	ok "Tunnel up"
}

tunnel_stop() {
	if [[ -f "$SERVICE_TUNNEL" ]]; then
		as_root systemctl stop congress-proxy-bridge.service congress-proxy-tunnel.service
		ok "Services stopped (they start again at boot; remove them with: $0 uninstall-service)"
		return 0
	fi
	bridge_stop
	if [[ -f "$SSH_PID" ]] && kill "$(cat "$SSH_PID")" >/dev/null 2>&1; then
		ok "Tunnel stopped"
	elif pkill -f "ssh .*-D 127.0.0.1:${PROXY_PORT} .*${PROXY_SERVER}" >/dev/null 2>&1; then
		ok "Tunnel stopped"
	else
		info "No tunnel was running"
	fi
	rm -f "$SSH_PID"
}

# ─────────────────────────── HTTP bridge (gost) ───────────────────────────

gost_install() {
	[[ -x "$GOST" ]] && return 0
	mkdir -p "$CONGRESS_PROXY_STATE"
	local arch
	case "$(uname -m)" in
	x86_64 | amd64) arch=amd64 ;;
	aarch64 | arm64) arch=arm64 ;;
	*) err "Unsupported CPU: $(uname -m)"; return 1 ;;
	esac
	local file="gost_${GOST_RELEASE}_linux_${arch}.tar.gz"
	local url="https://github.com/go-gost/gost/releases/download/v${GOST_RELEASE}/${file}"
	tcp_open 127.0.0.1 "$PROXY_PORT" || tunnel_start || return 1
	info "Downloading gost ${GOST_RELEASE} through the tunnel..."
	curl -fsSL --connect-timeout 30 --socks5-hostname "127.0.0.1:${PROXY_PORT}" "$url" -o "${CONGRESS_PROXY_STATE}/${file}" || {
		err "Could not download ${url}"
		return 1
	}
	tar -xzf "${CONGRESS_PROXY_STATE}/${file}" -C "$CONGRESS_PROXY_STATE" gost && chmod +x "$GOST"
	[[ -x "$GOST" ]] || { err "gost is missing after extracting ${file}"; return 1; }
	ok "gost installed at ${GOST}"
}

# Build containers (docker0) and the containers of the Compose project (their own bridge networks, all inside
# 172.16.0.0/12) reach the bridge on the host. A host firewall usually blocks that. The rule allows those
# private source addresses only; gost itself listens on 127.0.0.1 and the docker0 address, never publicly.
firewall_allow_docker() {
	local port="$CONGRESS_HTTP_BRIDGE_PORT" range=172.16.0.0/12
	[[ -d /sys/class/net/docker0 ]] || return 0
	if command -v ufw >/dev/null 2>&1 && as_root ufw status 2>/dev/null | grep -q "Status: active"; then
		as_root ufw status | grep -q "${port}/tcp.*ALLOW.*${range}" ||
			as_root ufw allow from "$range" to any port "$port" proto tcp >/dev/null 2>&1 || true
	elif command -v iptables >/dev/null 2>&1; then
		as_root iptables -C INPUT -s "$range" -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
			as_root iptables -I INPUT -s "$range" -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
	fi
}

bridge_stop() {
	if [[ -f "$GOST_PID" ]]; then
		kill "$(cat "$GOST_PID")" >/dev/null 2>&1 || true
		rm -f "$GOST_PID"
	fi
	pkill -f "${GOST} -L http://" >/dev/null 2>&1 || true
}

# gost arguments. Never 0.0.0.0: the proxy must not be reachable from the internet.
gost_args() {
	local hp="$CONGRESS_HTTP_BRIDGE_PORT" gw
	gw="$(docker_gateway)"
	GOST_ARGS=(-L "http://127.0.0.1:${hp}")
	if local_address_exists "$gw"; then GOST_ARGS+=(-L "http://${gw}:${hp}"); fi
	GOST_ARGS+=(-F "socks5://127.0.0.1:${PROXY_PORT}")
}

bridge_start() {
	local hp="$CONGRESS_HTTP_BRIDGE_PORT" gw
	gw="$(docker_gateway)"
	tcp_open 127.0.0.1 "$PROXY_PORT" || tunnel_start || return 1
	if tcp_open 127.0.0.1 "$hp"; then
		firewall_allow_docker
		return 0
	fi
	gost_install || return 1
	gost_args
	mkdir -p "$CONGRESS_PROXY_STATE"
	nohup "$GOST" "${GOST_ARGS[@]}" >>"$GOST_LOG" 2>&1 &
	echo $! >"$GOST_PID"
	sleep 2
	if ! tcp_open 127.0.0.1 "$hp"; then
		err "gost did not start. Last log lines:"
		tail -n 20 "$GOST_LOG" >&2 || true
		return 1
	fi
	firewall_allow_docker
	ok "HTTP bridge: $(host_http_proxy) on this server, ${gw}:${hp} for builds and containers"
}

services_installed() { [[ -f "$SERVICE_TUNNEL" ]]; }

ensure_up() {
	if services_installed; then
		# The permanent services own the tunnel and the bridge.
		as_root systemctl start congress-proxy-tunnel.service congress-proxy-bridge.service || return 1
		local i
		for i in 1 2 3 4 5 6 7 8 9 10; do
			tcp_open 127.0.0.1 "$PROXY_PORT" && tcp_open 127.0.0.1 "$CONGRESS_HTTP_BRIDGE_PORT" && { firewall_allow_docker; return 0; }
			sleep 1
		done
		err "The proxy services did not come up. See: journalctl -u congress-proxy-tunnel -u congress-proxy-bridge"
		return 1
	fi
	tunnel_start && bridge_start
}

# ─────────────────────────── permanent services (systemd) ───────────────────────────
# Containers use the proxy at run time (Caddy requests and renews certificates months after a deploy),
# so the tunnel and the bridge must outlive any shell: two systemd services that restart on failure.

service_install() {
	require_server
	[[ "$(id -u)" -eq 0 ]] || { err "Run as root: sudo $0 install-service"; return 1; }
	command -v systemctl >/dev/null 2>&1 || { err "systemd is required"; return 1; }
	local self conf ssh_bin key=""
	self="$(readlink -f "${BASH_SOURCE[0]}")"
	conf="$(readlink -f "$CONF" 2>/dev/null || echo "$CONF")"
	ssh_bin="$(command -v ssh)"
	[[ -n "$PROXY_SSH_KEY" ]] && key="-i ${PROXY_SSH_KEY}"
	[[ -f "$conf" ]] || { err "Config file ${conf} is missing; the services read it."; return 1; }
	# The services start without a keyboard: the key login must already work.
	if ! ssh -p "$PROXY_SSH_PORT" ${key} -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$PROXY_SERVER" exit; then
		err "ssh to ${PROXY_SERVER} needs a key that works without a password. Fix that first."
		return 1
	fi
	# Install gost now (through a temporary tunnel) so the bridge service can start offline of GitHub.
	if [[ ! -x "$GOST" ]]; then gost_install || return 1; fi
	tunnel_stop >/dev/null 2>&1
	cat >"$SERVICE_TUNNEL" <<EOF
[Unit]
Description=Congress Platform SSH SOCKS tunnel (${PROXY_SERVER})
After=network-online.target
Wants=network-online.target

[Service]
Environment=HOME=${HOME:-/root}
ExecStart=${ssh_bin} -N -D 127.0.0.1:${PROXY_PORT} -p ${PROXY_SSH_PORT} ${key} -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new ${PROXY_SERVER}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
	cat >"$SERVICE_BRIDGE" <<EOF
[Unit]
Description=Congress Platform HTTP bridge (gost to the SOCKS tunnel)
# docker.service first: the bridge also listens on the Docker bridge address, which exists once Docker is up.
After=congress-proxy-tunnel.service docker.service network-online.target
Wants=congress-proxy-tunnel.service

[Service]
Environment=CONGRESS_PROXY_CONF=${conf}
Environment=HOME=${HOME:-/root}
ExecStartPre=-${self} firewall
ExecStart=${self} bridge-foreground
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
	systemctl daemon-reload
	systemctl enable --now congress-proxy-tunnel.service congress-proxy-bridge.service
	sleep 3
	ok "Services installed and started (they also start at boot). Status: $0 status"
}

service_uninstall() {
	as_root systemctl disable --now congress-proxy-bridge.service congress-proxy-tunnel.service >/dev/null 2>&1 || true
	as_root rm -f "$SERVICE_TUNNEL" "$SERVICE_BRIDGE"
	as_root systemctl daemon-reload
	ok "Services removed"
}

# Used by the bridge service: gost in the foreground (systemd supervises it).
bridge_foreground() {
	[[ -x "$GOST" ]] || { err "gost is missing at ${GOST}. Run: $0 install-gost"; return 1; }
	gost_args
	exec "$GOST" "${GOST_ARGS[@]}"
}

# ─────────────────────────── containers (run-time proxy) ───────────────────────────

env_set() {
	local f="$1" k="$2" v="$3"
	if grep -q "^${k}=" "$f"; then
		sed -i.bak "s|^${k}=.*|${k}=${v}|" "$f" && rm -f "${f}.bak"
	else
		printf '%s=%s\n' "$k" "$v" >>"$f"
	fi
}

# Writes the run-time proxy into .staging/staging.env (read by deploy/staging/compose.yaml).
#   containers        Caddy (web) uses the proxy: certificate requests, renewals, OCSP
#   containers --api  the API too (only if it must reach something through the proxy; sms.ir normally must not)
#   containers off    nobody uses it
containers_configure() {
	local file="${CONGRESS_ROOT}/.staging/staging.env" mode="${1:-web}" url="http://host.docker.internal:${CONGRESS_HTTP_BRIDGE_PORT}"
	[[ -f "$file" ]] || { err "${file} not found. Create it first (docs/deployment)."; return 1; }
	local np="localhost,127.0.0.1,::1,db,api,web,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
	[[ -n "$CONGRESS_EXTRA_NO_PROXY" ]] && np="${np},${CONGRESS_EXTRA_NO_PROXY}"
	case "$mode" in
	off | --off)
		env_set "$file" CONGRESS_WEB_PROXY ""
		env_set "$file" CONGRESS_API_PROXY ""
		ok "Containers use no proxy. Apply with: $0 stack start"
		return 0
		;;
	web | "") env_set "$file" CONGRESS_API_PROXY "" ;;
	--api | api)
		env_set "$file" CONGRESS_API_PROXY "$url"
		warn "The API now uses the proxy for everything, including api.sms.ir, unless it is in CONGRESS_EXTRA_NO_PROXY."
		;;
	*) err "usage: $0 containers [--api | off]"; return 1 ;;
	esac
	env_set "$file" CONGRESS_WEB_PROXY "$url"
	env_set "$file" CONGRESS_RUNTIME_NO_PROXY "$np"
	ok "Written to ${file}: web proxy ${url}"
	services_installed || warn "The tunnel and bridge only run while you start them. For certificate renewals run: $0 install-service"
	info "Apply with: $0 stack start   (recreates the changed containers)"
}

# ─────────────────────────── system settings (root) ───────────────────────────

apt_setup() {
	ensure_up || return 1
	local p
	p="$(host_http_proxy)"
	printf 'Acquire::http::Proxy "%s";\nAcquire::https::Proxy "%s";\n' "$p" "$p" | as_root tee "$APT_PROXY_CONF" >/dev/null
	ok "apt now uses ${p} (while the tunnel is up). Remove with: $0 apt-off"
}

apt_off() {
	as_root rm -f "$APT_PROXY_CONF"
	ok "apt proxy removed"
}

docker_setup() {
	command -v docker >/dev/null 2>&1 || { err "Docker is not installed yet. Install it first (see docs/deployment/PROXY.md)."; return 1; }
	local socks="socks5://127.0.0.1:${PROXY_PORT}" np
	np="$(no_proxy_list)"
	as_root mkdir -p "$DOCKER_PROXY_DIR"
	as_root tee "$DOCKER_PROXY_CONF" >/dev/null <<EOF
[Service]
Environment="HTTP_PROXY=${socks}"
Environment="HTTPS_PROXY=${socks}"
Environment="ALL_PROXY=${socks}"
Environment="NO_PROXY=${np}"
EOF
	as_root systemctl daemon-reload
	info "Restarting Docker (running containers restart too)..."
	as_root systemctl restart docker
	sleep 3
	docker info >/dev/null 2>&1 || { err "Docker did not come back. See: journalctl -u docker"; return 1; }
	ok "Docker pulls now use ${socks}. The tunnel must be up when you pull or build."
}

docker_off() {
	as_root rm -f "$DOCKER_PROXY_CONF"
	as_root systemctl daemon-reload
	as_root systemctl restart docker
	ok "Docker proxy removed"
}

docker_status() {
	if [[ -f "$DOCKER_PROXY_CONF" ]]; then
		ok "Docker daemon proxy is ON (${DOCKER_PROXY_CONF})"
		sed 's/^/    /' "$DOCKER_PROXY_CONF"
	else
		info "Docker daemon proxy is OFF (direct internet)"
	fi
	[[ -f "$APT_PROXY_CONF" ]] && info "apt proxy is ON (${APT_PROXY_CONF})" || info "apt proxy is OFF"
	if services_installed; then
		ok "permanent services: tunnel $(systemctl is-active congress-proxy-tunnel.service), bridge $(systemctl is-active congress-proxy-bridge.service)"
	else
		info "permanent services are not installed (run: $0 install-service)"
	fi
	local envf="${CONGRESS_ROOT}/.staging/staging.env" v
	if [[ -f "$envf" ]]; then
		v="$(grep '^CONGRESS_WEB_PROXY=' "$envf" | cut -d= -f2-)"
		[[ -n "$v" ]] && ok "Caddy (web) container proxy: ${v}" || info "Caddy (web) container proxy: none (direct)"
		v="$(grep '^CONGRESS_API_PROXY=' "$envf" | cut -d= -f2-)"
		[[ -n "$v" ]] && ok "API container proxy: ${v}" || info "API container proxy: none (direct)"
	fi
	tcp_open 127.0.0.1 "$PROXY_PORT" && ok "SOCKS tunnel is listening on 127.0.0.1:${PROXY_PORT}" || warn "SOCKS tunnel is NOT running"
	tcp_open 127.0.0.1 "$CONGRESS_HTTP_BRIDGE_PORT" && ok "HTTP bridge is listening on 127.0.0.1:${CONGRESS_HTTP_BRIDGE_PORT}" || warn "HTTP bridge is NOT running"
}

proxychains_setup() {
	ensure_up || return 1
	command -v proxychains4 >/dev/null 2>&1 || as_root apt-get install -y proxychains4 || return 1
	mkdir -p "$CONGRESS_PROXY_STATE"
	cat >"$PROXYCHAINS_CONF" <<EOF
strict_chain
proxy_dns
tcp_read_time_out 15000
tcp_connect_time_out 8000
localnet 127.0.0.0/255.0.0.0
localnet 10.0.0.0/255.0.0.0
localnet 172.16.0.0/255.240.0.0
localnet 192.168.0.0/255.255.0.0
[ProxyList]
socks5 127.0.0.1 ${PROXY_PORT}
EOF
	ok "proxychains ready (private config: ${PROXYCHAINS_CONF}); system files untouched"
}

# One-time preparation on a bare server: tunnel, gost, apt, proxychains.
bootstrap() {
	ensure_up || return 1
	apt_setup || return 1
	as_root apt-get update || warn "apt-get update reported problems"
	proxychains_setup || return 1
	echo
	ok "Done. Next: install Docker and Node (docs/deployment/PROXY.md), then: $0 docker-setup"
}

# ─────────────────────────── checks ───────────────────────────

test_all() {
	local failed=0
	if tcp_open 127.0.0.1 "$PROXY_PORT"; then ok "SOCKS port ${PROXY_PORT} is open"; else err "SOCKS port ${PROXY_PORT} is closed (run: $0 start)"; return 1; fi
	if curl -fsS -o /dev/null --max-time 20 --socks5-hostname "127.0.0.1:${PROXY_PORT}" https://registry.npmjs.org/; then ok "npm registry reachable through SOCKS"; else err "npm registry NOT reachable through SOCKS"; failed=1; fi
	if tcp_open 127.0.0.1 "$CONGRESS_HTTP_BRIDGE_PORT"; then
		curl -fsS -o /dev/null --max-time 20 -x "$(host_http_proxy)" https://pypi.org/simple/ && ok "PyPI reachable through the HTTP bridge" || { err "PyPI NOT reachable through the HTTP bridge"; failed=1; }
	else
		err "HTTP bridge is not running (run: $0 start)"; failed=1
	fi
	curl -fsS -o /dev/null --max-time 20 -x "$(host_http_proxy)" https://acme-v02.api.letsencrypt.org/directory && ok "Let's Encrypt (ACME) reachable through the HTTP bridge" || { err "Let's Encrypt NOT reachable through the HTTP bridge"; failed=1; }
	if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
		local gw net="bridge"
		gw="$(docker_gateway)"
		if docker run --rm --network bridge alpine:3.20 nc -z -w 4 "$gw" "$CONGRESS_HTTP_BRIDGE_PORT" >/dev/null 2>&1; then
			ok "build containers can reach the bridge at ${gw}:${CONGRESS_HTTP_BRIDGE_PORT}"
		else
			err "build containers can NOT reach ${gw}:${CONGRESS_HTTP_BRIDGE_PORT} (run as root: $0 firewall; also check that the alpine image can be pulled)"; failed=1
		fi
		# What Caddy really does: reach the host from the Compose project's own network.
		docker network inspect congress-staging_edge >/dev/null 2>&1 && net=congress-staging_edge
		if docker run --rm --network "$net" --add-host host.docker.internal:host-gateway alpine:3.20 nc -z -w 4 host.docker.internal "$CONGRESS_HTTP_BRIDGE_PORT" >/dev/null 2>&1; then
			ok "containers on '${net}' can reach host.docker.internal:${CONGRESS_HTTP_BRIDGE_PORT}"
		else
			err "containers on '${net}' can NOT reach host.docker.internal:${CONGRESS_HTTP_BRIDGE_PORT} (firewall: $0 firewall)"; failed=1
		fi
	fi
	return "$failed"
}

# ─────────────────────────── running things ───────────────────────────

# Exports for the current shell: eval "$(./congress-proxy.sh env)"
print_env() {
	local p np
	p="$(host_http_proxy)"; np="$(no_proxy_list)"
	for k in HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy; do echo "export ${k}=${p}"; done
	echo "export NO_PROXY=\"${np}\""; echo "export no_proxy=\"${np}\""
}

# Any command through the SOCKS tunnel (works for git over ssh, scp, ...).
run_proxied() {
	[[ $# -gt 0 ]] || { err "usage: $0 run <command...>"; return 1; }
	ensure_up || return 1
	[[ -f "$PROXYCHAINS_CONF" ]] || proxychains_setup || return 1
	proxychains4 -q -f "$PROXYCHAINS_CONF" "$@"
}

# stack.mjs with the build proxy set. The tunnel stays up only for the duration of the command.
run_stack() {
	[[ -f "${CONGRESS_ROOT}/scripts/staging/stack.mjs" ]] || { err "No repository at ${CONGRESS_ROOT} (set CONGRESS_ROOT)"; return 1; }
	local was_up=0
	tcp_open 127.0.0.1 "$PROXY_PORT" && was_up=1
	ensure_up || return 1
	export CONGRESS_BUILD_PROXY="$(build_http_proxy)"
	export CONGRESS_BUILD_NO_PROXY="$(no_proxy_list)"
	info "Build proxy for this run: ${CONGRESS_BUILD_PROXY}"
	local status=0
	(cd "$CONGRESS_ROOT" && node scripts/staging/stack.mjs "$@") || status=$?
	# A tunnel opened just for this command is closed again; the permanent services are never stopped here.
	if [[ "$was_up" -eq 0 ]] && ! services_installed; then tunnel_stop; fi
	return "$status"
}

print_help() {
	cat <<EOF
Congress Platform proxy helper (config: ${CONF})

First time on a bare server:
  start            open the SSH tunnel and the HTTP bridge
  bootstrap        start + apt proxy + proxychains (then install Docker and Node)
  docker-setup     make Docker pull images through the tunnel (restarts Docker once)
  test             check the tunnel, the bridge and the build containers

Containers at run time (certificates, renewals):
  install-service  tunnel + bridge as systemd services: always on, restart on failure, start at boot
  containers       Caddy (web) uses the proxy: writes .staging/staging.env; then run: stack start
  containers --api also the API (normally not: sms.ir should be reached directly)
  containers off   containers go direct again

Every deploy:
  stack <args>     node scripts/staging/stack.mjs <args> with the build proxy (e.g. stack up)
  deploy           stack up, then stack check

Other:
  stop             close the tunnel and the bridge
  status           what is on or off
  env              print export lines for this shell:  eval "\$($0 env)"
  run <command>    run any command through the tunnel (git clone over ssh, scp, ...)
  apt-setup | apt-off | docker-off | firewall | install-gost | config
EOF
}

show_config() {
	echo "  PROXY_SERVER=${PROXY_SERVER:-<not set>}   PROXY_SSH_PORT=${PROXY_SSH_PORT}   PROXY_PORT=${PROXY_PORT}"
	echo "  HTTP bridge (this server): $(host_http_proxy)"
	echo "  HTTP bridge (builds):      $(build_http_proxy)"
	echo "  CONGRESS_ROOT=${CONGRESS_ROOT}   state=${CONGRESS_PROXY_STATE}"
	echo "  NO_PROXY=$(no_proxy_list)"
}

main() {
	local cmd="${1:-help}"
	[[ $# -gt 0 ]] && shift
	case "$cmd" in
	start | start-tunnel) ensure_up ;;
	stop | stop-tunnel) tunnel_stop ;;
	status) docker_status ;;
	bootstrap | setup) bootstrap ;;
	apt-setup) apt_setup ;;
	apt-off) apt_off ;;
	docker-setup | setup-docker) docker_setup ;;
	docker-off) docker_off ;;
	firewall) firewall_allow_docker ;;
	install-service) service_install ;;
	uninstall-service) service_uninstall ;;
	bridge-foreground) bridge_foreground ;;
	containers) containers_configure "$@" ;;
	install-gost) gost_install ;;
	test | verify) test_all ;;
	env) print_env ;;
	run) run_proxied "$@" ;;
	stack) run_stack "$@" ;;
	deploy)
		run_stack up || return 1
		(cd "$CONGRESS_ROOT" && node scripts/staging/stack.mjs check)
		;;
	config) show_config ;;
	help | -h | --help) print_help ;;
	*) err "Unknown command: ${cmd}"; print_help; return 1 ;;
	esac
}

main "$@"
