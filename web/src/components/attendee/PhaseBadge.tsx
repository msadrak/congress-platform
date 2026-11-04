import type { AttendeeLocale } from "../../lib/i18n";
import { congressPhase, phaseLabel } from "./congressTime";

interface PhaseBadgeProps {
  startsAt: string;
  endsAt: string;
  locale: AttendeeLocale;
  tone?: "ink" | "light";
  className?: string;
  /** The congress's IANA zone: "day 2" and "starts tomorrow" follow the venue's calendar. */
  timeZone?: string;
}

/** Live / upcoming / ended status computed from the congress's own dates. Renders nothing if they are unusable. */
export function PhaseBadge({ startsAt, endsAt, locale, tone = "light", className = "", timeZone }: PhaseBadgeProps) {
  const phase = congressPhase(startsAt, endsAt, undefined, timeZone);
  if (!phase) return null;
  const ink = tone === "ink";
  const surface =
    phase.kind === "live"
      ? ink
        ? "bg-white text-surface-ink"
        : "bg-status-success-bg text-status-success-text border border-status-success-border"
      : phase.kind === "upcoming"
        ? ink
          ? "bg-white/10 text-white ring-1 ring-inset ring-white/20"
          : "bg-event-accent-soft text-event-accent border border-event-accent/20"
        : ink
          ? "bg-white/5 text-ink-300 ring-1 ring-inset ring-white/15"
          : "bg-surface-panel-subtle text-text-secondary border border-border-default";
  const dot = phase.kind === "live" ? "bg-status-success-solid" : phase.kind === "upcoming" ? (ink ? "bg-aiteb-orchid" : "bg-event-accent") : "bg-ink-400";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold leading-none whitespace-nowrap ${surface} ${className}`.trim()}>
      <span aria-hidden="true" className="relative grid size-2 place-items-center">
        {phase.kind === "live" && <span className={`absolute inset-0 rounded-full ${dot} motion-safe:animate-pulse-ring`} />}
        <span className={`relative size-2 rounded-full ${dot}`} />
      </span>
      {phaseLabel(phase, locale)}
    </span>
  );
}
