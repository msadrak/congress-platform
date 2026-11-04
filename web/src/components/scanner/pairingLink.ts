/**
 * Reads a scanned pairing QR code: the link `scannerPairingUrl` builds (`<origin>/scan/<pointId>?token=<token>`).
 * The installed app pairs by scanning it, because a home-screen app on iOS does not share the browser's storage.
 */
export type PairingScan = { kind: "ok"; token: string } | { kind: "wrongPoint" } | { kind: "notPairing" };

export function readPairingScan(value: string, pointId: string): PairingScan {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { kind: "notPairing" };
  }
  const match = /^\/scan\/([^/]+)\/?$/.exec(url.pathname);
  const token = url.searchParams.get("token")?.trim();
  if (!match || !token) return { kind: "notPairing" };
  let scanned: string;
  try {
    scanned = decodeURIComponent(match[1]);
  } catch {
    return { kind: "notPairing" };
  }
  return scanned === pointId ? { kind: "ok", token } : { kind: "wrongPoint" };
}
