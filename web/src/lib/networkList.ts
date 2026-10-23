/**
 * The attendee's searchable contact list as pages arrive from `/api/attendees/me/network/search`. Pure,
 * so it is unit tested under `node --test`.
 */

interface Identified {
  id: string;
}

/** Appends a page, skipping contacts already shown (a contact added meanwhile shifts the server's pages). */
export function appendPage<T extends Identified>(shown: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(shown.map((c) => c.id));
  return [...shown, ...page.filter((c) => !seen.has(c.id))];
}

/** The contact first (new or just re-scanned), without a duplicate further down. */
export function withContactFirst<T extends Identified>(shown: readonly T[], contact: T): T[] {
  return [contact, ...shown.filter((c) => c.id !== contact.id)];
}

/** Replaces the contact with the same id, keeping its place. */
export function replaceContact<T extends Identified>(shown: readonly T[], contact: T): T[] {
  return shown.map((c) => (c.id === contact.id ? contact : c));
}

export function removeContact<T extends Identified>(shown: readonly T[], id: string): T[] {
  return shown.filter((c) => c.id !== id);
}
