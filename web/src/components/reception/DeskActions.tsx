import { useState, type FormEvent } from "react";
import type { AttendeeDetailCard, CheckInPointOut, DeskAdmitOut, PassSmsResendOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { deskCopy } from "../../copy/desk";
import type { AttendeeLocale } from "../../lib/i18n";
import { normalizeIranMobile } from "../../lib/mobile";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Select, TextInput } from "../ui/Input";
import { Notice } from "../ui/Notice";

export type ResendOutcome =
  | { kind: "result"; data: PassSmsResendOut }
  /** 429: this pass was sent moments ago. */
  | { kind: "throttled"; retryAfter: number }
  /** Anything else the desk should show. */
  | { kind: "error"; message: string }
  /** 401: the caller already dropped the session. */
  | { kind: "unauthorized" };

/** Each action resolves to the message to show, or null when it succeeded (or the session was lost). */
export interface DeskCardActions {
  checkinPoints: CheckInPointOut[];
  admit: (ticketId: string, pointId: string) => Promise<{ verdict: DeskAdmitOut } | { error: string | null }>;
  edit: (ticketId: string, body: { attendee_full_name: string; attendee_organization: string; attendee_title: string }) => Promise<string | null>;
  cancel: (ticketId: string, reason: string) => Promise<string | null>;
  reissue: (ticketId: string) => Promise<string | null>;
  transfer: (ticketId: string, body: { mobile: string; full_name: string | null; organization: string | null; title: string | null }) => Promise<string | null>;
  resend: (ticketId: string) => Promise<ResendOutcome>;
}

function readPoint(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

interface AdmitControlsProps {
  points: CheckInPointOut[];
  /** localStorage key that remembers the last point used on this desk. */
  storageKey: string;
  /** Admit is the card's primary action (the badge is printed and current). */
  primary: boolean;
  disabled: boolean;
  busy: boolean;
  onAdmit: (pointId: string) => void;
  locale: AttendeeLocale;
}

/** One button per point when there are one or two, otherwise a point select and one button; the last point is remembered. */
export function AdmitControls({ points, storageKey, primary, disabled, busy, onAdmit, locale }: AdmitControlsProps) {
  const c = deskCopy[locale];
  const [chosen, setChosen] = useState<string | null>(() => readPoint(storageKey));
  if (points.length === 0) return null;
  const selected = chosen !== null && points.some((p) => p.id === chosen) ? chosen : points[0].id;
  const admit = (pointId: string) => {
    setChosen(pointId);
    try {
      localStorage.setItem(storageKey, pointId);
    } catch {
      // storage blocked: the desk simply starts at the first point next time
    }
    onAdmit(pointId);
  };
  if (points.length <= 2) {
    return (
      <div data-testid="desk-admit" className="contents">
        {points.map((point) => (
          <Button
            key={point.id}
            type="button"
            variant={primary && point.id === selected ? "primary" : "secondary"}
            size="lg"
            icon="check"
            disabled={disabled}
            loading={busy && point.id === selected}
            onClick={() => admit(point.id)}
            title={c.admitAt(point.name)}
            className={`min-w-0 ${primary && point.id === selected ? "rx-primary" : ""}`}
          >
            <span className="min-w-0 truncate">{c.admitAt(point.name)}</span>
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div data-testid="desk-admit" className={`col-span-full flex min-w-0 gap-2 ${primary ? "rx-primary" : ""}`}>
      <Select size="lg" aria-label={c.pointLabel} value={selected} disabled={disabled} onChange={(e) => setChosen(e.target.value)} wrapperClassName="min-w-0 flex-1">
        {points.map((point) => (
          <option key={point.id} value={point.id}>
            {point.name}
          </option>
        ))}
      </Select>
      <Button type="button" variant={primary ? "primary" : "secondary"} size="lg" icon="check" disabled={disabled} loading={busy} onClick={() => admit(selected)} className="shrink-0">
        {c.admit}
      </Button>
    </div>
  );
}

interface EditDialogProps {
  card: AttendeeDetailCard;
  isOpen: boolean;
  onClose: () => void;
  onSave: (body: { attendee_full_name: string; attendee_organization: string; attendee_title: string }) => Promise<string | null>;
  locale: AttendeeLocale;
}

/** Correct the name, organization or title on this congress's registration. */
export function EditDialog({ card, isOpen, onClose, onSave, locale }: EditDialogProps) {
  const c = deskCopy[locale];
  const common = commonCopy[locale];
  const [form, setForm] = useState({ name: card.attendee_name, organization: card.organization, title: card.title });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setNameError(true);
      return;
    }
    setBusy(true);
    setError(null);
    const message = await onSave({ attendee_full_name: form.name.trim(), attendee_organization: form.organization.trim(), attendee_title: form.title.trim() });
    setBusy(false);
    if (message) setError(message);
  };
  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => !busy && onClose()}
      title={c.editTitle}
      description={c.editBody}
      size="md"
      footer={
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {common.cancel}
          </Button>
          <Button type="submit" form="rx-edit-form" variant="primary" loading={busy}>
            {common.save}
          </Button>
        </>
      }
    >
      <form id="rx-edit-form" onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field label={c.fullName} required error={nameError ? c.nameRequired : undefined}>
          <TextInput value={form.name} onChange={(e) => { setNameError(false); setForm({ ...form, name: e.target.value }); }} />
        </Field>
        <Field label={c.organization}>
          <TextInput value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
        </Field>
        <Field label={c.jobTitle}>
          <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}

interface TransferDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onTransfer: (body: { mobile: string; full_name: string | null; organization: string | null; title: string | null }) => Promise<string | null>;
  locale: AttendeeLocale;
}

/** Give the place to someone else: the current pass is cancelled and the new holder gets a new one by SMS. */
export function TransferDialog({ isOpen, onClose, onTransfer, locale }: TransferDialogProps) {
  const c = deskCopy[locale];
  const common = commonCopy[locale];
  const [form, setForm] = useState({ mobile: "", name: "", organization: "", title: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mobile = normalizeIranMobile(form.mobile);
    if (!mobile) {
      setMobileError(true);
      return;
    }
    setBusy(true);
    setError(null);
    const message = await onTransfer({
      mobile,
      full_name: form.name.trim() || null,
      organization: form.organization.trim() || null,
      title: form.title.trim() || null,
    });
    setBusy(false);
    if (message) setError(message);
  };
  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => !busy && onClose()}
      title={c.transferTitle}
      description={c.transferBody}
      size="md"
      footer={
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {common.cancel}
          </Button>
          <Button type="submit" form="rx-transfer-form" variant="primary" loading={busy}>
            {c.transfer}
          </Button>
        </>
      }
    >
      <form id="rx-transfer-form" onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Field label={c.newMobile} required error={mobileError ? common.mobileInvalid : undefined}>
          <TextInput type="tel" dir="ltr" inputMode="tel" autoComplete="off" value={form.mobile} onChange={(e) => { setMobileError(false); setForm({ ...form, mobile: e.target.value }); }} />
        </Field>
        <Field label={c.fullName} hint={c.newNameHint}>
          <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={c.organization}>
            <TextInput value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
          </Field>
          <Field label={c.jobTitle}>
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Dialog>
  );
}
