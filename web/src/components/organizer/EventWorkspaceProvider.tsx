import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApiClient, isNetworkFailure, localizedApiError, type EventOut, type OrganizerRole } from "../../api/client";
import { canEditEvent, sessionAllows } from "./roleAccess";
import type { OrganizerOutletContext } from "../../pages/OrganizerLayout";
import { EventWorkspaceContext, type EventLoadErrorKind } from "./eventWorkspaceContext";

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
  const { apiKey, onKeyRejected, reportEvent, session, locale, t, isRtl, dir } = organizer;
  // A failed fetch (offline venue Wi-Fi, DNS, reset) resolves to an error result instead of rejecting, so every
  // section that loads through this client ends in data or an error card, never an endless skeleton.
  const client = useMemo(
    () => (apiKey ? createApiClient({ kind: "organizer", token: apiKey }, { networkErrors: "result" }) : null),
    [apiKey],
  );
  const [active, setActive] = useState(false);
  const [event, setEvent] = useState<EventOut | null>(null);
  const [loading, setLoading] = useState(true);
  // The failure body is kept and localized when shown, so a language switch re-words it without a refetch.
  const [failure, setFailure] = useState<{ body: unknown; kind: EventLoadErrorKind } | null>(null);
  const error = failure ? localizedApiError(failure.body, locale) : null;
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!active || !eventId || !apiKey || !client) return;
    let isMounted = true;

    const loadEvent = async () => {
      setLoading(true);
      setFailure(null);
      try {
        // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
        const { data, error: err, response } = await client.GET("/api/events/{event_id}", {
          params: { path: { event_id: eventId } },
        });
        if (!isMounted) return;
        if (data) setEvent(data);
        else {
          const kind = isNetworkFailure(response) ? "network" : response.status === 404 ? "not-found" : "other";
          setFailure({ body: err, kind });
        }
      } catch (thrown) {
        // Not a network failure (those resolve): a request the client refused to build. Still end the load.
        if (isMounted) setFailure({ body: thrown, kind: "other" });
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadEvent();
    return () => {
      isMounted = false;
    };
  }, [active, eventId, apiKey, client, reloadToken]);

  useEffect(() => {
    if (event) reportEvent(event);
  }, [event, reportEvent]);

  const activate = useCallback(() => setActive(true), []);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  const can = useCallback((needed: OrganizerRole) => sessionAllows(session, needed), [session]);
  const canEdit = canEditEvent(session, event);
  const errorKind = failure?.kind ?? null;

  const value = useMemo(
    () => ({
      apiKey,
      onKeyRejected,
      reportEvent,
      session,
      locale,
      t,
      isRtl,
      dir,
      eventId,
      event,
      loading,
      error,
      errorKind,
      reload,
      replaceEvent: setEvent,
      client,
      can,
      canEdit,
      activate,
    }),
    [apiKey, onKeyRejected, reportEvent, session, locale, t, isRtl, dir, eventId, event, loading, error, errorKind, reload, client, can, canEdit, activate],
  );

  return <EventWorkspaceContext.Provider value={value}>{children}</EventWorkspaceContext.Provider>;
}
