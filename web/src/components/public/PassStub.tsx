import type { TicketTierOut } from "../../api/client";
import { Icon } from "../ui/Icon";
import { Bidi } from "./Bidi";
import { num, publicCopy, type PublicLocale } from "./copy";
import { formatMoment } from "./format";
import type { Availability } from "../../lib/registrationWindow";

interface PassStubProps {
  tier: TicketTierOut;
  selected: boolean;
  locale: PublicLocale;
  onSelect: () => void;
  /** Whether this tier can be reserved now (congress window, tier sales window, switch, quota). */
  availability: Availability;
  /** The congress's zone, for "opens at" times. */
  timeZone?: string;
}

/**
 * The stub's label for a tier that cannot be reserved now, and the notice under the capacity meter when the
 * label alone does not say why (full and ended sales say it in the label).
 */
function unavailableText(availability: Exclude<Availability, { kind: "open" }>, locale: PublicLocale, timeZone?: string) {
  const c = publicCopy[locale];
  switch (availability.kind) {
    case "full":
      return { notice: null, label: c.tierStatusSoldOut, icon: "users" as const };
    case "opens":
      return { notice: c.tierOpensNotice(formatMoment(availability.at, locale, timeZone)), label: c.tierStatusOpens, icon: "clock" as const };
    case "closed":
      return {
        notice:
          availability.reason === "tier"
            ? c.tierClosedNotice
            : availability.reason === "sales"
              ? null
              : availability.reason === "ended"
                ? c.eventEndedNotice
                : c.eventClosedNotice,
        label: availability.reason === "sales" ? c.tierStatusSalesEnded : c.tierStatusClosed,
        icon: "lock" as const,
      };
  }
}

/**
 * One ticket tier as a perforated pass: body (name, description, capacity meter) and a tear-off stub
 * carrying the price/state. The native radio keeps selection semantics and keyboard behaviour.
 */
export function PassStub({ tier, selected, locale, onSelect, availability, timeZone }: PassStubProps) {
  const c = publicCopy[locale];
  const available = availability.kind === "open";
  const unavailable = availability.kind === "open" ? null : unavailableText(availability, locale, timeZone);
  const reserved = tier.reserved_count ?? 0;
  const remaining = Math.max(0, tier.quota - reserved);
  const taken = tier.quota > 0 ? Math.min(100, Math.round((reserved / tier.quota) * 100)) : 100;
  const low = available && tier.quota > 0 && remaining / tier.quota <= 0.25;
  const ink = selected && available;

  return (
    <label
      className={`pass-shell group block select-none ${available ? "cursor-pointer motion-safe:hover:-translate-y-0.5" : "cursor-not-allowed"}`}
      data-selected={ink}
      data-state={available ? "open" : "disabled"}
      data-availability={availability.kind}
    >
      <div className={`pass-stub min-h-[10.5rem] ${ink ? "bg-surface-ink text-white" : "bg-surface-panel text-text-primary"}`}>
        {/* Body */}
        <div className="relative flex min-w-0 flex-col gap-3 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="ticket_tier"
              value={tier.id}
              checked={selected}
              disabled={!available}
              onChange={() => {
                if (available) onSelect();
              }}
              className="mt-1 size-[18px] shrink-0 cursor-pointer accent-[var(--event-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            />
            <div className="min-w-0 space-y-1">
              <span className={`block text-title-sm font-semibold leading-snug break-words ${available || ink ? "" : "text-text-secondary"}`}>
                <Bidi text={tier.name} />
              </span>
              {tier.description && (
                <span className={`block text-body-sm leading-relaxed ${ink ? "text-ink-200" : "text-text-secondary"}`}>
                  <Bidi text={tier.description} />
                </span>
              )}
            </div>
          </div>

          {/* Capacity */}
          <div className="mt-auto space-y-2 ps-[30px]">
            <div
              className={`pass-meter ${ink ? "pass-meter-ink" : ""}`}
              data-tone={!available ? "off" : low ? "low" : "ok"}
              role="presentation"
            >
              <span style={{ inlineSize: `${taken}%` }} />
            </div>
            <p className={`text-caption ${ink ? "text-ink-200" : "text-text-muted"}`}>
              {unavailable ? (
                unavailable.notice && <span className={`font-medium ${availability.kind === "opens" ? "text-text-secondary" : ""}`}>{unavailable.notice}</span>
              ) : (
                <>
                  {c.capacityRemaining}{" "}
                  <strong className={`font-semibold tabular ${ink ? "text-white" : low ? "text-status-warning-text" : "text-text-primary"}`}>
                    {num(remaining, locale)}
                  </strong>{" "}
                  / {num(tier.quota, locale)}
                </>
              )}
            </p>
          </div>
        </div>

        {/* Stub */}
        <div
          className={`relative flex flex-col items-center justify-center gap-2 px-2 py-5 text-center ${
            ink ? "text-white" : available ? "bg-event-accent-soft text-event-accent" : "pass-hatch bg-surface-panel-subtle text-text-muted"
          }`}
        >
          <span aria-hidden="true" className={`pass-perf ${ink ? "text-white" : "text-text-muted"}`} />
          {unavailable ? (
            <>
              <Icon name={unavailable.icon} size={20} />
              <span className="text-caption font-bold leading-tight">{unavailable.label}</span>
            </>
          ) : (
            <>
              <span className="text-body font-bold">{c.tierFree}</span>
              <Icon name={selected ? "check-circle" : "ticket"} size={20} className={ink ? "text-aiteb-orchid" : "opacity-80"} />
            </>
          )}
        </div>
      </div>
    </label>
  );
}
