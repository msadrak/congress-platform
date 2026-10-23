import React, { useEffect, useRef, useState } from "react";
import { createApiClient, localizedApiError, type LeadOut } from "../../api/client";
import { isBoothAccessRevoked } from "../../lib/leadList";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../../lib/attendeeSession";
import { codeFontClass, formatLocalizedDate, translations, type AttendeeLocale } from "../../lib/i18n";
import { formatMobile, telHref } from "../../lib/mobile";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { BoothSpinner } from "./BoothSpinner";
import { LeadMonogram } from "./LeadCard";
import { RatingChip, RatingControl } from "./RatingControl";
import { TagPicker } from "./TagPicker";
import { RATING_META, asRating, type LeadRating } from "./rating";

interface QualifyDialogProps {
  /** The lead being qualified; null keeps the dialog closed. */
  lead: LeadOut | null;
  onClose: () => void;
  boothId: string;
  token: string;
  locale: AttendeeLocale;
  tagPresets: string[];
  onSaved: (lead: LeadOut) => void;
  /** 403 BOOTH_STAFF_REQUIRED: this account was removed from the booth. */
  onAccessRevoked: () => void;
}

/** Lead detail and qualification (rating, follow-up tags, notes). Closes itself a moment after a confirmed save. */
export function QualifyDialog({ lead, onClose, boothId, token, locale, tagPresets, onSaved, onAccessRevoked }: QualifyDialogProps) {
  const t = translations[locale];
  const isRtl = locale === "fa";
  const [editRating, setEditRating] = useState<LeadRating>("WARM");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editNotes, setEditNotes] = useState("");
  const [customTagInput, setCustomTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFeedback, setEditFeedback] = useState<string | null>(null);
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
    setEditFeedback(null);
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
      return;
    }

    setSaving(true);
    setEditError(null);
    setEditFeedback(null);
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
      if (isBoothAccessRevoked(response.status, err)) {
        onAccessRevoked();
      } else if (err) {
        // LEAD_DELETED (another device moved it to the trash), LEAD_NOT_FOUND …: in the reader's language.
        setEditError(localizedApiError(err, locale));
      } else if (data) {
        onSaved(data);
        setEditTags(tags);
        setCustomTagInput("");
        setEditFeedback(t.qualificationSavedSuccess);
        cancelClose();
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = undefined;
          onClose();
          setEditFeedback(null);
        }, 1000);
      }
    } catch {
      // The same values can be saved again safely; the form keeps what was typed.
      setEditError(isRtl ? "اتصال قطع شد؛ تغییرات ذخیره نشد. اطلاعات واردشده حفظ شده است، دوباره ذخیره کنید." : "The connection dropped; your changes were not confirmed. Your entry is kept, save again.");
    } finally {
      setSaving(false);
    }
  };

  const role = lead ? [lead.title, lead.organization].filter(Boolean).join(" · ") : "";

  return (
    <Dialog
      isOpen={Boolean(lead)}
      onClose={() => {
        if (!saving) close();
      }}
      title={lead ? `${t.qualificationDrawerTitle}: ${lead.attendee_name}` : ""}
      description={t.qualificationDrawerDesc}
      size="lg"
    >
      {lead && (
        <form onSubmit={handleSave} className="space-y-5">
          <div className={`${RATING_META[asRating(lead.rating)].tone} flex items-start gap-3.5 rounded-2xl border border-border-default bg-surface-page p-4`}>
            <LeadMonogram name={lead.attendee_name} rating={lead.rating} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-bold leading-snug text-text-primary break-words">{lead.attendee_name}</p>
                  {role && <p className="mt-0.5 text-[13px] text-text-secondary break-words">{role}</p>}
                </div>
                <RatingChip rating={lead.rating} locale={locale} size="sm" />
              </div>
              {lead.attendee_mobile && (
                <a
                  href={telHref(lead.attendee_mobile)}
                  className="mt-2 inline-flex min-h-[44px] max-w-full items-center gap-1.5 rounded-sm px-1 text-[13px] font-medium text-action-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <Icon name="phone" size={15} className="shrink-0" />
                  <bdi dir="ltr" className={`min-w-0 break-all ${codeFontClass(formatMobile(lead.attendee_mobile, locale))} text-[12.5px]`}>{formatMobile(lead.attendee_mobile, locale)}</bdi>
                </a>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border-subtle pt-3">
                <div className="min-w-0">
                  <dt className="booth-meta-label">{t.capturedAtLabel}</dt>
                  <dd className="mt-0.5 text-[13px] text-text-primary">{formatLocalizedDate(lead.created_at, locale)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="booth-meta-label">{t.tierColumnLabel}</dt>
                  <dd className="mt-0.5 text-[13px] text-text-primary break-words">{lead.ticket_tier_name}</dd>
                </div>
              </dl>
            </div>
          </div>

          <RatingControl label={t.interestRatingLabel} value={editRating} onChange={setEditRating} locale={locale} />

          <TagPicker label={t.followUpTagsLabel} presets={tagPresets} selected={editTags} onToggle={toggleTag}>
            <div className="relative mt-2.5">
              <Icon name="tag" size={17} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={handleAddCustomTag}
                enterKeyHint="enter"
                placeholder={t.addCustomTagPlaceholder}
                aria-label={t.addCustomTagPlaceholder}
                className="ui-input ps-11"
              />
            </div>
          </TagPicker>

          <div>
            <label htmlFor="booth-edit-notes" className="ui-label">{t.notesLabel}</label>
            <textarea
              id="booth-edit-notes"
              rows={3}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder={t.notesPlaceholder}
              className="ui-textarea"
            />
          </div>
          <div className="sticky -bottom-6 z-10 -mx-5 -mb-6 border-t border-border-subtle bg-surface-panel px-5 pb-5 pt-3 sm:-bottom-7 sm:-mx-7 sm:-mb-7 sm:px-7 sm:pb-6">
            {editFeedback && (
              <div role="status" className="mb-3 flex items-center gap-2.5 rounded-xl border border-status-success-border bg-status-success-bg p-3 text-[13px] font-semibold text-status-success-text motion-safe:animate-pop">
                <Icon name="check-circle" size={18} className="shrink-0" />
                <span>{editFeedback}</span>
              </div>
            )}
            {editError && (
              <div role="alert" aria-live="assertive" className="mb-3 flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3 text-[13px] leading-relaxed text-status-danger-text motion-safe:animate-pop">
                <Icon name="alert" size={18} className="shrink-0" />
                <span>{editError}</span>
              </div>
            )}
            <div className="flex gap-2 sm:justify-end">
              <Button type="button" variant="ghost" size="lg" disabled={saving} onClick={close} className="shrink-0 max-sm:hidden">
                {isRtl ? "انصراف" : "Cancel"}
              </Button>
              <Button type="submit" variant="primary" size="lg" disabled={saving} aria-busy={saving} className="min-w-0 flex-1 sm:flex-none sm:min-w-[15rem]">
                {saving ? <BoothSpinner /> : <Icon name="check" size={19} className="shrink-0" />}
                <span className="whitespace-normal leading-tight">{saving ? (isRtl ? "در حال ذخیره…" : "Saving…") : t.saveQualificationAction}</span>
              </Button>
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}
