import type { CSSProperties, ReactNode } from "react";
import QRCode from "react-qr-code";
import { Icon } from "../ui/Icon";

export interface PassData {
  qr: string;
  name: string;
  tier: string;
  org: string;
  ticketId: string;
}

interface ReceptionPassProps {
  pass: PassData;
  isRtl: boolean;
  /** Congress name from the operator context, when known. */
  eventName?: string;
  /** Only the pass in front of the operator is printable, so a print never stacks two passes. */
  printable: boolean;
  /** Surface behind the pass; the perforation notches take this colour. */
  notch?: "panel" | "subtle";
}

/**
 * Attendee pass preview — also the exact element `window.print()` outputs (`print-pass`).
 * The QR value and rendering are unchanged: black modules on a white plate with a quiet zone.
 */
export function ReceptionPass({ pass, isRtl, eventName, printable, notch = "subtle" }: ReceptionPassProps) {
  return (
    <article
      className={`${printable ? "print-pass " : ""}rx-pass relative mx-auto w-full max-w-[17.5rem] overflow-hidden shape-arc border border-border-default bg-white text-center shadow-soft`}
      style={notch === "panel" ? ({ "--rx-notch": "var(--surface-panel)" } as CSSProperties) : undefined}
    >
      <div aria-hidden="true" className="rx-pass-accent absolute inset-y-0 start-0 w-[3px] bg-event-accent" />
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 text-start sm:px-5">
        <span className="min-w-0 truncate text-[11px] font-semibold text-text-muted">
          {eventName || (isRtl ? "کارت ورود همایش" : "Congress pass")}
        </span>
        <Icon name="ticket" size={16} className="text-event-accent" />
      </div>
      <div className="px-4 pb-5 flex justify-center sm:px-5">
        <div className="rounded-xl bg-white p-3 ring-1 ring-ink-900/80">
          <QRCode value={pass.qr} size={176} level="H" viewBox="0 0 256 256" fgColor="#000000" bgColor="#FFFFFF" className="w-44 h-44 select-none" />
        </div>
      </div>
      <div aria-hidden="true" className="rx-pass-perf" />
      <div className="px-4 pt-4 pb-5 space-y-1.5 sm:px-5">
        <h3 className="text-lg font-bold leading-snug tracking-[-0.01em] text-text-primary break-words">{pass.name}</h3>
        <p className="text-xs font-medium text-text-secondary break-words">
          {pass.tier} <span aria-hidden="true" className="text-text-muted">·</span> {pass.org || (isRtl ? "شرکت‌کننده آزاد" : "Independent Attendee")}
        </p>
        <p className="pt-1.5 font-mono text-[11px] tracking-wide text-text-muted">
          <bdi dir="ltr">Pass ID: #{pass.ticketId.slice(0, 8).toUpperCase()}</bdi>
        </p>
      </div>
    </article>
  );
}

/** High-contrast ticket status: solid, legible at a glance from across the desk. */
export function TicketStatusChip({ status, activeLabel, size = "sm" }: { status: string; activeLabel: string; size?: "sm" | "md" }) {
  const active = status === "active";
  const sizing = size === "md" ? "gap-1.5 px-2.5 py-1.5 text-xs" : "gap-1 px-2 py-1 text-[11px]";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-semibold leading-none text-white ${sizing} ${active ? "bg-status-success-text" : "bg-status-danger-text"}`}
    >
      <Icon name={active ? "check" : "x"} size={size === "md" ? 14 : 12} strokeWidth={2.5} />
      <span>{active ? activeLabel : status}</span>
    </span>
  );
}

/** Small keyboard key used in shortcut hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rx-kbd">{children}</kbd>;
}
