import { Icon } from "./Icon";
import { uiCopy, type UiLocale } from "./uiCopy";

/**
 * The one language switch: a globe and the other language's name, written in that language (`lang`), so it
 * reads «English» on Persian pages and «فارسی» on English ones. 44 px; `tone="ink"` on dark surfaces.
 */
export function LanguageToggle({
  locale,
  onChange,
  tone = "default",
  className = "",
}: {
  locale: UiLocale;
  onChange: (next: UiLocale) => void;
  tone?: "default" | "ink";
  className?: string;
}) {
  const next: UiLocale = locale === "fa" ? "en" : "fa";
  return (
    <button
      type="button"
      lang={next}
      onClick={() => onChange(next)}
      className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-3 text-body-sm font-semibold transition-colors ${
        tone === "ink" ? "text-white/80 hover:bg-white/8 hover:text-white" : "text-text-secondary hover:bg-surface-panel-subtle hover:text-text-primary"
      } ${className}`.trim()}
    >
      <Icon name="globe" size={18} />
      {uiCopy[next].languageName}
    </button>
  );
}
