/**
 * The personal agenda: the sessions an attendee starred, kept on this device per attendee and congress.
 * Storage may be missing, full or blocked (private mode); every function then degrades instead of throwing.
 * Pure apart from the storage object passed in, so it is unit tested under `node --test`.
 */

export const AGENDA_KEY_PREFIX = "congress_agenda_";
/** Signed-out visitors share one device-local agenda per congress. */
export const GUEST_AGENDA_OWNER = "guest";
/** A congress program is never this large; a corrupt value cannot grow without bound. */
const MAX_IDS = 500;

export type AgendaStorage = Pick<Storage, "getItem" | "setItem">;

export function agendaKey(owner: string, eventId: string): string {
  return `${AGENDA_KEY_PREFIX}${owner}_${eventId}`;
}

/** The starred session ids; an empty list when nothing is stored or the value is unreadable. */
export function loadAgenda(storage: AgendaStorage | null | undefined, owner: string, eventId: string): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(agendaKey(owner, eventId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, MAX_IDS);
  } catch {
    return [];
  }
}

/** Stores the agenda; false when the device refused (the caller keeps it in memory for this visit). */
export function saveAgenda(storage: AgendaStorage | null | undefined, owner: string, eventId: string, ids: readonly string[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(agendaKey(owner, eventId), JSON.stringify([...new Set(ids)].slice(0, MAX_IDS)));
    return true;
  } catch {
    return false;
  }
}

/** Adds the session when absent, removes it when present. */
export function toggleAgendaId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** `window.localStorage`, or null where reading it throws (blocked storage) or there is no window. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
