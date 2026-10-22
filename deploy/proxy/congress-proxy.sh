#!/usr/bin/env bash
#
# Congress Platform — deploy from a server without direct internet, through an SSH bastion.
# Same method as DrGibi (DrGibi-Deploy-ML/drgibi-proxy.sh):
#
#   this server ──ssh -D 127.0.0.1:1080──► bastion ──► internet
#     ├─ Docker daemon (systemd drop-in) ......... docker pull and the base images of docker build
#     ├─ gost HTTP bridge on docker0:8118 ......... npm ci / uv sync inside docker build
#     └─ proxychains4 ............................. git, curl, apt on this server (`git`, `run`)
#
# Configure once:  cp congress-proxy.conf.example congress-proxy.conf   # bastion, SSH port, SOCKS port
#                  ./congress-proxy.sh setup && ./congress-proxy.sh verify
# Every deploy:    ./congress-proxy.sh git pull && ./congress-proxy.sh deploy
#
# A command that needs the tunnel opens it and closes it when it ends. A tunnel that is already listening
# (start-tunnel, or DrGibi's on the same server) is used as it is and left running.
# Guide: docs/deployment/PROXY-QUICK-START.md

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${CONGRESS_PROXY_CONF:-${SCRIPT_DIR}/congress-proxy.conf}"
# shellcheck disable=SC1090
[[ -f "$CONF" ]] && source "$CONF"

# Defaults — override in congress-proxy.conf (or the environment).
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

DOCKER_DROPIN_DIR=/etc/systemd/system/docker.service.d
DOCKER_DROPIN="${DOCKER_DROPIN_DIR}/congress-proxy.conf"
# DrGibi's drop-in. When both exist, systemd applies it last, so its settings win.
DRGIBI_DROPIN="${DOCKER_DROPIN_DIR}/http-proxy.conf"
TUNNEL_SOCKET="${CONGRESS_PROXY_STATE}/tunnel.sock"
GOST="${CONGRESS_PROXY_STATE}/gost"
GOST_PID="${CONGRESS_PROXY_STATE}/gost.pid"
GOST_LOG="${CONGRESS_PROXY_STATE}/gost.log"
PROXYCHAINS_CONF="${CONGRESS_PROXY_STATE}/proxychains.conf"
# Pulled from Docker Hub like postgres:16-alpine, so the probe also proves that path (same image as DrGibi).
PROBE_IMAGE=alpine:3.20
# Left behind by the previous version of this script (always-on services, apt pointed at the bridge).
LEGACY_UNITS=(congress-proxy-bridge.service congress-proxy-tunnel.service)
LEGACY_APT_CONF=/etc/apt/apt.conf.d/95congress-proxy

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok() { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
log_err() { echo -e "${RED}[✗]${NC} $*" >&2; }

as_root() {
	if [[ "$(id -u)" -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

port_open() {
	if command -v nc >/dev/null 2>&1; then
		nc -z -w 2 "$1" "$2" >/dev/null 2>&1
	else
		timeout 2 bash -c "exec 3<>/dev/tcp/$1/$2" >/dev/null 2>&1
	fi
}

wait_port() {
	local i
	for ((i = 0; i < $3 * 2; i++)); do
		port_open "$1" "$2" && return 0
		sleep 0.5
	done
	return 1
}

docker_up() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

# This server's address on the default Docker bridge: where docker build RUN steps reach the host.
docker_gateway() {
	local gw
	gw="$(ip -4 -o addr show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
	if [[ -z "$gw" ]] && docker_up; then
		gw="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null)"
	fi
	[[ -n "$gw" && "$gw" != "<no value>" ]] || gw=172.17.0.1
	echo "$gw"
}

no_proxy_list() {
	local list="localhost,127.0.0.1,::1,*.local,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16"
	[[ -n "$CONGRESS_EXTRA_NO_PROXY" ]] && list="${list},${CONGRESS_EXTRA_NO_PROXY}"
	echo "$list"
}

socks_url() { echo "socks5://127.0.0.1:${PROXY_PORT}"; }
bridge_url() { echo "http://127.0.0.1:${CONGRESS_HTTP_BRIDGE_PORT}"; }
build_proxy_url() { echo "http://$(docker_gateway):${CONGRESS_HTTP_BRIDGE_PORT}"; }

require_server() {
	if [[ -z "$PROXY_SERVER" || "$PROXY_SERVER" == *YOUR_BASTION* ]]; then
		log_err "PROXY_SERVER is not set. Run: cp ${SCRIPT_DIR}/congress-proxy.conf.example ${CONF}  and edit it."
		exit 1
	fi
}

ssh_args() {
	SSH_ARGS=(-p "$PROXY_SSH_PORT" -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new)
	[[ -n "$PROXY_SSH_KEY" ]] && SSH_ARGS+=(-i "$PROXY_SSH_KEY")
}

# What this run opened, closed again on exit unless KEEP_OPEN=1 (start-tunnel).
OPENED_TUNNEL=0
OPENED_BRIDGE=0
REUSED_TUNNEL=0
KEEP_OPEN=0

close_opened() {
	if [[ "$KEEP_OPEN" -eq 0 ]]; then
		[[ "$OPENED_BRIDGE" -eq 1 ]] && bridge_stop
		[[ "$OPENED_TUNNEL" -eq 1 ]] && tunnel_stop
	fi
	return 0
}
trap close_opened EXIT
trap 'exit 130' INT TERM

# --- tunnel (ssh -D) -------------------------------------------------------------------

tunnel_ours() { [[ -S "$TUNNEL_SOCKET" ]] && ssh -S "$TUNNEL_SOCKET" -O check "$PROXY_SERVER" >/dev/null 2>&1; }

tunnel_start() {
	require_server
	if port_open 127.0.0.1 "$PROXY_PORT"; then
		if [[ "$OPENED_TUNNEL" -eq 0 && "$REUSED_TUNNEL" -eq 0 ]]; then
			log_info "Using the tunnel already listening on 127.0.0.1:${PROXY_PORT}"
			REUSED_TUNNEL=1
		fi
		return 0
	fi
	mkdir -p "$CONGRESS_PROXY_STATE"
	rm -f "$TUNNEL_SOCKET"
	log_info "Opening SSH tunnel to ${PROXY_SERVER} (port ${PROXY_SSH_PORT}), SOCKS on 127.0.0.1:${PROXY_PORT}..."
	ssh_args
	# -M -S: a control socket, so the tunnel can be checked and closed exactly (ssh -O check / -O exit).
	if ! ssh "${SSH_ARGS[@]}" -f -N -M -S "$TUNNEL_SOCKET" -D "127.0.0.1:${PROXY_PORT}" \
		-o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 "$PROXY_SERVER"; then
		log_err "ssh to ${PROXY_SERVER} failed. Test it by hand: ssh -p ${PROXY_SSH_PORT} ${PROXY_SERVER}"
		return 1
	fi
	OPENED_TUNNEL=1
	if ! wait_port 127.0.0.1 "$PROXY_PORT" 10; then
		log_err "The tunnel is not listening on 127.0.0.1:${PROXY_PORT}"
		return 1
	fi
	log_ok "Tunnel up"
}

tunnel_stop() {
	if tunnel_ours; then
		ssh -S "$TUNNEL_SOCKET" -O exit "$PROXY_SERVER" >/dev/null 2>&1
		log_ok "Tunnel closed"
	elif port_open 127.0.0.1 "$PROXY_PORT"; then
		log_info "127.0.0.1:${PROXY_PORT} belongs to a tunnel this script did not open (DrGibi's?); left running"
	fi
	rm -f "$TUNNEL_SOCKET"
}

# --- HTTP bridge (gost: HTTP CONNECT -> SOCKS) -----------------------------------------
# npm and uv inside docker build speak HTTP proxies, not SOCKS; gost turns one into the other (as in DrGibi).

gost_install() {
	[[ -x "$GOST" ]] && return 0
	local os arch file url
	case "$(uname -s)" in
	Linux) os=linux ;;
	Darwin) os=darwin ;;
	*) log_err "Unsupported OS: $(uname -s)"; return 1 ;;
	esac
	case "$(uname -m)" in
	x86_64 | amd64) arch=amd64 ;;
	aarch64 | arm64) arch=arm64 ;;
	*) log_err "Unsupported CPU: $(uname -m)"; return 1 ;;
	esac
	file="gost_${GOST_RELEASE}_${os}_${arch}.tar.gz"
	url="https://github.com/go-gost/gost/releases/download/v${GOST_RELEASE}/${file}"
	tunnel_start || return 1
	mkdir -p "$CONGRESS_PROXY_STATE"
	log_info "Downloading gost ${GOST_RELEASE} through the tunnel..."
	if ! curl -fsSL --connect-timeout 30 --socks5-hostname "127.0.0.1:${PROXY_PORT}" "$url" -o "${CONGRESS_PROXY_STATE}/${file}"; then
		log_err "Could not download ${url}"
		return 1
	fi
	tar -xzf "${CONGRESS_PROXY_STATE}/${file}" -C "$CONGRESS_PROXY_STATE" gost && chmod +x "$GOST"
	rm -f "${CONGRESS_PROXY_STATE}/${file}"
	[[ -x "$GOST" ]] || { log_err "gost is missing after extracting ${file}"; return 1; }
	log_ok "gost installed: ${GOST}"
}

gost_running() { [[ -f "$GOST_PID" ]] && kill -0 "$(cat "$GOST_PID")" 2>/dev/null; }

bridge_start() {
	local hp="$CONGRESS_HTTP_BRIDGE_PORT" gw=""
	docker_up && gw="$(docker_gateway)"
	if port_open 127.0.0.1 "$hp"; then
		if [[ -z "$gw" ]] || port_open "$gw" "$hp"; then
			return 0
		fi
		# Ours, started before Docker was running: restart it so it listens on docker0 too.
		if gost_running; then
			bridge_stop
		else
			log_err "Port ${hp} is in use on 127.0.0.1 but not on ${gw} (docker build needs it there). Free it or set CONGRESS_HTTP_BRIDGE_PORT."
			return 1
		fi
	fi
	tunnel_start && gost_install || return 1
	# Loopback for this server, docker0 for build containers. Never 0.0.0.0: that would be an open proxy.
	local -a listen=(-L "http://127.0.0.1:${hp}")
	[[ -n "$gw" ]] && listen+=(-L "http://${gw}:${hp}")
	nohup "$GOST" "${listen[@]}" -F "$(socks_url)" >>"$GOST_LOG" 2>&1 &
	echo $! >"$GOST_PID"
	OPENED_BRIDGE=1
	if ! wait_port 127.0.0.1 "$hp" 10 || { [[ -n "$gw" ]] && ! port_open "$gw" "$hp"; }; then
		log_err "gost did not start. Last lines of ${GOST_LOG}:"
		tail -n 15 "$GOST_LOG" >&2
		return 1
	fi
	log_ok "HTTP bridge up: $(bridge_url)${gw:+ (docker build: http://${gw}:${hp})}"
}

bridge_stop() {
	if gost_running; then
		kill "$(cat "$GOST_PID")" 2>/dev/null
		log_ok "HTTP bridge stopped"
	fi
	rm -f "$GOST_PID"
}

# Build containers reach the bridge through docker0; a host firewall (UFW) usually drops that. Same rule as DrGibi.
# Needs root (or sudo without a password); without it the build-container check says what to do.
firewall_allow_docker() {
	[[ -d /sys/class/net/docker0 ]] && command -v iptables >/dev/null 2>&1 || return 0
	[[ "$(id -u)" -eq 0 ]] || sudo -n true 2>/dev/null || return 0
	as_root iptables -C INPUT -i docker0 -p tcp --dport "$CONGRESS_HTTP_BRIDGE_PORT" -j ACCEPT 2>/dev/null ||
		as_root iptables -I INPUT -i docker0 -p tcp --dport "$CONGRESS_HTTP_BRIDGE_PORT" -j ACCEPT
}

proxy_up() {
	tunnel_start && bridge_start || return 1
	firewall_allow_docker
}

# True if a container on the default bridge (where docker build RUN steps run) reaches the HTTP bridge.
build_container_reaches_bridge() {
	docker run --rm --network bridge "$PROBE_IMAGE" nc -z -w 5 "$(docker_gateway)" "$CONGRESS_HTTP_BRIDGE_PORT" >/dev/null 2>&1
}

# --- Docker daemon proxy (systemd drop-in) ---------------------------------------------

docker_dropin_content() {
	cat <<EOF
# Written by congress-proxy.sh (enable): Docker pulls images through the SSH tunnel.
[Service]
Environment="HTTP_PROXY=$(socks_url)"
Environment="HTTPS_PROXY=$(socks_url)"
Environment="NO_PROXY=$(no_proxy_list)"
EOF
}

# The proxy the running Docker daemon really uses (empty: none, or Docker is down). A drop-in counts only after a restart.
docker_daemon_proxy() { docker info --format '{{.HTTPSProxy}}' 2>/dev/null; }

docker_restart() {
	as_root systemctl daemon-reload && as_root systemctl restart docker || return 1
	local i
	for ((i = 0; i < 30; i++)); do
		docker info >/dev/null 2>&1 && return 0
		sleep 1
	done
	log_err "Docker did not come back. See: journalctl -u docker"
	return 1
}

docker_enable() {
	command -v docker >/dev/null 2>&1 || { log_err "Docker is not installed yet (docs/deployment/PROXY.md: bare server)"; return 1; }
	if [[ -f "$DOCKER_DROPIN" && "$(cat "$DOCKER_DROPIN")" == "$(docker_dropin_content)" && -n "$(docker_daemon_proxy)" ]]; then
		log_ok "Docker proxy already enabled (${DOCKER_DROPIN})"
		return 0
	fi
	as_root mkdir -p "$DOCKER_DROPIN_DIR"
	docker_dropin_content | as_root tee "$DOCKER_DROPIN" >/dev/null
	log_info "Restarting Docker (running containers restart with it)..."
	docker_restart || return 1
	log_ok "Docker pulls images through $(socks_url); deploy opens the tunnel while it pulls"
}

docker_disable() {
	if [[ ! -f "$DOCKER_DROPIN" ]]; then
		log_ok "Docker proxy already disabled"
		return 0
	fi
	as_root rm -f "$DOCKER_DROPIN"
	docker_restart || return 1
	log_ok "Docker proxy disabled: pulls go direct"
}

# --- proxychains4 (git, curl, apt on this server) ----------------------------------------

install_proxychains() {
	if command -v proxychains4 >/dev/null 2>&1; then
		log_ok "proxychains4 installed"
		return 0
	fi
	command -v apt-get >/dev/null 2>&1 || { log_err "Install proxychains4 (proxychains-ng) with your package manager"; return 1; }
	log_info "Installing proxychains4..."
	local -a apt=(env DEBIAN_FRONTEND=noninteractive apt-get -qq -o Acquire::http::Timeout=20 -o Acquire::Retries=0)
	if ! { as_root "${apt[@]}" update >/dev/null 2>&1; as_root "${apt[@]}" install -y proxychains4 >/dev/null 2>&1; }; then
		log_info "The package mirror is not reachable directly; installing through the tunnel..."
		tunnel_start || return 1
		local p="socks5h://127.0.0.1:${PROXY_PORT}"
		apt+=(-o "Acquire::http::Proxy=${p}" -o "Acquire::https::Proxy=${p}")
		as_root "${apt[@]}" update >/dev/null
		as_root "${apt[@]}" install -y proxychains4 >/dev/null || { log_err "apt-get install proxychains4 failed"; return 1; }
	fi
	log_ok "proxychains4 installed"
}

# Written on every use from congress-proxy.conf; the system /etc/proxychains4.conf is not touched.
write_proxychains_conf() {
	mkdir -p "$CONGRESS_PROXY_STATE"
	cat >"$PROXYCHAINS_CONF" <<EOF
# Written by congress-proxy.sh from ${CONF}
strict_chain
proxy_dns
remote_dns_subnet 224
tcp_read_time_out 15000
tcp_connect_time_out 8000
localnet 127.0.0.0/255.0.0.0
localnet 10.0.0.0/255.0.0.0
localnet 172.16.0.0/255.240.0.0
localnet 192.168.0.0/255.255.0.0

[ProxyList]
socks5 127.0.0.1 ${PROXY_PORT}
EOF
}

run_proxied() {
	[[ $# -gt 0 ]] || { log_err "usage: $0 run <command> [args...]"; return 1; }
	command -v proxychains4 >/dev/null 2>&1 || { log_err "proxychains4 is missing. Run: $0 setup"; return 1; }
	tunnel_start || return 1
	write_proxychains_conf
	proxychains4 -q -f "$PROXYCHAINS_CONF" "$@"
}

# --- deploy ----------------------------------------------------------------------------

need_repo() {
	[[ -f "${CONGRESS_ROOT}/scripts/staging/stack.mjs" ]] || {
		log_err "No Congress repository at ${CONGRESS_ROOT} (set CONGRESS_ROOT in ${CONF})"
		return 1
	}
	command -v node >/dev/null 2>&1 || { log_err "Node.js is missing (scripts/staging/stack.mjs needs it)"; return 1; }
}

# Open what docker build needs and export the build proxy that stack.mjs passes as --build-arg.
build_env() {
	docker_up || { log_err "Docker is not running (or this user may not use it)"; return 1; }
	[[ -n "$(docker_daemon_proxy)" ]] || log_warn "The Docker daemon has no proxy: image pulls go direct. Turn it on: $0 enable"
	proxy_up || return 1
	docker image inspect "$PROBE_IMAGE" >/dev/null 2>&1 || docker pull -q "$PROBE_IMAGE" >/dev/null || {
		log_err "docker pull ${PROBE_IMAGE} failed: Docker cannot pull through the tunnel. Run: $0 enable && $0 verify"
		return 1
	}
	build_container_reaches_bridge || {
		log_err "Build containers cannot reach the HTTP bridge at $(build_proxy_url)."
		log_err "Run this command as root (it adds the docker0 firewall rule), or allow docker0 -> port ${CONGRESS_HTTP_BRIDGE_PORT}."
		return 1
	}
	# Inside the build (npm ci, uv sync): the bridge on docker0, passed by stack.mjs as --build-arg.
	export CONGRESS_BUILD_PROXY CONGRESS_BUILD_NO_PROXY
	CONGRESS_BUILD_PROXY="$(build_proxy_url)"
	CONGRESS_BUILD_NO_PROXY="$(no_proxy_list)"
	# The compose/buildx client itself fetches the registry tokens of every image the build needs (BuildKit
	# session auth: FROM images, `# syntax=docker/dockerfile:1`), so it needs the proxy too, as in DrGibi.
	export HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY no_proxy
	HTTP_PROXY="$(bridge_url)"
	HTTPS_PROXY="$HTTP_PROXY" http_proxy="$HTTP_PROXY" https_proxy="$HTTP_PROXY"
	NO_PROXY="$(no_proxy_list)"
	no_proxy="$NO_PROXY"
	log_info "docker build uses ${CONGRESS_BUILD_PROXY}"
}

stack() { (cd "$CONGRESS_ROOT" && node scripts/staging/stack.mjs "$@"); }

deploy() {
	need_repo && build_env || return 1
	log_info "Building and starting the stack (stack.mjs up)..."
	if ! stack up; then
		log_err "Deploy failed (see above). Fix it and run deploy again; layers already built are cached."
		return 1
	fi
	# stack.mjs check: 0 ok, 1 warnings (e.g. no scheduled backup yet), 2 critical.
	local st=0
	stack check || st=$?
	if [[ "$st" -ge 2 ]]; then
		log_err "Deployed, but the health check reports a critical problem (see above)"
		return "$st"
	fi
	[[ "$st" -eq 1 ]] && log_warn "Deployed; the health check has warnings (see above)" || log_ok "Deployed"
	return 0
}

run_stack() {
	need_repo && build_env || return 1
	stack "$@"
}

# --- setup -----------------------------------------------------------------------------

legacy_units_present() {
	local unit
	for unit in "${LEGACY_UNITS[@]}"; do [[ -f "/etc/systemd/system/${unit}" ]] && return 0; done
	return 1
}

legacy_present() { [[ -f "$LEGACY_APT_CONF" ]] || legacy_units_present; }

remove_legacy() {
	local unit f
	if legacy_units_present; then
		as_root systemctl disable --now "${LEGACY_UNITS[@]}" >/dev/null 2>&1
		for unit in "${LEGACY_UNITS[@]}"; do as_root rm -f "/etc/systemd/system/${unit}"; done
		as_root systemctl daemon-reload
		log_ok "Removed the always-on tunnel services of the previous version (commands open the tunnel now)"
	fi
	if [[ -f "$LEGACY_APT_CONF" ]]; then
		as_root rm -f "$LEGACY_APT_CONF"
		log_ok "Removed ${LEGACY_APT_CONF} (apt pointed at a bridge that is no longer always on)"
	fi
	# A tunnel or bridge that the previous version started by hand (no control socket).
	f="${CONGRESS_PROXY_STATE}/tunnel.pid"
	if [[ -f "$f" ]]; then
		kill "$(cat "$f")" 2>/dev/null && log_ok "Stopped the tunnel of the previous version"
		rm -f "$f"
	fi
	gost_running && bridge_stop
	return 0
}

setup() {
	require_server
	log_info "One-time setup: proxychains4, gost, Docker daemon proxy"
	remove_legacy
	install_proxychains || return 1
	gost_install || return 1
	if command -v docker >/dev/null 2>&1; then
		docker_enable || return 1
	else
		log_warn "Docker is not installed yet. Install it through the tunnel (docs/deployment/PROXY.md), then run: $0 enable"
	fi
	echo ""
	log_ok "One-time proxy setup done."
	echo "Next:"
	echo "  1. $0 verify"
	echo "  2. cd ${CONGRESS_ROOT} && $0 deploy"
}

# --- checks ----------------------------------------------------------------------------

PASSED=0
WARNINGS=0
FAILED=0
pass() { log_ok "$1"; PASSED=$((PASSED + 1)); }
warn() { log_warn "$1"; WARNINGS=$((WARNINGS + 1)); }
fail() { log_err "$1"; FAILED=$((FAILED + 1)); }

summary() {
	echo ""
	echo "Passed: ${PASSED}  Warnings: ${WARNINGS}  Failed: ${FAILED}"
	if [[ "$FAILED" -eq 0 ]]; then
		log_ok "OK — run $0 deploy when ready."
		return 0
	fi
	return 1
}

# Live part: the tunnel, the bridge, Docker pulls and build containers, really used.
test_tunnel() {
	log_info "Live test through the tunnel..."
	if ! proxy_up; then
		fail "Tunnel or HTTP bridge did not start (see above)"
		return 0
	fi
	curl -fsS -o /dev/null --max-time 20 --socks5-hostname "127.0.0.1:${PROXY_PORT}" https://registry.npmjs.org/ &&
		pass "SOCKS tunnel reaches the internet (registry.npmjs.org)" ||
		fail "registry.npmjs.org is not reachable through the tunnel (bastion without internet, or its sshd has AllowTcpForwarding no)"
	curl -fsS -o /dev/null --max-time 20 -x "$(bridge_url)" https://pypi.org/simple/ &&
		pass "HTTP bridge reaches PyPI ($(bridge_url))" ||
		fail "PyPI is not reachable through the HTTP bridge (see ${GOST_LOG})"
	if command -v proxychains4 >/dev/null 2>&1; then
		write_proxychains_conf
		proxychains4 -q -f "$PROXYCHAINS_CONF" curl -fsS -o /dev/null --max-time 20 https://github.com/ &&
			pass "proxychains reaches GitHub (the git command)" ||
			fail "proxychains cannot reach github.com"
	fi
	if docker_up; then
		docker pull -q "$PROBE_IMAGE" >/dev/null 2>&1 &&
			pass "Docker pulls images through the tunnel (${PROBE_IMAGE})" ||
			fail "docker pull ${PROBE_IMAGE} failed — is the Docker proxy on? ($0 enable)"
		build_container_reaches_bridge &&
			pass "Build containers reach the HTTP bridge ($(build_proxy_url))" ||
			fail "Build containers cannot reach $(build_proxy_url) — run as root (adds the docker0 firewall rule)"
	fi
}

verify() {
	echo ""
	echo "Congress proxy — verification"
	echo "============================="
	log_info "Settings..."
	[[ -f "$CONF" ]] && pass "settings file ${CONF}" || fail "settings file missing: cp ${SCRIPT_DIR}/congress-proxy.conf.example ${CONF}"
	if [[ -n "$PROXY_SERVER" && "$PROXY_SERVER" != *YOUR_BASTION* ]]; then
		pass "bastion ${PROXY_SERVER} port ${PROXY_SSH_PORT}, SOCKS port ${PROXY_PORT}"
	else
		fail "PROXY_SERVER is not set in ${CONF}"
		summary
		return 1
	fi

	log_info "Tools..."
	local tool
	for tool in ssh curl proxychains4 docker node; do
		command -v "$tool" >/dev/null 2>&1 && pass "$tool" || fail "$tool missing$([[ "$tool" == proxychains4 ]] && echo " — run: $0 setup")"
	done
	if command -v docker >/dev/null 2>&1; then
		docker info >/dev/null 2>&1 && pass "Docker daemon running" || fail "Docker daemon not running"
		docker compose version >/dev/null 2>&1 && pass "docker compose v2" || fail "docker compose v2 missing"
	fi

	log_info "Docker daemon proxy..."
	local running=""
	docker_up && running="$(docker_daemon_proxy)"
	if [[ -n "$running" ]]; then
		pass "the running Docker daemon pulls through ${running}"
		[[ "$running" == "$(socks_url)" ]] ||
			warn "that is not this tunnel ($(socks_url)); DrGibi's ${DRGIBI_DROPIN} wins: use its PROXY_PORT in ${CONF}"
	elif docker_up && [[ -f "$DOCKER_DROPIN" || -f "$DRGIBI_DROPIN" ]]; then
		fail "a drop-in is in place but the running Docker daemon does not use it — run: $0 enable"
	else
		warn "off — image pulls go direct (turn on: $0 enable)"
	fi

	log_info "Repository..."
	if [[ -f "${CONGRESS_ROOT}/scripts/staging/stack.mjs" ]]; then
		pass "repository at ${CONGRESS_ROOT}"
		[[ -f "${CONGRESS_ROOT}/.staging/staging.env" ]] && pass ".staging/staging.env" ||
			warn ".staging/staging.env missing (docs/deployment/HOSTED_STAGING_READINESS.md)"
	else
		warn "no repository at ${CONGRESS_ROOT} yet (clone it: $0 git clone ...)"
	fi
	legacy_present && warn "pieces of the previous congress-proxy.sh are still installed — run: $0 setup"

	log_info "Bastion..."
	ssh_args
	if ssh "${SSH_ARGS[@]}" -o BatchMode=yes "$PROXY_SERVER" exit 2>/dev/null; then
		pass "key login to ${PROXY_SERVER} works"
	else
		warn "key login without a password failed — the tunnel will ask for a password (or fix the key)"
	fi

	test_tunnel
	summary
}

# --- information -----------------------------------------------------------------------

show_status() {
	local hp="$CONGRESS_HTTP_BRIDGE_PORT" gw
	gw="$(docker_gateway)"
	if tunnel_ours; then
		log_ok "Tunnel: open (started by this script) — 127.0.0.1:${PROXY_PORT} -> ${PROXY_SERVER}"
	elif port_open 127.0.0.1 "$PROXY_PORT"; then
		log_ok "Tunnel: 127.0.0.1:${PROXY_PORT} is listening (another tunnel, e.g. DrGibi's)"
	else
		log_info "Tunnel: closed (commands open it when they need it)"
	fi
	if port_open 127.0.0.1 "$hp"; then
		log_ok "HTTP bridge: listening on 127.0.0.1:${hp}$(port_open "$gw" "$hp" && echo " and ${gw}:${hp}")"
	else
		log_info "HTTP bridge: stopped"
	fi
	local running
	running="$(docker_daemon_proxy)"
	if [[ -n "$running" ]]; then
		log_ok "Docker daemon proxy: ON — the running daemon pulls through ${running}"
	elif [[ -f "$DOCKER_DROPIN" ]]; then
		log_warn "Docker daemon proxy: written to ${DOCKER_DROPIN} but not active — run: $0 enable"
	else
		log_info "Docker daemon proxy: OFF (direct pulls)"
	fi
	[[ -f "$DOCKER_DROPIN" ]] && sed 's/^/    /' "$DOCKER_DROPIN"
	[[ -f "$DRGIBI_DROPIN" ]] && log_info "DrGibi's Docker proxy is also present (${DRGIBI_DROPIN}); it takes precedence"
	command -v proxychains4 >/dev/null 2>&1 && log_ok "proxychains4: installed" || log_info "proxychains4: missing (run: $0 setup)"
	legacy_present && log_warn "Pieces of the previous congress-proxy.sh are still installed — run: $0 setup"
	return 0
}

show_config() {
	echo -e "${CYAN}[proxy]${NC} Settings: ${CONF} $([[ -f "$CONF" ]] && echo '(loaded)' || echo '(missing — defaults)')"
	echo "  PROXY_SERVER=${PROXY_SERVER:-<not set>}"
	echo "  PROXY_SSH_PORT=${PROXY_SSH_PORT}"
	echo "  PROXY_SSH_KEY=${PROXY_SSH_KEY:-<ssh default>}"
	echo "  PROXY_PORT=${PROXY_PORT}"
	echo "  CONGRESS_HTTP_BRIDGE_PORT=${CONGRESS_HTTP_BRIDGE_PORT}"
	echo "  CONGRESS_EXTRA_NO_PROXY=${CONGRESS_EXTRA_NO_PROXY:-<empty>}"
	echo "  CONGRESS_ROOT=${CONGRESS_ROOT}"
	echo -e "${CYAN}[proxy]${NC} SOCKS (Docker daemon, git):  $(socks_url)"
	echo -e "${CYAN}[proxy]${NC} HTTP bridge (this server):   $(bridge_url)"
	echo -e "${CYAN}[proxy]${NC} HTTP bridge (docker build):  $(build_proxy_url)"
}

print_env() {
	echo "# Use the tunnel from this shell (after: $0 start-tunnel):  eval \"\$($0 print-env)\""
	local k
	for k in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy; do echo "export ${k}=$(bridge_url)"; done
	echo "export NO_PROXY=\"$(no_proxy_list)\""
	echo "export no_proxy=\"$(no_proxy_list)\""
}

print_help() {
	cat <<EOF

$(echo -e "${CYAN}Congress proxy CLI${NC}") — same method as DrGibi's drgibi-proxy.sh. Settings: ${CONF}

$(echo -e "${YELLOW}Configure once${NC}") (copy congress-proxy.conf.example to congress-proxy.conf)
  PROXY_SERVER        SSH bastion user@host (the one in drgibi-proxy.conf)
  PROXY_SSH_PORT      SSH port of the bastion
  PROXY_PORT          local SOCKS port (default ${PROXY_PORT})

$(echo -e "${YELLOW}Commands${NC}")
  config              Show the settings in use
  setup               One time: proxychains4, gost, Docker daemon proxy (restarts Docker once)
  verify              Check everything, with a live test through the tunnel (alias: doctor)

  git <args>          git through the tunnel, e.g.  $0 git pull
  deploy              Tunnel + build proxy, then stack.mjs up (build, migrate, start) and stack.mjs check

  enable | disable | status       Docker daemon proxy on/off, and what is running
  start-tunnel | stop-tunnel      Keep the tunnel and the HTTP bridge open for manual work
  test-tunnel                     Live test only

  run <command...>    Any command through the tunnel (curl, apt-get, npm, ...)
  stack <args>        node scripts/staging/stack.mjs <args> with the build proxy
  print-env           Export lines for this shell (after start-tunnel)
  install-gost        Download gost ${GOST_RELEASE} (HTTP -> SOCKS bridge for docker build)

Guide: docs/deployment/PROXY-QUICK-START.md
EOF
}

main() {
	local cmd="${1:-help}"
	[[ $# -gt 0 ]] && shift
	case "$cmd" in
	config | show-config) show_config ;;
	setup | init) setup ;;
	verify | doctor | check) verify ;;
	enable) docker_enable ;;
	disable) docker_disable ;;
	status) show_status ;;
	start-tunnel | start)
		proxy_up || return 1
		KEEP_OPEN=1
		log_ok "Tunnel and HTTP bridge stay open. Close them with: $0 stop-tunnel"
		;;
	stop-tunnel | stop)
		bridge_stop
		tunnel_stop
		;;
	test-tunnel | test)
		test_tunnel
		summary
		;;
	deploy) deploy ;;
	stack) run_stack "$@" ;;
	git) run_proxied git "$@" ;;
	run) run_proxied "$@" ;;
	print-env | env) print_env ;;
	install-gost) gost_install ;;
	help | -h | --help) print_help ;;
	*)
		log_err "Unknown command: ${cmd}"
		print_help
		return 1
		;;
	esac
}

main "$@"
