import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiErrorCode, createApiClient, type LeadOut, type LeadScanInput, type LeadScanRequest } from "../../api/client";
import { boothCopy, type BoothCopy } from "../../copy/booth";
import { useHidScanner } from "../../hooks/useHidScanner";
import { useWakeLock } from "../../hooks/useWakeLock";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../../lib/attendeeSession";
import type { AttendeeLocale } from "../../lib/i18n";
import { accessBlockOf, isEventArchived, type AccessBlock } from "../../lib/leadList";
import { QrCameraInput } from "../QrCameraInput";
import { VerdictBanner } from "../operator/VerdictBanner";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { CodeInput } from "../ui/Input";
import { Notice } from "../ui/Notice";
import { codedMessage } from "./boothText";
import { RatingControl } from "./RatingControl";
import { asRating, type LeadRating } from "./rating";

interface CaptureDialogProps {
  isOpen: boolean;
  onClose: () => void;
  boothId: string;
  token: string;
  locale: AttendeeLocale;
  /** A code a barcode gun read before the sheet opened: it is saved at once. */
  initialCode?: string;
  /** A lead was saved (201 new, 200 already a lead of this booth). */
  onCaptured: (lead: LeadOut, existed: boolean) => void;
  /** A rating chosen on the result was saved. */
  onLeadChanged: (lead: LeadOut) => void;
  /** «یادداشت» on the result: the portal closes this sheet and opens qualification. */
  onQualify: (lead: LeadOut) => void;
  /** Stores the scan on this device to send later; false when the device could not keep it. */
  onQueue: (input: LeadScanInput) => Promise<boolean>;
  /** 403 BOOTH_STAFF_REQUIRED: this account was removed from the booth. */
  onAccessBlocked: (block: AccessBlock) => void;
  /** 409 EVENT_ARCHIVED: the congress is closed; its leads are read-only. */
  onArchived: () => void;
  /** The stored session changed in another tab: the portal re-renders for the current one. */
  onSessionChanged: () => void;
}

type CaptureResult =
  | { kind: "new" | "existing"; lead: LeadOut }
  | { kind: "queued"; code: string }
  | { kind: "invalid" | "other"; code: string };

/** The result goes back to the camera by itself after this long, unless the operator touched it. */
const AUTO_NEXT_MS = 4000;

function finePointer(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
}

/**
 * The capture sheet: the camera starts by itself where permission was already granted, and a decoded badge, a
 * barcode-gun scan or a typed code is saved at once. The result shows who was captured with one-tap rating
 * chips and «بعدی». On touch screens the code field stays closed (the keyboard would cover the camera) until
 * «وارد کردن کد» opens it. The portal remounts the sheet (key) for every opening, so each capture starts clean.
 */
export function CaptureDialog({
  isOpen,
  onClose,
  boothId,
  token,
  locale,
  initialCode,
  onCaptured,
  onLeadChanged,
  onQualify,
  onQueue,
  onAccessBlocked,
  onArchived,
  onSessionChanged,
}: CaptureDialogProps) {
  const text = boothCopy[locale];
  const formId = useId();
  const [fine] = useState(finePointer);
  const [manualOpen, setManualOpen] = useState(fine);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a dropped connection: the scan the operator may keep on the device to send later.
  const [offerQueue, setOfferQueue] = useState<LeadScanInput | null>(null);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [rating, setRating] = useState<LeadRating | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);
  // The operator touched the result (rating, note): no auto-advance.
  const [touched, setTouched] = useState(false);
  const inFlight = useRef(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useWakeLock(isOpen);

  const next = useCallback(() => {
    setResult(null);
    setRating(null);
    setTouched(false);
    setError(null);
    setOfferQueue(null);
    setCode("");
    if (fine) window.setTimeout(() => codeInputRef.current?.focus(), 60);
  }, [fine]);

  const queueScan = async (input: LeadScanInput) => {
    if (await onQueue(input)) {
      setResult({ kind: "queued", code: input.qr_secret });
      setRating(null);
      setCode("");
      setError(null);
      setOfferQueue(null);
    } else {
      setError(`${text.queueFailed} ${text.storageUnavailable}`);
    }
  };

  const capture = async (raw: string) => {
    const qr = raw.trim();
    if (!qr || inFlight.current) return;
    if (!isStoredAttendeeToken(token)) {
      setError(sessionChangedMessage(locale));
      onSessionChanged();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setResult(null);
    setRating(null);
    setTouched(false);
    setError(null);
    setOfferQueue(null);
    // The badge alone: scanning an attendee who is already a lead never resets their rating or tags.
    const input: LeadScanInput = { qr_secret: qr };
    try {
      // No connection at all: keep the scan on this device; it is sent once the booth is back online.
      if (!navigator.onLine) {
        await queueScan(input);
        return;
      }
      const client = createApiClient({ kind: "user", token });
      const { data, error: err, response } = await client.POST("/api/booths/{booth_id}/leads/scan", {
        params: { path: { booth_id: boothId } },
        // Defaulted fields are optional on the wire; the generated type wrongly requires them.
        body: input as LeadScanRequest,
      });

      // A changed or expired session (the API client removed it) gets no feedback here.
      if (attendeeResponseState(token, response.status) !== "current") return;
      const block = accessBlockOf(response.status, err);
      const coded = apiErrorCode(err) !== undefined;
      if (block) {
        onAccessBlocked(block);
      } else if (err && response.status === 404 && !coded) {
        // The scan's own 404 (not a badge) and 400 (another congress) carry no code.
        setResult({ kind: "invalid", code: qr });
        setCode("");
      } else if (err && response.status === 400 && !coded) {
        setResult({ kind: "other", code: qr });
        setCode("");
      } else if (err) {
        if (isEventArchived(response.status, err)) onArchived();
        setCode(qr);
        setManualOpen(true);
        setError(response.status === 403 && !coded ? text.notAllowed : (codedMessage(err, locale) ?? text.scanFailed));
      } else if (data) {
        // 201 = new lead, 200 = this attendee was already a lead of this booth.
        const existed = response.status === 200;
        setResult({ kind: existed ? "existing" : "new", lead: data });
        setRating(existed ? asRating(data.rating) : null);
        setCode("");
        onCaptured(data, existed);
      }
    } catch {
      // The request may or may not have reached the server. Nothing is retried automatically; scanning the same
      // badge again is safe (it updates the same lead). The operator may keep it on the device instead.
      setCode(qr);
      setManualOpen(true);
      setError(text.connectionLost);
      setOfferQueue(input);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  // The latest `capture` for the gun hook and the opening code, without re-subscribing on every render.
  const captureRef = useRef(capture);
  useEffect(() => {
    captureRef.current = capture;
  });

  // A barcode-gun scan while the sheet is open saves at once, from the result too (it is the next visitor).
  useHidScanner((scanned) => void captureRef.current(scanned), isOpen && !submitting);

  // The code the gun read before the sheet opened.
  const openedWith = useRef(false);
  useEffect(() => {
    if (!isOpen || !initialCode || openedWith.current) return;
    openedWith.current = true;
    void captureRef.current(initialCode);
  }, [isOpen, initialCode]);

  // Back to the camera after a few seconds when nobody touches the result.
  useEffect(() => {
    if (!result || touched) return;
    const timer = window.setTimeout(next, AUTO_NEXT_MS);
    return () => window.clearTimeout(timer);
  }, [result, touched, next]);

  const rate = async (value: LeadRating) => {
    if (!result || ratingSaving) return;
    setTouched(true);
    setError(null);
    if (result.kind === "queued") {
      // The queue folds a second scan of the same badge into the waiting one, with this rating.
      if (await onQueue({ qr_secret: result.code, rating: value })) setRating(value);
      else setError(text.queueFailed);
      return;
    }
    if (result.kind !== "new" && result.kind !== "existing") return;
    if (!isStoredAttendeeToken(token)) {
      setError(sessionChangedMessage(locale));
      onSessionChanged();
      return;
    }
    const previous = rating;
    setRating(value);
    setRatingSaving(true);
    try {
      const { data, error: err, response } = await createApiClient({ kind: "user", token }).PATCH("/api/booths/{booth_id}/leads/{lead_id}", {
        params: { path: { booth_id: boothId, lead_id: result.lead.id } },
        body: { rating: value },
      });
      if (attendeeResponseState(token, response.status) !== "current") return;
      const block = accessBlockOf(response.status, err);
      if (block) {
        onAccessBlocked(block);
      } else if (err || !data) {
        if (isEventArchived(response.status, err)) onArchived();
        setRating(previous);
        setError(codedMessage(err, locale) ?? text.saveFailed);
      } else {
        setResult({ kind: result.kind, lead: data });
        onLeadChanged(data);
      }
    } catch {
      setRating(previous);
      setError(text.saveConnectionLost);
    } finally {
      setRatingSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void capture(code);
  };

  const verdict = result ? verdictOf(result, text) : null;
  const lead = result && (result.kind === "new" || result.kind === "existing") ? result.lead : null;
  const role = lead ? [lead.title, lead.organization].filter(Boolean).join(" · ") : "";
  const canRate = result !== null && result.kind !== "invalid" && result.kind !== "other";

  const footer = result ? (
    <>
      <Button type="button" variant="ghost" size="lg" onClick={onClose}>
        {text.done}
      </Button>
      <Button type="button" variant="primary" size="lg" iconEnd="arrow-right" autoFocus onClick={next} className="sm:min-w-40">
        {text.next}
      </Button>
    </>
  ) : manualOpen ? (
    <Button type="submit" form={formId} variant="primary" size="lg" icon="user-plus" loading={submitting}>
      {text.saveLead}
    </Button>
  ) : undefined;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={text.capture}
      description={result ? undefined : text.captureHint}
      size="full"
      footer={footer}
      className="booth-sheet"
    >
      {/* Mounted with the sheet, so the result is announced once; the banner below is the visual. */}
      <p role="status" className="sr-only">
        {result?.kind === "new" ? text.leadCaptured : result?.kind === "existing" ? text.leadUpdated : ""}
      </p>

      {result && verdict ? (
        <div className="space-y-4" data-testid={result.kind === "queued" ? "capture-queued" : "capture-result"} data-result={result.kind}>
          <VerdictBanner
            locale={locale}
            tone={verdict.tone}
            title={verdict.title}
            icon={verdict.icon}
            name={lead?.attendee_name}
            meta={role ? <p className="text-body opacity-90"><bdi>{role}</bdi></p> : undefined}
            reason={verdict.reason}
          />
          {canRate && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <RatingControl label={text.interest} value={rating} onChange={(value) => void rate(value)} locale={locale} size="compact" disabled={ratingSaving} />
              </div>
              {lead && (
                <Button
                  type="button"
                  variant="secondary"
                  icon="note"
                  onClick={() => {
                    // One dialog at a time: the sheet closes before qualification opens.
                    onClose();
                    onQualify(lead);
                  }}
                >
                  {text.note}
                </Button>
              )}
            </div>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      ) : (
        <div className="space-y-4">
          <QrCameraInput locale={locale} disabled={submitting} autoStart={!fine} onDecode={(value) => void capture(value)} />
          {manualOpen ? (
            <form id={formId} onSubmit={handleSubmit}>
              <Field label={text.codeLabel} required>
                <CodeInput
                  ref={codeInputRef}
                  maxLength={512}
                  required
                  autoFocus={fine}
                  enterKeyHint="go"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
            </form>
          ) : (
            <Button type="button" variant="ghost" icon="keyboard" onClick={() => setManualOpen(true)}>
              {text.enterCode}
            </Button>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          {offerQueue && (
            <Button type="button" variant="secondary" icon="hourglass" isFullWidth disabled={submitting} onClick={() => void queueScan(offerQueue)}>
              {text.saveOffline}
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}

function verdictOf(result: CaptureResult, text: BoothCopy) {
  switch (result.kind) {
    case "new":
      return { tone: "admitted" as const, title: text.newLead, icon: "check" as const, reason: undefined };
    case "existing":
      return { tone: "info" as const, title: text.existingLead, icon: "layers" as const, reason: text.existingReason };
    case "queued":
      return { tone: "admitted-offline" as const, title: text.savedOffline, icon: "hourglass" as const, reason: text.savedOfflineReason };
    case "invalid":
      return { tone: "rejected" as const, title: text.invalidCode, icon: "x" as const, reason: undefined };
    case "other":
      return { tone: "rejected" as const, title: text.otherCongress, icon: "x" as const, reason: undefined };
  }
}
