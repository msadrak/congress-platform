import React, { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { createApiClient, formatApiError, type EventOut } from "../api/client";
import { formatLocalizedDate, formatLocalizedNumber } from "../lib/i18n";
import { eventFormProblem, eventTimeStatus, type EventFormField } from "../lib/organizerWorkspace";
import { eventAccentStyle } from "../lib/eventAccent";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Button, LinkButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { CongressSignature } from "../components/brand/CongressSignature";
import {
  DialogActions,
  EmptyState,
  EventStatusBadge,
  Field,
  FormAlert,
  Notice,
  SectionHeader,
} from "../components/organizer/WorkspaceUi";
import { EventEditDialog } from "../components/organizer/EventEditDialog";
import { eventTiming } from "../components/organizer/eventTiming";

export default function OrganizerEvents() {
  const { apiKey, onKeyRejected, locale, t, isRtl } = useOutletContext<OrganizerOutletContext>();
  const [events, setEvents] = useState<EventOut[]>([]);
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Event creation modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formInvalid, setFormInvalid] = useState<EventFormField | null>(null);

  // Event editing modal state
  const [editingEvent, setEditingEvent] = useState<EventOut | null>(null);
  // A field is marked invalid only while its form error is on screen.
  const createInvalid = (field: EventFormField) => (formError !== null && formInvalid === field) || undefined;
  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!apiKey) return;
    let isMounted = true;
    const fetchEvents = async () => {
      setLoading(true);
      setError(null);
      const client = createApiClient({ kind: "organizer", token: apiKey });
      const { data, error: err, response } = await client.GET("/api/events");
      // 401 invalidates only the key that was sent, even if this page has since unmounted.
      if (response.status === 401) onKeyRejected(apiKey);
      if (!isMounted) return;
      if (err) {
        setError(formatApiError(err));
      } else if (data) {
        setEvents(data);
      }
      setLoading(false);
    };
    fetchEvents();
    return () => {
      isMounted = false;
    };
  }, [apiKey, onKeyRejected]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    // Suggest slug if user has not explicitly typed a custom slug
    const currentGenerated = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    if (!slug || slug === currentGenerated) {
      const generated = newName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      setSlug(generated);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormInvalid(null);
    const problem = eventFormProblem({ name, slug, startsAt, endsAt, location });
    if (problem) {
      setFormInvalid(problem.field);
      setFormError(t[problem.message]);
      return;
    }

    if (!apiKey) return;
    setSubmitting(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.POST("/api/events", {
      body: {
        name: name.trim(),
        slug: slug.trim(),
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        location: location.trim(),
        description: description.trim(),
      },
    });

    if (response.status === 401) onKeyRejected(apiKey);
    setSubmitting(false);
    if (err) {
      setFormError(formatApiError(err));
    } else if (data) {
      setEvents((prev) => [...prev, data]);
      setNotice(isRtl ? `همایش «${data.name}» ایجاد شد.` : `Event “${data.name}” created.`);
      setName("");
      setSlug("");
      setStartsAt("");
      setEndsAt("");
      setLocation("");
      setDescription("");
      setIsCreateModalOpen(false);
    }
  };

  const liveCount = events.filter((ev) => eventTimeStatus(ev.starts_at, ev.ends_at, now) === "in-progress").length;
  const upcomingCount = events.filter((ev) => eventTimeStatus(ev.starts_at, ev.ends_at, now) === "upcoming").length;

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader
        eyebrow={
          <>
            {t.activeOrganizer}
            <span className="mx-2 text-border-strong" aria-hidden="true">
              /
            </span>
            <span className="tabular">
              {formatLocalizedNumber(events.length, locale)} {isRtl ? "همایش" : events.length === 1 ? "event" : "events"}
            </span>
          </>
        }
        title={t.eventsListHeading}
        description={t.eventsListSubheading}
        action={
          <Button type="button" variant="primary" size="md" onClick={() => setIsCreateModalOpen(true)}>
            <Icon name="plus" size={18} />
            <span>{t.createEventButton}</span>
          </Button>
        }
      />

      {/* Portfolio summary: counts derived from the listed events' own dates */}
      {!loading && events.length > 0 && (
        <dl className="grid grid-cols-3 divide-x divide-border-default overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
          {([
            [isRtl ? "کل همایش‌ها" : "Congresses", events.length],
            [isRtl ? "در حال برگزاری" : "Live now", liveCount],
            [isRtl ? "پیش‌رو" : "Scheduled", upcomingCount],
          ] as const).map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1 px-4 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 sm:px-6">
              <dt className="text-xs font-semibold text-text-muted">{label}</dt>
              <dd className="org-kpi-value text-[1.5rem] text-text-primary sm:text-[1.75rem]">{formatLocalizedNumber(value, locale)}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Global Error Banner */}
      {error && <FormAlert>{error}</FormAlert>}

      {notice && (
        <Notice tone="ok" onDismiss={() => setNotice(null)} dismissLabel={isRtl ? "بستن پیام" : "Dismiss message"}>
          {notice}
        </Notice>
      )}

      {/* Loading Skeleton */}
      {loading && events.length === 0 && (
        <div className="space-y-4" aria-hidden="true">
          <div className="skeleton h-44 shape-arc" />
          <div className="skeleton h-44 rounded-2xl" />
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && events.length === 0 && (
        <EmptyState
          icon="calendar"
          title={t.noEventsFoundTitle}
          action={
            <Button type="button" variant="primary" size="md" onClick={() => setIsCreateModalOpen(true)}>
              <Icon name="plus" size={18} />
              {t.createEventButton}
            </Button>
          }
        >
          {t.noEventsFoundDesc}
        </EmptyState>
      )}

      {/* Populated Events List */}
      {!loading && events.length > 0 && (
        <div className="space-y-5">
          {events.map((ev, index) => {
            const status = eventTimeStatus(ev.starts_at, ev.ends_at, now);
            return (
              <article
                key={ev.id}
                aria-labelledby={`event-title-${ev.id}`}
                style={eventAccentStyle(ev.slug)}
                className="group grid overflow-hidden border border-border-default bg-surface-panel shadow-soft transition-[border-color,box-shadow] duration-300 shape-arc-lg hover:border-border-strong hover:shadow-lift motion-reduce:transition-none md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_auto]"
              >
                {/* Congress signature */}
                <div className="relative h-32 overflow-hidden md:h-auto md:min-h-[12rem]">
                  <CongressSignature seed={ev.slug} tone="ink" className="absolute inset-0 h-full w-full" />
                  <span aria-hidden="true" className="absolute start-4 top-4 font-mono text-[0.6875rem] text-white/60">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>

                {/* Identity + metadata */}
                <div className="min-w-0 space-y-4 p-5 sm:p-6">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <EventStatusBadge status={status} isRtl={isRtl} />
                    <span className="text-xs text-text-muted">{eventTiming(ev.starts_at, ev.ends_at, now, locale)}</span>
                  </div>
                  <div className="space-y-1.5">
                    <h2 id={`event-title-${ev.id}`} className="font-display text-xl font-[660] leading-snug tracking-[-0.02em] text-text-primary sm:text-2xl">
                      <Link
                        to={`/organizer/events/${ev.id}`}
                        className="rounded-sm transition-colors hover:text-event-accent focus-visible:outline-2 focus-visible:outline-focus-ring"
                      >
                        {ev.name}
                      </Link>
                    </h2>
                    <p className="font-mono text-xs text-event-accent">
                      <bdi dir="ltr">/e/{ev.slug}</bdi>
                    </p>
                  </div>
                  <dl className="grid gap-x-6 gap-y-3 border-t border-border-subtle pt-4 text-sm sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                        <Icon name="calendar" size={14} />
                        {isRtl ? "زمان برگزاری" : "Dates"}
                      </dt>
                      <dd className="mt-1 text-text-primary">
                        {formatLocalizedDate(ev.starts_at, locale)} – {formatLocalizedDate(ev.ends_at, locale)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                        <Icon name="pin" size={14} />
                        {isRtl ? "محل برگزاری" : "Venue"}
                      </dt>
                      <dd className="mt-1 break-words text-text-primary">{ev.location}</dd>
                    </div>
                  </dl>
                  {ev.description && (
                    <p className="line-clamp-2 text-sm leading-relaxed text-text-secondary">
                      <bdi>{ev.description}</bdi>
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle bg-surface-panel-subtle/60 p-4 sm:px-6 md:col-span-2 xl:col-span-1 xl:w-56 xl:flex-col xl:items-stretch xl:justify-center xl:border-s xl:border-t-0 xl:bg-transparent">
                  <LinkButton to={`/organizer/events/${ev.id}`} variant="primary" size="sm" className="xl:justify-between">
                    <Icon name="sliders" size={16} />
                    <span className="xl:flex-1 xl:text-start">{t.manageEventAction}</span>
                  </LinkButton>
                  <Button onClick={() => setEditingEvent(ev)} variant="secondary" size="sm" className="xl:justify-start">
                    <Icon name="note" size={16} />
                    <span>{t.editEventAction || (isRtl ? "ویرایش" : "Edit")}</span>
                  </Button>
                  <LinkButton to={`/organizer/events/${ev.id}/desk`} variant="secondary" size="sm" className="xl:justify-start">
                    <Icon name="id-card" size={16} />
                    <span>{t.openDeskAction}</span>
                  </LinkButton>
                  <LinkButton to={`/organizer/events/${ev.id}/analytics`} variant="secondary" size="sm" className="xl:justify-start">
                    <Icon name="chart" size={16} />
                    <span>{t.openAnalyticsAction}</span>
                  </LinkButton>
                  <a
                    href={`/e/${ev.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-event-accent transition-colors hover:bg-event-accent-soft focus-visible:outline-2 focus-visible:outline-focus-ring"
                  >
                    <span>{t.openPublicPageAction}</span>
                    <Icon name="arrow-up-right" size={16} />
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Accessible Event Creation Modal */}
      <Dialog
        isOpen={isCreateModalOpen}
        onClose={() => {
          if (!submitting) {
            setIsCreateModalOpen(false);
            setFormError(null);
          }
        }}
        title={t.createEventModalTitle}
        description={t.createEventModalDesc}
        size="lg"
      >
        <form onSubmit={handleCreateEvent} className="space-y-5" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t.eventNameLabel} required className="sm:col-span-2">
              <input
                type="text"
                required
                value={name}
                onChange={handleNameChange}
                aria-invalid={createInvalid("name")}
                placeholder={isRtl ? "مثال: هجدهمین کنگره سالانه بیوتکنولوژی" : "e.g. 18th Annual Congress of Biotechnology"}
                className="ui-input"
              />
            </Field>

            <Field label={t.eventSlugLabel} required hint={t.eventSlugHint} className="sm:col-span-2">
              <div className="flex items-stretch overflow-hidden rounded-[10px]" dir="ltr">
                <span className="inline-flex items-center border border-e-0 border-border-default bg-surface-panel-subtle px-3 font-mono text-sm text-text-muted [border-start-start-radius:10px] [border-end-start-radius:10px]">
                  /e/
                </span>
                <input
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  aria-invalid={createInvalid("slug")}
                  placeholder="biotech-congress-2027"
                  className="ui-input min-w-0 rounded-s-none font-mono"
                />
              </div>
            </Field>

            <Field label={t.startsAtLabel} required>
              <input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} aria-invalid={createInvalid("startsAt")} className="ui-input font-mono" />
            </Field>

            <Field label={t.endsAtLabel} required>
              <input type="datetime-local" required value={endsAt} min={startsAt || undefined} onChange={(e) => setEndsAt(e.target.value)} aria-invalid={createInvalid("endsAt")} className="ui-input font-mono" />
            </Field>

            <Field label={t.locationLabel} required className="sm:col-span-2">
              <input
                type="text"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                aria-invalid={createInvalid("location")}
                placeholder={isRtl ? "مثال: مرکز همایش‌های بین‌المللی برج میلاد" : "e.g. International Convention Center, Hall A"}
                className="ui-input"
              />
            </Field>

            <Field label={t.descriptionLabel} className="sm:col-span-2">
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={isRtl ? "توضیحات و اهداف همایش علمی..." : "Summary and objectives of the conference..."}
                className="ui-textarea"
              />
            </Field>
          </div>

          {formError && <FormAlert>{formError}</FormAlert>}

          <DialogActions>
            <Button type="button" variant="ghost" size="md" disabled={submitting} onClick={() => setIsCreateModalOpen(false)}>
              {isRtl ? "انصراف" : "Cancel"}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submitting} aria-busy={submitting}>
              {submitting ? t.creatingAction : t.saveEventAction}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Accessible Event Edit Modal */}
      <EventEditDialog
        event={editingEvent}
        apiKey={apiKey}
        onKeyRejected={onKeyRejected}
        t={t}
        isRtl={isRtl}
        onClose={() => setEditingEvent(null)}
        onSaved={(data) => {
          setEvents((prev) => prev.map((item) => (item.id === data.id ? data : item)));
          setNotice(isRtl ? `همایش «${data.name}» ذخیره شد.` : `Event “${data.name}” saved.`);
          setEditingEvent(null);
        }}
      />
    </div>
  );
}
