import { useId, type FormEvent } from "react";
import type { TicketTierOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { deskCopy } from "../../copy/desk";
import { tierAvailable } from "../../lib/deskBadge";
import { formatNumber } from "../../lib/format";
import type { AttendeeLocale } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Select, TextInput } from "../ui/Input";
import { Notice } from "../ui/Notice";
import type { DuplicateState } from "./deskTypes";

export interface WalkInDraft {
  fullName: string;
  mobile: string;
  organization: string;
  title: string;
  tierId: string;
}

interface WalkInDialogProps {
  isOpen: boolean;
  onClose: () => void;
  draft: WalkInDraft;
  onChange: (patch: Partial<WalkInDraft>) => void;
  tiers: TicketTierOut[];
  submitting: boolean;
  /** Field-level problems found before sending. */
  nameError: boolean;
  mobileError: boolean;
  formError: string | null;
  duplicate: DuplicateState;
  onOpenExisting: (ticketId: string) => void;
  onSubmit: (e: FormEvent) => void;
  locale: AttendeeLocale;
}

/** «ثبت‌نام حضوری»: issue a pass to someone who has not registered yet. The draft lives in the station, so closing keeps it. */
export function WalkInDialog({ isOpen, onClose, draft, onChange, tiers, submitting, nameError, mobileError, formError, duplicate, onOpenExisting, onSubmit, locale }: WalkInDialogProps) {
  const c = deskCopy[locale];
  const common = commonCopy[locale];
  const formId = useId();
  const canIssue = tiers.some(tierAvailable);
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={c.walkIn}
      size="md"
      footer={
        <>
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button type="submit" form={formId} variant="primary" size="lg" icon="ticket" loading={submitting} disabled={!canIssue}>
            {c.issue}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label={c.walkInName} required error={nameError ? c.nameRequired : undefined}>
          <TextInput autoComplete="off" value={draft.fullName} onChange={(e) => onChange({ fullName: e.target.value })} placeholder={c.walkInNamePlaceholder} />
        </Field>
        <Field label={c.mobile} optional hint={c.walkInMobileHint} error={mobileError ? common.mobileInvalid : undefined}>
          <TextInput type="tel" dir="ltr" inputMode="tel" autoComplete="off" value={draft.mobile} onChange={(e) => onChange({ mobile: e.target.value })} />
        </Field>
        <Field label={c.passType} required hint={tiers.length === 0 ? c.noPassTypes : undefined}>
          <Select value={draft.tierId} onChange={(e) => onChange({ tierId: e.target.value })}>
            {tiers.map((tier) => {
              const seats = tier.quota - tier.reserved_count;
              const label = !tier.is_open ? c.passTypeClosed(tier.name) : seats <= 0 ? c.passTypeFull(tier.name) : c.passTypeSeats(tier.name, formatNumber(seats, locale));
              return (
                <option key={tier.id} value={tier.id} disabled={!tierAvailable(tier)}>
                  {label}
                </option>
              );
            })}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={c.organization}>
            <TextInput autoComplete="off" value={draft.organization} onChange={(e) => onChange({ organization: e.target.value })} />
          </Field>
          <Field label={c.jobTitle}>
            <TextInput autoComplete="off" value={draft.title} onChange={(e) => onChange({ title: e.target.value })} />
          </Field>
        </div>

        {formError && <Notice tone="danger">{formError}</Notice>}

        {duplicate.status !== "none" && (
          <Notice tone="warning" icon="ticket">
            {duplicate.status === "looking" && <p>{c.duplicateLooking}</p>}
            {duplicate.status === "failed" && <p>{c.duplicateLookupFailed}</p>}
            {duplicate.status === "missing" && <p>{c.duplicateMissing}</p>}
            {duplicate.status === "found" && (
              <div className="space-y-2">
                <p>{c.duplicateFound}</p>
                {duplicate.candidates.map((candidate) => (
                  <Button
                    key={candidate.ticket_id}
                    type="button"
                    variant="secondary"
                    size="md"
                    isFullWidth
                    iconEnd="arrow-right"
                    className="h-auto justify-between whitespace-normal text-start"
                    onClick={() => onOpenExisting(candidate.ticket_id)}
                  >
                    <span className="min-w-0 break-words">{c.openExisting(candidate.attendee_name)}</span>
                  </Button>
                ))}
              </div>
            )}
          </Notice>
        )}
      </form>
    </Dialog>
  );
}
