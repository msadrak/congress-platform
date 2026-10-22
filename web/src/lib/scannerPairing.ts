/**
 * Scanner pairing links: an organizer issues a point-scoped device token and hands it to a phone as
 * `/scan/<pointId>?token=<token>`. The scanner page stores the token and strips it from the address bar;
 * the edge proxy drops the `token` query parameter from its access logs.
 */

export function scannerPairingUrl(origin: string, pointId: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/scan/${encodeURIComponent(pointId)}?token=${encodeURIComponent(token)}`;
}

/**
 * True when the console itself is opened through a loopback address. A pairing link built from that
 * origin points every phone at itself, so the console warns instead of silently handing out a dead link.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}
