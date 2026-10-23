/**
 * Link passes (ADR 0015): a pass opened from the SMS short link `/t/:code`, kept read-only on this device.
 *
 * Deliberately separate from the owner-scoped ticket cache (ticketCache.ts): a link pass needs no sign-in, so it
 * is not tied to an attendee token and survives sign-in and sign-out. It holds exactly what the link already
 * shows to whoever has the SMS (like a screenshot of the QR): the pass and its QR, never the mobile number and
 * never the link code itself. Each pass is stored under its ticket id and removed once the link's `expires_at`
 * has passed, so it keeps working offline until then.
 */

import type { components } from "../api/schema";
import type { PassCardTicket } from "../components/attendee/DigitalPassCard";

export type LinkPass = components["schemas"]["LinkPassOut"];
export type LinkErrorOut = components["schemas"]["LinkErrorOut"];

export const LINK_PASS_KEY_PREFIX = "congress_link_pass_";

interface LinkPassEnvelope {
  savedAt: number;
  pass: LinkPass;
}

function resolveStorage(customStorage?: Storage | null): Storage | null {
  if (customStorage !== undefined) return customStorage;
  return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
}

/** Shape check for a pass read back from storage or navigation state. */
export function isLinkPass(value: unknown): value is LinkPass {
  if (typeof value !== "object" || value === null) return false;
  if (!("ticket_id" in value) || typeof value.ticket_id !== "string" || !value.ticket_id) return false;
  if (!("qr_secret" in value) || typeof value.qr_secret !== "string" || !value.qr_secret) return false;
  if (!("expires_at" in value) || typeof value.expires_at !== "string") return false;
  if (!("event" in value) || typeof value.event !== "object" || value.event === null) return false;
  if (!("slug" in value.event) || typeof value.event.slug !== "string") return false;
  return "attendee" in value && typeof value.attendee === "object" && value.attendee !== null;
}

function expiry(pass: LinkPass): number {
  const at = Date.parse(pass.expires_at);
  return Number.isNaN(at) ? 0 : at;
}

/** Keep a resolved pass on this device until its link expires. Returns false when it cannot be stored. */
export function saveLinkPass(pass: LinkPass, now: number = Date.now(), customStorage?: Storage | null): boolean {
  const storage = resolveStorage(customStorage);
  if (!storage || !isLinkPass(pass) || expiry(pass) <= now) return false;
  const envelope: LinkPassEnvelope = { savedAt: now, pass };
  try {
    storage.setItem(`${LINK_PASS_KEY_PREFIX}${pass.ticket_id}`, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/**
 * The link passes kept on this device for one congress (or all of them), newest first. Expired, malformed or
 * mislabelled entries are removed as they are found.
 */
export function loadLinkPasses(slug: string | undefined, now: number = Date.now(), customStorage?: Storage | null): LinkPass[] {
  const storage = resolveStorage(customStorage);
  if (!storage) return [];
  const passes: LinkPass[] = [];
  const stale: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(LINK_PASS_KEY_PREFIX)) continue;
      let envelope: unknown = null;
      try {
        envelope = JSON.parse(storage.getItem(key) ?? "null");
      } catch {
        envelope = null;
      }
      const pass = typeof envelope === "object" && envelope !== null && "pass" in envelope ? envelope.pass : null;
      if (!isLinkPass(pass) || key !== `${LINK_PASS_KEY_PREFIX}${pass.ticket_id}` || expiry(pass) <= now) {
        stale.push(key);
        continue;
      }
      if (!slug || pass.event.slug === slug) passes.push(pass);
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    return passes;
  }
  return passes.sort((a, b) => b.issued_at.localeCompare(a.issued_at));
}

/** Forget one link pass (for example when the link turned out to be revoked). */
export function clearLinkPass(ticketId: string, customStorage?: Storage | null): void {
  const storage = resolveStorage(customStorage);
  try {
    storage?.removeItem(`${LINK_PASS_KEY_PREFIX}${ticketId}`);
  } catch {
    // ignore
  }
}

/** The pass card's view of a link pass. */
export function linkPassCard(pass: LinkPass): PassCardTicket {
  return {
    id: pass.ticket_id,
    event_name: pass.event.name,
    event_slug: pass.event.slug,
    event_location: pass.event.location,
    event_starts_at: pass.event.starts_at,
    event_ends_at: pass.event.ends_at,
    // Absent from a pass saved before the server sent it: the card then reads its dates in the device's zone.
    event_timezone: pass.event_timezone,
    ticket_tier_name: pass.tier_name,
    attendee_name: pass.attendee.full_name,
    qr_secret: pass.qr_secret,
    created_at: pass.issued_at,
    status: pass.status,
  };
}

export type LinkOutcome = "expired" | "invalid" | "throttled" | "offline";

/**
 * Why a link did not open, from the resolve response: `expired` (410: expired, revoked or an inactive pass),
 * `throttled` (429), `offline` (no response or a server error: worth retrying), `invalid` (404, anything else).
 */
export function linkOutcome(status: number | null): LinkOutcome {
  if (status === null || status >= 500) return "offline";
  if (status === 410) return "expired";
  if (status === 429) return "throttled";
  return "invalid";
}
