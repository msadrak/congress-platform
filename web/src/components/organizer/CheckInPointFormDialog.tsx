import React, { useId, useState } from "react";
import { localizedApiError, type CheckInPointOut, type EventSessionOut, type TicketTierOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerSetupCopy } from "../../copy/organizerSetup";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { Select, TextInput } from "../ui/Input";
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

/**
 * Create or edit a check-in point: name, location and entry rule up front; the pass-type filter, entry/exit,
 * daily reset, required point and session door under «تنظیمات پیشرفته», collapsed until opened.
 */
export function CheckInPointFormDialog(props: CheckInPointFormDialogProps) {
  const { tiers, points, sessions, onClose, onSaved } = props;
  const { eventId, client, locale } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].pointForm;
  const common = commonCopy[locale];
  const advancedId = useId();
  const point = props.mode === "edit" ? props.point : null;
  const isEdit = props.mode === "edit";
  const isOpen = props.mode === "edit" ? props.point !== null : props.isOpen;

  const [draft, setDraft] = useState<PointDraft>(NEW_POINT);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The field the last client-side check rejected; its message shows under that field.
  const [invalidField, setInvalidField] = useState<PointField | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Each opening of the edit form starts from the point as saved, with the advanced settings collapsed.
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
      setAdvancedOpen(false);
    }
  }

  const occupancyAllowed = OCCUPANCY_POLICIES.includes(draft.policy);
  const tracksOccupancy = occupancyAllowed && draft.tracksOccupancy;
  const windowApplies = draft.policy === "SINGLE_USE" || draft.policy === "CAPACITY_CAPPED" || tracksOccupancy;
  const fieldError = (field: PointField) => (invalidField === field ? formError : null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit && !point) return;
    if (!eventId) return;
    setFormError(null);
    setInvalidField(null);
    if (!draft.name.trim()) {
      setInvalidField("name");
      setFormError(copy.nameRequired);
      return;
    }
    if (draft.policy === "TIER_RESTRICTED" && draft.allowedTiers.length === 0) {
      setInvalidField("tiers");
      setFormError(copy.tiersRequired);
      setAdvancedOpen(true);
      return;
    }
    if (!client) return;
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
    // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
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
    setSubmitting(false);
    if (err) {
      setFormError(localizedApiError(err, locale, response.status));
    } else if (data) {
      if (!point) setDraft(NEW_POINT);
      onSaved(data);
    }
  };

  // Another point of this event, not archived (or the one already chosen), can be required first.
  const parentOptions = points.filter((p) => p.id !== point?.id && (!p.archived_at || p.id === draft.requiresPointId));
  const policyOption = (policy: PolicyType) => (
    <option key={policy} value={policy}>
      {checkInPolicyMeta(policy, locale).label}
    </option>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!submitting) {
          onClose();
          setFormError(null);
        }
      }}
      title={isEdit ? copy.editTitle : copy.createTitle}
      size="md"
    >
      {(!isEdit || point) && (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label={copy.name} required error={fieldError("name")}>
            <TextInput
              required
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={isEdit ? undefined : copy.namePlaceholder}
            />
          </Field>

          <Field label={copy.location}>
            <TextInput
              value={draft.location}
              onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
              placeholder={copy.locationPlaceholder}
            />
          </Field>

          <Field label={copy.rule} required={!isEdit} hint={isEdit ? copy.ruleLocked : checkInPolicyMeta(draft.policy, locale).desc}>
            <Select value={draft.policy} onChange={(e) => setDraft((d) => ({ ...d, policy: e.target.value as PolicyType }))}>
              {policyOption("MULTI_ENTRY")}
              {policyOption("SINGLE_USE")}
              {policyOption("CAPACITY_CAPPED")}
              {/* Kept for points that already use it: a multi-entry point with a tier filter does the same. */}
              {point?.policy_type === "TIER_RESTRICTED" && policyOption("TIER_RESTRICTED")}
            </Select>
          </Field>

          {draft.policy === "CAPACITY_CAPPED" && (
            <Field label={copy.capacity} optional hint={tracksOccupancy ? copy.capacityInside : copy.capacityTotal}>
              <TextInput
                type="number"
                inputMode="numeric"
                min={1}
                className="tabular"
                value={draft.maxCapacity ?? ""}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  setDraft((d) => ({ ...d, maxCapacity: Number.isFinite(value) ? value : undefined }));
                }}
                placeholder={copy.capacityPlaceholder}
              />
            </Field>
          )}

          <div className="rounded-control border border-border-default">
            <button
              type="button"
              aria-expanded={advancedOpen}
              aria-controls={advancedId}
              onClick={() => setAdvancedOpen((open) => !open)}
              className="flex min-h-11 w-full items-center gap-2 px-3.5 text-start text-body-sm font-semibold text-text-primary"
            >
              <Icon name={advancedOpen ? "chevron-down" : "chevron-right"} size={16} />
              {copy.advanced}
            </button>
            {advancedOpen && (
              <div id={advancedId} className="space-y-4 border-t border-border-subtle p-3.5" data-testid="point-advanced">
                <fieldset className="space-y-1">
                  <legend className="ui-label">
                    {copy.tiers}
                    {draft.policy === "TIER_RESTRICTED" && (
                      <span aria-hidden="true" className="ms-1 text-status-danger-solid">
                        *
                      </span>
                    )}
                  </legend>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {tiers.map((tr) => (
                      <label key={tr.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-body-sm text-text-secondary hover:bg-surface-panel-subtle">
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
                          aria-invalid={fieldError("tiers") ? true : undefined}
                          className="size-4 shrink-0 accent-aiteb-indigo"
                        />
                        <bdi>{tr.name}</bdi>
                      </label>
                    ))}
                  </div>
                  {fieldError("tiers") ? (
                    <p className="text-xs font-medium text-status-danger-text">{fieldError("tiers")}</p>
                  ) : (
                    <p className="text-xs text-text-muted">{copy.tiersHint}</p>
                  )}
                </fieldset>

                {occupancyAllowed && (
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 text-body-sm">
                    <input
                      type="checkbox"
                      checked={draft.tracksOccupancy}
                      onChange={(e) => {
                        const { checked } = e.target;
                        setDraft((d) => ({ ...d, tracksOccupancy: checked }));
                      }}
                      className="mt-1 size-4 shrink-0 accent-aiteb-indigo"
                    />
                    <span>
                      <span className="block font-semibold text-text-primary">{copy.occupancy}</span>
                      <span className="block text-xs text-text-muted">{copy.occupancyHint}</span>
                    </span>
                  </label>
                )}

                {windowApplies && (
                  <Field label={copy.resetWindow} hint={copy.resetHint}>
                    <Select value={draft.resetWindow} onChange={(e) => setDraft((d) => ({ ...d, resetWindow: e.target.value === "DAY" ? "DAY" : "EVENT" }))}>
                      <option value="EVENT">{copy.wholeCongress}</option>
                      <option value="DAY">{copy.eachDay}</option>
                    </Select>
                  </Field>
                )}

                <Field label={copy.requires} hint={copy.requiresHint}>
                  <Select value={draft.requiresPointId} onChange={(e) => setDraft((d) => ({ ...d, requiresPointId: e.target.value }))}>
                    <option value="">{copy.noRequirement}</option>
                    {parentOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={copy.session} hint={copy.sessionHint}>
                  <Select value={draft.sessionId} onChange={(e) => setDraft((d) => ({ ...d, sessionId: e.target.value }))}>
                    <option value="">{copy.noSession}</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </div>

          {formError && invalidField === null && <FormAlert>{formError}</FormAlert>}

          <DialogActions>
            <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>
              {common.cancel}
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              {isEdit ? common.save : common.add}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
