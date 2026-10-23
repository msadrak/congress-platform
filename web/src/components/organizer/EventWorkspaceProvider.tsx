import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApiClient, formatApiError, type EventOut } from "../../api/client";
import type { OrganizerOutletContext } from "../../pages/OrganizerLayout";
import { EventWorkspaceContext } from "./eventWorkspaceContext";

interface EventWorkspaceProviderProps {
  eventId: string;
  organizer: OrganizerOutletContext;
  children: ReactNode;
}

/**
 * Loads one event for every page of its workspace and reports it to the layout. Mount it keyed by the
 * event id, so a late response for event A can never write into event B's workspace.
 */
export function EventWorkspaceProvider({ eventId, organizer, children }: EventWorkspaceProviderProps) {
  const { apiKey, onKeyRejected, reportEvent, locale, t, isRtl, dir } = organizer;
  const client = useMemo(() => (apiKey ? createApiClient({ kind: "organizer", token: apiKey }) : null), [apiKey]);
  const [active, setActive] = useState(false);
  const [event, setEvent] = useState<EventOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!active || !eventId || !apiKey || !client) return;
    let isMounted = true;

    const loadEvent = async () => {
      setLoading(true);
      setError(null);
      const { data, error: err, response } = await client.GET("/api/events/{event_id}", {
        params: { path: { event_id: eventId } },
      });
      // 401 invalidates only the key that was sent, even if this workspace has since unmounted.
      if (response.status === 401) onKeyRejected(apiKey);
      if (!isMounted) return;
      if (err) {
        setError(formatApiError(err));
      } else if (data) {
        setEvent(data);
      }
      setLoading(false);
    };

    loadEvent();
    return () => {
      isMounted = false;
    };
  }, [active, eventId, apiKey, client, onKeyRejected, reloadToken]);

  useEffect(() => {
    if (event) reportEvent(event);
  }, [event, reportEvent]);

  const activate = useCallback(() => setActive(true), []);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const value = useMemo(
    () => ({
      apiKey,
      onKeyRejected,
      reportEvent,
      locale,
      t,
      isRtl,
      dir,
      eventId,
      event,
      loading,
      error,
      reload,
      replaceEvent: setEvent,
      client,
      activate,
    }),
    [apiKey, onKeyRejected, reportEvent, locale, t, isRtl, dir, eventId, event, loading, error, reload, client, activate],
  );

  return <EventWorkspaceContext.Provider value={value}>{children}</EventWorkspaceContext.Provider>;
}
