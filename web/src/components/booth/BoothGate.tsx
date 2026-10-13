import type { ReactNode } from "react";
import { AitebAttribution, ArcMotif } from "../brand/Aiteb";
import { Icon, type IconName } from "../ui/Icon";

interface BoothGateProps {
  locale: "fa" | "en";
  dir: "rtl" | "ltr";
  icon: IconName;
  tone?: "brand" | "danger" | "warning";
  eyebrow: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}

const TONES = {
  brand: "bg-aiteb-lavender text-aiteb-indigo",
  danger: "bg-status-danger-bg text-status-danger-text",
  warning: "bg-status-warning-bg text-status-warning-text",
} as const;

/** Full-page authority state of the booth workspace: signed out, refused (403) or unavailable. */
export function BoothGate({ locale, dir, icon, tone = "brand", eyebrow, title, children, actions }: BoothGateProps) {
  return (
    <div dir={dir} lang={locale} className="booth-gate flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface-page bg-meridian px-4 py-10 font-sans text-text-primary">
      <div className="w-full max-w-md overflow-hidden border border-border-default bg-surface-panel shadow-lift shape-arc-lg motion-safe:animate-rise">
        <div className="relative h-24 overflow-hidden bg-surface-ink bg-meridian-ink">
          <ArcMotif className="absolute -bottom-10 end-4 size-36 opacity-90" weight={5} />
          <p className="absolute start-6 top-5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300 sm:start-8">
            <Icon name="booth" size={15} className="text-aiteb-orchid" />
            <span>{eyebrow}</span>
          </p>
        </div>
        <div className="relative px-6 pb-7 sm:px-8 sm:pb-8">
          <span className={`-mt-7 grid size-14 place-items-center rounded-2xl shadow-soft ring-4 ring-surface-panel ${TONES[tone]}`}>
            <Icon name={icon} size={26} />
          </span>
          <h1 className="mt-5 text-[1.6rem] font-bold leading-tight tracking-[-0.025em] text-text-primary">{title}</h1>
          {children && <div className="mt-2.5 space-y-3 text-sm leading-relaxed text-text-secondary">{children}</div>}
          {actions && <div className="mt-7 flex flex-col gap-2.5">{actions}</div>}
        </div>
      </div>
      <AitebAttribution locale={locale} />
    </div>
  );
}
