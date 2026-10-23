import { useState, type ReactNode } from "react";
import { localizedApiError, type EventOut } from "../../api/client";
import { Button, LinkButton } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { ErrorState, StateBlock } from "../../components/ui/StateBlock";
import { FormAlert } from "../../components/organizer/WorkspaceUi";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { organizerSharedCopy } from "../../copy/organizerShared";

/** Pieces every section of the event workspace shares: load states, the add action, the change notice. */

export type SectionNoticeState = { tone: "ok" | "error"; text: string } | null;

export interface EventSectionGateProps {
  /** The section's own lists have answered (success or failure). Defaults to true for a section without lists. */
  listsLoaded?: boolean;
  /**
   * The section itself, rendered under the archived banner once the event and the lists are in. A function
   * receives the loaded event. Without children the gate renders only its states (and the archived banner).
   */
  children?: ReactNode | ((event: EventOut) => ReactNode);
}

/**
 * Every state of an event section around its content:
 * - a skeleton until the event and the section's lists have loaded;
 * - the failure card with a retry when the event could not be loaded (the offline icon when there was no
 *   response at all), or the not-found card for a 404;
 * - once loaded, an archived congress gets the «بایگانی‌شده — فقط مشاهده» banner (with Unarchive for a
 *   manager) above the children.
 *
 * Either wrap the section: `<EventSectionGate listsLoaded={lists.loaded}>{(event) => …}</EventSectionGate>`,
 * or return `<EventSectionGate listsLoaded={lists.loaded} />` while `!event || error || !listsLoaded` and
 * render the section yourself (no archived banner then).
 */
export function EventSectionGate({ listsLoaded = true, children }: EventSectionGateProps) {
  const { event, loading, error, errorKind, reload, locale, t } = useEventWorkspace();
  const copy = organizerSharedCopy[locale];

  if ((loading && !event) || !listsLoaded) {
    return (
      <div role="status" className="space-y-6">
        <span className="sr-only">{copy.loading}</span>
        <div className="skeleton h-60 shape-arc-lg" aria-hidden="true" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-hidden="true">
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-32 rounded-2xl" />
        </div>
        <div className="skeleton h-64 rounded-2xl" aria-hidden="true" />
      </div>
    );
  }

  const back = (
    <LinkButton to="/organizer" variant="secondary" icon="arrow-left">
      {t.breadcrumbEvents}
    </LinkButton>
  );

  if (errorKind === "not-found") {
    return <StateBlock kind="empty" icon="search" title={copy.notFoundTitle} body={copy.notFoundBody} action={back} />;
  }

  if (error || !event) {
    return (
      <ErrorState
        offline={errorKind === "network"}
        title={copy.loadFailedTitle}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="primary" icon="sync" loading={loading} onClick={reload}>
              {t.retryAction}
            </Button>
            {back}
          </div>
        }
      >
        <p>{copy.loadFailedBody}</p>
        {error && (
          <p dir="auto" className="text-caption text-text-muted" data-testid="event-load-error">
            {error}
          </p>
        )}
      </ErrorState>
    );
  }

  return (
    <>
      {event.archived_at != null && <ArchivedBanner event={event} />}
      {typeof children === "function" ? children(event) : children}
    </>
  );
}

/** The archived congress is read-only everywhere; a manager can unarchive it from here. */
function ArchivedBanner({ event }: { event: EventOut }) {
  const { client, can, replaceEvent, locale } = useEventWorkspace();
  const copy = organizerSharedCopy[locale];
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const unarchive = async () => {
    if (!client) return;
    setBusy(true);
    setFailure(null);
    const { data, error } = await client.POST("/api/events/{event_id}/archive", {
      params: { path: { event_id: event.id } },
      body: { archived: false },
    });
    setBusy(false);
    if (data) replaceEvent(data);
    else setFailure(error ?? true);
  };

  return (
    <div className="space-y-3" data-testid="section-archived">
      <Notice
        tone="warning"
        icon="lock"
        title={copy.archivedBanner}
        action={
          can("manager") ? (
            <Button type="button" variant="secondary" size="sm" icon="sync" loading={busy} onClick={() => void unarchive()}>
              {copy.unarchive}
            </Button>
          ) : undefined
        }
      />
      {failure !== null && <FormAlert>{localizedApiError(failure, locale)}</FormAlert>}
    </div>
  );
}

/** Primary "add" action of a section header or empty state. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="primary" icon="plus" onClick={onClick}>
      <span>{label}</span>
    </Button>
  );
}

/** Result of the last change, announced politely; errors are announced assertively. */
export function SectionNotice({ notice, onDismiss }: { notice: SectionNoticeState; onDismiss: () => void }) {
  const { locale } = useEventWorkspace();
  if (!notice) return null;
  return (
    <Notice tone={notice.tone} onDismiss={onDismiss} dismissLabel={organizerSharedCopy[locale].dismissMessage}>
      {notice.text}
    </Notice>
  );
}

/**
 * A list of this section failed to load: say so and offer a retry, which reloads the event as well.
 * `loading` covers the section's lists; the event's own reload is added here.
 */
export function SectionLoadError({ error, loading, onRetry }: { error: string | null; loading: boolean; onRetry: () => void }) {
  const { loading: eventLoading, reload, t } = useEventWorkspace();
  if (!error) return null;
  const busy = loading || eventLoading;
  return (
    <div className="space-y-3">
      <FormAlert>
        {t.sectionsLoadFailed} <bdi>{error}</bdi>
      </FormAlert>
      <Button
        type="button"
        variant="secondary"
        icon="sync"
        loading={busy}
        onClick={() => {
          reload();
          onRetry();
        }}
      >
        {t.retryAction}
      </Button>
    </div>
  );
}
