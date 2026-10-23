import React, { useEffect, useRef, useState } from "react";
import { createApiClient, type BoothOut } from "../../api/client";
import { boothCopy } from "../../copy/booth";
import { commonCopy } from "../../copy/common";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../../lib/attendeeSession";
import { BOOTH_DESCRIPTION_MAX, draftProblems, profileBody, refusedFields, type BoothPageDraft, type BoothPageField } from "../../lib/boothPage";
import { formatNumber } from "../../lib/format";
import type { AttendeeLocale } from "../../lib/i18n";
import { IMAGE_ACCEPT, imageFileProblem } from "../../lib/imageUpload";
import { accessBlockOf, isEventArchived, type AccessBlock } from "../../lib/leadList";
import { BoothLogo } from "../BoothLogo";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { TextInput, Textarea } from "../ui/Input";
import { Notice } from "../ui/Notice";
import { codedMessage } from "./boothText";

interface BoothProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  booth: BoothOut;
  token: string;
  locale: AttendeeLocale;
  /** False while the device is offline: nothing can be sent. */
  online: boolean;
  /** The congress is archived: the page is read-only. */
  archived: boolean;
  /** The booth as saved; `closed` when the dialog is done (the text was saved), otherwise only the logo changed. */
  onSaved: (booth: BoothOut, closed: boolean) => void;
  onAccessBlocked: (block: AccessBlock) => void;
  onArchived: () => void;
  onSessionChanged: () => void;
}

const draftOf = (booth: BoothOut): BoothPageDraft => ({
  description: booth.description,
  website_url: booth.website_url,
  brochure_url: booth.brochure_url,
});

/**
 * The booth's public page as its representatives edit it: the logo (sent as soon as it is picked), the description
 * and the two links (saved together). The name, page address and stand are the organizer's.
 */
export function BoothProfileDialog({ isOpen, onClose, booth, token, locale, online, archived, onSaved, onAccessBlocked, onArchived, onSessionChanged }: BoothProfileDialogProps) {
  const text = boothCopy[locale];
  const common = commonCopy[locale];
  const [draft, setDraft] = useState<BoothPageDraft>(() => draftOf(booth));
  const [invalid, setInvalid] = useState<BoothPageField[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState<"upload" | "remove" | null>(null);
  const [logoNotice, setLogoNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  // The picked file, shown until the saved logo can be loaded (a congress page that is not published serves none).
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [logoHidden, setLogoHidden] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Each opening starts from the booth as saved.
  const [openedFor, setOpenedFor] = useState(false);
  if (isOpen !== openedFor) {
    setOpenedFor(isOpen);
    if (isOpen) {
      setDraft(draftOf(booth));
      setInvalid([]);
      setFormError(null);
      setLogoNotice(null);
    }
  }

  useEffect(() => () => {
    if (localPreview) URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  const readOnly = archived || !online;
  const busy = saving || logoBusy !== null;

  /** A refusal every request shares: "" when the portal took over (access ended), the archived sentence, or null. */
  const handledRefusal = (status: number, error: unknown): string | null => {
    const block = accessBlockOf(status, error);
    if (block) {
      onAccessBlocked(block);
      return "";
    }
    if (isEventArchived(status, error)) {
      onArchived();
      return text.pageArchived;
    }
    return null;
  };

  const sessionCurrent = (): boolean => {
    if (isStoredAttendeeToken(token)) return true;
    setFormError(sessionChangedMessage(locale));
    onSessionChanged();
    return false;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || busy) return;
    setFormError(null);
    const problems = draftProblems(draft);
    setInvalid(problems);
    if (problems.length > 0 || !sessionCurrent()) return;
    setSaving(true);
    try {
      const { data, error, response } = await createApiClient({ kind: "user", token }).PATCH("/api/booths/{booth_id}/profile", {
        params: { path: { booth_id: booth.id } },
        body: profileBody(draft),
      });
      if (attendeeResponseState(token, response.status) !== "current") return;
      if (data) {
        onSaved(data, true);
        return;
      }
      const fields = refusedFields(error);
      if (fields.length > 0) {
        setInvalid(fields);
        return;
      }
      const refusal = handledRefusal(response.status, error);
      if (refusal !== "") setFormError(refusal ?? codedMessage(error, locale) ?? text.saveFailed);
    } catch {
      setFormError(text.saveConnectionLost);
    } finally {
      setSaving(false);
    }
  };

  const showPreview = (file: File | null) => {
    setLocalPreview(file ? URL.createObjectURL(file) : null);
    setLogoHidden(false);
  };

  const uploadLogo = async (file: File) => {
    setLogoNotice(null);
    const problem = imageFileProblem(file);
    if (problem) {
      setLogoNotice({ tone: "danger", text: problem === "type" ? text.logoTypeError : problem === "size" ? text.logoSizeError : text.logoEmptyError });
      return;
    }
    if (!sessionCurrent()) return;
    setLogoBusy("upload");
    try {
      const { data, error, response } = await createApiClient({ kind: "user", token }).PUT("/api/booths/{booth_id}/logo", {
        params: { path: { booth_id: booth.id }, header: { "content-type": file.type } },
        // The image itself, sent as is; the server re-encodes it.
        body: file as unknown as string,
        bodySerializer: (body: unknown) => body as BodyInit,
      });
      if (attendeeResponseState(token, response.status) !== "current") return;
      if (data) {
        showPreview(file);
        setLogoNotice({ tone: "success", text: text.logoSaved });
        onSaved(data, false);
        return;
      }
      const refusal = handledRefusal(response.status, error);
      if (refusal !== "") setLogoNotice({ tone: "danger", text: refusal ?? codedMessage(error, locale) ?? text.logoFailed });
    } catch {
      setLogoNotice({ tone: "danger", text: text.logoFailed });
    } finally {
      setLogoBusy(null);
    }
  };

  const removeLogo = async () => {
    setLogoNotice(null);
    if (!sessionCurrent()) return;
    setLogoBusy("remove");
    try {
      const { data, error, response } = await createApiClient({ kind: "user", token }).DELETE("/api/booths/{booth_id}/logo", {
        params: { path: { booth_id: booth.id } },
      });
      if (attendeeResponseState(token, response.status) !== "current") return;
      if (data) {
        showPreview(null);
        setLogoNotice({ tone: "success", text: text.logoRemoved });
        onSaved(data, false);
        return;
      }
      const refusal = handledRefusal(response.status, error);
      if (refusal !== "") setLogoNotice({ tone: "danger", text: refusal ?? codedMessage(error, locale) ?? text.logoFailed });
    } catch {
      setLogoNotice({ tone: "danger", text: text.logoFailed });
    } finally {
      setLogoBusy(null);
    }
  };

  const fieldError = (field: BoothPageField): string | undefined => {
    if (!invalid.includes(field)) return undefined;
    return field === "description" ? text.descriptionTooLong(formatNumber(BOOTH_DESCRIPTION_MAX, locale)) : text.urlInvalid;
  };
  const set = (field: BoothPageField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const formId = "booth-page-form";
  const logoSrc = localPreview ?? booth.logo_url;
  const hasLogo = Boolean(booth.logo_url);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={text.editPage}
      size="md"
      footer={
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {common.cancel}
          </Button>
          <Button type="submit" form={formId} variant="primary" icon="check" loading={saving} disabled={readOnly || logoBusy !== null}>
            {common.save}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} noValidate className="space-y-5">
        {archived ? <Notice tone="warning">{text.pageArchived}</Notice> : !online && <Notice tone="warning">{text.pageOffline}</Notice>}

        <fieldset className="space-y-3" aria-describedby="booth-logo-hint">
          <legend className="ui-label">{text.logo}</legend>
          <div className="flex flex-wrap items-center gap-3">
            {hasLogo && !logoHidden && (
              <BoothLogo key={logoSrc} src={logoSrc} alt={booth.name} size="header" onUnavailable={() => setLogoHidden(true)} />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                icon="upload"
                loading={logoBusy === "upload"}
                disabled={readOnly || busy}
                onClick={() => fileInput.current?.click()}
              >
                {hasLogo ? text.replaceLogo : text.chooseLogo}
              </Button>
              {hasLogo && (
                <Button type="button" variant="ghost" icon="trash" loading={logoBusy === "remove"} disabled={readOnly || busy} onClick={() => void removeLogo()}>
                  {text.removeLogo}
                </Button>
              )}
            </div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="booth-logo-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadLogo(file);
            }}
          />
          <p id="booth-logo-hint" className="text-caption text-text-muted">
            {hasLogo && logoHidden ? text.logoNotShown : text.logoHint}
          </p>
          {logoNotice && <Notice tone={logoNotice.tone}>{logoNotice.text}</Notice>}
        </fieldset>

        <Field
          label={text.description}
          optional
          hint={text.descriptionCount(formatNumber(draft.description.length, locale), formatNumber(BOOTH_DESCRIPTION_MAX, locale))}
          error={fieldError("description")}
        >
          <Textarea rows={5} value={draft.description} maxLength={BOOTH_DESCRIPTION_MAX} disabled={archived} onChange={set("description")} />
        </Field>

        <Field label={text.website} optional error={fieldError("website_url")}>
          <TextInput
            type="url"
            dir="ltr"
            inputMode="url"
            autoComplete="url"
            value={draft.website_url}
            disabled={archived}
            onChange={set("website_url")}
            placeholder="https://company.example.com"
          />
        </Field>

        <Field label={text.brochure} optional error={fieldError("brochure_url")}>
          <TextInput
            type="url"
            dir="ltr"
            inputMode="url"
            value={draft.brochure_url}
            disabled={archived}
            onChange={set("brochure_url")}
            placeholder="https://company.example.com/brochure.pdf"
          />
        </Field>

        {formError && <Notice tone="danger">{formError}</Notice>}
      </form>
    </Dialog>
  );
}
