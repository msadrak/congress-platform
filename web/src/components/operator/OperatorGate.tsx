import type { ReactNode } from "react";
import { operatorCopy, type OperatorGateKind, type OperatorLocale } from "../../copy/operator";
import { LOCALE_DIR } from "../../lib/i18n";
import { Icon, type IconName } from "../ui/Icon";

export interface OperatorGateProps {
  locale: OperatorLocale;
  /** Picks the icon, its colour and the default title and line. */
  kind: OperatorGateKind;
  /** Ink for the scanner, light for the desk and the booth. */
  tone?: "light" | "ink";
  /** Replaces the default title (2–4 words). */
  title?: string;
  /** Replaces the default line (one sentence); `null` hides it. */
  body?: string | null;
  icon?: IconName;
  /** The one primary button (`Button` or `LinkButton`, `size="lg" isFullWidth`). */
  action?: ReactNode;
  /** An optional quiet second action. */
  secondary?: ReactNode;
  /** Extra content above the buttons: a paste-code field, an unsent-scans line, the install hint. */
  children?: ReactNode;
  /** Diagnostics folded under «جزئیات فنی» (version, point id, English detail). */
  details?: ReactNode;
}

type GateLook = "brand" | "warning" | "danger";

const KIND: Record<OperatorGateKind, { icon: IconName; look: GateLook }> = {
  unpaired: { icon: "qr", look: "brand" },
  signIn: { icon: "key", look: "brand" },
  archived: { icon: "eye", look: "brand" },
  revoked: { icon: "lock", look: "danger" },
  removed: { icon: "lock", look: "danger" },
  wrongGate: { icon: "gate", look: "danger" },
  expired: { icon: "hourglass", look: "warning" },
  suspended: { icon: "pause", look: "warning" },
  unavailable: { icon: "wifi-off", look: "warning" },
};

const TILE_LIGHT: Record<GateLook, string> = {
  brand: "bg-aiteb-lavender text-aiteb-indigo",
  warning: "bg-status-warning-bg text-status-warning-text",
  danger: "bg-status-danger-bg text-status-danger-text",
};

const TILE_INK: Record<GateLook, string> = {
  brand: "bg-white/10 text-aiteb-orchid",
  warning: "bg-status-warning-solid text-ink-950",
  danger: "bg-status-danger-solid text-white",
};

/**
 * One template for every setup or blocked screen of the operator tools (unpaired, revoked, wrong point, expired,
 * suspended, removed, archived, sign-in needed, server unreachable): icon, short title, one line, one primary button.
 */
export function OperatorGate({ locale, kind, tone = "light", title, body, icon, action, secondary, children, details }: OperatorGateProps) {
  const copy = operatorCopy[locale];
  const look = KIND[kind];
  const ink = tone === "ink";
  const line = body === undefined ? copy.gate[kind].body : body;

  return (
    <div
      dir={LOCALE_DIR[locale]}
      lang={locale}
      data-gate={kind}
      className={`flex min-h-dvh flex-col items-center justify-center px-4 pt-safe pb-safe font-sans ${
        ink ? "bg-surface-ink text-white" : "bg-surface-page text-text-primary"
      }`}
    >
      <div
        className={`my-10 w-full max-w-md rounded-2xl border p-6 sm:p-8 ${
          ink ? "border-white/10 bg-surface-ink-raised" : "border-border-default bg-surface-panel shadow-soft"
        }`}
      >
        <span className={`grid size-14 place-items-center rounded-2xl ${ink ? TILE_INK[look.look] : TILE_LIGHT[look.look]}`}>
          <Icon name={icon ?? look.icon} size={26} />
        </span>
        <h1 className="mt-5 text-2xl leading-tight font-bold">{title ?? copy.gate[kind].title}</h1>
        {line && <p className={`mt-2 text-sm leading-relaxed ${ink ? "text-ink-200" : "text-text-secondary"}`}>{line}</p>}
        {children && <div className="mt-4 space-y-3 text-sm">{children}</div>}
        {(action || secondary) && (
          <div className="mt-6 flex flex-col gap-2.5">
            {action}
            {secondary}
          </div>
        )}
        {details && (
          <details className={`group mt-6 text-sm ${ink ? "text-ink-200" : "text-text-muted"}`}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-medium [&::-webkit-details-marker]:hidden">
              <span>{copy.details}</span>
              <Icon name="chevron-down" size={16} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="mt-2 space-y-1 text-xs break-words">{details}</div>
          </details>
        )}
      </div>
    </div>
  );
}
