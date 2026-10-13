import type { ReactNode } from "react";
import { AitebAttribution } from "../brand/Aiteb";
import { Icon, type IconName } from "../ui/Icon";

type Locale = "fa" | "en";

/** Full-height ink instrument surface; carries the scanner's own language direction. */
export function ScannerScreen({ locale, children, className = "" }: { locale: Locale; children: ReactNode; className?: string }) {
  return (
    <div
      dir={locale === "fa" ? "rtl" : "ltr"}
      lang={locale}
      className={`scanner-root min-h-dvh bg-ink-950 text-white text-start antialiased ${className}`.trim()}
    >
      <div aria-hidden="true" className="scanner-brandline" />
      {children}
    </div>
  );
}

/**
 * Operational command label. In Persian the English command name stays beside the Persian one: supervisors,
 * runbooks and the scanner's audit language all use it.
 */
export function BiLabel({ locale, label, className = "" }: { locale: Locale; label: { fa: string; en: string }; className?: string }) {
  if (locale === "en") return <span className={className}>{label.en}</span>;
  return (
    <span className={`inline-flex flex-col items-center leading-tight ${className}`.trim()}>
      <span>{label.fa}</span>
      <span lang="en" dir="ltr" className="scanner-bi-en">
        {label.en}
      </span>
    </span>
  );
}

/** Stacked variant for headings, labels and banner titles; the English line follows the Persian start edge. */
export function BiHeading({ locale, label }: { locale: Locale; label: { fa: string; en: string } }) {
  if (locale === "en") return <>{label.en}</>;
  return (
    <>
      <span className="block">{label.fa}</span>
      <span className="block">
        <span lang="en" className="scanner-bi-en ltr-isolate">
          {label.en}
        </span>
      </span>
    </>
  );
}

export function LanguageSwitch({ locale, label, onToggle }: { locale: Locale; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="scanner-tool inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-white/12 bg-white/[0.04] px-3 text-[13px] font-semibold text-ink-100 hover:border-white/25 hover:bg-white/[0.08]"
      aria-label={locale === "fa" ? "Switch to English" : "تغییر زبان به فارسی"}
    >
      <Icon name="globe" size={17} />
      <span lang={locale === "fa" ? "en" : "fa"}>{label}</span>
    </button>
  );
}

export function ProductMark({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[12px] font-semibold text-ink-300">
      <span className="grid size-7 place-items-center rounded-lg border border-white/12 bg-white/[0.04] text-white">
        <Icon name="scan" size={16} />
      </span>
      <span className={compact ? "max-sm:sr-only" : undefined}>{text}</span>
    </span>
  );
}

/** Pairing / deauthorized / deactivated screens: calm, trustworthy, one focused panel. */
export function SetupFrame({
  locale,
  product,
  languageLabel,
  onToggleLocale,
  children,
}: {
  locale: Locale;
  product: string;
  languageLabel: string;
  onToggleLocale: () => void;
  children: ReactNode;
}) {
  return (
    <ScannerScreen locale={locale} className="flex flex-col bg-meridian-ink">
      <header className="pt-safe">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <ProductMark text={product} />
          <LanguageSwitch locale={locale} label={languageLabel} onToggle={onToggleLocale} />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6">{children}</main>
      <footer className="pb-safe">
        <div className="mx-auto flex w-full max-w-5xl justify-center px-4 py-5">
          <AitebAttribution locale={locale} tone="dark" />
        </div>
      </footer>
    </ScannerScreen>
  );
}

export function SetupPanel({ tone = "neutral", icon, children }: { tone?: "neutral" | "danger" | "warning"; icon: IconName; children: ReactNode }) {
  const medal =
    tone === "danger"
      ? "border-status-danger-solid/50 bg-status-danger-solid/15 text-[#FF8BA8]"
      : tone === "warning"
        ? "border-status-warning-solid/50 bg-status-warning-solid/15 text-[#FFC266]"
        : "border-white/15 bg-white/[0.06] text-white";
  return (
    <section className="scanner-setup-panel shape-arc-lg relative w-full max-w-[30rem] overflow-hidden border border-white/10 bg-ink-900/95 p-5 shadow-[0_40px_90px_-40px_rgb(0_0_0/0.9)] sm:p-8">
      <svg aria-hidden="true" viewBox="0 0 120 120" className="pointer-events-none absolute -top-3 -end-3 size-24 opacity-50">
        <path d="M6 96 C 40 88, 78 60, 96 6" fill="none" stroke="url(#scanner-arc)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M36 118 C 44 78, 74 56, 118 48" fill="none" stroke="url(#scanner-arc)" strokeWidth="1.5" strokeLinecap="round" />
        <defs>
          <linearGradient id="scanner-arc" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#FF97FF" />
            <stop offset="1" stopColor="#3D35DF" />
          </linearGradient>
        </defs>
      </svg>
      <div className={`relative mb-5 grid size-12 place-items-center rounded-2xl border ${medal}`}>
        <Icon name={icon} size={24} />
      </div>
      <div className="relative space-y-4">{children}</div>
    </section>
  );
}

/** English diagnostic lines as the system reported them (shown verbatim; never translated). */
export function SystemReadout({ label, lines }: { label: string; lines: Array<string | null | undefined> }) {
  const shown = lines.filter((l): l is string => Boolean(l));
  if (shown.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/70 p-3.5">
      <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-ink-400">
        <Icon name="activity" size={14} />
        {label}
      </p>
      <div lang="en" dir="ltr" className="space-y-1.5 text-start font-mono text-[12.5px] leading-relaxed text-ink-200">
        {shown.map((line, i) => (
          <p key={i} className={i === 0 ? "font-medium text-white" : undefined}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
