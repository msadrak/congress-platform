import React, { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { createApiClient, formatApiError, type EventOut } from "../api/client";
import { formatLocalizedDate } from "../lib/i18n";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";

export default function OrganizerEvents() {
  const { apiKey, onKeyRejected, locale, t, isRtl } = useOutletContext<OrganizerOutletContext>();
  const [events, setEvents] = useState<EventOut[]>([]);
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

  // Event editing modal state
  const [editingEvent, setEditingEvent] = useState<EventOut | null>(null);
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editEndsAt, setEditEndsAt] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
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
    if (!name.trim() || !slug.trim() || !startsAt || !endsAt || !location.trim()) {
      setFormError(isRtl ? "لطفاً تمامی فیلدهای ستاره‌دار را تکمیل نمایید." : "Please fill out all required fields.");
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
      setName("");
      setSlug("");
      setStartsAt("");
      setEndsAt("");
      setLocation("");
      setDescription("");
      setIsCreateModalOpen(false);
    }
  };

  const openEditModal = (ev: EventOut) => {
    setEditingEvent(ev);
    setEditName(ev.name);
    setEditLocation(ev.location);
    try {
      setEditStartsAt(new Date(ev.starts_at).toISOString().slice(0, 16));
      setEditEndsAt(new Date(ev.ends_at).toISOString().slice(0, 16));
    } catch {
      setEditStartsAt("");
      setEditEndsAt("");
    }
    setEditDescription(ev.description || "");
    setEditError(null);
  };

  const handleUpdateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEvent) return;
    setEditError(null);

    if (!editName.trim() || !editStartsAt || !editEndsAt || !editLocation.trim()) {
      setEditError(isRtl ? "لطفاً تمامی فیلدهای ستاره‌دار را تکمیل نمایید." : "Please fill out all required fields.");
      return;
    }

    const startsDate = new Date(editStartsAt);
    const endsDate = new Date(editEndsAt);
    if (endsDate <= startsDate) {
      setEditError(isRtl ? "زمان پایان همایش باید پس از زمان آغاز باشد." : "End time must be after start time.");
      return;
    }

    if (!apiKey) return;
    setEditSubmitting(true);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err, response } = await client.PATCH("/api/events/{event_id}", {
      params: { path: { event_id: editingEvent.id } },
      body: {
        name: editName.trim(),
        location: editLocation.trim(),
        starts_at: startsDate.toISOString(),
        ends_at: endsDate.toISOString(),
        description: editDescription.trim(),
      },
    });

    if (response.status === 401) onKeyRejected(apiKey);
    setEditSubmitting(false);
    if (err) {
      setEditError(formatApiError(err));
    } else if (data) {
      setEvents((prev) => prev.map((item) => (item.id === data.id ? data : item)));
      setEditingEvent(null);
    }
  };
  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Page Title & Primary Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-border-default">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="brand" size="md">
              {t.activeOrganizer}
            </Badge>
            <span className="text-xs text-text-muted">
              ({events.length} {isRtl ? "همایش" : "events"})
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-primary">
            {t.eventsListHeading}
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary">
            {t.eventsListSubheading}
          </p>
        </div>

        <div className="shrink-0">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setIsCreateModalOpen(true)}
            className="gap-2 shadow-xs"
          >
            <span>+</span>
            <span>{t.createEventButton}</span>
          </Button>
        </div>
      </div>

      {/* Global Error Banner */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-4 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
        >
          {error}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && events.length === 0 && (
        <div className="space-y-4 animate-pulse">
          <div className="h-32 bg-surface-panel rounded-2xl border border-border-default" />
          <div className="h-32 bg-surface-panel rounded-2xl border border-border-default" />
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && events.length === 0 && (
        <Card className="p-8 sm:p-14 text-center space-y-4 border-border-default">
          <div className="w-14 h-14 rounded-2xl bg-action-subtle text-action-primary mx-auto flex items-center justify-center text-2xl font-bold shadow-xs">
            📅
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-lg font-bold text-text-primary">
              {t.noEventsFoundTitle}
            </h2>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              {t.noEventsFoundDesc}
            </p>
          </div>
          <div className="pt-2">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setIsCreateModalOpen(true)}
            >
              + {t.createEventButton}
            </Button>
          </div>
        </Card>
      )}

      {/* Populated Events List */}
      {!loading && events.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:gap-5">
          {events.map((ev) => (
            <article
              key={ev.id}
              aria-labelledby={`event-title-${ev.id}`}
              className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5 transition-all hover:border-border-strong"
            >
              <div className="space-y-2.5 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success" size="sm">
                    {isRtl ? "همایش فعال" : "Active Congress"}
                  </Badge>
                  <span className="text-xs text-text-muted">•</span>
                  <span className="text-xs font-mono text-text-muted">
                    <bdi dir="ltr">/e/{ev.slug}</bdi>
                  </span>
                </div>

                <h2 id={`event-title-${ev.id}`} className="text-lg sm:text-xl font-bold text-text-primary tracking-tight">
                  <Link
                    to={`/organizer/events/${ev.id}`}
                    className="hover:text-action-primary transition-colors focus-visible:outline-focus-ring"
                  >
                    {ev.name}
                  </Link>
                </h2>

                {/* Metadata Details */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary font-medium">
                  <span className="flex items-center gap-1">
                    <span>📍</span>
                    <span>{ev.location}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span>📅</span>
                    <span>
                      {formatLocalizedDate(ev.starts_at, locale)} – {formatLocalizedDate(ev.ends_at, locale)}
                    </span>
                  </span>
                </div>

                {ev.description && (
                  <p className="text-xs text-text-muted line-clamp-2 leading-relaxed pt-0.5">
                    {ev.description}
                  </p>
                )}
              </div>

              {/* Action Cluster (Configuration, Desk, Analytics, Public Page) */}
              <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-border-subtle">
                <LinkButton
                  to={`/organizer/events/${ev.id}`}
                  variant="primary"
                  size="sm"
                  className="gap-1.5"
                >
                  <span>⚙️</span>
                  <span>{t.manageEventAction}</span>
                </LinkButton>

                <Button
                  onClick={() => openEditModal(ev)}
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                >
                  <span>✏️</span>
                  <span>{t.editEventAction || (isRtl ? "ویرایش" : "Edit")}</span>
                </Button>

                <LinkButton
                  to={`/organizer/events/${ev.id}/desk`}
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                >
                  <span>🖨️</span>
                  <span>{t.openDeskAction}</span>
                </LinkButton>

                <LinkButton
                  to={`/organizer/events/${ev.id}/analytics`}
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                >
                  <span>📊</span>
                  <span>{t.openAnalyticsAction}</span>
                </LinkButton>

                <a
                  href={`/e/${ev.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-action-primary hover:bg-action-subtle transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring"
                >
                  <span>{t.openPublicPageAction}</span>
                  <span aria-hidden="true">↗</span>
                </a>
              </div>
            </article>
          ))}
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
        <form onSubmit={handleCreateEvent} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.eventNameLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={handleNameChange}
                placeholder={isRtl ? "مثال: هجدهمین کنگره سالانه بیوتکنولوژی" : "e.g. 18th Annual Congress of Biotechnology"}
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.eventSlugLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="biotech-congress-2027"
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
              <span className="text-[11px] text-text-muted mt-1 block">
                {t.eventSlugHint}
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.startsAtLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.endsAtLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                required
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.locationLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={isRtl ? "مثال: مرکز همایش‌های بین‌المللی برج میلاد" : "e.g. International Convention Center, Hall A"}
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.descriptionLabel}
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={isRtl ? "توضیحات و اهداف همایش علمی..." : "Summary and objectives of the conference..."}
                className="w-full p-3 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>
          </div>

          {formError && (
            <div
              role="alert"
              aria-live="assertive"
              className="p-3.5 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
            >
              {formError}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2.5">
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={submitting}
              onClick={() => setIsCreateModalOpen(false)}
            >
              {isRtl ? "انصراف" : "Cancel"}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={submitting}
            >
              {submitting ? "..." : t.saveEventAction}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Accessible Event Edit Modal */}
      <Dialog
        isOpen={editingEvent !== null}
        onClose={() => {
          if (!editSubmitting) {
            setEditingEvent(null);
            setEditError(null);
          }
        }}
        title={t.editEventTitle || (isRtl ? "ویرایش مشخصات همایش" : "Edit Event")}
        description={t.editEventDesc || (isRtl ? "ویرایش عنوان، محل برگزاری، توضیحات و زمان‌بندی همایش." : "Update event details.")}
        size="lg"
      >
        {editingEvent && (
          <form onSubmit={handleUpdateEvent} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.eventNameLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.eventSlugLabel}
                </label>
                <input
                  type="text"
                  disabled
                  value={editingEvent.slug}
                  className="w-full px-3.5 py-2.5 bg-neutral-100 border border-border-subtle rounded-xl text-sm font-mono text-text-muted cursor-not-allowed opacity-75"
                />
                <span className="text-[11px] text-text-muted mt-1 block">
                  {isRtl
                    ? "شناسه اختصاصی اینترنتی (اسلاگ) جهت حفظ پیوند کارت‌ها و آدرس‌های عمومی ثابت می‌ماند."
                    : "The public URL slug is preserved to protect published links and attendee passes."}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.startsAtLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  required
                  value={editStartsAt}
                  onChange={(e) => setEditStartsAt(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.endsAtLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  required
                  value={editEndsAt}
                  onChange={(e) => setEditEndsAt(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.locationLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.descriptionLabel}
                </label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full p-3 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>
            </div>

            {editError && (
              <div
                role="alert"
                aria-live="assertive"
                className="p-3.5 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
              >
                {editError}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2.5">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={editSubmitting}
                onClick={() => setEditingEvent(null)}
              >
                {t.cancelAction || (isRtl ? "انصراف" : "Cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={editSubmitting}
              >
                {editSubmitting ? (t.savingAction || "...") : (t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes"))}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
