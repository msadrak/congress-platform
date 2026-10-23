/** Sections of one event's workspace, in navigation order. `path` is relative to `/organizer/events/:id`. */
export const EVENT_SETUP_SECTIONS = [
  { key: "overview", path: "" },
  { key: "program", path: "/program" },
  { key: "venue", path: "/venue" },
  { key: "tiers", path: "/tiers" },
  { key: "check-in", path: "/check-in" },
  { key: "booths", path: "/booths" },
  { key: "operators", path: "/operators" },
  { key: "page", path: "/page" },
  { key: "panel", path: "/panel" },
  { key: "sms", path: "/sms" },
] as const;

export type EventSetupSection = (typeof EVENT_SETUP_SECTIONS)[number]["key"];
/** Day-to-day sections after the setup ones, in navigation order. */
export const EVENT_OPERATION_SECTIONS = ["participants", "analytics", "desk"] as const;
export type EventOperationSection = (typeof EVENT_OPERATION_SECTIONS)[number];
export type EventWorkspaceSection = EventSetupSection | EventOperationSection;

/** Navigation index of an operational section: it continues the setup sections' numbering. */
export function eventOperationNumber(key: EventOperationSection): number {
  return EVENT_SETUP_SECTIONS.length + 1 + EVENT_OPERATION_SECTIONS.indexOf(key);
}

/** 1-based position of a setup section in the workspace navigation: the "01", "02" … index its header shows. */
export function eventSectionNumber(key: EventSetupSection): number {
  return EVENT_SETUP_SECTIONS.findIndex((s) => s.key === key) + 1;
}

export function eventWorkspacePath(eventId: string, path: string): string {
  return `/organizer/events/${encodeURIComponent(eventId)}${path}`;
}

/** The active section for a pathname below `/organizer/events/:id`, or null outside an event. */
export function eventSectionFromPath(pathname: string): EventWorkspaceSection | null {
  const match = /^\/organizer\/events\/[^/]+(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return null;
  const segment = match[1];
  if (!segment) return "overview";
  const operation = EVENT_OPERATION_SECTIONS.find((s) => s === segment);
  if (operation) return operation;
  const setup = EVENT_SETUP_SECTIONS.find((s) => s.path === `/${segment}`);
  return setup ? setup.key : null;
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
