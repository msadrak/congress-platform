import type { CheckInManifest } from "../api/client";

/**
 * Manifest refresh for the gate scanner: the server answers `?since=<cursor>` with a delta (new tickets,
 * admission changes at this point, removed tickets) that is merged into the cached manifest here.
 */

export const MANIFEST_POLL_MS = 30_000;
/** While the server answers, the scanner reports its state (unsynced scans, version) this often. */
export const HEARTBEAT_MS = 60_000;
/** Sent in the heartbeat; bump when the scanner's protocol changes (2: windows, entry/exit, heartbeat). */
export const SCANNER_APP_VERSION = "web-scanner/2";

/**
 * True when the point's rules changed in a way that changes which tickets the manifest must hold, or what every
 * ticket's state means (window, occupancy, required point).
 */
function ticketSetRulesChanged(a: CheckInManifest["checkin_point"], b: CheckInManifest["checkin_point"]): boolean {
  if (a.policy_type !== b.policy_type) return true;
  if ((a.reset_window ?? "EVENT") !== (b.reset_window ?? "EVENT")) return true;
  if (Boolean(a.tracks_occupancy) !== Boolean(b.tracks_occupancy)) return true;
  if ((a.requires_point_id ?? null) !== (b.requires_point_id ?? null)) return true;
  const tiers = (p: CheckInManifest["checkin_point"]) => [...(p.allowed_tier_ids ?? [])].sort().join(",");
  return tiers(a) !== tiers(b);
}

/**
 * The manifest to cache after a fetch. A full manifest replaces the cache. A delta is applied to it
 * (removals first, then upserts by qr_hash); `needsFull` asks for a full fetch instead when there is no
 * cache to apply it to, or the point's policy or tiers changed (tickets outside the delta may now count).
 */
export function mergeManifest(
  cached: CheckInManifest | null,
  incoming: CheckInManifest
): { manifest: CheckInManifest; needsFull: boolean } {
  if (!incoming.is_delta) return { manifest: incoming, needsFull: false };
  if (!cached || ticketSetRulesChanged(cached.checkin_point, incoming.checkin_point)) {
    return { manifest: cached ?? incoming, needsFull: true };
  }
  const byHash: Record<string, CheckInManifest["tickets"][number]> = {};
  for (const t of cached.tickets) byHash[t.qr_hash] = t;
  for (const hash of incoming.removed_qr_hashes ?? []) delete byHash[hash];
  for (const t of incoming.tickets) byHash[t.qr_hash] = t;
  return {
    manifest: {
      ...incoming,
      tickets: Object.values(byHash),
      is_delta: false,
      removed_qr_hashes: [],
    },
    needsFull: false,
  };
}

interface LegacyManifestTicket {
  qr_secret: string;
}

function isLegacyTicket(ticket: object): ticket is LegacyManifestTicket {
  return "qr_secret" in ticket && typeof ticket.qr_secret === "string";
}

/**
 * A manifest cached by an older scanner holds raw QR secrets. It is rewritten with qr_hash so the
 * secrets leave the device; its missing cursor makes the next refresh a full fetch.
 */
export async function upgradeLegacyManifest(
  manifest: CheckInManifest,
  hash: (eventId: string, code: string) => Promise<string>
): Promise<{ manifest: CheckInManifest; upgraded: boolean }> {
  if (!manifest.tickets.some((t) => isLegacyTicket(t) || !t.qr_hash)) return { manifest, upgraded: false };
  const tickets: CheckInManifest["tickets"] = [];
  for (const t of manifest.tickets) {
    if (isLegacyTicket(t)) {
      const { qr_secret, ...rest } = t;
      tickets.push({ ...rest, qr_hash: await hash(manifest.event_id, qr_secret) });
    } else if (t.qr_hash) {
      tickets.push(t);
    }
  }
  return { manifest: { ...manifest, tickets, cursor: "", is_delta: false, removed_qr_hashes: [] }, upgraded: true };
}
