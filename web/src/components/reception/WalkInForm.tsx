import type { FormEvent, RefObject } from "react";
import type { TicketTierOut } from "../../api/client";
import { formatLocalizedNumber, type AttendeeLocale, type TranslationDictionary } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import type { DuplicateState } from "./deskTypes";

export interface WalkInDraft {
  fullName: string;
  mobile: string;
  organization: string;
  title: string;
  tierId: string;
}

interface WalkInFormProps {
  ids: { name: string; mobile: string; org: string; title: string; tier: string };
  nameInputRef: RefObject<HTMLInputElement | null>;
  draft: WalkInDraft;
  onChange: (patch: Partial<WalkInDraft>) => void;
  tiers: TicketTierOut[];
  submitting: boolean;
  formError: string | null;
  duplicate: DuplicateState;
  onOpenExisting: (ticketId: string) => void;
  onSubmit: (e: FormEvent) => void;
  locale: AttendeeLocale;
  t: TranslationDictionary;
  isRtl: boolean;
}

/** 03 — issue a pass to someone who has not registered yet. */
export function WalkInForm({ ids, nameInputRef, draft, onChange, tiers, submitting, formError, duplicate, onOpenExisting, onSubmit, locale, t, isRtl }: WalkInFormProps) {
  return (
    <section aria-labelledby="walkin-heading" className="rx-area-walkin min-w-0 overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
      <div className="space-y-1.5 border-b border-border-subtle px-5 py-4 sm:px-6">
        <h2 id="walkin-heading" className="flex items-center gap-2.5 text-sm font-semibold text-text-primary">
          <span aria-hidden="true" className="font-mono text-[11px] text-aiteb-indigo">03</span>
          <span>{t.walkInRegistrationHeading}</span>
        </h2>
        <p className="text-xs leading-relaxed text-text-secondary">{isRtl ? "صدور آنی کارت ورود برای کسی که هنوز ثبت‌نام نکرده است." : "Issue a pass for someone who has not registered yet."}</p>
      </div>

      <form onSubmit={onSubmit} className="@container space-y-4 p-5 sm:p-6" noValidate>
        <div>
          <label htmlFor={ids.name} className="ui-label">{isRtl ? "نام و نام خانوادگی شرکت‌کننده" : "Full Name"} <span aria-hidden="true" className="text-status-danger-solid">*</span></label>
          <input id={ids.name} ref={nameInputRef} type="text" required value={draft.fullName} onChange={(e) => onChange({ fullName: e.target.value })} placeholder={isRtl ? "مثال: دکتر مهدی احمدی" : "e.g. Dr. Mahdi Ahmadi"} className="ui-input" />
        </div>
        <div>
          <label htmlFor={ids.mobile} className="ui-label">{isRtl ? "شماره موبایل (اختیاری)" : "Mobile Number (Optional)"}</label>
          <input id={ids.mobile} type="tel" dir="ltr" inputMode="tel" autoComplete="off" value={draft.mobile} onChange={(e) => onChange({ mobile: e.target.value })} placeholder="09xx xxx xxxx" className="ui-input font-mono" />
          <p className="mt-1.5 text-xs text-text-muted">
            {isRtl ? "با شماره موبایل، لینک کارت ورود پیامک می‌شود و شرکت‌کننده بعداً می‌تواند وارد شود." : "With a number, the pass link is sent by SMS and the attendee can sign in later."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
          <div>
            <label htmlFor={ids.org} className="ui-label">{isRtl ? "سازمان / دانشگاه" : "Organization"}</label>
            <input id={ids.org} type="text" value={draft.organization} onChange={(e) => onChange({ organization: e.target.value })} placeholder={isRtl ? "دانشگاه علوم پزشکی" : "University / Hospital"} className="ui-input" />
          </div>
          <div>
            <label htmlFor={ids.title} className="ui-label">{isRtl ? "عنوان حرفه‌ای" : "Title"}</label>
            <input id={ids.title} type="text" value={draft.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={isRtl ? "متخصص، پژوهشگر" : "Specialist, Researcher"} className="ui-input" />
          </div>
        </div>
        <div>
          <label htmlFor={ids.tier} className="ui-label">{t.tierLabel} <span aria-hidden="true" className="text-status-danger-solid">*</span></label>
          <select id={ids.tier} value={draft.tierId} onChange={(e) => onChange({ tierId: e.target.value })} className="ui-select">
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name} ({t.tierQuotaTotal}: {formatLocalizedNumber(tier.quota, locale)})
              </option>
            ))}
          </select>
          {tiers.length === 0 && <p className="mt-1.5 text-xs text-text-muted">{isRtl ? "هنوز رده بلیتی برای این همایش تعریف نشده است." : "No ticket tier is defined for this congress yet."}</p>}
        </div>

        {formError && (
          <div role="alert" aria-live="assertive" className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-[13px] leading-relaxed text-status-danger-text">
            <Icon name="alert" size={17} className="mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        {duplicate.status !== "none" && (
          <div role="status" className="space-y-3 rounded-xl border border-status-warning-border bg-status-warning-bg p-3.5 text-[13px] leading-relaxed text-status-warning-text">
            {duplicate.status === "looking" && <p className="flex items-center gap-2"><Icon name="sync" size={16} className="motion-safe:animate-spin" />{isRtl ? "در حال جستجوی کارت موجود..." : "Looking for the existing pass..."}</p>}
            {duplicate.status === "failed" && <p>{isRtl ? "کارت موجود پیدا نشد (خطای جستجو). با جستجوی دستی بررسی کنید." : "The existing pass could not be looked up. Check with the search box."}</p>}
            {duplicate.status === "missing" && <p>{isRtl ? "کارت دقیقاً مطابق این شماره پیدا نشد. با جستجوی دستی بررسی کنید." : "No pass with exactly this mobile number was found. Check with the search box."}</p>}
            {duplicate.status === "found" && (
              <>
                <p className="flex items-start gap-2"><Icon name="ticket" size={16} className="mt-0.5" /><span>{isRtl ? "این شماره قبلاً کارت دارد. برای بررسی کارت موجود، آن را انتخاب کنید:" : "This mobile number already has a pass. Choose it to review the existing pass:"}</span></p>
                {duplicate.candidates.map((c) => (
                  <Button key={c.ticket_id} type="button" variant="secondary" size="md" isFullWidth className="h-auto justify-between whitespace-normal text-start" onClick={() => onOpenExisting(c.ticket_id)}>
                    <span className="min-w-0 break-words">{isRtl ? `بررسی کارت ${c.attendee_name}` : `Review existing pass: ${c.attendee_name}`}</span>
                    <Icon name="arrow-right" size={16} />
                  </Button>
                ))}
              </>
            )}
          </div>
        )}

        <Button type="submit" variant="primary" size="lg" isFullWidth disabled={submitting || tiers.length === 0} aria-busy={submitting}>
          <Icon name={submitting ? "sync" : "ticket"} size={18} className={submitting ? "motion-safe:animate-spin" : ""} />
          <span>{submitting ? t.mintingBadge : t.mintBadgeAction}</span>
        </Button>
      </form>
    </section>
  );
}
