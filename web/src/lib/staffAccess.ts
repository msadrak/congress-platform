/**
 * Where a signed-in person works at congresses besides attending them: booths they staff (`/booth/:id`) and
 * desks they operate (`/reception/:eventId`), from `/api/me/access` (roles PARTNER / RECEPTION) and, for booth
 * names, `/api/booths/me`. Descriptive only: each portal still authorizes on its own. Pure (no React, no
 * network): unit tested in tests/staffAccess.test.ts.
 */
import type { AccessOut, BoothOut } from "../api/client.ts";

export interface StaffBooth {
  id: string;
  /** Empty when the booth list did not name it (the UI shows a generic "booth"). */
  name: string;
  location: string;
  eventId: string;
  eventName: string;
  eventSlug: string;
}

export interface StaffDesk {
  eventId: string;
  eventName: string;
  eventSlug: string;
}

export interface StaffDestinations {
  booths: StaffBooth[];
  desks: StaffDesk[];
}

export const NO_STAFF_DESTINATIONS: StaffDestinations = { booths: [], desks: [] };

/** True when the access lists a booth (PARTNER) role, so the booth names are worth fetching. */
export function hasBoothRole(access: Pick<AccessOut, "events">): boolean {
  return access.events.some((e) => e.roles.includes("PARTNER") && e.booth_ids.length > 0);
}

/**
 * Booths and desks, sorted by congress name then booth name. The access decides which exist; the booth list
 * only names them (a booth the list does not know keeps an empty name).
 */
export function staffDestinations(
  access: Pick<AccessOut, "events">,
  booths: readonly Pick<BoothOut, "id" | "name" | "location">[] = [],
): StaffDestinations {
  const named: Record<string, Pick<BoothOut, "id" | "name" | "location">> = {};
  for (const booth of booths) named[booth.id] = booth;
  const result: StaffDestinations = { booths: [], desks: [] };
  for (const event of access.events) {
    const context = { eventId: event.event_id, eventName: event.event_name, eventSlug: event.event_slug };
    if (event.roles.includes("PARTNER")) {
      for (const id of event.booth_ids) {
        result.booths.push({ id, name: named[id]?.name ?? "", location: named[id]?.location ?? "", ...context });
      }
    }
    if (event.roles.includes("RECEPTION") && event.desk_operator_ids.length > 0) result.desks.push(context);
  }
  const byText = (a: string, b: string) => a.localeCompare(b, "fa");
  result.booths.sort((a, b) => byText(a.eventName, b.eventName) || byText(a.name, b.name) || a.id.localeCompare(b.id));
  result.desks.sort((a, b) => byText(a.eventName, b.eventName) || a.eventId.localeCompare(b.eventId));
  return result;
}
