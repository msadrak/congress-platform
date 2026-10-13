/** Sections of one event's workspace, in navigation order. `path` is relative to `/organizer/events/:id`. */
export const EVENT_SETUP_SECTIONS = [
  { key: "overview", path: "" },
  { key: "tiers", path: "/tiers" },
  { key: "check-in", path: "/check-in" },
  { key: "booths", path: "/booths" },
  { key: "operators", path: "/operators" },
  { key: "page", path: "/page" },
] as const;

export type EventSetupSection = (typeof EVENT_SETUP_SECTIONS)[number]["key"];
export type EventWorkspaceSection = EventSetupSection | "analytics" | "desk";

export function eventWorkspacePath(eventId: string, path: string): string {
  return `/organizer/events/${encodeURIComponent(eventId)}${path}`;
}

/** The active section for a pathname below `/organizer/events/:id`, or null outside an event. */
export function eventSectionFromPath(pathname: string): EventWorkspaceSection | null {
  const match = /^\/organizer\/events\/[^/]+(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return null;
  const segment = match[1];
  if (!segment) return "overview";
  if (segment === "analytics" || segment === "desk") return segment;
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
