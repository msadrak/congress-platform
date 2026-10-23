import { Link } from "react-router-dom";
import { MobileOtpForm } from "../auth/MobileOtpForm";
import type { AttendeeLocale, TranslationDictionary } from "../../lib/i18n";
import { ArcMotif } from "../brand/Aiteb";
import { Button, LinkButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { ModeSwitch, type DeskMode } from "./ModeSwitch";
import { deskFocusRing } from "./deskTypes";

/** Organizer mode was chosen but no organizer key is held (Organizer administration only). */
export function OrganizerKeyRequired({ isRtl, onUseOperator }: { isRtl: boolean; onUseOperator: () => void }) {
  return (
    <div className="mx-auto my-10 max-w-md sm:my-16">
      <div className="relative overflow-hidden shape-arc-lg border border-border-default bg-surface-panel p-8 text-center shadow-soft sm:p-10">
        <ArcMotif className="pointer-events-none absolute -top-8 -end-8 size-32 opacity-25" weight={4} />
        <div className="relative space-y-5">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-aiteb-lavender text-aiteb-indigo">
            <Icon name="key" size={26} />
          </span>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-text-primary">{isRtl ? "برای حالت مدیر به کلید سازمان نیاز است" : "Organizer mode needs your organizer key"}</h1>
          <div className="flex flex-col gap-2.5">
            <LinkButton to="/organizer" variant="primary" size="lg">
              <Icon name="key" size={18} />
              <span>{isRtl ? "ورود با کلید سازمان" : "Enter organizer key"}</span>
            </LinkButton>
            <Button type="button" variant="secondary" size="lg" onClick={onUseOperator}>
              <Icon name="user" size={18} />
              <span>{isRtl ? "استفاده از نشست اپراتور" : "Use an operator session"}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface DeskSignInProps {
  locale: AttendeeLocale;
  t: TranslationDictionary;
  isRtl: boolean;
  /** The independent Reception Portal: no link back to the Organizer console. */
  standalone: boolean;
  /** Offered only inside Organizer administration with an organizer key. */
  modeSwitch: { mode: DeskMode; disabled: boolean; onSelect: (mode: DeskMode) => void } | null;
  /** The previous session was refused (revoked or expired). */
  sessionRejected: boolean;
  hasDraft: boolean;
  /** Verifies the operator's SMS code; resolves to the message to show, or null once signed in. */
  verifyCode: (mobile: string, code: string) => Promise<string | null>;
}

/** The desk entry gate: operator sign-in by mobile number and SMS code. */
export function DeskSignIn({ locale, t, isRtl, standalone, modeSwitch, sessionRejected, hasDraft, verifyCode }: DeskSignInProps) {
  const steps = isRtl
    ? ["جستجوی شرکت‌کننده با نام یا شماره موبایل", "بررسی و چاپ کارت ورود", "صدور کارت برای ثبت‌نام حضوری"]
    : ["Find an attendee by name or mobile number", "Review and print their pass", "Issue a pass to a walk-in guest"];
  return (
    <div className="rx-station mx-auto max-w-4xl sm:my-6">
      <div className="grid overflow-hidden shape-arc-lg border border-border-default bg-surface-panel shadow-lift md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <aside className="relative isolate overflow-hidden bg-surface-ink p-6 text-white sm:p-8 md:p-10">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-meridian-ink" />
          <ArcMotif className="pointer-events-none absolute -bottom-12 -end-10 -z-10 size-56 opacity-80 md:size-72" weight={4} />
          <div className="space-y-5 md:space-y-8">
            <p className="eyebrow text-ink-300">{t.openDeskAction}</p>
            <p className="text-2xl font-semibold leading-tight tracking-[-0.03em] md:text-[2rem]">
              {isRtl ? "پیدا کنید، بررسی کنید، چاپ کنید." : "Find. Review. Print."}
            </p>
            <ol className="hidden space-y-3.5 text-sm text-ink-200 sm:block">
              {steps.map((step, i) => (
                <li key={step} className="flex items-baseline gap-3">
                  <span aria-hidden="true" className="font-mono text-[11px] text-aiteb-orchid">0{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <div className="space-y-6 p-6 sm:p-8 md:p-10">
          {modeSwitch && <ModeSwitch mode={modeSwitch.mode} isRtl={isRtl} disabled={modeSwitch.disabled} onSelect={modeSwitch.onSelect} tone="light" />}
          <div className="space-y-2">
            <span aria-hidden="true" className="mb-4 grid size-11 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo">
              <Icon name="lock" size={20} />
            </span>
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text-primary sm:text-[1.75rem]">{t.deskLoginTitle}</h1>
            <p className="text-sm leading-relaxed text-text-secondary">{t.deskLoginSubtitle}</p>
          </div>

          {sessionRejected && (
            <div role="alert" aria-live="assertive" className="flex items-start gap-3 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-sm leading-relaxed text-status-danger-text">
              <Icon name="alert" size={18} className="mt-0.5" />
              <span>
                {isRtl ? "دسترسی اپراتور لغو شده یا نشست کاری منقضی گردیده است." : "Operator access revoked or session expired."}
                {hasDraft && (
                  <span className="mt-1 block text-xs">
                    {isRtl ? "اطلاعات واردشده برای ثبت‌نام حضوری حفظ شده و پس از ورود خودکار ارسال نمی‌شود." : "Your unsent walk-in entry is kept and is not submitted automatically after you sign in."}
                  </span>
                )}
              </span>
            </div>
          )}

          <MobileOtpForm locale={locale} purpose="desk" verifyCode={verifyCode} verifyLabel={t.deskLoginButton} />
          {!standalone && (
            <div className="border-t border-border-subtle pt-4 text-center">
              <Link to="/organizer" className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-action-primary hover:underline ${deskFocusRing}`}>
                <Icon name="arrow-left" size={16} />
                <span>{isRtl ? "ورود با کلید مدیر ارشد" : "Back to Organizer Console"}</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
