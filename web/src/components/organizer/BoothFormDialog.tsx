import React, { useState } from "react";
import { formatApiError, type BoothOut } from "../../api/client";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";
import { useEventWorkspace } from "./eventWorkspaceContext";

type BoothDraft = Pick<BoothOut, "name" | "slug" | "location" | "description" | "website_url" | "brochure_url">;

const NEW_BOOTH: BoothDraft = { name: "", slug: "", location: "", description: "", website_url: "", brochure_url: "" };

/** Slug suggested from a booth name: Latin letters and digits joined by single hyphens; a Persian name suggests nothing. */
const boothSlugFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/** First problem in a booth form (the checks the browser's `required`/`type="url"` used to make), named per field. */
function boothDraftProblem(draft: BoothDraft, isRtl: boolean): { field: keyof BoothDraft; message: string } | null {
  if (!draft.name.trim()) return { field: "name", message: isRtl ? "نام غرفه را وارد کنید." : "Enter the booth name." };
  if (!draft.slug.trim()) {
    return {
      field: "slug",
      message: isRtl
        ? "شناسه اینترنتی غرفه را وارد کنید؛ فقط حروف انگلیسی کوچک، عدد و خط تیره."
        : "Enter the booth slug: lowercase letters, numbers and hyphens.",
    };
  }
  for (const field of ["website_url", "brochure_url"] as const) {
    const value = draft[field].trim();
    if (!value) continue;
    // The API accepts only absolute http(s) addresses: these become links on the public booth page.
    if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) {
      return {
        field,
        message: isRtl ? "نشانی کامل وب را وارد کنید؛ مثلاً https://company.example.com" : "Enter a full web address, e.g. https://company.example.com.",
      };
    }
  }
  return null;
}

type BoothFormDialogProps = {
  onClose: () => void;
  /** The created or saved booth; the caller updates its list, closes the dialog and announces the change. */
  onSaved: (booth: BoothOut) => void;
} & (
  | {
      /** A new booth: what was typed survives closing the dialog until a booth is created. */
      mode: "create";
      isOpen: boolean;
    }
  | {
      /** An existing booth, open while non-null; each opening starts from the booth's saved values. */
      mode: "edit";
      booth: BoothOut | null;
    }
);

/** Create or edit an exhibition booth. A new booth's slug is suggested from its name. */
export function BoothFormDialog(props: BoothFormDialogProps) {
  const { onClose, onSaved } = props;
  const { eventId, apiKey, client, onKeyRejected, t, isRtl } = useEventWorkspace();
  const booth = props.mode === "edit" ? props.booth : null;
  const isEdit = props.mode === "edit";
  const isOpen = props.mode === "edit" ? props.booth !== null : props.isOpen;

  const [draft, setDraft] = useState<BoothDraft>(NEW_BOOTH);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The field the last client-side check rejected; marked only while the form's error is shown.
  const [invalidField, setInvalidField] = useState<keyof BoothDraft | null>(null);
  const fieldInvalid = (field: keyof BoothDraft) => (formError !== null && invalidField === field) || undefined;

  // Each opening of the edit form starts from the booth as saved.
  const [shownBooth, setShownBooth] = useState<BoothOut | null>(null);
  if (booth !== shownBooth) {
    setShownBooth(booth);
    if (booth) {
      setDraft({
        name: booth.name,
        slug: booth.slug,
        location: booth.location,
        description: booth.description,
        website_url: booth.website_url,
        brochure_url: booth.brochure_url,
      });
      setFormError(null);
      setInvalidField(null);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit && (!booth || !eventId || !apiKey)) return;
    if (!eventId) return;
    setFormError(null);
    setInvalidField(null);
    const body: BoothDraft = {
      name: draft.name.trim(),
      slug: draft.slug.trim(),
      location: draft.location.trim(),
      description: draft.description.trim(),
      website_url: draft.website_url.trim(),
      brochure_url: draft.brochure_url.trim(),
    };
    const problem = boothDraftProblem(body, isRtl);
    if (problem) {
      setInvalidField(problem.field);
      setFormError(problem.message);
      return;
    }
    if (!apiKey || !client) return;
    setSubmitting(true);
    const { data, error: err, response } = booth
      ? await client.PATCH("/api/events/{event_id}/booths/{booth_id}", {
          params: { path: { event_id: eventId, booth_id: booth.id } },
          body,
        })
      : await client.POST("/api/events/{event_id}/booths", {
          params: { path: { event_id: eventId } },
          body,
        });
    if (response.status === 401) onKeyRejected(apiKey);
    setSubmitting(false);
    if (booth && response.status === 409) {
      setInvalidField("slug");
      setFormError(
        isRtl
          ? "این شناسه اینترنتی را غرفهٔ دیگری استفاده می‌کند؛ شناسهٔ دیگری انتخاب کنید."
          : "Another booth already uses this slug; choose a different one."
      );
    } else if (err) {
      setFormError(formatApiError(err));
    } else if (data) {
      if (!booth) setDraft(NEW_BOOTH);
      onSaved(data);
    }
  };

  const cancelLabel = isRtl ? "انصراف" : "Cancel";
  // A new booth shows examples in every field; an edit shows the saved values.
  const example = (fa: string, en: string) => (isEdit ? undefined : isRtl ? fa : en);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!submitting) {
          onClose();
          setFormError(null);
        }
      }}
      title={isEdit ? (isRtl ? "ویرایش غرفه" : "Edit booth") : t.createBoothModalTitle}
      description={
        isEdit
          ? booth
            ? isRtl
              ? `ویرایش مشخصات غرفه «${booth.name}».`
              : `Update the details of “${booth.name}”.`
            : undefined
          : t.createBoothModalDesc
      }
      size="md"
    >
      {(!isEdit || booth) && (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label={t.boothNameLabel} required>
            <input
              type="text"
              required
              value={draft.name}
              onChange={(e) => {
                const next = e.target.value;
                setDraft((d) => ({
                  ...d,
                  // A new booth keeps suggesting while the slug is still the one suggested for the previous name.
                  slug: !isEdit && (!d.slug || d.slug === boothSlugFrom(d.name)) ? boothSlugFrom(next) : d.slug,
                  name: next,
                }));
              }}
              aria-invalid={fieldInvalid("name")}
              placeholder={example("مثال: شرکت پیشگامان زیست‌فناوری", "e.g. Biotech Systems Global")}
              className="ui-input"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.boothSlugLabel} required>
              <input
                type="text"
                required
                dir="ltr"
                value={draft.slug}
                onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                aria-invalid={fieldInvalid("slug")}
                placeholder={isEdit ? undefined : "biotech-systems"}
                className="ui-input font-mono"
              />
            </Field>

            <Field label={t.boothLocationLabel}>
              <input
                type="text"
                value={draft.location}
                onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
                placeholder={example("مثال: سالن B، استند شماره ۱۰۴", "e.g. Hall B, Stand 104")}
                className="ui-input"
              />
            </Field>
          </div>

          <Field label={t.websiteUrlLabel}>
            <input
              type="url"
              dir="ltr"
              value={draft.website_url}
              onChange={(e) => setDraft((d) => ({ ...d, website_url: e.target.value }))}
              aria-invalid={fieldInvalid("website_url")}
              placeholder="https://company.example.com"
              className="ui-input font-mono"
            />
          </Field>

          <Field label={t.brochureUrlLabel}>
            <input
              type="url"
              dir="ltr"
              value={draft.brochure_url}
              onChange={(e) => setDraft((d) => ({ ...d, brochure_url: e.target.value }))}
              aria-invalid={fieldInvalid("brochure_url")}
              placeholder="https://company.example.com/brochure.pdf"
              className="ui-input font-mono"
            />
          </Field>

          <Field label={t.boothDescriptionLabel}>
            <textarea
              rows={isEdit ? 3 : 2}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder={example("توضیح مختصر محصولات و فعالیت‌های غرفه...", "Overview of company products...")}
              className="ui-textarea"
            />
          </Field>

          {formError && <FormAlert>{formError}</FormAlert>}

          <DialogActions>
            <Button type="button" variant="ghost" size="md" disabled={isEdit ? submitting : undefined} onClick={onClose}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant="primary" size="md" disabled={submitting} aria-busy={submitting}>
              {isEdit
                ? submitting
                  ? t.savingAction
                  : t.saveChangesAction || (isRtl ? "ذخیره تغییرات" : "Save Changes")
                : submitting
                  ? t.creatingAction
                  : t.saveBoothAction}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
