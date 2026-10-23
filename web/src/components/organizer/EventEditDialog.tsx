import React, { useState } from "react";
import { createApiClient, formatApiError, type EventOut } from "../../api/client";
import type { TranslationDictionary } from "../../lib/i18n";
import { eventFormProblem, type EventFormField } from "../../lib/organizerWorkspace";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";
import { toDateTimeLocal } from "./sessionTime";

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

/** Edit an event's name, schedule, venue and description. The slug is shown but never changes. */
export function EventEditDialog({ event, apiKey, t, isRtl, onClose, onSaved }: EventEditDialogProps) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The field the last client-side check rejected; marked only while the form's error is shown.
  const [invalidField, setInvalidField] = useState<EventFormField | null>(null);
  const fieldInvalid = (field: EventFormField) => (formError !== null && invalidField === field) || undefined;

  const [shownEvent, setShownEvent] = useState<EventOut | null>(null);
  if (event !== shownEvent) {
    setShownEvent(event);
    if (event) {
      setName(event.name);
      setLocation(event.location);
      // `datetime-local` shows the organizer's own wall time; saving reads it back as local time.
      setStartsAt(toDateTimeLocal(event.starts_at));
      setEndsAt(toDateTimeLocal(event.ends_at));
      setDescription(event.description || "");
      setFormError(null);
      setInvalidField(null);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;
    setFormError(null);
    setInvalidField(null);
    const problem = eventFormProblem({ name, startsAt, endsAt, location });
    if (problem) {
      setInvalidField(problem.field);
      setFormError(t[problem.message]);
      return;
    }
    const startsDate = new Date(startsAt);
    const endsDate = new Date(endsAt);
    if (!apiKey) return;
    setSubmitting(true);
    // A 401 reaches the organizer layout's key gate through the API client (registerUnauthorizedHandler).
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const { data, error: err } = await client.PATCH("/api/events/{event_id}", {
      params: { path: { event_id: event.id } },
      body: {
        name: name.trim(),
        location: location.trim(),
        starts_at: startsDate.toISOString(),
        ends_at: endsDate.toISOString(),
        description: description.trim(),
      },
    });
    setSubmitting(false);
    if (err) {
      setFormError(formatApiError(err));
    } else if (data) {
      onSaved(data);
    }
  };

  return (
    <Dialog
      isOpen={event !== null}
      onClose={() => {
        if (!submitting) {
          onClose();
          setFormError(null);
        }
      }}
      title={t.editEventTitle || (isRtl ? "ویرایش مشخصات همایش" : "Edit Event")}
      description={t.editEventDesc || (isRtl ? "ویرایش عنوان، محل برگزاری، توضیحات و زمان‌بندی همایش." : "Update event details.")}
      size="lg"
    >
      {event && (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t.eventNameLabel} required className="sm:col-span-2">
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} aria-invalid={fieldInvalid("name")} className="ui-input" />
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

            <Field label={t.startsAtLabel} required>
              <input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} aria-invalid={fieldInvalid("startsAt")} className="ui-input font-mono" />
            </Field>

            <Field label={t.endsAtLabel} required>
              <input type="datetime-local" required value={endsAt} min={startsAt || undefined} onChange={(e) => setEndsAt(e.target.value)} aria-invalid={fieldInvalid("endsAt")} className="ui-input font-mono" />
            </Field>

            <Field label={t.locationLabel} required className="sm:col-span-2">
              <input type="text" required value={location} onChange={(e) => setLocation(e.target.value)} aria-invalid={fieldInvalid("location")} className="ui-input" />
            </Field>

            <Field label={t.descriptionLabel} className="sm:col-span-2">
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="ui-textarea" />
            </Field>
          </div>

          {formError && <FormAlert>{formError}</FormAlert>}

          <DialogActions>
            <Button type="button" variant="ghost" size="md" disabled={submitting} onClick={onClose}>
              {t.cancelAction || (isRtl ? "انصراف" : "Cancel")}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submitting} aria-busy={submitting}>
              {submitting ? t.savingAction : t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes")}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
