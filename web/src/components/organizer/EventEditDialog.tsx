import React, { useEffect, useRef, useState } from "react";
import { createApiClient, localizedApiError, type EventOut } from "../../api/client";
import { eventFormProblem, focusFirstInvalid, type EventFormField } from "../../lib/organizerWorkspace";
import { timeZoneLabel } from "../../lib/format";
import { organizerCopy } from "../../copy/organizer";
import { commonCopy } from "../../copy/common";
import { Button } from "../ui/Button";
import { DateTimeField } from "../ui/DateTimeField";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { CodeInput, Select, TextInput, Textarea } from "../ui/Input";
import { Switch } from "../ui/Switch";
import { DialogActions, FormAlert } from "./WorkspaceUi";
import { eventTimeZone, fromZonedDateTimeLocal, timeZoneOptions, toZonedDateTimeLocal } from "./sessionTime";
import { useGuardedClose } from "./useGuardedClose";

interface EventEditDialogProps {
  /** The event being edited, open while non-null; each opening starts from the event's saved values. */
  event: EventOut | null;
  apiKey: string | null;
  locale: "fa" | "en";
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

type DraftField = EventFormField | "registrationClosesAt";
type Problem = { field: DraftField; message: keyof (typeof organizerCopy)["fa"]["form"]["problems"] };

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
 * The congress settings: name, venue, description, time zone and dates, the registration switch and window, and
 * the home-page listing. Every time is entered on the congress clock (its time zone), whatever the organizer's
 * own. The page address is shown but never changes. The first invalid field gets focus and its error.
 */
export function EventEditDialog({ event, apiKey, locale, onClose, onSaved }: EventEditDialogProps) {
  const copy = organizerCopy[locale].form;
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [initial, setInitial] = useState<EventDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const errorOf = (field: DraftField) => (problem?.field === field ? copy.problems[problem.message] : undefined);

  const [shownEvent, setShownEvent] = useState<EventOut | null>(null);
  if (event !== shownEvent) {
    setShownEvent(event);
    if (event) {
      const fresh = draftOf(event);
      setDraft(fresh);
      setInitial(fresh);
      setFormError(null);
      setProblem(null);
    }
  }

  useEffect(() => {
    if (attempt > 0) focusFirstInvalid(formRef.current);
  }, [attempt]);

  const dirty = Boolean(draft && initial && !sameDraft(draft, initial));
  const { requestClose, discardDialog } = useGuardedClose(dirty, onClose, locale);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !draft) return;
    setFormError(null);
    const zone = draft.timeZone;
    const opensAt = draft.registrationEnabled && draft.registrationOpensAt ? fromZonedDateTimeLocal(draft.registrationOpensAt, zone) : "";
    const closesAt = draft.registrationEnabled && draft.registrationClosesAt ? fromZonedDateTimeLocal(draft.registrationClosesAt, zone) : "";
    const found: Problem | null =
      eventFormProblem({ name: draft.name, startsAt: draft.startsAt, endsAt: draft.endsAt, location: draft.location }) ??
      (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt) ? { field: "registrationClosesAt", message: "registrationOrder" } : null);
    setProblem(found);
    if (found) {
      setAttempt((n) => n + 1);
      return;
    }
    if (!apiKey) return;
    setSubmitting(true);
    // A 401 reaches the organizer layout's key gate through the API client (registerUnauthorizedHandler).
    const { data, error, response } = await createApiClient({ kind: "organizer", token: apiKey }, { networkErrors: "result" }).PATCH("/api/events/{event_id}", {
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
    if (data) onSaved(data);
    else setFormError(localizedApiError(error, locale, response.status));
  };

  return (
    <>
      <Dialog
        isOpen={event !== null}
        onClose={() => {
          if (!submitting) requestClose();
        }}
        title={copy.editTitle}
        size="lg"
      >
        {event && draft && (
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field label={copy.nameLabel} required error={errorOf("name")}>
              <TextInput value={draft.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label={copy.slugLabel} hint={copy.slugFixed}>
              <CodeInput disabled value={event.slug} />
            </Field>
            <Field label={copy.timeZoneLabel}>
              <Select value={draft.timeZone} onChange={(e) => set("timeZone", e.target.value)}>
                {timeZoneOptions(eventTimeZone(event)).map((zone) => (
                  <option key={zone} value={zone}>
                    {timeZoneLabel(zone, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="space-y-4">
              <DateTimeField
                label={copy.startsLabel}
                required
                value={draft.startsAt}
                onChange={(value) => set("startsAt", value)}
                locale={locale}
                timeZone={draft.timeZone}
                error={errorOf("startsAt")}
              />
              <DateTimeField
                label={copy.endsLabel}
                required
                value={draft.endsAt}
                onChange={(value) => set("endsAt", value)}
                locale={locale}
                timeZone={draft.timeZone}
                error={errorOf("endsAt")}
              />
            </div>
            <Field label={copy.locationLabel} required error={errorOf("location")}>
              <TextInput value={draft.location} onChange={(e) => set("location", e.target.value)} />
            </Field>
            <Field label={copy.descriptionLabel} optional>
              <Textarea rows={3} value={draft.description} onChange={(e) => set("description", e.target.value)} />
            </Field>

            <fieldset className="space-y-4 rounded-card border border-border-default p-4">
              <legend className="px-1 text-body-sm font-bold text-text-primary">{copy.registration}</legend>
              <Switch
                label={copy.registrationOpen}
                description={copy.registrationOffHint}
                checked={draft.registrationEnabled}
                onChange={(checked) => set("registrationEnabled", checked)}
              />
              {draft.registrationEnabled && (
                <div className="space-y-4">
                  <DateTimeField
                    label={`${copy.opensLabel} ${commonCopy[locale].optional}`}
                    value={draft.registrationOpensAt}
                    onChange={(value) => set("registrationOpensAt", value)}
                    locale={locale}
                    timeZone={draft.timeZone}
                  />
                  <DateTimeField
                    label={`${copy.closesLabel} ${commonCopy[locale].optional}`}
                    value={draft.registrationClosesAt}
                    onChange={(value) => set("registrationClosesAt", value)}
                    locale={locale}
                    timeZone={draft.timeZone}
                    error={errorOf("registrationClosesAt")}
                  />
                </div>
              )}
              <Switch label={copy.listed} checked={draft.listed} onChange={(checked) => set("listed", checked)} />
            </fieldset>

            {formError && <FormAlert>{formError}</FormAlert>}

            <DialogActions>
              <Button type="button" variant="ghost" disabled={submitting} onClick={requestClose}>
                {commonCopy[locale].cancel}
              </Button>
              <Button type="submit" variant="primary" loading={submitting}>
                {commonCopy[locale].save}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>
      {discardDialog}
    </>
  );
}
