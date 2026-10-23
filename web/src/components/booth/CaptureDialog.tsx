import React, { useEffect, useRef, useState } from "react";
import {
  apiErrorCode,
  createApiClient,
  localizedApiError,
  type LeadOut,
  type LeadScanInput,
  type LeadScanRequest,
} from "../../api/client";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../../lib/attendeeSession";
import { translations, type AttendeeLocale } from "../../lib/i18n";
import { isBoothAccessRevoked } from "../../lib/leadList";
import { boothText } from "./boothText";
import { QrCameraInput } from "../QrCameraInput";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { BoothSpinner } from "./BoothSpinner";
import { LeadMonogram } from "./LeadCard";
import { RatingChip, RatingControl } from "./RatingControl";
import { TagPicker } from "./TagPicker";
import type { LeadRating } from "./rating";

interface CaptureDialogProps {
  isOpen: boolean;
  onClose: () => void;
  boothId: string;
  token: string;
  locale: AttendeeLocale;
  tagPresets: string[];
  /** A lead was saved (201 new, 200 already a lead of this booth). */
  onCaptured: (lead: LeadOut, existed: boolean) => void;
  /** "Qualify" from the confirmation: the portal closes this dialog and opens qualification. */
  onQualify: (lead: LeadOut) => void;
  /** Stores the scan on this device to send later; false when the device could not keep it. */
  onQueue: (input: LeadScanInput) => Promise<boolean>;
  /** 403 BOOTH_STAFF_REQUIRED: this account was removed from the booth. */
  onAccessRevoked: () => void;
  /** The stored session changed in another tab: the portal re-renders for the current one. */
  onSessionChanged: () => void;
}

/**
 * Capture station: camera, keyboard-wedge reader or typed badge code, optional quick qualification, and the
 * confirmation of who was captured. The portal remounts it (key) for every opening, so each capture starts clean.
 */
export function CaptureDialog({ isOpen, onClose, boothId, token, locale, tagPresets, onCaptured, onQualify, onQueue, onAccessRevoked, onSessionChanged }: CaptureDialogProps) {
  const t = translations[locale];
  const text = boothText(locale);
  const isRtl = locale === "fa";
  // The scan was stored on this device (no connection) instead of sent.
  const [queued, setQueued] = useState(false);
  // After a dropped connection: the scan the operator may keep on the device to send later.
  const [offerQueue, setOfferQueue] = useState<LeadScanInput | null>(null);
  const [qrSecret, setQrSecret] = useState("");
  const [captureRating, setCaptureRating] = useState<LeadRating>("WARM");
  const [captureTags, setCaptureTags] = useState<string[]>([]);
  const [captureNotes, setCaptureNotes] = useState("");
  const [touched, setTouched] = useState({ rating: false, tags: false });
  const [submitting, setSubmitting] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureFeedback, setCaptureFeedback] = useState<string | null>(null);
  // Result of the last capture: who was captured, and whether the lead already existed.
  const [capturedLead, setCapturedLead] = useState<{ lead: LeadOut; existed: boolean } | null>(null);
  const inFlight = useRef(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const resetCapture = () => {
    setQrSecret("");
    setCaptureRating("WARM");
    setCaptureTags([]);
    setCaptureNotes("");
    setTouched({ rating: false, tags: false });
    setCaptureError(null);
    setCaptureFeedback(null);
    setCapturedLead(null);
    setQueued(false);
    setOfferQueue(null);
  };

  useEffect(() => {
    if (!isOpen || capturedLead || queued) return;
    // A keyboard-wedge (USB/HID) scanner types into the focused field and presses Enter.
    const timer = setTimeout(() => codeInputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [isOpen, capturedLead, queued]);

  const close = () => {
    onClose();
    resetCapture();
  };

  const toggleTag = (tag: string) => {
    setCaptureTags((current) => (current.includes(tag) ? current.filter((x) => x !== tag) : [...current, tag]));
    setTouched((p) => ({ ...p, tags: true }));
  };

  const handleCaptureLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qrSecret.trim() || inFlight.current) return;
    if (!isStoredAttendeeToken(token)) {
      setCaptureError(sessionChangedMessage(locale));
      onSessionChanged();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setCaptureError(null);
    setCaptureFeedback(null);
    setOfferQueue(null);
    // Only qualification the operator actually chose is sent, so scanning an attendee who is
    // already a lead never resets their rating or tags.
    const input: LeadScanInput = {
      qr_secret: qrSecret.trim(),
      ...(touched.rating ? { rating: captureRating } : {}),
      ...(touched.tags ? { tags: captureTags } : {}),
      ...(captureNotes.trim() ? { notes: captureNotes.trim() } : {}),
    };
    // No connection at all: keep the scan on this device; it is sent once the booth is back online.
    if (!navigator.onLine) {
      try {
        await queueScan(input);
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
      return;
    }
    try {
      const client = createApiClient({ kind: "user", token });
      const { data, error: err, response } = await client.POST("/api/booths/{booth_id}/leads/scan", {
        params: { path: { booth_id: boothId } },
        // Defaulted fields are optional on the wire; the generated type wrongly requires them.
        body: input as LeadScanRequest,
      });

      // A changed or expired session (the API client removed it) gets no feedback here.
      if (attendeeResponseState(token, response.status) !== "current") return;
      if (isBoothAccessRevoked(response.status, err)) {
        onAccessRevoked();
      } else if (err) {
        // The scan's own 404 (not a badge) and 400 (another congress) carry no code; anything coded is localized.
        const coded = apiErrorCode(err) !== undefined;
        setCaptureError(
          response.status === 404 && !coded
            ? text.badgeInvalid
            : response.status === 400 && !coded
              ? text.badgeOtherEvent
              : response.status === 403 && !coded
                ? isRtl ? "شما اجازهٔ ثبت لید برای این غرفه را ندارید." : "You are not authorized to capture leads for this booth."
                : localizedApiError(err, locale)
        );
      } else if (data) {
        // 201 = new lead, 200 = this attendee was already a lead of this booth.
        const existed = response.status === 200;
        setCapturedLead({ lead: data, existed });
        setCaptureFeedback(existed ? t.leadUpdatedSuccess : t.leadCapturedSuccess);
        setQrSecret("");
        onCaptured(data, existed);
      }
    } catch {
      // The request may or may not have reached the server. Nothing is retried automatically;
      // scanning the same badge again is safe (it updates the same lead), but check the list first.
      // The operator may keep it on the device instead: a repeated scan never makes a second lead.
      setCaptureError(
        isRtl
          ? "اتصال قطع شد و مشخص نیست لید ثبت شده یا نه. فهرست لیدها را بررسی کنید؛ اسکن دوباره همین کارت ورود فقط همان لید را به‌روز می‌کند."
          : "The connection dropped, so it is not known whether the lead was saved. Check the lead list; scanning the same badge again only updates the same lead."
      );
      setOfferQueue(input);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const queueScan = async (input: LeadScanInput) => {
    if (await onQueue(input)) {
      setQueued(true);
      setQrSecret("");
      setCaptureError(null);
      setOfferQueue(null);
      setCaptureFeedback(text.queuedTitle);
    } else {
      setCaptureError(`${text.queueFailed} ${text.storageUnavailable}`);
    }
  };

  const capturedRole = capturedLead ? [capturedLead.lead.title, capturedLead.lead.organization].filter(Boolean).join(" · ") : "";

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!submitting) close();
      }}
      title={t.captureLeadModalTitle}
      description={t.captureLeadModalDesc}
      size="lg"
    >
      {/* Mounted with the dialog (the page behind it is aria-hidden by aria-modal), so the
          capture result is announced; the confirmation card below is visual only. */}
      <p role="status" className="sr-only">{captureFeedback?.replace(/^✓\s*/, "") ?? ""}</p>
      {capturedLead && (
        <div
          className={`${capturedLead.existed ? "booth-confirm-existing" : "booth-confirm-new"} space-y-4`}
          data-testid="capture-result"
        >
          <div className="rounded-2xl border border-[var(--confirm-border)] bg-[var(--confirm-bg)] p-4 sm:p-5">
            <div className="flex items-start gap-3.5">
              <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--confirm-solid)] text-white shadow-[0_10px_24px_-12px_var(--confirm-solid)] motion-safe:animate-pop">
                <Icon name={capturedLead.existed ? "layers" : "check"} size={24} strokeWidth={2.25} />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="booth-meta-label text-[var(--confirm-fg)]">
                  {capturedLead.existed ? (isRtl ? "لید موجود" : "Existing lead") : (isRtl ? "لید جدید" : "New lead")}
                </p>
                <p className="mt-1 text-base font-bold leading-snug text-text-primary">{captureFeedback?.replace(/^✓\s*/, "")}</p>
                {capturedLead.existed && (
                  <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                    {isRtl ? "این شرکت‌کننده قبلاً لید این غرفه بود؛ سطح علاقه و برچسب‌های قبلی حفظ شد." : "This attendee was already a lead of this booth; their rating and tags were kept."}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3.5 rounded-2xl border border-border-default bg-surface-panel p-4">
            <LeadMonogram name={capturedLead.lead.attendee_name} rating={capturedLead.lead.rating} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold leading-snug tracking-[-0.01em] text-text-primary break-words">{capturedLead.lead.attendee_name}</p>
              {capturedRole && <p className="mt-0.5 text-[13px] text-text-secondary break-words">{capturedRole}</p>}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <RatingChip rating={capturedLead.lead.rating} locale={locale} size="sm" />
                <Badge variant="neutral" size="sm">{capturedLead.lead.ticket_tier_name}</Badge>
              </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => {
                // One dialog at a time: the capture dialog closes before qualification opens;
                // the capture button stays one tap away.
                const lead = capturedLead.lead;
                close();
                onQualify(lead);
              }}
            >
              <Icon name="sliders" size={18} />
              <span>{t.qualifyLeadButton}</span>
            </Button>
            <Button
              type="button"
              variant="primary"
              size="lg"
              autoFocus
              onClick={() => {
                resetCapture();
                setTimeout(() => codeInputRef.current?.focus(), 60);
              }}
            >
              <span>{isRtl ? "شرکت‌کننده بعدی" : "Next attendee"}</span>
              <Icon name="arrow-right" size={18} />
            </Button>
          </div>
          <Button type="button" variant="ghost" size="md" isFullWidth onClick={close}>
            {isRtl ? "پایان" : "Done"}
          </Button>
        </div>
      )}
      {queued && (
        <div className="space-y-4" data-testid="capture-queued">
          <div className="rounded-2xl border border-status-warning-border bg-status-warning-bg p-4 sm:p-5">
            <div className="flex items-start gap-3.5">
              <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-status-warning-solid text-white motion-safe:animate-pop">
                <Icon name="hourglass" size={22} />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-base font-bold leading-snug text-text-primary">{text.queuedTitle}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{text.queuedDesc}</p>
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="primary"
            size="lg"
            isFullWidth
            autoFocus
            onClick={() => {
              resetCapture();
              setTimeout(() => codeInputRef.current?.focus(), 60);
            }}
          >
            <span>{isRtl ? "شرکت‌کننده بعدی" : "Next attendee"}</span>
            <Icon name="arrow-right" size={18} />
          </Button>
          <Button type="button" variant="ghost" size="md" isFullWidth onClick={close}>
            {isRtl ? "پایان" : "Done"}
          </Button>
        </div>
      )}
      {!capturedLead && !queued && (
        <form onSubmit={handleCaptureLead} className="space-y-5">
          <QrCameraInput
            isRtl={isRtl}
            disabled={submitting}
            onDecode={(value) => {
              setQrSecret(value);
              setCaptureError(null);
            }}
          />

          <div aria-hidden="true" className="flex items-center gap-3 text-xs font-medium text-text-muted">
            <span className="h-px flex-1 bg-border-default" />
            <span>{isRtl ? "یا کد را وارد کنید" : "or enter the code"}</span>
            <span className="h-px flex-1 bg-border-default" />
          </div>

          <div>
            <label htmlFor="booth-badge-code" className="ui-label">
              {t.badgeCodeLabel} <span aria-hidden="true" className="text-status-danger-solid">*</span>
            </label>
            <div className="relative">
              <Icon name="keyboard" size={19} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                id="booth-badge-code"
                ref={codeInputRef}
                type="text"
                required
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={qrSecret}
                onChange={(e) => setQrSecret(e.target.value)}
                placeholder={t.badgeCodePlaceholder}
                className="ui-input min-h-[54px] ps-11 font-mono text-[17px] placeholder:font-sans placeholder:text-base"
              />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{t.badgeCodeHint}</p>
          </div>

          <div className="space-y-5 rounded-2xl border border-border-subtle bg-surface-page p-4">
            <p className="booth-meta-label flex items-center gap-2">
              <Icon name="sliders" size={14} />
              <span>{isRtl ? "ارزیابی سریع (اختیاری)" : "Quick qualification (optional)"}</span>
            </p>
            <RatingControl
              label={t.interestRatingLabel}
              value={touched.rating ? captureRating : null}
              onChange={(rating) => {
                setCaptureRating(rating);
                setTouched((p) => ({ ...p, rating: true }));
              }}
              locale={locale}
              hint={
                isRtl
                  ? "اگر انتخاب نکنید، لید جدید «علاقه متوسط» ثبت می‌شود و لید موجود سطح قبلی خود را نگه می‌دارد."
                  : "Leave unset and a new lead starts as Warm, while an existing lead keeps its rating."
              }
            />
            <TagPicker label={t.followUpTagsLabel} presets={tagPresets} selected={captureTags} onToggle={toggleTag} />
            <div>
              <label htmlFor="booth-capture-notes" className="ui-label">{t.notesLabel}</label>
              <textarea
                id="booth-capture-notes"
                rows={2}
                value={captureNotes}
                onChange={(e) => setCaptureNotes(e.target.value)}
                placeholder={t.notesPlaceholder}
                className="ui-textarea min-h-[4.5rem]"
              />
            </div>
          </div>
          <div className="sticky -bottom-6 z-10 -mx-5 -mb-6 border-t border-border-subtle bg-surface-panel px-5 pb-5 pt-3 sm:-bottom-7 sm:-mx-7 sm:-mb-7 sm:px-7 sm:pb-6">
            {captureError && (
              <div role="alert" aria-live="assertive" className="mb-3 flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3 text-[13px] leading-relaxed text-status-danger-text motion-safe:animate-pop">
                <Icon name="alert" size={18} className="shrink-0" />
                <span>{captureError}</span>
              </div>
            )}
            {offerQueue && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                isFullWidth
                disabled={submitting}
                onClick={() => void queueScan(offerQueue)}
                className="mb-3 whitespace-normal"
              >
                <Icon name="hourglass" size={17} className="shrink-0" />
                <span>{text.saveOffline}</span>
              </Button>
            )}
            <div className="flex gap-2 sm:justify-end">
              {/* Phones dismiss with the header close button; the bar keeps the one action that matters. */}
              <Button type="button" variant="ghost" size="lg" disabled={submitting} onClick={onClose} className="shrink-0 max-sm:hidden">
                {isRtl ? "انصراف" : "Cancel"}
              </Button>
              <Button type="submit" variant="primary" size="lg" disabled={submitting} aria-busy={submitting} className="min-w-0 flex-1 sm:flex-none sm:min-w-[15rem]">
                {submitting ? <BoothSpinner /> : <Icon name="user-plus" size={19} className="shrink-0" />}
                <span className="whitespace-normal leading-tight">{submitting ? (isRtl ? "در حال ذخیره…" : "Saving…") : t.saveLeadAction}</span>
              </Button>
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}
