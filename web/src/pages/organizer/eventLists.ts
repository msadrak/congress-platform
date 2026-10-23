import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  formatApiError,
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

/** One list of the current event, loaded with the workspace's organizer key. */
export function useEventList<T>(loader: EventListLoader<T>): EventList<T> {
  const { eventId, apiKey, client, onKeyRejected } = useEventWorkspace();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!eventId || !apiKey || !client) return;
    let isMounted = true;

    const loadList = async () => {
      setLoading(true);
      const res = await loader(client, eventId);
      // 401 invalidates only the key that was sent, even if this page has since unmounted.
      if (res.response.status === 401) onKeyRejected(apiKey);
      if (!isMounted) return;
      if (!res.error && res.data) setItems(res.data);
      setError(res.error ? formatApiError(res.error) : null);
      setLoaded(true);
      setLoading(false);
    };

    loadList();
    return () => {
      isMounted = false;
    };
  }, [loader, eventId, apiKey, client, onKeyRejected, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
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
