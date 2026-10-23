import { useId, useState, type FormEvent } from "react";
import type { AttendeeDetailCard, CheckInPointOut, DeskAdmitOut } from "../../api/client";
import { admitReasonText } from "../../lib/deskBadge";
import type { AttendeeLocale } from "../../lib/i18n";
import { normalizeIranMobile } from "../../lib/mobile";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";

/** Each action resolves to the message to show, or null when it succeeded (or the session was lost). */
export interface DeskCardActions {
  checkinPoints: CheckInPointOut[];
  admit: (ticketId: string, pointId: string) => Promise<{ verdict: DeskAdmitOut } | { error: string | null }>;
  edit: (ticketId: string, body: { attendee_full_name: string; attendee_organization: string; attendee_title: string }) => Promise<string | null>;
  cancel: (ticketId: string, reason: string) => Promise<string | null>;
  reissue: (ticketId: string) => Promise<string | null>;
  transfer: (ticketId: string, body: { mobile: string; full_name: string | null; organization: string | null; title: string | null }) => Promise<string | null>;
}

interface AdmitPanelProps {
  card: AttendeeDetailCard;
  actions: DeskCardActions;
  locale: AttendeeLocale;
  isRtl: boolean;
}

/** "Admit at point X": the gate's own rules decide, and the verdict is shown as the gate would show it. */
export function AdmitPanel({ card, actions, locale, isRtl }: AdmitPanelProps) {
  const selectId = useId();
  const [pointId, setPointId] = useState(actions.checkinPoints[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ verdict: DeskAdmitOut } | { error: string } | null>(null);
  if (actions.checkinPoints.length === 0) return null;
  const selected = actions.checkinPoints.some((p) => p.id === pointId) ? pointId : actions.checkinPoints[0].id;

  const admit = async () => {
    setBusy(true);
    setOutcome(null);
    const result = await actions.admit(card.ticket_id, selected);
    setBusy(false);
    if ("verdict" in result) setOutcome({ verdict: result.verdict });
    else if (result.error) setOutcome({ error: result.error });
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-border-default bg-surface-panel p-3" data-testid="desk-admit">
      <label htmlFor={selectId} className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
        <Icon name="gate" size={15} />
        {isRtl ? "پذیرش در نقطه ورود" : "Admit at"}
      </label>
      <div className="flex flex-wrap gap-2">
        <select id={selectId} value={selected} onChange={(e) => { setPointId(e.target.value); setOutcome(null); }} className="ui-select min-w-0 flex-1">
          {actions.checkinPoints.map((point) => (
            <option key={point.id} value={point.id}>{point.name}</option>
          ))}
        </select>
        <Button type="button" variant="ink" size="md" onClick={() => void admit()} disabled={busy} aria-busy={busy}>
          <Icon name={busy ? "sync" : "check"} size={16} className={busy ? "motion-safe:animate-spin" : ""} />
          <span>{isRtl ? "پذیرش" : "Admit"}</span>
        </Button>
      </div>
      {outcome && "verdict" in outcome && (
        <p
          role="status"
          data-testid="desk-admit-verdict"
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold ${
            outcome.verdict.status === "ADMITTED"
              ? "bg-status-success-bg text-status-success-text"
              : "bg-status-danger-bg text-status-danger-text"
          }`}
        >
          <Icon name={outcome.verdict.status === "ADMITTED" ? "check-circle" : "x-circle"} size={17} className="mt-px shrink-0" />
          <span>
            {outcome.verdict.status === "ADMITTED"
              ? isRtl ? `پذیرش در نقطه ورود «${outcome.verdict.checkin_point_name}» ثبت شد.` : `Admitted at ${outcome.verdict.checkin_point_name}.`
              : `${isRtl ? "پذیرش رد شد" : "Refused"}: ${admitReasonText(outcome.verdict.rejection_reason, locale)}`}
          </span>
        </p>
      )}
      {outcome && "error" in outcome && (
        <p role="alert" className="rounded-lg bg-status-danger-bg px-3 py-2 text-[13px] text-status-danger-text">{outcome.error}</p>
      )}
    </div>
  );
}

type ManageDialog = "edit" | "transfer" | "reissue" | "cancel" | null;

interface ManageRegistrationProps {
  card: AttendeeDetailCard;
  actions: DeskCardActions;
  isRtl: boolean;
}

/** Correct the registration, replace a lost pass, give the place to someone else, or cancel. */
export function ManageRegistration({ card, actions, isRtl }: ManageRegistrationProps) {
  const [open, setOpen] = useState<ManageDialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const ids = { name: useId(), org: useId(), title: useId(), mobile: useId(), reason: useId() };
  const [edit, setEdit] = useState({ name: card.attendee_name, organization: card.organization, title: card.title });
  const [transfer, setTransfer] = useState({ mobile: "", name: "", organization: "", title: "" });

  const show = (dialog: ManageDialog) => {
    setError(null);
    setNotice(null);
    if (dialog === "edit") setEdit({ name: card.attendee_name, organization: card.organization, title: card.title });
    if (dialog === "transfer") setTransfer({ mobile: "", name: "", organization: "", title: "" });
    if (dialog === "cancel") setReason("");
    setOpen(dialog);
  };
  const run = async (action: () => Promise<string | null>, done: string) => {
    setBusy(true);
    setError(null);
    const message = await action();
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setOpen(null);
    setNotice(done);
  };

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!edit.name.trim()) {
      setError(isRtl ? "نام و نام خانوادگی الزامی است." : "The full name is required.");
      return;
    }
    void run(
      () => actions.edit(card.ticket_id, { attendee_full_name: edit.name.trim(), attendee_organization: edit.organization.trim(), attendee_title: edit.title.trim() }),
      isRtl ? "مشخصات ثبت‌نام اصلاح شد." : "Registration details updated.",
    );
  };
  const submitTransfer = (e: FormEvent) => {
    e.preventDefault();
    const mobile = normalizeIranMobile(transfer.mobile);
    if (!mobile) {
      setError(isRtl ? "شماره موبایل دارندهٔ جدید معتبر نیست." : "Enter the new holder's valid mobile number.");
      return;
    }
    void run(
      () => actions.transfer(card.ticket_id, {
        mobile,
        full_name: transfer.name.trim() || null,
        organization: transfer.organization.trim() || null,
        title: transfer.title.trim() || null,
      }),
      isRtl ? "کارت ورود منتقل شد و برای دارندهٔ جدید کارت ورود تازه صادر شد." : "Ticket transferred; the new holder has a new pass.",
    );
  };

  const cancelLabel = isRtl ? "انصراف" : "Cancel";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label={isRtl ? "مدیریت ثبت‌نام" : "Manage registration"}>
        <Button type="button" variant="secondary" size="sm" onClick={() => show("edit")}>
          <Icon name="note" size={15} />
          <span>{isRtl ? "اصلاح مشخصات" : "Edit details"}</span>
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => show("reissue")}>
          <Icon name="sync" size={15} />
          <span>{isRtl ? "صدور دوبارهٔ کارت ورود" : "Reissue pass"}</span>
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => show("transfer")}>
          <Icon name="share" size={15} />
          <span>{isRtl ? "انتقال کارت ورود" : "Transfer ticket"}</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" className="!text-status-danger-text" onClick={() => show("cancel")}>
          <Icon name="x-circle" size={15} />
          <span>{isRtl ? "لغو کارت ورود" : "Cancel ticket"}</span>
        </Button>
      </div>
      {notice && <p role="status" className="text-xs font-medium text-status-success-text">{notice}</p>}
      {error && open === null && <p role="alert" className="text-xs text-status-danger-text">{error}</p>}

      <Dialog isOpen={open === "edit"} onClose={() => !busy && setOpen(null)} title={isRtl ? "اصلاح مشخصات ثبت‌نام" : "Edit registration details"} description={isRtl ? "فقط برای همین همایش؛ حساب شخص تغییر نمی‌کند. کارت ورود چاپ‌شده باید دوباره چاپ شود." : "For this congress only; the person's account is unchanged. A printed badge will need reprinting."} size="md">
        <form onSubmit={submitEdit} className="space-y-4" noValidate>
          <div>
            <label htmlFor={ids.name} className="ui-label">{isRtl ? "نام و نام خانوادگی" : "Full name"}</label>
            <input id={ids.name} className="ui-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor={ids.org} className="ui-label">{isRtl ? "سازمان / دانشگاه" : "Organization"}</label>
            <input id={ids.org} className="ui-input" value={edit.organization} onChange={(e) => setEdit({ ...edit, organization: e.target.value })} />
          </div>
          <div>
            <label htmlFor={ids.title} className="ui-label">{isRtl ? "عنوان حرفه‌ای" : "Title"}</label>
            <input id={ids.title} className="ui-input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          </div>
          {error && <p role="alert" className="text-sm text-status-danger-text">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="md" disabled={busy} onClick={() => setOpen(null)}>{cancelLabel}</Button>
            <Button type="submit" variant="primary" size="md" disabled={busy} aria-busy={busy}>{isRtl ? "ذخیره" : "Save"}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog isOpen={open === "transfer"} onClose={() => !busy && setOpen(null)} title={isRtl ? "انتقال کارت ورود به شخص دیگر" : "Transfer the ticket"} description={isRtl ? "کارت ورود فعلی لغو می‌شود و دارندهٔ جدید کارت ورود تازه‌ای با پیامک دریافت می‌کند." : "This ticket is cancelled and the new holder gets a new pass by SMS."} size="md">
        <form onSubmit={submitTransfer} className="space-y-4" noValidate>
          <div>
            <label htmlFor={ids.mobile} className="ui-label">{isRtl ? "شماره موبایل دارندهٔ جدید" : "New holder's mobile"}</label>
            <input id={ids.mobile} type="tel" dir="ltr" inputMode="tel" className="ui-input font-mono" value={transfer.mobile} onChange={(e) => setTransfer({ ...transfer, mobile: e.target.value })} placeholder="09xx xxx xxxx" />
          </div>
          <div>
            <label htmlFor={`${ids.mobile}-name`} className="ui-label">{isRtl ? "نام و نام خانوادگی (برای شمارهٔ جدید الزامی)" : "Full name (required for a new number)"}</label>
            <input id={`${ids.mobile}-name`} className="ui-input" value={transfer.name} onChange={(e) => setTransfer({ ...transfer, name: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${ids.mobile}-org`} className="ui-label">{isRtl ? "سازمان" : "Organization"}</label>
              <input id={`${ids.mobile}-org`} className="ui-input" value={transfer.organization} onChange={(e) => setTransfer({ ...transfer, organization: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${ids.mobile}-title`} className="ui-label">{isRtl ? "عنوان" : "Title"}</label>
              <input id={`${ids.mobile}-title`} className="ui-input" value={transfer.title} onChange={(e) => setTransfer({ ...transfer, title: e.target.value })} />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-status-danger-text">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="md" disabled={busy} onClick={() => setOpen(null)}>{cancelLabel}</Button>
            <Button type="submit" variant="primary" size="md" disabled={busy} aria-busy={busy}>{isRtl ? "انتقال" : "Transfer"}</Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        isOpen={open === "reissue"}
        title={isRtl ? "صدور دوبارهٔ کارت ورود؟" : "Reissue the pass?"}
        description={isRtl ? "کد QR تازه‌ای صادر و با پیامک فرستاده می‌شود؛ کارت ورود فعلی دیگر در نقطه‌های ورود کار نمی‌کند." : "A new QR code is issued and sent by SMS; the current pass stops working at the gates."}
        confirmLabel={isRtl ? "صدور دوباره" : "Reissue"}
        cancelLabel={cancelLabel}
        onCancel={() => setOpen(null)}
        onConfirm={() => void run(() => actions.reissue(card.ticket_id), isRtl ? "کارت ورود جدید صادر شد؛ آن را دوباره چاپ کنید." : "New pass issued; print the badge again.")}
      />

      <Dialog isOpen={open === "cancel"} onClose={() => !busy && setOpen(null)} title={isRtl ? "لغو کارت ورود؟" : "Cancel the ticket?"} description={isRtl ? "جای این کارت ورود آزاد می‌شود، دیگر در نقطه‌های ورود کار نمی‌کند و پیامک لغو فرستاده می‌شود." : "Its place returns to the tier, its pass stops working and the holder is told by SMS."} size="sm">
        <div className="space-y-4">
          <div>
            <label htmlFor={ids.reason} className="ui-label">{isRtl ? "دلیل (اختیاری)" : "Reason (optional)"}</label>
            <input id={ids.reason} className="ui-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-status-danger-text">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="md" disabled={busy} onClick={() => setOpen(null)}>{isRtl ? "بازگشت" : "Back"}</Button>
            <Button type="button" variant="danger" size="md" disabled={busy} aria-busy={busy} onClick={() => void run(() => actions.cancel(card.ticket_id, reason.trim()), isRtl ? "کارت ورود لغو شد." : "Ticket cancelled.")}>
              {isRtl ? "لغو کارت ورود" : "Cancel ticket"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
