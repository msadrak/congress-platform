import { createContext, useContext, useEffect } from "react";
import type { EventOut, OrganizerRole, createApiClient } from "../../api/client";
import type { OrganizerOutletContext } from "../../pages/OrganizerLayout";

export type OrganizerClient = ReturnType<typeof createApiClient>;

/**
 * One event's workspace, shared by every page below `/organizer/events/:eventId`: the event loaded once
 * (switching sections never refetches it), plus the organizer context the layout hands to its pages.
 */
export interface EventWorkspace extends OrganizerOutletContext {
  eventId: string;
  /** The loaded event; null until it loads, or when it failed to load. */
  event: EventOut | null;
  /** True until the first response, and again while `reload()` runs. */
  loading: boolean;
  /** Why the event failed to load (the API's message), or null. */
  error: string | null;
  /**
   * What kind of failure `error` is: `network` (no response: offline, DNS, reset), `not-found` (404: deleted, or
   * another organizer's), `other` (any other refusal or server error); null without a failure.
   */
  errorKind: EventLoadErrorKind | null;
  /** Fetches the event again; the current event stays on screen meanwhile. */
  reload: () => void;
  /** Replaces the loaded event with one the API returned (e.g. after a PATCH), without a refetch. */
  replaceEvent: (event: EventOut) => void;
  /** Organizer API client for the current key; null without a key (the layout then shows the key gate). */
  client: OrganizerClient | null;
  /**
   * Whether the signed-in role may use an action that needs `needed` (backend/app/roles.py): viewers read,
   * staff run the day, managers change the setup. Hide or disable what it may not do; the server still decides.
   */
  can: (needed: OrganizerRole) => boolean;
  /**
   * The setup may be changed: `can("manager")` on an event that is loaded and not archived (roleAccess
   * `canEditEvent`). Hide add / edit / delete / reorder without it; day actions use `can("staff")`.
   */
  canEdit: boolean;
}

export type EventLoadErrorKind = "network" | "not-found" | "other";

interface EventWorkspaceContextValue extends EventWorkspace {
  /** Starts loading the event: the provider fetches nothing until a page asks for the workspace. */
  activate: () => void;
}

export const EventWorkspaceContext = createContext<EventWorkspaceContextValue | null>(null);

/**
 * The event workspace of the current `/organizer/events/:eventId` route. The first call loads the event;
 * pages that never call it (they still fetch the event themselves) cost no extra request.
 *
 * Adopting it in another event page (Program, Venue, Page Studio, Panel, SMS, Analytics ...):
 * 1. Its route is already a child of `events/:eventId` in App.tsx, so the provider is above it.
 * 2. Replace the page's own `GET /api/events/{event_id}` and its `reportEvent` call with
 *    `const { event, loading, error, client, t, isRtl } = useEventWorkspace()`; the provider reports
 *    the event to the layout, and `client` carries the organizer key (a 401 reaches the layout's key gate
 *    through the API client itself; only raw `fetch` calls report it with `onKeyRejected(apiKey)`).
 * 3. Load the page's own lists with `useEventList(loader)` (pages/organizer/eventLists.ts) and render
 *    `<EventSectionGate listsLoaded={...} />` (pages/organizer/EventSectionUi.tsx) while
 *    `!event || error || !listsLoaded`: the same skeleton, failure, not-found and archived states as the other
 *    sections. Hide setup controls with `canEdit`.
 * 4. Drop the page's `key={eventId}` wrapper: the layout already remounts the workspace per event.
 * After saving the event itself, call `replaceEvent(saved)` so every section and the layout show it.
 */
export function useEventWorkspace(): EventWorkspace {
  const value = useContext(EventWorkspaceContext);
  if (!value) throw new Error("useEventWorkspace must be called below the /organizer/events/:eventId route");
  const { activate } = value;
  useEffect(() => activate(), [activate]);
  return value;
}
