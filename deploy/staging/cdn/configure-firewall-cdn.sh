#!/usr/bin/env bash
#
# Host firewall for a Congress server behind ParsPack CDN (same idea as DrGibi scripts/configure_firewall.sh).
# On ports 80 and 443, only ParsPack's published ranges may reach Docker; SSH and outbound traffic stay as they are.
#
#   sudo deploy/staging/cdn/configure-firewall-cdn.sh          # apply
#   sudo deploy/staging/cdn/configure-firewall-cdn.sh --remove # undo only the CDN rules
#
# The list is deploy/staging/cdn/cdnips.txt (refresh with: node scripts/staging/stack.mjs cdn sync).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CDN_IPS_FILE="${CONGRESS_CDN_IPS_FILE:-${SCRIPT_DIR}/cdnips.txt}"
CHAIN=CONGRESS-CDN-ALLOWED

red() { printf '\033[0;31m%s\033[0m\n' "$*" >&2; }
ok() { printf '\033[0;32m[ok]\033[0m %s\n' "$*"; }
info() { printf '[firewall] %s\n' "$*"; }

[[ "$(id -u)" -eq 0 ]] || { red "Run as root: sudo $0"; exit 1; }
command -v iptables >/dev/null || { red "iptables not found"; exit 1; }

remove_rules() {
	info "Removing Congress CDN firewall rules ..."
	iptables -D DOCKER-USER -p tcp -m multiport --dports 80,443 -j "$CHAIN" 2>/dev/null || true
	iptables -D DOCKER-USER -p tcp -m multiport --dports 80,443 -j DROP 2>/dev/null || true
	iptables -F "$CHAIN" 2>/dev/null || true
	iptables -X "$CHAIN" 2>/dev/null || true
	ok "CDN firewall rules removed"
}

if [[ "${1:-}" == "--remove" ]]; then
	remove_rules
	exit 0
fi

[[ -f "$CDN_IPS_FILE" ]] || { red "Missing ${CDN_IPS_FILE} (run: node scripts/staging/stack.mjs cdn sync)"; exit 1; }

info "Allowing return traffic and Docker outbound (same as DrGibi DOCKER-USER baseline) ..."
iptables -C DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null ||
	iptables -I DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
for cidr in 172.16.0.0/12 192.168.0.0/16 10.0.0.0/8; do
	iptables -C DOCKER-USER -s "$cidr" -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -s "$cidr" -j ACCEPT
done

iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"
count=0
while IFS= read -r line || [[ -n "$line" ]]; do
	line="${line%%#*}"
	line="$(echo "$line" | xargs)"
	[[ -n "$line" ]] || continue
	iptables -A "$CHAIN" -s "$line" -j ACCEPT
	count=$((count + 1))
done <"$CDN_IPS_FILE"

iptables -C DOCKER-USER -p tcp -m multiport --dports 80,443 -j "$CHAIN" 2>/dev/null ||
	iptables -I DOCKER-USER -p tcp -m multiport --dports 80,443 -j "$CHAIN"
iptables -C DOCKER-USER -p tcp -m multiport --dports 80,443 -j DROP 2>/dev/null ||
	iptables -A DOCKER-USER -p tcp -m multiport --dports 80,443 -j DROP

ok "Ports 80/443 on Docker: ${count} ParsPack ranges allowed; everything else dropped (SSH unchanged)."
info "Caddy also answers 403 for direct visitors when CONGRESS_CDN_ONLY=on (see stack.mjs cdn parspack)."
