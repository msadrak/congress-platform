import React, { useEffect, useRef, useState } from "react";
import { createApiClient, type LeadOut } from "../../api/client";
import { boothCopy } from "../../copy/booth";
import { commonCopy } from "../../copy/common";
import { accessBlockOf, isEventArchived, type AccessBlock } from "../../lib/leadList";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../../lib/attendeeSession";
import type { AttendeeLocale } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { TextInput, Textarea } from "../ui/Input";
import { Notice } from "../ui/Notice";
import { codedMessage } from "./boothText";
import { RatingControl } from "./RatingControl";
import { TagPicker } from "./TagPicker";
import { asRating, type LeadRating } from "./rating";

interface QualifyDialogProps {
  /** The lead being qualified; null keeps the dialog closed. */
  lead: LeadOut | null;
  onClose: () => void;
  boothId: string;
  token: string;
  locale: AttendeeLocale;
  onSaved: (lead: LeadOut) => void;
  /** 403 BOOTH_STAFF_REQUIRED: this account was removed from the booth. */
  onAccessBlocked: (block: AccessBlock) => void;
  /** 409 EVENT_ARCHIVED: the congress is closed; its leads are read-only. */
  onArchived: () => void;
  /** The stored session changed in another tab: the portal re-renders for the current one. */
  onSessionChanged: () => void;
}

/** Rating, follow-up tags and the note of one lead, titled with the attendee's name. Closes a moment after a confirmed save. */
export function QualifyDialog({ lead, onClose, boothId, token, locale, onSaved, onAccessBlocked, onArchived, onSessionChanged }: QualifyDialogProps) {
  const text = boothCopy[locale];
  const common = commonCopy[locale];
  const [editRating, setEditRating] = useState<LeadRating>("WARM");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editNotes, setEditNotes] = useState("");
  const [customTagInput, setCustomTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // The post-save auto-close; cleared whenever another lead is opened or the dialog is closed.
  const closeTimer = useRef<number | undefined>(undefined);

  // The form follows the lead that is opened (a new lead id, never a save of the same one).
  const [formFor, setFormFor] = useState<string | null>(null);
  if (lead && lead.id !== formFor) {
    setFormFor(lead.id);
    setEditRating(asRating(lead.rating));
    setEditTags(lead.tags || []);
    setEditNotes(lead.notes || "");
    setCustomTagInput("");
    setEditError(null);
    setSaved(false);
  } else if (!lead && formFor !== null) {
    setFormFor(null);
  }

  const cancelClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };
  useEffect(() => cancelClose, []);
  useEffect(() => {
    if (!lead) cancelClose();
  }, [lead]);

  const close = () => {
    cancelClose();
    onClose();
  };

  const toggleTag = (tag: string) => {
    setEditTags((current) => (current.includes(tag) ? current.filter((x) => x !== tag) : [...current, tag]));
  };

  const handleAddCustomTag = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const trimmed = customTagInput.trim();
    if (trimmed && !editTags.includes(trimmed)) {
      setEditTags((prev) => [...prev, trimmed]);
      setCustomTagInput("");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead) return;
    if (!isStoredAttendeeToken(token)) {
      setEditError(sessionChangedMessage(locale));
      onSessionChanged();
      return;
    }

    setSaving(true);
    setEditError(null);
    setSaved(false);
    try {
      // A tag typed but not yet added with Enter is still saved.
      const pendingTag = customTagInput.trim();
      const tags = pendingTag && !editTags.includes(pendingTag) ? [...editTags, pendingTag] : editTags;
      const client = createApiClient({ kind: "user", token });
      const { data, error: err, response } = await client.PATCH("/api/booths/{booth_id}/leads/{lead_id}", {
        params: { path: { booth_id: boothId, lead_id: lead.id } },
        body: { rating: editRating, tags, notes: editNotes.trim() },
      });

      // A changed or expired session (the API client removed it) gets no feedback here.
      if (attendeeResponseState(token, response.status) !== "current") return;
      const block = accessBlockOf(response.status, err);
      if (block) {
        onAccessBlocked(block);
      } else if (err) {
        if (isEventArchived(response.status, err)) onArchived();
        // LEAD_DELETED (another device moved it to the trash), LEAD_NOT_FOUND …: in the reader's language.
        setEditError(codedMessage(err, locale) ?? text.saveFailed);
      } else if (data) {
        onSaved(data);
        setEditTags(tags);
        setCustomTagInput("");
        setSaved(true);
        cancelClose();
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = undefined;
          onClose();
          setSaved(false);
        }, 1000);
      }
    } catch {
      // The same values can be saved again safely; the form keeps what was typed.
      setEditError(text.saveConnectionLost);
    } finally {
      setSaving(false);
    }
  };

  const formId = "booth-qualify-form";

  return (
    <Dialog
      isOpen={Boolean(lead)}
      onClose={() => {
        if (!saving) close();
      }}
      title={lead?.attendee_name ?? ""}
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" disabled={saving} onClick={close} className="max-sm:hidden">
            {common.cancel}
          </Button>
          <Button type="submit" form={formId} variant="primary" icon="check" loading={saving}>
            {common.save}
          </Button>
        </>
      }
    >
      {lead && (
        <form id={formId} onSubmit={handleSave} className="space-y-5">
          <RatingControl label={text.interest} value={editRating} onChange={setEditRating} locale={locale} />

          <TagPicker label={text.tags} presets={text.tagPresets} selected={editTags} onToggle={toggleTag}>
            <TextInput
              value={customTagInput}
              maxLength={40}
              onChange={(e) => setCustomTagInput(e.target.value)}
              onKeyDown={handleAddCustomTag}
              enterKeyHint="enter"
              placeholder={text.newTag}
              aria-label={text.newTag}
              className="mt-2.5"
            />
          </TagPicker>

          <Field label={text.note}>
            <Textarea maxLength={2000} rows={3} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
          </Field>

          {saved && <Notice tone="success">{text.leadUpdated}</Notice>}
          {editError && <Notice tone="danger">{editError}</Notice>}
        </form>
      )}
    </Dialog>
  );
}
