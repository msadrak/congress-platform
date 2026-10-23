import type { OrganizerRole } from "../api/client";

/** A section of one congress's workspace. `path` is relative to `/organizer/events/:id`. */
export interface EventNavItem {
  key: EventWorkspaceSection;
  path: string;
  /** The lowest role the section is offered to (participants and the desk carry personal data). */
  role: OrganizerRole;
}

const item = (key: EventWorkspaceSection, path: string, role: OrganizerRole = "viewer"): EventNavItem => ({ key, path, role });

/**
 * The workspace navigation (org spec §3): the overview, then the congress-day group, then the setup group. One
 * list for the rail and the phone strip, so the day-of sections come first everywhere.
 */
export const EVENT_NAV_GROUPS = [
  { key: "overview", items: [item("overview", "")] },
  {
    key: "day",
    items: [item("participants", "/participants", "staff"), item("check-in", "/check-in"), item("desk", "/desk", "staff"), item("analytics", "/analytics")],
  },
  {
    key: "setup",
    items: [item("program", "/program"), item("tiers", "/tiers"), item("booths", "/booths"), item("page", "/page"), item("sms", "/sms")],
  },
] as const satisfies readonly { key: string; items: readonly EventNavItem[] }[];

export type EventWorkspaceSection =
  | "overview"
  | "participants"
  | "check-in"
  | "desk"
  | "analytics"
  | "program"
  | "tiers"
  | "booths"
  | "page"
  | "sms";

/** Routes without a navigation item of their own, and the item they belong to. */
const SECTION_OF_SEGMENT: Record<string, EventWorkspaceSection> = {
  operators: "desk",
  venue: "program",
  panel: "page",
};

/** @deprecated Section numbers are gone from the navigation (org spec H1); kept until the section pages drop `index`. */
export function eventSectionNumber(_key: string): number {
  return 0;
}

/** @deprecated See `eventSectionNumber`. */
export function eventOperationNumber(_key: string): number {
  return 0;
}

export function eventWorkspacePath(eventId: string, path: string): string {
  return `/organizer/events/${encodeURIComponent(eventId)}${path}`;
}

/** The navigation item of a pathname below `/organizer/events/:id`, or null outside a congress. */
export function eventSectionFromPath(pathname: string): EventWorkspaceSection | null {
  const match = /^\/organizer\/events\/[^/]+(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return null;
  const segment = match[1];
  if (!segment) return "overview";
  if (Object.hasOwn(SECTION_OF_SEGMENT, segment)) return SECTION_OF_SEGMENT[segment];
  for (const group of EVENT_NAV_GROUPS) {
    const found = group.items.find((s) => s.path === `/${segment}`);
    if (found) return found.key;
  }
  return null;
}

export type EventTimeStatus = "upcoming" | "in-progress" | "ended";

/** Status derived only from the event's own start/end timestamps. */
export function eventTimeStatus(startsAt: string, endsAt: string, now: number): EventTimeStatus {
  if (now < new Date(startsAt).getTime()) return "upcoming";
  if (now > new Date(endsAt).getTime()) return "ended";
  return "in-progress";
}

export type EventFormField = "name" | "slug" | "startsAt" | "endsAt" | "location";
type EventFormMessage =
  | "eventNameRequired"
  | "eventSlugRequired"
  | "eventStartRequired"
  | "eventEndRequired"
  | "eventEndBeforeStart"
  | "eventLocationRequired";

/**
 * First problem in the create/edit event form, in field order: the field to mark invalid and the
 * translation key that names it. `slug` is omitted for the edit form, where it is read-only.
 * `startsAt`/`endsAt` are `datetime-local` values (local wall time).
 */
export function eventFormProblem(form: {
  name: string;
  slug?: string;
  startsAt: string;
  endsAt: string;
  location: string;
}): { field: EventFormField; message: EventFormMessage } | null {
  const starts = new Date(form.startsAt).getTime();
  const ends = new Date(form.endsAt).getTime();
  if (!form.name.trim()) return { field: "name", message: "eventNameRequired" };
  if (form.slug !== undefined && !form.slug.trim()) return { field: "slug", message: "eventSlugRequired" };
  if (!form.startsAt || Number.isNaN(starts)) return { field: "startsAt", message: "eventStartRequired" };
  if (!form.endsAt || Number.isNaN(ends)) return { field: "endsAt", message: "eventEndRequired" };
  if (ends <= starts) return { field: "endsAt", message: "eventEndBeforeStart" };
  if (!form.location.trim()) return { field: "location", message: "eventLocationRequired" };
  return null;
}

/** Moves focus to the first control a validation marked invalid (`aria-invalid`), inside `root`. */
export function focusFirstInvalid(root: HTMLElement | null): void {
  root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
