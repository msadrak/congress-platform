import React, { useState } from "react";
import { Link } from "react-router-dom";
import type { EventSessionCreate, EventSessionOut, VenuePlaceOut } from "../../api/client";
import { Button } from "../ui/Button";
import { DateTimeField } from "../ui/DateTimeField";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Select, TextInput, Textarea } from "../ui/Input";
import { FormAlert } from "./WorkspaceUi";
import { fromZonedDateTimeLocal, shiftDateTimeLocal, toZonedDateTimeLocal, wallClockSpan } from "./sessionTime";
import { useGuardedClose } from "./useGuardedClose";
import { SESSION_FIELD_LIMITS } from "../../lib/sessionCsv";
import { commonCopy } from "../../copy/common";
import { organizerProgramCopy } from "../../copy/organizerProgram";

interface SessionFormDialogProps {
  /** The session being edited, or null to add one. Mount per target (`key`) so the form starts fresh. */
  session: EventSessionOut | null;
  halls: VenuePlaceOut[];
  /** Track suggestions (existing tracks first). */
  tracks: string[];
  /** Day (YYYY-MM-DD, on the event's clock) a new session starts on. */
  defaultDay: string;
  /** The event's IANA zone: times are shown and entered on its clock, not the browser's. */
  timeZone: string;
  /** Where halls are added (the program's halls tab). */
  venuePath: string;
  locale: "fa" | "en";
  /** Saves the session; resolves to an error message, or null when saved (the caller closes the dialog). */
  onSave: (body: EventSessionCreate) => Promise<string | null>;
  onClose: () => void;
}

const HOUR_MS = 3_600_000;

export function SessionFormDialog({ session, halls, tracks, defaultDay, timeZone, venuePath, locale, onSave, onClose }: SessionFormDialogProps) {
  const c = organizerProgramCopy[locale].form;
  const common = commonCopy[locale];
  const [title, setTitle] = useState(session?.title ?? "");
  const [track, setTrack] = useState(session?.track ?? "");
  const [hallId, setHallId] = useState(session?.hall_id ?? "");
  const [speakers, setSpeakers] = useState(session?.speakers ?? "");
  const [description, setDescription] = useState(session?.description ?? "");
  const [startsAt, setStartsAt] = useState(session ? toZonedDateTimeLocal(session.starts_at, timeZone) : `${defaultDay}T09:00`);
  const [endsAt, setEndsAt] = useState(session ? toZonedDateTimeLocal(session.ends_at, timeZone) : `${defaultDay}T10:00`);
  // What the form opened with: closing it with other values asks before discarding them.
  const [initial] = useState(() => JSON.stringify([title, track, hallId, speakers, description, startsAt, endsAt]));
  const dirty = JSON.stringify([title, track, hallId, speakers, description, startsAt, endsAt]) !== initial;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  // The field values carry no zone: they are wall times on the event's clock (`timeZone`).
  const changeStart = (value: string) => {
    const span = wallClockSpan(startsAt, endsAt);
    setStartsAt(value);
    // Moving the start keeps the session's length, so the end never silently lands before it.
    const nextEnd = shiftDateTimeLocal(value, Number.isNaN(span) || span < 0 ? HOUR_MS : span);
    if (nextEnd) setEndsAt(nextEnd);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTitleError(null);
    const startsIso = fromZonedDateTimeLocal(startsAt, timeZone);
    const endsIso = fromZonedDateTimeLocal(endsAt, timeZone);
    if (!title.trim()) {
      setTitleError(c.titleRequired);
      return;
    }
    if (!startsIso || !endsIso) {
      setError(c.timesRequired);
      return;
    }
    if (Date.parse(endsIso) < Date.parse(startsIso)) {
      setError(c.endBeforeStart);
      return;
    }
    setSubmitting(true);
    const failure = await onSave({
      title: title.trim(),
      track: track.trim(),
      speakers: speakers.trim(),
      description: description.trim(),
      hall_id: hallId || null,
      starts_at: startsIso,
      ends_at: endsIso,
    });
    setSubmitting(false);
    if (failure) setError(failure);
  };

  const { requestClose, discardDialog } = useGuardedClose(dirty, onClose, locale);
  const close = () => {
    if (!submitting) requestClose();
  };

  return (
    <>
      <Dialog
        isOpen
        onClose={close}
        title={session ? c.editTitle : c.newTitle}
        size="lg"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={submitting} onClick={close}>
              {common.cancel}
            </Button>
            <Button type="submit" form="session-form" variant="primary" loading={submitting}>
              {session ? c.save : c.add}
            </Button>
          </div>
        }
      >
        <form id="session-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label={c.title} required error={titleError}>
            <TextInput
              type="text"
              required
              maxLength={SESSION_FIELD_LIMITS.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={c.titlePlaceholder}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <DateTimeField label={c.starts} required value={startsAt} onChange={changeStart} locale={locale} timeZone={timeZone} />
            <DateTimeField label={c.ends} required value={endsAt} onChange={setEndsAt} locale={locale} timeZone={timeZone} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={c.track} hint={c.trackHint}>
              <TextInput type="text" list="session-track-options" maxLength={SESSION_FIELD_LIMITS.track} value={track} onChange={(e) => setTrack(e.target.value)} />
            </Field>
            <datalist id="session-track-options">
              {tracks.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
            <Field
              label={c.hall}
              hint={
                halls.length === 0 ? (
                  <>
                    {c.noHalls}{" "}
                    <Link to={venuePath} className="font-semibold text-action-primary hover:underline">
                      {c.addHalls}
                    </Link>
                  </>
                ) : undefined
              }
            >
              <Select value={hallId} onChange={(e) => setHallId(e.target.value)}>
                <option value="">{c.noHall}</option>
                {halls.map((hall) => (
                  <option key={hall.id} value={hall.id}>
                    {hall.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label={c.speakers} hint={c.speakersHint}>
            <TextInput
              type="text"
              maxLength={SESSION_FIELD_LIMITS.speakers}
              value={speakers}
              onChange={(e) => setSpeakers(e.target.value)}
              placeholder={c.speakersPlaceholder}
            />
          </Field>

          <Field label={c.description}>
            <Textarea rows={3} maxLength={SESSION_FIELD_LIMITS.description} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          {error && <FormAlert>{error}</FormAlert>}
        </form>
      </Dialog>
      {discardDialog}
    </>
  );
}
