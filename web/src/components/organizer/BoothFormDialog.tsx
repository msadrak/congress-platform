import React, { useState } from "react";
import { apiErrorCode, localizedApiError, type BoothOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerSetupCopy } from "../../copy/organizerSetup";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { CodeInput, Textarea, TextInput } from "../ui/Input";
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

type BoothFormCopy = (typeof organizerSetupCopy)["fa" | "en"]["boothForm"];

/** First problem in a booth form (the checks the browser's `required`/`type="url"` used to make), named per field. */
function boothDraftProblem(draft: BoothDraft, copy: BoothFormCopy): { field: keyof BoothDraft; message: string } | null {
  if (!draft.name.trim()) return { field: "name", message: copy.nameRequired };
  if (!draft.slug.trim()) return { field: "slug", message: copy.slugRequired };
  for (const field of ["website_url", "brochure_url"] as const) {
    const value = draft[field].trim();
    if (!value) continue;
    // The API accepts only absolute http(s) addresses: these become links on the public booth page.
    if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) {
      return { field, message: copy.urlInvalid };
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
  const { eventId, client, locale } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].boothForm;
  const common = commonCopy[locale];
  const booth = props.mode === "edit" ? props.booth : null;
  const isEdit = props.mode === "edit";
  const isOpen = props.mode === "edit" ? props.booth !== null : props.isOpen;

  const [draft, setDraft] = useState<BoothDraft>(NEW_BOOTH);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The field the last client-side check rejected; marked only while the form's error is shown.
  const [invalidField, setInvalidField] = useState<keyof BoothDraft | null>(null);
  const fieldError = (field: keyof BoothDraft) => (invalidField === field ? formError : null);

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
    if (isEdit && !booth) return;
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
    const problem = boothDraftProblem(body, copy);
    if (problem) {
      setInvalidField(problem.field);
      setFormError(problem.message);
      return;
    }
    if (!client) return;
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
    setSubmitting(false);
    if (booth && response.status === 409 && apiErrorCode(err) !== "EVENT_ARCHIVED") {
      setInvalidField("slug");
      setFormError(copy.slugTaken);
    } else if (err) {
      setFormError(localizedApiError(err, locale, response.status));
    } else if (data) {
      if (!booth) setDraft(NEW_BOOTH);
      onSaved(data);
    }
  };

  // A new booth shows examples in every field; an edit shows the saved values.
  const example = (text: string) => (isEdit ? undefined : text);

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
      {(!isEdit || booth) && (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label={copy.name} required error={fieldError("name")}>
            <TextInput
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
              placeholder={example(copy.namePlaceholder)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={copy.slug} required hint={copy.slugHint} error={fieldError("slug")}>
              <CodeInput
                required
                value={draft.slug}
                onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                placeholder={isEdit ? undefined : "biotech-systems"}
              />
            </Field>

            <Field label={copy.location}>
              <TextInput value={draft.location} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} placeholder={example(copy.locationPlaceholder)} />
            </Field>
          </div>

          <Field label={copy.website} optional error={fieldError("website_url")}>
            <CodeInput
              type="url"
              value={draft.website_url}
              onChange={(e) => setDraft((d) => ({ ...d, website_url: e.target.value }))}
              placeholder="https://company.example.com"
            />
          </Field>

          <Field label={copy.brochure} optional error={fieldError("brochure_url")}>
            <CodeInput
              type="url"
              value={draft.brochure_url}
              onChange={(e) => setDraft((d) => ({ ...d, brochure_url: e.target.value }))}
              placeholder="https://company.example.com/brochure.pdf"
            />
          </Field>

          <Field label={copy.description} optional>
            <Textarea rows={isEdit ? 3 : 2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </Field>

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
