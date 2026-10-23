import React, { useRef, useState } from "react";
import { localizedApiError, type TicketTierOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerSetupCopy } from "../../copy/organizerSetup";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DateTimeField } from "../ui/DateTimeField";
import { Dialog } from "../ui/Dialog";
import { NumberInput, Select, Textarea, TextInput } from "../ui/Input";
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

/** Create or edit a pass type; its reservation window is entered on the congress clock. Closing an open type asks first. */
export function TierFormDialog(props: TierFormDialogProps) {
  const { onClose, onSaved } = props;
  const { eventId, event, client, locale } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].tierForm;
  const common = commonCopy[locale];
  const zone = event ? eventTimeZone(event) : "";
  const tier = props.mode === "edit" ? props.tier : null;
  const isEdit = props.mode === "edit";
  const isOpen = props.mode === "edit" ? props.tier !== null : props.isOpen;

  const [draft, setDraft] = useState<TierDraft>(NEW_TIER);
  // What the form started from: closing it with other values asks before discarding them.
  const [initial, setInitial] = useState<TierDraft>(NEW_TIER);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The field the last client-side check rejected; its message shows under that field.
  const [invalidField, setInvalidField] = useState<TierField | null>(null);
  const fieldError = (field: TierField) => (invalidField === field ? formError : null);
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
  const { requestClose, discardDialog } = useGuardedClose(dirty, onClose, locale);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isEdit && !tier) return;
    setFormError(null);
    setInvalidField(null);
    if (!draft.name.trim()) {
      setInvalidField("name");
      setFormError(copy.nameRequired);
      return;
    }
    if (!(draft.quota >= 1)) {
      setInvalidField("quota");
      setFormError(copy.quotaInvalid);
      return;
    }
    const salesStartsAt = draft.salesStartsAt ? fromZonedDateTimeLocal(draft.salesStartsAt, zone) : "";
    const salesEndsAt = draft.salesEndsAt ? fromZonedDateTimeLocal(draft.salesEndsAt, zone) : "";
    if (salesStartsAt && salesEndsAt && Date.parse(salesEndsAt) <= Date.parse(salesStartsAt)) {
      setInvalidField("salesEndsAt");
      setFormError(copy.salesOrder);
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
    const { data, error: err, response } = tier
      ? await client.PATCH("/api/events/{event_id}/ticket-tiers/{tier_id}", { params: { path: { event_id: eventId, tier_id: tier.id } }, body })
      : await client.POST("/api/events/{event_id}/ticket-tiers", { params: { path: { event_id: eventId } }, body });
    setSubmitting(false);
    if (!data) {
      setFormError(localizedApiError(err, locale, response.status));
      return;
    }
    if (!tier) setDraft(NEW_TIER);
    onSaved(data);
  };

  const quotaField = (
    <Field label={copy.quota} required hint={isEdit ? copy.quotaHint : undefined} error={fieldError("quota")}>
      <NumberInput
        required
        locale={locale}
        value={draft.quota || undefined}
        onValueChange={(quota) => setDraft((d) => ({ ...d, quota: quota ?? 0 }))}
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
        title={isEdit ? copy.editTitle : copy.createTitle}
        size="md"
      >
        {(!isEdit || tier) && (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field label={copy.name} required error={fieldError("name")}>
              <TextInput
                required
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder={isEdit ? undefined : copy.namePlaceholder}
              />
            </Field>

            {isEdit ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {quotaField}
                <Field label={copy.status}>
                  <Select value={draft.isOpen ? "open" : "closed"} onChange={(e) => setDraft((d) => ({ ...d, isOpen: e.target.value === "open" }))}>
                    <option value="open">{common.status.open}</option>
                    <option value="closed">{common.status.closed}</option>
                  </Select>
                </Field>
              </div>
            ) : (
              quotaField
            )}

            <Field label={copy.description} optional>
              <Textarea rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
            </Field>

            {!isEdit && (
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-body-sm font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={draft.isOpen}
                  onChange={(e) => setDraft((d) => ({ ...d, isOpen: e.target.checked }))}
                  className="size-4 shrink-0 accent-aiteb-indigo"
                />
                {copy.isOpen}
              </label>
            )}

            <fieldset className="space-y-3">
              <legend className="ui-label">
                {copy.salesWindow} <span className="font-normal text-text-muted">{common.optional}</span>
              </legend>
              <DateTimeField
                label={copy.salesStart}
                value={draft.salesStartsAt}
                onChange={(value) => setDraft((d) => ({ ...d, salesStartsAt: value }))}
                locale={locale}
                timeZone={zone}
              />
              <DateTimeField
                label={copy.salesEnd}
                value={draft.salesEndsAt}
                onChange={(value) => setDraft((d) => ({ ...d, salesEndsAt: value }))}
                locale={locale}
                timeZone={zone}
                hint={copy.salesHint}
                error={fieldError("salesEndsAt")}
              />
            </fieldset>

            {formError && invalidField === null && <FormAlert>{formError}</FormAlert>}

            <DialogActions>
              <Button type="button" variant="ghost" disabled={submitting} onClick={requestClose}>
                {common.cancel}
              </Button>
              <Button type="submit" variant="primary" loading={submitting}>
                {isEdit ? common.save : common.add}
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
          title={copy.closeTitle}
          description={copy.closeBody}
          confirmLabel={copy.closeConfirm}
          cancelLabel={common.cancel}
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
