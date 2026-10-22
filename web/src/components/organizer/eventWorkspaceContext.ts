import { createContext, useContext, useEffect } from "react";
import type { EventOut, createApiClient } from "../../api/client";
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
  /** Fetches the event again; the current event stays on screen meanwhile. */
  reload: () => void;
  /** Replaces the loaded event with one the API returned (e.g. after a PATCH), without a refetch. */
  replaceEvent: (event: EventOut) => void;
  /** Organizer API client for the current key; null without a key (the layout then shows the key gate). */
  client: OrganizerClient | null;
}

interface EventWorkspaceContextValue extends EventWorkspace {
  /** Starts loading the event: the provider fetches nothing until a page asks for the workspace. */
  activate: () => void;
}

export const EventWorkspaceContext = createContext<EventWorkspaceContextValue | null>(null);

/**
 * The event workspace of the current `/organizer/events/:eventId` route. The first call loads the event;
 * pages that never call it (they still fetch the event themselves) cost no extra request.
 */
export function useEventWorkspace(): EventWorkspace {
  const value = useContext(EventWorkspaceContext);
  if (!value) throw new Error("useEventWorkspace must be called below the /organizer/events/:eventId route");
  const { activate } = value;
  useEffect(() => activate(), [activate]);
  return value;
}
