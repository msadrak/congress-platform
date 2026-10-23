import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { createApiClient, localizedApiError, type EventCreate, type EventOut } from "../api/client";
import { formatDateRange, formatNumber } from "../lib/format";
import { eventFormProblem, eventTimeStatus, focusFirstInvalid, type EventFormField } from "../lib/organizerWorkspace";
import { eventAccentStyle } from "../lib/eventAccent";
import { organizerCopy } from "../copy/organizer";
import { commonCopy } from "../copy/common";
import { sessionAllows } from "../components/organizer/roleAccess";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { DateTimeField } from "../components/ui/DateTimeField";
import { Dialog } from "../components/ui/Dialog";
import { Field } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { CodeInput, TextInput } from "../components/ui/Input";
import { Notice } from "../components/ui/Notice";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/StateBlock";
import { DialogActions, EventStatusBadge, FormAlert } from "../components/organizer/WorkspaceUi";
import { DEFAULT_EVENT_TIMEZONE, fromZonedDateTimeLocal } from "../components/organizer/sessionTime";

/** The name of the congress the workspace just deleted (its navigation state), if any. */
function deletedEventName(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("deletedEventName" in state)) return null;
  return typeof state.deletedEventName === "string" ? state.deletedEventName : null;
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/** `/organizer`: the organizer's congresses, active first and the archived ones in a collapsed group. */
export default function OrganizerEvents() {
  const { apiKey, session, locale } = useOutletContext<OrganizerOutletContext>();
  const copy = organizerCopy[locale];
  const canManage = sessionAllows(session, "manager");
  const routeLocation = useLocation();
  const [events, setEvents] = useState<EventOut[]>([]);
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(() => {
    const deleted = deletedEventName(routeLocation.state);
    return deleted ? copy.events.deleted(deleted) : null;
  });
  const [loading, setLoading] = useState(true);
  // The failure body, localized when shown (a language switch re-words it without a refetch).
  const [failure, setFailure] = useState<{ body: unknown; status: number } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!apiKey) return;
    let isMounted = true;
    const fetchEvents = async () => {
      setLoading(true);
      setFailure(null);
      try {
        // A 401 reaches the layout's key gate through the API client; no connection resolves to an error result.
        const { data, error, response } = await createApiClient({ kind: "organizer", token: apiKey }, { networkErrors: "result" }).GET("/api/events");
        if (!isMounted) return;
        if (data) setEvents(data);
        else setFailure({ body: error, status: response.status });
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void fetchEvents();
    return () => {
      isMounted = false;
    };
  }, [apiKey, reloadToken]);

  const active = events.filter((ev) => ev.archived_at == null);
  const archived = events.filter((ev) => ev.archived_at != null);
  const createButton = canManage ? (
    <Button type="button" variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>
      {copy.events.create}
    </Button>
  ) : undefined;

  const card = (ev: EventOut) => (
    <li key={ev.id}>
      <article
        aria-labelledby={`event-title-${ev.id}`}
        style={eventAccentStyle(ev.slug)}
        className="org-event-card relative flex items-start gap-3 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft transition-colors hover:border-border-strong sm:p-5"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {ev.archived_at ? (
              <Badge variant="warning" size="sm" icon={<Icon name="lock" size={12} />}>
                {copy.shell.archived}
              </Badge>
            ) : (
              <EventStatusBadge status={eventTimeStatus(ev.starts_at, ev.ends_at, now)} isRtl={locale === "fa"} />
            )}
            <span className="text-meta text-text-secondary">{formatDateRange(ev.starts_at, ev.ends_at, locale, ev.timezone)}</span>
          </div>
          <h2 id={`event-title-${ev.id}`} className="text-title-sm font-bold leading-snug text-text-primary">
            {/* The whole card is this one link. */}
            <Link to={`/organizer/events/${ev.id}`} className="after:absolute after:inset-0 after:rounded-card hover:text-event-accent">
              <bdi>{ev.name}</bdi>
            </Link>
          </h2>
          <p className="flex items-center gap-1.5 text-meta text-text-secondary">
            <Icon name="pin" size={14} className="shrink-0" />
            <bdi className="min-w-0 break-words">{ev.location}</bdi>
          </p>
        </div>
        {!ev.archived_at && (
          <a
            href={`/e/${encodeURIComponent(ev.slug)}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={copy.events.publicPageOf(ev.name)}
            title={copy.shell.publicPage}
            className="relative z-10 grid size-11 shrink-0 place-items-center rounded-control text-event-accent hover:bg-event-accent-soft"
          >
            <Icon name="arrow-up-right" size={20} />
          </a>
        )}
      </article>
    </li>
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader title={copy.events.title} actions={events.length > 0 ? createButton : undefined} />

      {notice && (
        <Notice tone="ok" onDismiss={() => setNotice(null)} dismissLabel={commonCopy[locale].dismissMessage}>
          {notice}
        </Notice>
      )}

      {loading && events.length === 0 ? (
        <LoadingState />
      ) : failure ? (
        <ErrorState
          title={copy.events.loadFailed}
          offline={failure.status === 503}
          body={localizedApiError(failure.body, locale, failure.status)}
          onRetry={() => setReloadToken((n) => n + 1)}
          retryLabel={commonCopy[locale].retry}
        />
      ) : events.length === 0 ? (
        <EmptyState icon="calendar" title={copy.events.empty} body={canManage ? undefined : copy.events.emptyAsk} action={createButton} />
      ) : (
        <>
          {active.length > 0 && (
            <ul className="space-y-3" data-testid="events-active">
              {active.map(card)}
            </ul>
          )}
          {archived.length > 0 && (
            <details className="group rounded-card border border-border-default bg-surface-panel-subtle" data-testid="events-archived">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-body-sm font-semibold text-text-secondary [&::-webkit-details-marker]:hidden">
                <Icon name="chevron-down" size={18} className="transition-transform group-open:rotate-180" />
                {copy.events.archivedGroup(formatNumber(archived.length, locale))}
              </summary>
              <ul className="space-y-3 px-3 pb-3">{archived.map(card)}</ul>
            </details>
          )}
        </>
      )}

      <CreateEventDialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setEvents((prev) => [...prev, created]);
          setNotice(copy.events.created(created.name));
          setCreateOpen(false);
        }}
      />
    </div>
  );
}

type CreateForm = { name: string; slug: string; startsAt: string; endsAt: string; location: string };
const EMPTY_FORM: CreateForm = { name: "", slug: "", startsAt: "", endsAt: "", location: "" };

/** A new congress: name, page address, start, end and venue. Everything else is in its settings. */
function CreateEventDialog({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (event: EventOut) => void }) {
  const { apiKey, locale } = useOutletContext<OrganizerOutletContext>();
  const copy = organizerCopy[locale];
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState<{ field: EventFormField; message: keyof typeof copy.form.problems } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (attempt > 0) focusFirstInvalid(formRef.current);
  }, [attempt]);

  const set = (key: keyof CreateForm, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const errorOf = (field: EventFormField) => (invalid?.field === field ? copy.form.problems[invalid.message] : undefined);

  const close = () => {
    if (submitting) return;
    setInvalid(null);
    setFormError(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const problem = eventFormProblem(form);
    setInvalid(problem);
    if (problem) {
      setAttempt((n) => n + 1);
      return;
    }
    if (!apiKey) return;
    setSubmitting(true);
    const zone = DEFAULT_EVENT_TIMEZONE;
    // Times are wall-clock times of the congress's own zone, whatever the organizer's browser zone is.
    const body: EventCreate = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      starts_at: fromZonedDateTimeLocal(form.startsAt, zone),
      ends_at: fromZonedDateTimeLocal(form.endsAt, zone),
      location: form.location.trim(),
      description: "",
      timezone: zone,
      registration_enabled: true,
      registration_opens_at: null,
      registration_closes_at: null,
      listed: false,
    };
    const { data, error, response } = await createApiClient({ kind: "organizer", token: apiKey }, { networkErrors: "result" }).POST("/api/events", { body });
    setSubmitting(false);
    if (data) {
      setForm(EMPTY_FORM);
      onCreated(data);
    } else {
      setFormError(localizedApiError(error, locale, response.status));
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={close} title={copy.events.create} size="md">
      <form ref={formRef} onSubmit={submit} className="space-y-4" noValidate>
        <Field label={copy.form.nameLabel} required error={errorOf("name")}>
          <TextInput
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({ ...f, name, slug: !f.slug || f.slug === slugOf(f.name) ? slugOf(name) : f.slug }));
            }}
          />
        </Field>
        <Field label={copy.form.slugLabel} required hint={copy.form.slugHint} error={errorOf("slug")}>
          <CodeInput value={form.slug} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
        </Field>
        <DateTimeField
          label={copy.form.startsLabel}
          required
          value={form.startsAt}
          onChange={(value) => set("startsAt", value)}
          locale={locale}
          timeZone={DEFAULT_EVENT_TIMEZONE}
          error={errorOf("startsAt")}
        />
        <DateTimeField
          label={copy.form.endsLabel}
          required
          value={form.endsAt}
          onChange={(value) => set("endsAt", value)}
          locale={locale}
          timeZone={DEFAULT_EVENT_TIMEZONE}
          error={errorOf("endsAt")}
        />
        <Field label={copy.form.locationLabel} required error={errorOf("location")}>
          <TextInput value={form.location} onChange={(e) => set("location", e.target.value)} />
        </Field>

        {formError && <FormAlert>{formError}</FormAlert>}

        <DialogActions>
          <Button type="button" variant="ghost" disabled={submitting} onClick={close}>
            {commonCopy[locale].cancel}
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            {copy.form.add}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
