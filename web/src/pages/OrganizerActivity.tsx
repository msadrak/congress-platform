import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { createApiClient, localizedApiError, type AuditEventOut, type EventOut } from "../api/client";
import {
  CONSOLE_COPY,
  PERSON_ACTORS,
  activityAction,
  activityActor,
  activityActorKind,
  activityTarget,
  formatActivityTime,
} from "../lib/organizerConsole";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { EmptyState, FormAlert, SectionHeader } from "../components/organizer/WorkspaceUi";

/** `/organizer/activity`: the organizer's audit log, newest first (ADR 0016). Read-only by design. */
export default function OrganizerActivity() {
  const { apiKey, session, locale } = useOutletContext<OrganizerOutletContext>();
  const copy = CONSOLE_COPY[locale];
  const [events, setEvents] = useState<EventOut[]>([]);
  const [eventId, setEventId] = useState("");
  const [items, setItems] = useState<AuditEventOut[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    void createApiClient({ kind: "organizer", token: apiKey })
      .GET("/api/events")
      .then(({ data }) => {
        if (data) setEvents(data);
      });
  }, [apiKey]);

  const fetchPage = useCallback(
    (before: string | null) =>
      createApiClient({ kind: "organizer", token: apiKey ?? "" }).GET("/api/organizer/activity", {
        params: { query: { limit: 50, ...(eventId ? { event_id: eventId } : {}), ...(before ? { before } : {}) } },
      }),
    [apiKey, eventId],
  );

  // The first page, again whenever the congress filter changes (the filter's handler shows the loading state).
  useEffect(() => {
    if (!apiKey) return;
    let alive = true;
    void fetchPage(null).then(({ data, error: err }) => {
      if (!alive) return;
      setLoading(false);
      if (!data) return setError(localizedApiError(err, locale));
      setItems(data.items);
      setNext(data.next_before ?? null);
    });
    return () => {
      alive = false;
    };
  }, [apiKey, fetchPage, locale]);

  const loadMore = async (before: string) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchPage(before);
    setLoading(false);
    if (!data) return setError(localizedApiError(err, locale));
    setItems((prev) => [...prev, ...data.items]);
    setNext(data.next_before ?? null);
  };

  const chooseEvent = (id: string) => {
    setEventId(id);
    setLoading(true);
    setError(null);
    setItems([]);
    setNext(null);
  };

  const eventName = (id: string | null | undefined) => (id ? events.find((e) => e.id === id)?.name : undefined);

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader
        eyebrow={session ? <bdi>{session.organizer.name}</bdi> : copy.membersEyebrow}
        title={copy.activityTitle}
        description={copy.activityDesc}
        action={
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <span>{copy.eventFilter}</span>
            <select value={eventId} onChange={(e) => chooseEvent(e.target.value)} className="ui-input min-h-10 w-auto py-1.5 text-sm">
              <option value="">{copy.allEvents}</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {error && <FormAlert>{error}</FormAlert>}

      {!loading && !error && items.length === 0 ? (
        <EmptyState icon="activity" title={copy.noActivity} />
      ) : (
        <ol className="divide-y divide-border-subtle overflow-clip rounded-2xl border border-border-default bg-surface-panel shadow-soft" data-testid="activity-list">
          {items.map((item) => {
            const target = activityTarget(item, locale);
            const name = eventName(item.event_id);
            const person = PERSON_ACTORS.has(item.actor_type);
            return (
              <li key={item.id} className="flex flex-col gap-1.5 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
                <time dateTime={item.at} className="shrink-0 text-xs tabular text-text-muted sm:w-44 sm:pt-0.5">
                  {formatActivityTime(item.at, locale)}
                </time>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm text-text-primary">
                    <span className="font-semibold">
                      <bdi>{activityActor(item, locale)}</bdi>
                    </span>{" "}
                    {person && (
                      <Badge variant="neutral" size="sm" className="me-1 align-middle">
                        {activityActorKind(item.actor_type, locale)}
                      </Badge>
                    )}
                    <span>{activityAction(item.action, locale)}</span>
                    {target && (
                      <>
                        {" "}
                        <bdi dir="auto" className="font-medium text-text-secondary">
                          {target}
                        </bdi>
                      </>
                    )}
                  </p>
                  {(name || item.ip) && (
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
                      {name && (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="congress" size={13} />
                          <bdi>{name}</bdi>
                        </span>
                      )}
                      {item.ip && (
                        <span className="inline-flex items-center gap-1" title={copy.where}>
                          <Icon name="globe" size={13} />
                          <bdi dir="ltr" className="font-mono">
                            {item.ip}
                          </bdi>
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {loading && (
        <div role="status" aria-busy="true" className="text-sm text-text-muted">
          {copy.loading}
        </div>
      )}
      {next && !loading && (
        <Button type="button" variant="secondary" size="md" onClick={() => void loadMore(next)}>
          <Icon name="chevron-down" size={16} />
          {copy.loadMore}
        </Button>
      )}
    </div>
  );
}
