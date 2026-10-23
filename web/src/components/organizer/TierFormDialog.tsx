import React, { useRef, useState } from "react";
import { localizedApiError, type TicketTierOut } from "../../api/client";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Dialog } from "../ui/Dialog";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";
import { useEventWorkspace } from "./eventWorkspaceContext";
import { eventTimeZone, fromZonedDateTimeLocal, toZonedDateTimeLocal } from "./sessionTime";
import { useGuardedClose } from "./useGuardedClose";

/** `salesStartsAt`/`salesEndsAt` are `datetime-local` values on the congress clock ("" for no bound). */
type TierDraft = { name: string; description: string; quota: number; isOpen: boolean; salesStartsAt: string; salesEndsAt: string };
type TierField = "name" | "quota" | "salesEndsAt";

const NEW_TIER: TierDraft = { name: "", description: "", quota: 100, isOpen: true, salesStartsAt: "", salesEndsAt: "" };
const sameDraft = (a: TierDraft, b: TierDraft) => (Object.keys(a) as (keyof TierDraft)[]).every((key) => a[key] === b[key]);

type TierFormDialogProps = {
  onClose: () => void;
  /** The created or saved tier; the caller updates its list, closes the dialog and announces the change. */
  onSaved: (tier: TicketTierOut) => void;
} & (
  | {
      /** A new tier: what was typed survives closing the dialog until a tier is created. */
      mode: "create";
      isOpen: boolean;
    }
  | {
      /** An existing tier, open while non-null; each opening starts from the tier's saved values. */
      mode: "edit";
      tier: TicketTierOut | null;
    }
);

/** Create or edit a ticket tier. Closing an open tier asks for confirmation first. */
export function TierFormDialog(props: TierFormDialogProps) {
  const { onClose, onSaved } = props;
  const { eventId, event, client, locale, t, isRtl } = useEventWorkspace();
  const zone = event ? eventTimeZone(event) : "";
  const tier = props.mode === "edit" ? props.tier : null;
  const isEdit = props.mode === "edit";
  const isOpen = props.mode === "edit" ? props.tier !== null : props.isOpen;

  const [draft, setDraft] = useState<TierDraft>(NEW_TIER);
  // What the form started from: closing it with other values asks before discarding them.
  const [initial, setInitial] = useState<TierDraft>(NEW_TIER);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The field the last client-side check rejected; marked only while the form's error is shown.
  const [invalidField, setInvalidField] = useState<TierField | null>(null);
  const fieldInvalid = (field: TierField) => (formError !== null && invalidField === field) || undefined;
  const [confirmClose, setConfirmClose] = useState(false);
  const closeConfirmed = useRef(false);

  // Each opening of the edit form starts from the tier as saved.
  const [shownTier, setShownTier] = useState<TicketTierOut | null>(null);
  if (tier !== shownTier) {
    setShownTier(tier);
    if (tier) {
      const fresh: TierDraft = {
        name: tier.name,
        description: tier.description || "",
        quota: tier.quota,
        isOpen: tier.is_open,
        salesStartsAt: tier.sales_starts_at ? toZonedDateTimeLocal(tier.sales_starts_at, zone) : "",
        salesEndsAt: tier.sales_ends_at ? toZonedDateTimeLocal(tier.sales_ends_at, zone) : "",
      };
      setDraft(fresh);
      setInitial(fresh);
      setFormError(null);
      setInvalidField(null);
    }
  }

  // A new tier keeps what was typed when closed (the draft survives), so only the edit form asks.
  const dirty = isEdit && !sameDraft(draft, initial);
  const { requestClose, discardDialog } = useGuardedClose(dirty, onClose, isRtl);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isEdit && !tier) return;
    if (!eventId) return;
    setFormError(null);
    setInvalidField(null);
    if (!draft.name.trim()) {
      setInvalidField("name");
      setFormError(isRtl ? "نام رده را وارد کنید." : "Enter the tier name.");
      return;
    }
    if (!(draft.quota >= 1)) {
      setInvalidField("quota");
      setFormError(isRtl ? "سهمیه را دست‌کم ۱ وارد کنید." : "Enter a quota of at least 1.");
      return;
    }
    const salesStartsAt = draft.salesStartsAt ? fromZonedDateTimeLocal(draft.salesStartsAt, zone) : "";
    const salesEndsAt = draft.salesEndsAt ? fromZonedDateTimeLocal(draft.salesEndsAt, zone) : "";
    if (salesStartsAt && salesEndsAt && Date.parse(salesEndsAt) <= Date.parse(salesStartsAt)) {
      setInvalidField("salesEndsAt");
      setFormError(isRtl ? "پایان فروش باید پس از شروع آن باشد." : "Sales must end after they start.");
      return;
    }
    if (tier) {
      if (tier.is_open && !draft.isOpen && !closeConfirmed.current) {
        setConfirmClose(true);
        return;
      }
      closeConfirmed.current = false;
    }
    if (!client) return;
    setSubmitting(true);
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      quota: draft.quota,
      is_open: draft.isOpen,
      sales_starts_at: salesStartsAt || null,
      sales_ends_at: salesEndsAt || null,
    };
    // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
    const { data, error: err } = tier
      ? await client.PATCH("/api/events/{event_id}/ticket-tiers/{tier_id}", {
          params: { path: { event_id: eventId, tier_id: tier.id } },
          body,
        })
      : await client.POST("/api/events/{event_id}/ticket-tiers", {
          params: { path: { event_id: eventId } },
          body,
        });
    setSubmitting(false);
    if (err) {
      setFormError(localizedApiError(err, locale));
    } else if (data) {
      if (!tier) setDraft(NEW_TIER);
      onSaved(data);
    }
  };

  const cancelLabel = isRtl ? "انصراف" : "Cancel";
  const quotaField = (
    <Field
      label={t.tierQuotaLabel}
      required
      hint={isEdit ? (isRtl ? "سهمیه نمی‌تواند کمتر از بلیط‌های صادرشده باشد." : "Quota cannot fall below confirmed registrations.") : undefined}
    >
      <input
        type="number"
        required
        min={1}
        value={draft.quota}
        // The edit form reads whole numbers only.
        onChange={(e) => setDraft((d) => ({ ...d, quota: isEdit ? parseInt(e.target.value) || 0 : Number(e.target.value) }))}
        aria-invalid={fieldInvalid("quota")}
        className="ui-input font-mono tabular"
      />
    </Field>
  );

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={() => {
          if (!submitting) {
            requestClose();
            setFormError(null);
          }
        }}
        title={isEdit ? t.editTierTitle || (isRtl ? "ویرایش رده بلیط و سهمیه" : "Edit Ticket Tier") : t.createTierModalTitle}
        description={isEdit ? t.editTierDesc || (isRtl ? "ویرایش نام، توضیحات، سهمیه و وضعیت ثبت‌نام رده." : "Update tier details.") : t.createTierModalDesc}
        size="md"
      >
        {(!isEdit || tier) && (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field label={t.tierNameLabel} required>
              <input
                type="text"
                required
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                aria-invalid={fieldInvalid("name")}
                placeholder={isEdit ? undefined : isRtl ? "مثال: ثبت‌نام استاندارد هیئت علمی" : "e.g. Faculty Full Delegate"}
                className="ui-input"
              />
            </Field>

            {isEdit ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {quotaField}

                <Field label={t.tierStatusLabel || (isRtl ? "وضعیت ثبت‌نام" : "Registration Status")}>
                  <select value={draft.isOpen ? "open" : "closed"} onChange={(e) => setDraft((d) => ({ ...d, isOpen: e.target.value === "open" }))} className="ui-select">
                    <option value="open">{t.tierOpenOption || (isRtl ? "باز جهت ثبت‌نام و صدور بلیط" : "Open for Registration")}</option>
                    <option value="closed">{t.tierClosedOption || (isRtl ? "بسته شده (عدم پذیرش ثبت‌نام)" : "Closed")}</option>
                  </select>
                </Field>
              </div>
            ) : (
              quotaField
            )}

            <Field label={isEdit ? t.tierDescriptionLabel || (isRtl ? "توضیحات و مزایای رده" : "Tier Description") : t.tierDescriptionLabel}>
              <textarea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder={isEdit ? undefined : isRtl ? "شامل دسترسی به تمامی سخنرانی‌ها و نمایشگاه..." : "Includes access to all keynote sessions..."}
                className="ui-textarea"
              />
            </Field>

            {!isEdit && (
              <label
                htmlFor="tierIsOpenInput"
                className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-border-default bg-surface-panel-subtle px-3.5 py-2.5 text-sm font-medium text-text-primary"
              >
                <input
                  type="checkbox"
                  id="tierIsOpenInput"
                  checked={draft.isOpen}
                  onChange={(e) => setDraft((d) => ({ ...d, isOpen: e.target.checked }))}
                  className="size-4 shrink-0 accent-aiteb-indigo"
                />
                {t.tierIsOpenLabel}
              </label>
            )}

            <fieldset className="space-y-3">
              <legend className="ui-label">{isRtl ? "بازهٔ فروش (اختیاری)" : "Sales window (optional)"}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={isRtl ? "شروع فروش" : "Sales start"}>
                  <input
                    type="datetime-local"
                    value={draft.salesStartsAt}
                    onChange={(e) => setDraft((d) => ({ ...d, salesStartsAt: e.target.value }))}
                    className="ui-input font-mono"
                  />
                </Field>
                <Field label={isRtl ? "پایان فروش" : "Sales end"}>
                  <input
                    type="datetime-local"
                    value={draft.salesEndsAt}
                    min={draft.salesStartsAt || undefined}
                    onChange={(e) => setDraft((d) => ({ ...d, salesEndsAt: e.target.value }))}
                    aria-invalid={fieldInvalid("salesEndsAt")}
                    className="ui-input font-mono"
                  />
                </Field>
              </div>
              <p className="text-xs leading-relaxed text-text-muted">
                {isRtl
                  ? `خالی یعنی بدون محدودیت. زمان‌ها به وقت ${zone} است. بیرون از این بازه، رزرو این رده پذیرفته نمی‌شود.`
                  : `Leave blank for no limit. Times are in ${zone}. Outside this window the tier cannot be reserved.`}
              </p>
            </fieldset>

            {formError && <FormAlert>{formError}</FormAlert>}

            <DialogActions>
              <Button type="button" variant="ghost" size="md" disabled={isEdit ? submitting : undefined} onClick={requestClose}>
                {isEdit ? t.cancelAction || cancelLabel : cancelLabel}
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={submitting} aria-busy={submitting}>
                {isEdit
                  ? submitting
                    ? t.savingAction
                    : t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes")
                  : submitting
                    ? t.creatingAction
                    : t.saveTierAction}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      {/* The confirmations render after the form so they stack above it. */}
      {discardDialog}
      {isEdit && (
        <ConfirmDialog
          isOpen={confirmClose}
          title={isRtl ? "بستن این رده بلیط؟" : "Close this ticket tier?"}
          description={
            isRtl
              ? "پس از بستن، شرکت‌کنندگان جدید نمی‌توانند این رده را رزرو کنند. رزروهای موجود حفظ می‌شود."
              : "New attendees will no longer be able to reserve this tier. Existing reservations are kept."
          }
          confirmLabel={isRtl ? "بستن رده" : "Close tier"}
          cancelLabel={cancelLabel}
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            closeConfirmed.current = true;
            setConfirmClose(false);
            void handleSubmit();
          }}
        />
      )}
    </>
  );
}
