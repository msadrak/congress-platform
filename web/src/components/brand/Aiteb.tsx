import { useId } from "react";

export const AITEB_URL = "https://aiteb.ir/";
/** Display name in every language: Latin even inside Persian copy, set in an LTR island there. */
export const AITEB_NAME = "AI Teb";

interface AitebLogoProps {
  /** `full` = official wordmark lockup, `mark` = the crossing-arcs symbol alone. */
  variant?: "full" | "mark";
  className?: string;
  /** Accessible name; empty string makes the logo decorative (when a visible label sits beside it). */
  alt?: string;
}

/** Official AIteb logo files from aiteb.ir (public/brand); never redrawn or recoloured. */
export function AitebLogo({ variant = "full", className = "", alt = AITEB_NAME }: AitebLogoProps) {
  if (variant === "mark") {
    return <img src="/brand/aiteb-mark.png" width={256} height={256} alt={alt} className={`object-contain ${className}`.trim()} draggable={false} />;
  }
  return <img src="/brand/aiteb-logo.png" width={300} height={95} alt={alt} className={`object-contain ${className}`.trim()} draggable={false} />;
}

const CREDIT = {
  fa: { lead: "طراحی و توسعه توسط", newTab: "(در زبانه جدید باز می‌شود)" },
  en: { lead: "Designed & developed by", newTab: "(opens in a new tab)" },
} as const;

interface AitebAttributionProps {
  locale: "fa" | "en";
  /** `light` for pale surfaces, `dark` for ink surfaces. */
  tone?: "light" | "dark";
  className?: string;
}

/**
 * Platform-developer credit linking to aiteb.ir. Restrained by design: AIteb builds the platform,
 * each congress keeps its own identity.
 */
export function AitebAttribution({ locale, tone = "light", className = "" }: AitebAttributionProps) {
  const copy = CREDIT[locale];
  const toneClass =
    tone === "dark"
      ? "text-ink-300 hover:text-white focus-visible:outline-aiteb-orchid"
      : "text-text-muted hover:text-aiteb-indigo";
  return (
    <a
      href={AITEB_URL}
      target="_blank"
      rel="noopener noreferrer"
      lang={locale}
      dir={locale === "fa" ? "rtl" : "ltr"}
      aria-label={`${copy.lead} ${AITEB_NAME} ${copy.newTab}`}
      className={`group inline-flex items-center gap-2 text-xs font-medium transition-colors ${toneClass} ${className}`.trim()}
    >
      <span className="grid size-6 place-items-center rounded-full bg-white shadow-[0_0_0_1px_rgb(14_12_43/0.08)] transition-transform duration-300 group-hover:rotate-[18deg] motion-reduce:transition-none">
        <AitebLogo variant="mark" alt="" className="size-4" />
      </span>
      <span>
        {copy.lead}{" "}
        <bdi dir="ltr" lang="en" className="font-bold text-current">
          {AITEB_NAME}
        </bdi>
      </span>
    </a>
  );
}

interface ArcMotifProps {
  className?: string;
  /** Stroke width in the 100-unit viewBox. */
  weight?: number;
  animate?: boolean;
}

/** Two crossing arcs: the platform's graphic motif, derived from (not a copy of) the AIteb mark. */
export function ArcMotif({ className = "", weight = 7, animate = false }: ArcMotifProps) {
  const uid = useId().replace(/:/g, "");
  const draw = animate ? "motion-safe:animate-draw" : "";
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id={`m-a-${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FF97FF" />
          <stop offset="1" stopColor="#3D35DF" />
        </linearGradient>
        <linearGradient id={`m-b-${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FF97FF" />
          <stop offset="1" stopColor="#2000CD" />
        </linearGradient>
      </defs>
      <path d="M8 66 C 34 58, 62 42, 76 8" stroke={`url(#m-a-${uid})`} strokeWidth={weight} strokeLinecap="round" pathLength={1} strokeDasharray="1" className={draw} style={{ ["--arc-length" as string]: 1 }} />
      <path d="M30 94 C 36 62, 60 46, 94 40" stroke={`url(#m-b-${uid})`} strokeWidth={weight} strokeLinecap="round" pathLength={1} strokeDasharray="1" className={draw} style={{ ["--arc-length" as string]: 1, animationDelay: "160ms" }} />
    </svg>
  );
}
