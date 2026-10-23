import React, { useState } from "react";
import { localizedApiError, type CheckInPointOut, type EventSessionOut, type TicketTierOut } from "../../api/client";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";
import { checkInPolicyMeta, type PolicyType } from "./checkInPolicy";
import { useEventWorkspace } from "./eventWorkspaceContext";

type ResetWindow = "EVENT" | "DAY";
type PointDraft = {
  name: string;
  location: string;
  policy: PolicyType;
  allowedTiers: string[];
  maxCapacity: number | undefined;
  resetWindow: ResetWindow;
  tracksOccupancy: boolean;
  requiresPointId: string;
  sessionId: string;
};
type PointField = "name" | "tiers";

const NEW_POINT: PointDraft = {
  name: "",
  location: "",
  policy: "MULTI_ENTRY",
  allowedTiers: [],
  maxCapacity: undefined,
  resetWindow: "EVENT",
  tracksOccupancy: false,
  requiresPointId: "",
  sessionId: "",
};

/** Policies whose points can record exits (a single-use point lets a ticket in only once). */
const OCCUPANCY_POLICIES: PolicyType[] = ["MULTI_ENTRY", "CAPACITY_CAPPED", "TIER_RESTRICTED"];

type CheckInPointFormDialogProps = {
  /** The event's tiers, offered as the point's tier filter. */
  tiers: TicketTierOut[];
  /** The event's other points, offered as the point that must admit first. */
  points: CheckInPointOut[];
  /** The event's programme sessions, offered when the point is a session door. */
  sessions: EventSessionOut[];
  onClose: () => void;
  /** The created or saved point; the caller updates its list, closes the dialog and announces the change. */
  onSaved: (point: CheckInPointOut) => void;
} & (
  | {
      /** A new point: what was typed survives closing the dialog until a point is created. */
      mode: "create";
      isOpen: boolean;
    }
  | {
      /** An existing point, open while non-null; each opening starts from the point's saved values. */
      mode: "edit";
      point: CheckInPointOut | null;
    }
);

/** Create or edit a check-in point: its admission policy, tier filter, window, occupancy, hierarchy and session. */
export function CheckInPointFormDialog(props: CheckInPointFormDialogProps) {
  const { tiers, points, sessions, onClose, onSaved } = props;
  const { eventId, apiKey, client, onKeyRejected, t, isRtl, locale } = useEventWorkspace();
  const point = props.mode === "edit" ? props.point : null;
  const isEdit = props.mode === "edit";
  const isOpen = props.mode === "edit" ? props.point !== null : props.isOpen;

  const [draft, setDraft] = useState<PointDraft>(NEW_POINT);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The field the last client-side check rejected; marked only while the form's error is shown.
  const [invalidField, setInvalidField] = useState<PointField | null>(null);
  const fieldInvalid = (field: PointField) => (formError !== null && invalidField === field) || undefined;

  // Each opening of the edit form starts from the point as saved.
  const [shownPoint, setShownPoint] = useState<CheckInPointOut | null>(null);
  if (point !== shownPoint) {
    setShownPoint(point);
    if (point) {
      setDraft({
        name: point.name,
        location: point.location || "",
        policy: point.policy_type as PolicyType,
        allowedTiers: point.allowed_tier_ids || [],
        maxCapacity: point.max_capacity ?? undefined,
        resetWindow: point.reset_window === "DAY" ? "DAY" : "EVENT",
        tracksOccupancy: Boolean(point.tracks_occupancy),
        requiresPointId: point.requires_point_id ?? "",
        sessionId: point.session_id ?? "",
      });
      setFormError(null);
      setInvalidField(null);
    }
  }

  const occupancyAllowed = OCCUPANCY_POLICIES.includes(draft.policy);
  const tracksOccupancy = occupancyAllowed && draft.tracksOccupancy;
  const windowApplies = draft.policy === "SINGLE_USE" || draft.policy === "CAPACITY_CAPPED" || tracksOccupancy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit && !point) return;
    if (!eventId) return;
    setFormError(null);
    setInvalidField(null);
    if (!draft.name.trim()) {
      setInvalidField("name");
      setFormError(isRtl ? "نام گیت را وارد کنید." : "Enter the check-in point name.");
      return;
    }
    if (draft.policy === "TIER_RESTRICTED" && draft.allowedTiers.length === 0) {
      setInvalidField("tiers");
      setFormError(isRtl ? "حداقل یک رده بلیط مجاز برای این گیت انتخاب کنید." : "Select at least one allowed tier.");
      return;
    }
    if (!apiKey || !client) return;
    setSubmitting(true);
    const rules = {
      name: draft.name.trim(),
      location: draft.location.trim(),
      policy_type: draft.policy,
      // The tier filter applies to every policy; an empty list admits every tier.
      allowed_tier_ids: draft.allowedTiers,
      reset_window: windowApplies ? draft.resetWindow : ("EVENT" as const),
      tracks_occupancy: tracksOccupancy,
    };
    const { data, error: err, response } = point
      ? await client.PATCH("/api/events/{event_id}/checkin-points/{point_id}", {
          params: { path: { event_id: eventId, point_id: point.id } },
          body: {
            ...rules,
            // An edit clears what the new settings do not use.
            max_capacity: draft.policy === "CAPACITY_CAPPED" ? draft.maxCapacity || null : null,
            requires_point_id: draft.requiresPointId || null,
            session_id: draft.sessionId || null,
          },
        })
      : await client.POST("/api/events/{event_id}/checkin-points", {
          params: { path: { event_id: eventId } },
          body: {
            ...rules,
            max_capacity: draft.policy === "CAPACITY_CAPPED" && draft.maxCapacity ? draft.maxCapacity : undefined,
            requires_point_id: draft.requiresPointId || undefined,
            session_id: draft.sessionId || undefined,
          },
        });
    if (response.status === 401) onKeyRejected(apiKey);
    setSubmitting(false);
    if (err) {
      setFormError(localizedApiError(err, locale));
    } else if (data) {
      if (!point) setDraft(NEW_POINT);
      onSaved(data);
    }
  };

  const cancelLabel = isRtl ? "انصراف" : "Cancel";
  const policyMeta = checkInPolicyMeta(t);
  // Another point of this event, not archived (or the one already chosen), can be required first.
  const parentOptions = points.filter((p) => p.id !== point?.id && (!p.archived_at || p.id === draft.requiresPointId));

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!submitting) {
          onClose();
          setFormError(null);
        }
      }}
      title={isEdit ? t.editPointTitle || (isRtl ? "ویرایش گیت پذیرش" : "Edit Check-In Point") : t.createPointModalTitle}
      description={isEdit ? t.editPointDesc || (isRtl ? "ویرایش نام، محل استقرار و ظرفیت گیت." : "Update gate details.") : t.createPointModalDesc}
      size="md"
    >
      {(!isEdit || point) && (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label={t.pointNameLabel} required>
            <input
              type="text"
              required
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              aria-invalid={fieldInvalid("name")}
              placeholder={isEdit ? undefined : isRtl ? "مثال: گیت ورودی شمالی سالن ۱" : "e.g. North Gate Entrance"}
              className="ui-input"
            />
          </Field>

          <Field label={t.pointLocationLabel}>
            <input
              type="text"
              value={draft.location}
              onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
              placeholder={
                isEdit
                  ? isRtl
                    ? "مثال: ورودی سالن اصلی، طبقه ۱"
                    : "e.g. Main Hall North, Floor 1"
                  : isRtl
                    ? "مثال: طبقه همکف، درب B"
                    : "e.g. Ground Floor, Gate B"
              }
              className="ui-input"
            />
          </Field>

          <Field
            label={t.policyTypeLabel}
            required={!isEdit}
            hint={
              isEdit
                ? t.policyLockedNotice || (isRtl ? "سیاست پذیرش پس از ثبت اسکن جهت حفظ یکپارچگی مانیفست قفل می‌شود." : "Policy locked once scans are recorded.")
                : policyMeta[draft.policy]?.desc
            }
          >
            <select value={draft.policy} onChange={(e) => setDraft((d) => ({ ...d, policy: e.target.value as PolicyType }))} className="ui-select">
              <option value="MULTI_ENTRY">{t.policyMultiEntry}</option>
              <option value="SINGLE_USE">{t.policySingleUse}</option>
              <option value="CAPACITY_CAPPED">{t.policyCapacityCapped}</option>
              {/* Kept for points that already use it: a multi-entry point with a tier filter does the same. */}
              {point?.policy_type === "TIER_RESTRICTED" && <option value="TIER_RESTRICTED">{t.policyTierRestricted}</option>}
            </select>
          </Field>

          <fieldset className="space-y-2 rounded-xl border border-border-default bg-surface-panel-subtle p-3.5">
            <legend className="sr-only">{t.allowedTiersLabel}</legend>
            <span aria-hidden="true" className="ui-label">
              {t.allowedTiersLabel}
              {draft.policy === "TIER_RESTRICTED" && <span className="ms-1 text-status-danger-solid">*</span>}
            </span>
            <p className="text-xs text-text-muted">
              {isRtl ? "اگر هیچ رده‌ای انتخاب نشود، همهٔ رده‌ها پذیرفته می‌شوند." : "Leave all unticked to admit every tier."}
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {tiers.map((tr) => (
                <label
                  key={tr.id}
                  className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-text-secondary transition-colors hover:bg-surface-panel"
                >
                  <input
                    type="checkbox"
                    checked={draft.allowedTiers.includes(tr.id)}
                    onChange={(e) => {
                      const { checked } = e.target;
                      setDraft((d) => ({
                        ...d,
                        allowedTiers: checked ? [...d.allowedTiers, tr.id] : d.allowedTiers.filter((id) => id !== tr.id),
                      }));
                    }}
                    aria-invalid={fieldInvalid("tiers")}
                    className="size-4 shrink-0 accent-aiteb-indigo"
                  />
                  <span>{tr.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {draft.policy === "CAPACITY_CAPPED" && (
            <Field
              label={t.maxCapacityLabel}
              hint={
                tracksOccupancy
                  ? isRtl
                    ? "سقف افرادی که هم‌زمان داخل هستند."
                    : "The most people inside at once."
                  : isRtl
                    ? "سقف کل ورودها (در هر بازه)."
                    : "The most admissions in total (per window)."
              }
            >
              <input
                type="number"
                min={1}
                value={isEdit ? (draft.maxCapacity ?? "") : draft.maxCapacity || ""}
                onChange={(e) => {
                  const { value } = e.target;
                  // The edit form reads whole numbers only.
                  setDraft((d) => ({ ...d, maxCapacity: value ? (isEdit ? parseInt(value) : Number(value)) : undefined }));
                }}
                placeholder={isEdit ? "200" : isRtl ? "مثال: ۲۵۰" : "e.g. 250"}
                className="ui-input font-mono tabular"
              />
            </Field>
          )}

          {occupancyAllowed && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-default p-3.5 text-sm">
              <input
                type="checkbox"
                checked={draft.tracksOccupancy}
                onChange={(e) => {
                  const { checked } = e.target;
                  setDraft((d) => ({ ...d, tracksOccupancy: checked }));
                }}
                className="mt-0.5 size-4 shrink-0 accent-aiteb-indigo"
              />
              <span className="space-y-0.5">
                <span className="block font-semibold text-text-primary">{isRtl ? "ثبت ورود و خروج" : "Track entry and exit"}</span>
                <span className="block text-xs text-text-muted">
                  {isRtl
                    ? "اسکنر حالت ورود/خروج می‌گیرد و تعداد افراد داخل شمرده می‌شود؛ ورود دوبارهٔ کسی که داخل است دوباره شمرده نمی‌شود."
                    : "The scanner gets an Entry/Exit switch and the point counts who is inside; someone already inside is not counted twice."}
                </span>
              </span>
            </label>
          )}

          {windowApplies && (
            <Field
              label={isRtl ? "بازهٔ تکرار" : "Reset window"}
              hint={
                isRtl
                  ? "روزانه: هر روز (به وقت همایش) از نو؛ مثلاً یک ناهار در روز."
                  : "Daily: starts afresh each day in the congress's time zone, e.g. one lunch per day."
              }
            >
              <select
                value={draft.resetWindow}
                onChange={(e) => setDraft((d) => ({ ...d, resetWindow: e.target.value === "DAY" ? "DAY" : "EVENT" }))}
                className="ui-select"
              >
                <option value="EVENT">{isRtl ? "کل همایش" : "Whole congress"}</option>
                <option value="DAY">{isRtl ? "هر روز" : "Each day"}</option>
              </select>
            </Field>
          )}

          <Field
            label={isRtl ? "گیت پیش‌نیاز" : "Required point"}
            hint={isRtl ? "فقط کسانی پذیرفته می‌شوند که پیش‌تر از این گیت وارد شده‌اند." : "Only tickets already admitted at that point are let in."}
          >
            <select
              value={draft.requiresPointId}
              onChange={(e) => setDraft((d) => ({ ...d, requiresPointId: e.target.value }))}
              className="ui-select"
            >
              <option value="">{isRtl ? "بدون پیش‌نیاز" : "None"}</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={isRtl ? "درِ جلسه" : "Session door"}
            hint={isRtl ? "ورودهای این گیت حضور در آن جلسه به‌شمار می‌آیند." : "Admissions here count as attendance of that session."}
          >
            <select value={draft.sessionId} onChange={(e) => setDraft((d) => ({ ...d, sessionId: e.target.value }))} className="ui-select">
              <option value="">{isRtl ? "هیچ جلسه‌ای" : "No session"}</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </Field>

          {formError && <FormAlert>{formError}</FormAlert>}

          <DialogActions>
            <Button type="button" variant="ghost" size="md" disabled={isEdit ? submitting : undefined} onClick={onClose}>
              {isEdit ? t.cancelAction || cancelLabel : cancelLabel}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submitting} aria-busy={submitting}>
              {isEdit
                ? submitting
                  ? t.savingAction
                  : t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes")
                : submitting
                  ? t.creatingAction
                  : t.savePointAction}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
