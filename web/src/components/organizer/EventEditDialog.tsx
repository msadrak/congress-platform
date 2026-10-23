import React, { useState } from "react";
import { createApiClient, localizedApiError, type EventOut } from "../../api/client";
import type { TranslationDictionary } from "../../lib/i18n";
import { eventFormProblem, type EventFormField } from "../../lib/organizerWorkspace";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";
import { DEFAULT_EVENT_TIMEZONE, eventTimeZone, fromZonedDateTimeLocal, timeZoneOptions, toZonedDateTimeLocal } from "./sessionTime";
import { useGuardedClose } from "./useGuardedClose";

interface EventEditDialogProps {
  /** The event being edited, open while non-null; each opening starts from the event's saved values. */
  event: EventOut | null;
  apiKey: string | null;
  t: TranslationDictionary;
  isRtl: boolean;
  onClose: () => void;
  /** The saved event; the caller updates its copy, closes the dialog and announces the change. */
  onSaved: (event: EventOut) => void;
}

interface EventDraft {
  name: string;
  location: string;
  description: string;
  timeZone: string;
  /** `datetime-local` values on the congress clock (`timeZone`). */
  startsAt: string;
  endsAt: string;
  registrationEnabled: boolean;
  registrationOpensAt: string;
  registrationClosesAt: string;
  listed: boolean;
}

function draftOf(event: EventOut): EventDraft {
  const zone = eventTimeZone(event);
  return {
    name: event.name,
    location: event.location,
    description: event.description || "",
    timeZone: zone,
    startsAt: toZonedDateTimeLocal(event.starts_at, zone),
    endsAt: toZonedDateTimeLocal(event.ends_at, zone),
    registrationEnabled: event.registration_enabled ?? true,
    registrationOpensAt: event.registration_opens_at ? toZonedDateTimeLocal(event.registration_opens_at, zone) : "",
    registrationClosesAt: event.registration_closes_at ? toZonedDateTimeLocal(event.registration_closes_at, zone) : "",
    listed: event.listed ?? false,
  };
}

const sameDraft = (a: EventDraft, b: EventDraft) => (Object.keys(a) as (keyof EventDraft)[]).every((key) => a[key] === b[key]);

/**
 * Edit an event's details and settings: name, venue, description, its time zone and dates, the registration
 * switch and window, and whether it is listed on the public home. Every time is entered on the congress clock
 * (its time zone), whatever the organizer's own. The slug is shown but never changes.
 */
export function EventEditDialog({ event, apiKey, t, isRtl, onClose, onSaved }: EventEditDialogProps) {
  const locale = isRtl ? "fa" : "en";
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [initial, setInitial] = useState<EventDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The field the last client-side check rejected; marked only while the form's error is shown.
  const [invalidField, setInvalidField] = useState<EventFormField | "registrationClosesAt" | null>(null);
  const fieldInvalid = (field: EventFormField | "registrationClosesAt") => (formError !== null && invalidField === field) || undefined;
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  const [shownEvent, setShownEvent] = useState<EventOut | null>(null);
  if (event !== shownEvent) {
    setShownEvent(event);
    if (event) {
      const fresh = draftOf(event);
      setDraft(fresh);
      setInitial(fresh);
      setFormError(null);
      setInvalidField(null);
    }
  }

  const dirty = Boolean(draft && initial && !sameDraft(draft, initial));
  const { requestClose, discardDialog } = useGuardedClose(dirty, onClose, isRtl);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !draft) return;
    setFormError(null);
    setInvalidField(null);
    const problem = eventFormProblem({ name: draft.name, startsAt: draft.startsAt, endsAt: draft.endsAt, location: draft.location });
    if (problem) {
      setInvalidField(problem.field);
      setFormError(t[problem.message]);
      return;
    }
    const zone = draft.timeZone;
    const opensAt = draft.registrationOpensAt ? fromZonedDateTimeLocal(draft.registrationOpensAt, zone) : "";
    const closesAt = draft.registrationClosesAt ? fromZonedDateTimeLocal(draft.registrationClosesAt, zone) : "";
    if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) {
      setInvalidField("registrationClosesAt");
      setFormError(isRtl ? "پایان ثبت‌نام باید پس از شروع آن باشد." : "Registration must close after it opens.");
      return;
    }
    if (!apiKey) return;
    setSubmitting(true);
    // A 401 reaches the organizer layout's key gate through the API client (registerUnauthorizedHandler).
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err } = await client.PATCH("/api/events/{event_id}", {
      params: { path: { event_id: event.id } },
      body: {
        name: draft.name.trim(),
        location: draft.location.trim(),
        starts_at: fromZonedDateTimeLocal(draft.startsAt, zone),
        ends_at: fromZonedDateTimeLocal(draft.endsAt, zone),
        description: draft.description.trim(),
        timezone: zone,
        registration_enabled: draft.registrationEnabled,
        registration_opens_at: opensAt || null,
        registration_closes_at: closesAt || null,
        listed: draft.listed,
      },
    });
    setSubmitting(false);
    if (err) {
      setFormError(localizedApiError(err, locale));
    } else if (data) {
      onSaved(data);
    }
  };

  const zoneLabel = (zone: string) => (zone === DEFAULT_EVENT_TIMEZONE ? `${zone} (${isRtl ? "وقت ایران" : "Iran time"})` : zone);
  const clockHint = draft
    ? isRtl
      ? `زمان‌ها به وقت ${draft.timeZone} خوانده و نشان داده می‌شوند، نه وقت مرورگر شما.`
      : `Times are read and shown in ${draft.timeZone}, not your browser's time zone.`
    : undefined;

  return (
    <>
      <Dialog
        isOpen={event !== null}
        onClose={() => {
          if (!submitting) requestClose();
        }}
        title={t.editEventTitle || (isRtl ? "ویرایش مشخصات همایش" : "Edit Event")}
        description={t.editEventDesc || (isRtl ? "ویرایش عنوان، محل برگزاری، توضیحات و زمان‌بندی همایش." : "Update event details.")}
        size="lg"
      >
        {event && draft && (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t.eventNameLabel} required className="sm:col-span-2">
                <input type="text" required value={draft.name} onChange={(e) => set("name", e.target.value)} aria-invalid={fieldInvalid("name")} className="ui-input" />
              </Field>

              <Field
                label={t.eventSlugLabel}
                className="sm:col-span-2"
                hint={
                  isRtl
                    ? "شناسه اختصاصی اینترنتی (اسلاگ) جهت حفظ پیوند کارت‌ها و آدرس‌های عمومی ثابت می‌ماند."
                    : "The public URL slug is preserved to protect published links and attendee passes."
                }
              >
                <input type="text" disabled dir="ltr" value={event.slug} className="ui-input font-mono" />
              </Field>

              <Field label={isRtl ? "منطقهٔ زمانی همایش" : "Congress time zone"} hint={clockHint} className="sm:col-span-2">
                <select value={draft.timeZone} onChange={(e) => set("timeZone", e.target.value)} dir="ltr" className="ui-input font-mono">
                  {timeZoneOptions(eventTimeZone(event)).map((zone) => (
                    <option key={zone} value={zone}>
                      {zoneLabel(zone)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t.startsAtLabel} required>
                <input type="datetime-local" required value={draft.startsAt} onChange={(e) => set("startsAt", e.target.value)} aria-invalid={fieldInvalid("startsAt")} className="ui-input font-mono" />
              </Field>

              <Field label={t.endsAtLabel} required>
                <input
                  type="datetime-local"
                  required
                  value={draft.endsAt}
                  min={draft.startsAt || undefined}
                  onChange={(e) => set("endsAt", e.target.value)}
                  aria-invalid={fieldInvalid("endsAt")}
                  className="ui-input font-mono"
                />
              </Field>

              <Field label={t.locationLabel} required className="sm:col-span-2">
                <input type="text" required value={draft.location} onChange={(e) => set("location", e.target.value)} aria-invalid={fieldInvalid("location")} className="ui-input" />
              </Field>

              <Field label={t.descriptionLabel} className="sm:col-span-2">
                <textarea rows={3} value={draft.description} onChange={(e) => set("description", e.target.value)} className="ui-textarea" />
              </Field>
            </div>

            <fieldset className="space-y-3 rounded-xl border border-border-default p-4">
              <legend className="px-1 text-sm font-bold text-text-primary">{isRtl ? "ثبت‌نام و نمایش" : "Registration and visibility"}</legend>
              <label className="flex min-h-[40px] cursor-pointer items-start gap-3 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={draft.registrationEnabled}
                  onChange={(e) => set("registrationEnabled", e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-aiteb-indigo"
                />
                <span>
                  <span className="font-semibold">{isRtl ? "ثبت‌نام باز است" : "Registration is open"}</span>
                  <span className="block text-xs leading-relaxed text-text-muted">
                    {isRtl
                      ? "با خاموش کردن، رزرو تازه پذیرفته نمی‌شود؛ بلیت‌های صادرشده معتبر می‌مانند. بازهٔ ثبت‌نام اختیاری است."
                      : "Turned off, no new reservation is accepted; issued tickets stay valid. The registration window is optional."}
                  </span>
                </span>
              </label>
              {draft.registrationEnabled && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={isRtl ? "شروع ثبت‌نام (اختیاری)" : "Registration opens (optional)"}>
                    <input type="datetime-local" value={draft.registrationOpensAt} onChange={(e) => set("registrationOpensAt", e.target.value)} className="ui-input font-mono" />
                  </Field>
                  <Field label={isRtl ? "پایان ثبت‌نام (اختیاری)" : "Registration closes (optional)"}>
                    <input
                      type="datetime-local"
                      value={draft.registrationClosesAt}
                      min={draft.registrationOpensAt || undefined}
                      onChange={(e) => set("registrationClosesAt", e.target.value)}
                      aria-invalid={fieldInvalid("registrationClosesAt")}
                      className="ui-input font-mono"
                    />
                  </Field>
                </div>
              )}
              <label className="flex min-h-[40px] cursor-pointer items-start gap-3 text-sm text-text-primary">
                <input type="checkbox" checked={draft.listed} onChange={(e) => set("listed", e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-aiteb-indigo" />
                <span>
                  <span className="font-semibold">{isRtl ? "نمایش در صفحهٔ اصلی عمومی" : "List on the public home"}</span>
                  <span className="block text-xs leading-relaxed text-text-muted">
                    {isRtl
                      ? "همایش در فهرست همایش‌های صفحهٔ اصلی دیده می‌شود (پس از انتشار صفحهٔ آن). نشانی مستقیم همایش در هر حال کار می‌کند."
                      : "The congress appears in the home page's list once its page is published. Its direct address works either way."}
                  </span>
                </span>
              </label>
            </fieldset>

            {formError && <FormAlert>{formError}</FormAlert>}

            <DialogActions>
              <Button type="button" variant="ghost" size="md" disabled={submitting} onClick={requestClose}>
                {t.cancelAction || (isRtl ? "انصراف" : "Cancel")}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={submitting} aria-busy={submitting}>
                {submitting ? t.savingAction : t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes")}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>
      {discardDialog}
    </>
  );
}
