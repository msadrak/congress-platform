import type { ReactNode } from "react";
import { operatorCopy, type OperatorLocale, type VerdictTone } from "../../copy/operator";
import { Icon, type IconName } from "../ui/Icon";
import "../../styles/operator.css";

export interface VerdictBannerProps {
  locale: OperatorLocale;
  tone: VerdictTone;
  /** Replaces the tone's word (≤ 2 words), e.g. the booth's «لید جدید». */
  title?: string;
  /** The person, on its own line. */
  name?: string;
  /** Next to the name, e.g. a pass type chip. */
  meta?: ReactNode;
  /** Why, at most 8 words. */
  reason?: string;
  icon?: IconName;
  /** `stage` fills its positioned parent (scanner takeover); `inline` sits in a desk card or the booth sheet. */
  layout?: "stage" | "inline";
}

const ICON: Record<VerdictTone, IconName> = {
  admitted: "check",
  "admitted-offline": "hourglass",
  exit: "logout",
  duplicate: "copy",
  rejected: "x",
  info: "info",
};

/** Refusals interrupt; everything else is announced politely. */
const URGENT = new Set<VerdictTone>(["duplicate", "rejected"]);

/**
 * The outcome of a scan, an admit or a capture: colour, icon and one word, then the name and a short reason.
 * Each tone differs by colour, icon and pattern, never by colour alone.
 */
export function VerdictBanner({ locale, tone, title, name, meta, reason, icon, layout = "inline" }: VerdictBannerProps) {
  const urgent = URGENT.has(tone);
  return (
    <div
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      aria-atomic="true"
      data-tone={tone}
      className={`op-verdict op-verdict--${tone} op-verdict--${layout}`}
    >
      <span className="op-verdict-icon" aria-hidden="true">
        <Icon name={icon ?? ICON[tone]} size={36} strokeWidth={2.4} />
      </span>
      <p className="op-verdict-title">{title ?? operatorCopy[locale].verdict[tone]}</p>
      {(name || meta) && (
        <div className="flex flex-col items-center gap-1">
          {name && (
            <p className="op-verdict-name">
              <bdi>{name}</bdi>
            </p>
          )}
          {meta}
        </div>
      )}
      {reason && <p className="op-verdict-reason">{reason}</p>}
    </div>
  );
}
