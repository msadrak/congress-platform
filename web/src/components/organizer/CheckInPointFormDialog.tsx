import React, { useState } from "react";
import { formatApiError, type CheckInPointOut, type TicketTierOut } from "../../api/client";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";
import { checkInPolicyMeta, type PolicyType } from "./checkInPolicy";
import { useEventWorkspace } from "./eventWorkspaceContext";

type PointDraft = { name: string; location: string; policy: PolicyType; allowedTiers: string[]; maxCapacity: number | undefined };
type PointField = "name" | "tiers";

const NEW_POINT: PointDraft = { name: "", location: "", policy: "MULTI_ENTRY", allowedTiers: [], maxCapacity: undefined };

type CheckInPointFormDialogProps = {
  /** The event's tiers, offered for a tier-restricted point. */
  tiers: TicketTierOut[];
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

/** Create or edit a check-in point and its admission policy. */
export function CheckInPointFormDialog(props: CheckInPointFormDialogProps) {
  const { tiers, onClose, onSaved } = props;
  const { eventId, apiKey, client, onKeyRejected, t, isRtl } = useEventWorkspace();
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
      });
      setFormError(null);
      setInvalidField(null);
    }
  }

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
      setFormError(isRtl ? "حداقل یک رده بلیت مجاز برای این گیت انتخاب کنید." : "Select at least one allowed tier.");
      return;
    }
    if (!apiKey || !client) return;
    setSubmitting(true);
    const { data, error: err, response } = point
      ? await client.PATCH("/api/events/{event_id}/checkin-points/{point_id}", {
          params: { path: { event_id: eventId, point_id: point.id } },
          body: {
            name: draft.name.trim(),
            location: draft.location.trim(),
            policy_type: draft.policy,
            // An edit clears what the new policy does not use.
            allowed_tier_ids: draft.policy === "TIER_RESTRICTED" ? draft.allowedTiers : [],
            max_capacity: draft.policy === "CAPACITY_CAPPED" ? draft.maxCapacity || null : null,
          },
        })
      : await client.POST("/api/events/{event_id}/checkin-points", {
          params: { path: { event_id: eventId } },
          body: {
            name: draft.name.trim(),
            location: draft.location.trim(),
            policy_type: draft.policy,
            allowed_tier_ids: draft.policy === "TIER_RESTRICTED" ? draft.allowedTiers : undefined,
            max_capacity: draft.policy === "CAPACITY_CAPPED" && draft.maxCapacity ? draft.maxCapacity : undefined,
          },
        });
    if (response.status === 401) onKeyRejected(apiKey);
    setSubmitting(false);
    if (err) {
      setFormError(formatApiError(err));
    } else if (data) {
      if (!point) setDraft(NEW_POINT);
      onSaved(data);
    }
  };

  const cancelLabel = isRtl ? "انصراف" : "Cancel";
  const policyMeta = checkInPolicyMeta(t);

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
              <option value="TIER_RESTRICTED">{t.policyTierRestricted}</option>
              <option value="CAPACITY_CAPPED">{t.policyCapacityCapped}</option>
            </select>
          </Field>

          {draft.policy === "TIER_RESTRICTED" && (
            <fieldset className="space-y-2 rounded-xl border border-border-default bg-surface-panel-subtle p-3.5">
              <legend className="sr-only">{t.allowedTiersLabel}</legend>
              <span aria-hidden="true" className="ui-label">
                {t.allowedTiersLabel}
                <span className="ms-1 text-status-danger-solid">*</span>
              </span>
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
          )}

          {draft.policy === "CAPACITY_CAPPED" && (
            <Field label={t.maxCapacityLabel}>
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
