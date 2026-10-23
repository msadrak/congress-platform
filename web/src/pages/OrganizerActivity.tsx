import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { createApiClient, localizedApiError, type AuditEventOut, type EventOut } from "../api/client";
import {
  activityActor,
  activityActorKind,
  describeActivity,
  formatActivityTime,
  isPersonActor,
} from "../lib/organizerConsole";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Select } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/StateBlock";
import { organizerCopy } from "../copy/organizer";
import { commonCopy } from "../copy/common";

/** `/organizer/activity`: the organizer's audit log, newest first (ADR 0016). Read-only by design. */
export default function OrganizerActivity() {
  const { apiKey, session, locale } = useOutletContext<OrganizerOutletContext>();
  const copy = organizerCopy[locale].activity;
  const showIp = session?.role === "owner";
  const [events, setEvents] = useState<EventOut[]>([]);
  const [eventId, setEventId] = useState("");
  const [items, setItems] = useState<AuditEventOut[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ body: unknown; status: number } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!apiKey) return;
    void createApiClient({ kind: "organizer", token: apiKey }, { networkErrors: "result" })
      .GET("/api/events")
      .then(({ data }) => {
        if (data) setEvents(data);
      });
  }, [apiKey]);

  const fetchPage = useCallback(
    (before: string | null) =>
      createApiClient({ kind: "organizer", token: apiKey ?? "" }, { networkErrors: "result" }).GET("/api/organizer/activity", {
        params: { query: { limit: 50, ...(eventId ? { event_id: eventId } : {}), ...(before ? { before } : {}) } },
      }),
    [apiKey, eventId],
  );

  // The first page, again whenever the congress filter changes (the filter's handler shows the loading state).
  useEffect(() => {
    if (!apiKey) return;
    let alive = true;
    void fetchPage(null)
      .then(({ data, error: err, response }) => {
        if (!alive) return;
        if (!data) return setFailure({ body: err, status: response.status });
        setItems(data.items);
        setNext(data.next_before ?? null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apiKey, fetchPage, reloadToken]);

  const loadMore = async (before: string) => {
    setLoading(true);
    setFailure(null);
    const { data, error: err, response } = await fetchPage(before);
    setLoading(false);
    if (!data) return setFailure({ body: err, status: response.status });
    setItems((prev) => [...prev, ...data.items]);
    setNext(data.next_before ?? null);
  };

  const chooseEvent = (id: string) => {
    setEventId(id);
    setLoading(true);
    setFailure(null);
    setItems([]);
    setNext(null);
  };

  const eventName = (id: string | null | undefined) => (id ? events.find((e) => e.id === id)?.name : undefined);

  const retry = () => {
    setLoading(true);
    setFailure(null);
    setReloadToken((n) => n + 1);
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        title={copy.title}
        actions={
          <label className="flex w-full min-w-0 items-center gap-2 text-body-sm text-text-secondary sm:w-auto">
            <span className="shrink-0">{copy.eventFilter}</span>
            <Select value={eventId} onChange={(e) => chooseEvent(e.target.value)} wrapperClassName="min-w-0 flex-1 sm:w-72 sm:flex-none" className="w-full">
              <option value="">{copy.allEvents}</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </Select>
          </label>
        }
      />

      {failure && items.length === 0 ? (
        <ErrorState
          title={copy.loadFailed}
          offline={failure.status === 503}
          body={localizedApiError(failure.body, locale, failure.status)}
          onRetry={retry}
          retryLabel={commonCopy[locale].retry}
        />
      ) : items.length === 0 ? (
        !loading && <EmptyState icon="activity" title={copy.empty} />
      ) : (
        <ol className="divide-y divide-border-subtle overflow-clip rounded-card border border-border-default bg-surface-panel shadow-soft" data-testid="activity-list">
          {items.map((item) => {
            const { action, target } = describeActivity(item, locale);
            const name = eventName(item.event_id);
            const person = isPersonActor(item.actor_type);
            return (
              <li key={item.id} className="flex flex-col gap-1.5 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
                <time dateTime={item.at} className="shrink-0 text-caption tabular text-text-muted sm:w-48 sm:pt-0.5">
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
                    <span>{action}</span>
                    {target && (
                      <>
                        {" "}
                        <bdi dir="auto" className="font-medium text-text-secondary">
                          {target}
                        </bdi>
                      </>
                    )}
                  </p>
                  {(name || (showIp && item.ip)) && (
                    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
                      {name && (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="congress" size={13} />
                          <bdi>{name}</bdi>
                        </span>
                      )}
                      {showIp && item.ip && (
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

      {failure && items.length > 0 && <ErrorState title={copy.loadFailed} body={localizedApiError(failure.body, locale, failure.status)} onRetry={() => next && void loadMore(next)} retryLabel={commonCopy[locale].retry} />}
      {loading && <LoadingState />}
      {next && !loading && !failure && (
        <Button type="button" variant="secondary" icon="chevron-down" onClick={() => void loadMore(next)}>
          {copy.loadMore}
        </Button>
      )}
    </div>
  );
}
