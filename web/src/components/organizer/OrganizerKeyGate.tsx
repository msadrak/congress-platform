import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { TranslationDictionary } from "../../lib/i18n";
import { SIGN_IN_COPY } from "../../lib/organizerConsole";
import { OrganizerMemberSignIn } from "./OrganizerMemberSignIn";
import { AitebAttribution, ArcMotif } from "../brand/Aiteb";
import { CongressSignature } from "../brand/CongressSignature";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

type GateMode = "mobile" | "key";

interface OrganizerKeyGateProps {
  locale: "fa" | "en";
  t: TranslationDictionary;
  isRtl: boolean;
  inputKey: string;
  onInputKeyChange: (value: string) => void;
  /** Validation message, or null. */
  error: string | null;
  /** The previous key or member session was refused by the API (401). */
  keyRejected: boolean;
  /** Which sign-in method the gate opens on: the one that was just refused, else mobile sign-in. */
  initialMode?: GateMode;
  onSubmit: (e: FormEvent) => void;
  /** A member signed in by SMS code (ADR 0016): the session token, stored like a key. */
  onSession: (token: string) => void;
  onToggleLocale: () => void;
}


/**
 * Organizer sign-in: an ink artwork panel (what this console runs) beside a single focused form. Members sign
 * in with their mobile number and an SMS code; the API key stays available for integrations and technical
 * administrators. Session storage and key validation stay in OrganizerLayout.
 */
export function OrganizerKeyGate({ locale, t, isRtl, inputKey, onInputKeyChange, error, keyRejected, initialMode = "mobile", onSubmit, onSession, onToggleLocale }: OrganizerKeyGateProps) {
  const copy = SIGN_IN_COPY[locale];
  const [mode, setMode] = useState<GateMode>(initialMode);
  const areas = isRtl
    ? [t.tabTiers, t.tabPoints, t.tabBooths, `${t.tabOperators} و ${t.breadcrumbAnalytics}`]
    : [t.tabTiers, t.tabPoints, t.tabBooths, `${t.tabOperators} & ${t.breadcrumbAnalytics}`];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Ink artwork panel */}
      <section className="org-ink relative isolate flex flex-col overflow-hidden bg-surface-ink px-5 pb-7 pt-5 text-white sm:px-10 sm:pb-10 lg:min-h-dvh lg:px-12 lg:py-10">
        <CongressSignature seed="aiteb-organizer-console" tone="ink" animate className="absolute inset-0 -z-10 h-full w-full opacity-90" />
        <div aria-hidden="true" className="bg-meridian-ink absolute inset-0 -z-10" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-gradient-to-t from-surface-ink via-surface-ink/80 to-transparent" />

        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/[0.07] ring-1 ring-white/15">
            <ArcMotif className="size-6" weight={9} />
          </span>
          <span className="text-sm font-semibold text-white/90">{t.organizerConsole}</span>
        </div>

        <div className="mt-8 max-w-md space-y-4 sm:mt-12 lg:mt-auto">
          <p className="text-xs font-semibold text-aiteb-orchid">{isRtl ? "فضای کاری برگزارکننده" : "Organizer workspace"}</p>
          <p className="font-display text-[1.75rem] font-[680] leading-[1.12] tracking-[-0.03em] sm:text-[2.5rem] lg:text-[2.75rem]">
            {isRtl ? (
              <>
                همهٔ همایش‌های شما، در <span className="text-aiteb-orchid">یک فضای کاری دقیق.</span>
              </>
            ) : (
              <>
                Every congress you run, in <span className="text-aiteb-orchid">one precise workspace.</span>
              </>
            )}
          </p>
          <p className="max-w-sm text-sm leading-relaxed text-ink-300">{t.organizerConsoleDesc}</p>
        </div>

        <ol className="mt-10 hidden max-w-md grid-cols-2 gap-x-6 border-t border-white/10 pt-6 lg:grid">
          {areas.map((label, i) => (
            <li key={label} className="flex items-baseline gap-2.5 py-2 text-[0.8125rem] text-ink-200">
              <span aria-hidden="true" className="font-mono text-[0.6875rem] text-aiteb-orchid/90">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>

        <div className="mt-8 lg:mt-12">
          <AitebAttribution locale={locale} tone="dark" />
        </div>
      </section>

      {/* Form panel */}
      <section className="relative flex flex-col bg-surface-page px-5 py-5 sm:px-10 lg:px-16 lg:py-10">
        <div aria-hidden="true" className="bg-meridian pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
        <div className="relative flex items-center justify-between gap-3">
          <Link
            to="/"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg text-sm font-semibold text-text-secondary transition-colors hover:text-aiteb-indigo focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            <Icon name="arrow-left" size={18} />
            {t.platformHome}
          </Link>
          <button
            type="button"
            onClick={onToggleLocale}
            aria-label={isRtl ? "Switch language to English" : "تغییر زبان به فارسی"}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-border-default bg-surface-panel px-4 text-sm font-semibold text-text-secondary shadow-soft transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            <Icon name="globe" size={18} />
            {t.languageToggle}
          </button>
        </div>

        <div className="relative mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-10 sm:py-16">
          <div className="space-y-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-aiteb-lavender text-aiteb-indigo ring-1 ring-action-subtle-border">
              <Icon name={mode === "mobile" ? "smartphone" : "key"} size={24} />
            </span>
            <h1 className="pt-2 font-display text-[1.75rem] font-[680] leading-tight tracking-[-0.03em] text-text-primary sm:text-[2rem]">
              {mode === "mobile" ? copy.mobileTitle : t.apiKeyGateTitle}
            </h1>
            <p className="text-sm leading-relaxed text-text-secondary">{mode === "mobile" ? copy.mobileDesc : t.apiKeyGateDesc}</p>
          </div>

          <div role="group" aria-label={copy.modeLabel} className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-surface-panel-subtle p-1 ring-1 ring-border-default">
            {(["mobile", "key"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={`min-h-11 cursor-pointer rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring ${
                  mode === option ? "bg-surface-panel text-text-primary shadow-soft" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {option === "mobile" ? copy.mobileTab : copy.keyTab}
              </button>
            ))}
          </div>

          {mode === "mobile" ? (
            <div className="mt-6 space-y-5">
              {keyRejected && (
                <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg px-3.5 py-3 text-sm leading-relaxed text-status-danger-text">
                  <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
                  <span>{isRtl ? "نشست شما پایان یافته است. دوباره وارد شوید." : "Your session has ended. Please sign in again."}</span>
                </div>
              )}
              <OrganizerMemberSignIn locale={locale} onSession={onSession} />
            </div>
          ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-5">
            <div>
              <label htmlFor="apiKeyInput" className="ui-label">
                {t.apiKeyLabel}
                <span aria-hidden="true" className="ms-1 text-status-danger-solid">
                  *
                </span>
              </label>
              <div className="relative" dir="ltr">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 grid w-11 place-items-center text-text-muted">
                  <Icon name="lock" size={18} />
                </span>
                <input
                  id="apiKeyInput"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={inputKey}
                  onChange={(e) => onInputKeyChange(e.target.value)}
                  placeholder={t.apiKeyPlaceholder}
                  aria-invalid={error || keyRejected ? true : undefined}
                  dir={inputKey || !isRtl ? "ltr" : "rtl"}
                  className={`ui-input pl-11 ${inputKey ? "font-mono text-[0.9375rem]" : ""}`}
                />
              </div>
            </div>

            {(error || keyRejected) && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg px-3.5 py-3 text-sm leading-relaxed text-status-danger-text"
              >
                <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
                <span>
                  {error ?? (isRtl ? "کلید API رد شد. لطفاً کلید معتبر وارد کنید." : "Your organizer API key was rejected. Please enter a valid key.")}
                </span>
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" isFullWidth>
              {t.apiKeySubmit}
              <Icon name="arrow-right" size={18} />
            </Button>
            <p className="text-xs leading-relaxed text-text-muted">{copy.keyHint}</p>
          </form>
          )}

          <p className="mt-8 flex items-start gap-2.5 border-t border-border-default pt-5 text-xs leading-relaxed text-text-muted">
            <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-aiteb-slate" />
            <span>
              {isRtl
                ? "نکته امنیتی: نشست ورود یا کلید دسترسی فقط در حافظهٔ نشست همین تب (SessionStorage) نگه داشته می‌شود و با بستن تب پاک می‌گردد. نشست اعضا پس از ۱۲ ساعت پایان می‌یابد."
                : "Security notice: your session or API key is kept only in this tab's sessionStorage and clears when the tab is closed. Member sessions end after 12 hours."}
            </span>
          </p>
        </div>
      </section>
    </div>
  );
}
