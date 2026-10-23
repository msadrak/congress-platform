import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  localizedApiError,
  type BoothOut,
  type CheckInPointOut,
  type DeskOperatorOut,
  type EventSessionOut,
  type TicketTierOut,
  type VenuePlaceOut,
} from "../../api/client";
import { useEventWorkspace, type OrganizerClient } from "../../components/organizer/eventWorkspaceContext";

/** Reads one of the event's lists. Keep loaders module-level so their identity is stable. */
type EventListLoader<T> = (client: OrganizerClient, eventId: string) => Promise<{ data?: T[]; error?: unknown; response: Response }>;

export const loadTicketTiers: EventListLoader<TicketTierOut> = (client, eventId) =>
  client.GET("/api/events/{event_id}/ticket-tiers", { params: { path: { event_id: eventId } } });
export const loadCheckInPoints: EventListLoader<CheckInPointOut> = (client, eventId) =>
  client.GET("/api/events/{event_id}/checkin-points", { params: { path: { event_id: eventId } } });
export const loadBooths: EventListLoader<BoothOut> = (client, eventId) =>
  client.GET("/api/events/{event_id}/booths", { params: { path: { event_id: eventId } } });
export const loadDeskOperators: EventListLoader<DeskOperatorOut> = (client, eventId) =>
  client.GET("/api/events/{event_id}/desk/operators", { params: { path: { event_id: eventId } } });
export const loadSessions: EventListLoader<EventSessionOut> = (client, eventId) =>
  client.GET("/api/events/{event_id}/sessions", { params: { path: { event_id: eventId } } });
export const loadVenuePlaces: EventListLoader<VenuePlaceOut> = (client, eventId) =>
  client.GET("/api/events/{event_id}/venue-places", { params: { path: { event_id: eventId } } });

export interface EventList<T> {
  items: T[];
  setItems: Dispatch<SetStateAction<T[]>>;
  /** True while a request is in flight. */
  loading: boolean;
  /** True once the first response arrived, success or not. */
  loaded: boolean;
  /** The API's message when the last load failed: a failed list must never read as an empty one. */
  error: string | null;
  reload: () => void;
}

/**
 * One list of the current event, loaded with the workspace's organizer key. `enabled: false` (a list the
 * signed-in role may not read) loads nothing and reads as an empty, loaded list.
 */
export function useEventList<T>(loader: EventListLoader<T>, enabled = true): EventList<T> {
  const { eventId, apiKey, client, locale } = useEventWorkspace();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  // The failure body is kept and localized when shown, so a language switch re-words it without a refetch.
  const [failure, setFailure] = useState<{ body: unknown } | null>(null);
  const error = failure ? localizedApiError(failure.body, locale) : null;
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!eventId || !apiKey || !client || !enabled) return;
    let isMounted = true;

    const loadList = async () => {
      setLoading(true);
      // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
      const res = await loader(client, eventId);
      if (!isMounted) return;
      if (!res.error && res.data) setItems(res.data);
      setFailure(res.error ? { body: res.error } : null);
      setLoaded(true);
      setLoading(false);
    };

    loadList();
    return () => {
      isMounted = false;
    };
  }, [loader, eventId, apiKey, client, enabled, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  if (!enabled) return { items: [], setItems, loading: false, loaded: true, error: null, reload };
  return { items, setItems, loading, loaded, error, reload };
}

/** The lists one section shows, as one load: the first failure (in the given order) names the problem. */
export function sectionLoad(lists: readonly Pick<EventList<unknown>, "loading" | "loaded" | "error" | "reload">[]) {
  return {
    loaded: lists.every((list) => list.loaded),
    loading: lists.some((list) => list.loading),
    error: lists.find((list) => list.error !== null)?.error ?? null,
    reload: () => lists.forEach((list) => list.reload()),
  };
}
