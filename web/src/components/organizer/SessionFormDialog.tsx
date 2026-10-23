import React, { useState } from "react";
import { Link } from "react-router-dom";
import type { EventSessionCreate, EventSessionOut, VenuePlaceOut } from "../../api/client";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";
import { fromZonedDateTimeLocal, shiftDateTimeLocal, toZonedDateTimeLocal, wallClockSpan } from "./sessionTime";
import { useGuardedClose } from "./useGuardedClose";
import { SESSION_FIELD_LIMITS } from "../../lib/sessionCsv";

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
  venuePath: string;
  isRtl: boolean;
  /** Saves the session; resolves to an error message, or null when saved (the caller closes the dialog). */
  onSave: (body: EventSessionCreate) => Promise<string | null>;
  onClose: () => void;
}

const HOUR_MS = 3_600_000;

export function SessionFormDialog({ session, halls, tracks, defaultDay, timeZone, venuePath, isRtl, onSave, onClose }: SessionFormDialogProps) {
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

  // `datetime-local` values carry no zone: they are wall times on the event's clock (`timeZone`).
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
    const startsIso = fromZonedDateTimeLocal(startsAt, timeZone);
    const endsIso = fromZonedDateTimeLocal(endsAt, timeZone);
    if (!title.trim()) {
      setError(isRtl ? "عنوان جلسه را وارد کنید." : "Enter the session title.");
      return;
    }
    if (!startsIso || !endsIso) {
      setError(isRtl ? "زمان شروع و پایان را کامل وارد کنید." : "Enter both the start and the end time.");
      return;
    }
    if (Date.parse(endsIso) < Date.parse(startsIso)) {
      setError(isRtl ? "زمان پایان نمی‌تواند پیش از زمان شروع باشد." : "The end time cannot be before the start time.");
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

  const { requestClose, discardDialog } = useGuardedClose(dirty, onClose, isRtl);
  const close = () => {
    if (!submitting) requestClose();
  };

  return (
    <>
      <Dialog
        isOpen
        onClose={close}
        title={session ? (isRtl ? "ویرایش جلسه" : "Edit session") : isRtl ? "افزودن جلسه" : "Add session"}
        description={
          isRtl
            ? "تغییرات بلافاصله در برنامهٔ همایش برای شرکت‌کنندگان نمایش داده می‌شود."
            : "Changes appear in the attendees' program as soon as you save."
        }
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label={isRtl ? "عنوان" : "Title"} required>
            <input
              type="text"
              required
              maxLength={SESSION_FIELD_LIMITS.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isRtl ? "مثال: سخنرانی افتتاحیه" : "e.g. Opening keynote"}
              className="ui-input"
            />
          </Field>

          <p className="text-xs leading-relaxed text-text-muted" data-testid="session-time-zone">
            {isRtl ? `زمان‌ها به وقت همایش (${timeZone}) است.` : `Times are on the congress clock (${timeZone}).`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={isRtl ? "زمان شروع" : "Starts"} required>
              <input type="datetime-local" required value={startsAt} onChange={(e) => changeStart(e.target.value)} className="ui-input font-mono" />
            </Field>
            <Field label={isRtl ? "زمان پایان" : "Ends"} required>
              <input type="datetime-local" required value={endsAt} min={startsAt} onChange={(e) => setEndsAt(e.target.value)} className="ui-input font-mono" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={isRtl ? "نوع (Track)" : "Track"}
              hint={isRtl ? "برچسب دسته‌بندی؛ مثلاً سمینار، کارگاه یا نمایشگاه." : "A category label, e.g. Seminar, Workshop or Exhibition."}
            >
              <input
                type="text"
                list="session-track-options"
                maxLength={SESSION_FIELD_LIMITS.track}
                value={track}
                onChange={(e) => setTrack(e.target.value)}
                className="ui-input"
              />
              <datalist id="session-track-options">
                {tracks.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </Field>
            <Field
              label={isRtl ? "سالن" : "Hall"}
              hint={
                halls.length === 0 ? (
                  <>
                    {isRtl ? "هنوز سالنی تعریف نشده است. " : "No hall is defined yet. "}
                    <Link to={venuePath} className="font-semibold text-action-primary hover:underline">
                      {isRtl ? "افزودن سالن" : "Add halls"}
                    </Link>
                  </>
                ) : undefined
              }
            >
              <select value={hallId} onChange={(e) => setHallId(e.target.value)} className="ui-select">
                <option value="">{isRtl ? "بدون سالن" : "No hall"}</option>
                {halls.map((hall) => (
                  <option key={hall.id} value={hall.id}>
                    {hall.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={isRtl ? "سخنرانان" : "Speakers"} hint={isRtl ? "نام‌ها را با ویرگول جدا کنید." : "Separate names with commas."}>
            <input
              type="text"
              maxLength={SESSION_FIELD_LIMITS.speakers}
              value={speakers}
              onChange={(e) => setSpeakers(e.target.value)}
              placeholder={isRtl ? "مثال: دکتر سارا احمدی، دکتر علی رضایی" : "e.g. Dr. Sara Ahmadi, Dr. Ali Rezaei"}
              className="ui-input"
            />
          </Field>

          <Field label={isRtl ? "توضیحات" : "Description"}>
            <textarea
              rows={3}
              maxLength={SESSION_FIELD_LIMITS.description}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="ui-textarea"
            />
          </Field>

          {error && <FormAlert>{error}</FormAlert>}

          <DialogActions>
            <Button type="button" variant="ghost" size="md" disabled={submitting} onClick={close}>
              {isRtl ? "انصراف" : "Cancel"}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submitting}>
              {submitting ? (isRtl ? "در حال ذخیره…" : "Saving…") : session ? (isRtl ? "ذخیره تغییرات" : "Save changes") : isRtl ? "افزودن جلسه" : "Add session"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      {discardDialog}
    </>
  );
}
