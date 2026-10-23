import type { TicketTierOut } from "../../api/client";
import { codeFontClass, translations } from "../../lib/i18n";
import { Icon } from "../ui/Icon";
import { Bidi } from "./Bidi";
import { indexLabel, num, publicCopy, type PublicLocale } from "./copy";
import { tierState } from "./format";

interface PassStubProps {
  tier: TicketTierOut;
  index: number;
  selected: boolean;
  locale: PublicLocale;
  onSelect: () => void;
}

/**
 * One ticket tier as a perforated pass: body (name, description, capacity meter) and a tear-off stub
 * carrying the price/state. The native radio keeps selection semantics and keyboard behaviour.
 */
export function PassStub({ tier, index, selected, locale, onSelect }: PassStubProps) {
  const c = publicCopy[locale];
  const t = translations[locale];
  const state = tierState(tier);
  const available = state === "AVAILABLE";
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
              <span className={`block ${codeFontClass(`${c.tierPassNo} ${indexLabel(index + 1, locale)}`)} text-[11px] tabular ${ink ? "text-aiteb-orchid" : "text-text-muted"}`}>
                {c.tierPassNo} {indexLabel(index + 1, locale)}
              </span>
              <span className={`block text-lg font-semibold leading-snug tracking-[-0.015em] break-words ${available || ink ? "" : "text-text-secondary"}`}>
                <Bidi text={tier.name} />
              </span>
              <span className={`block text-sm leading-relaxed ${ink ? "text-ink-200" : "text-text-secondary"}`}>
                {tier.description ? <Bidi text={tier.description} /> : c.tierDefaultDescription}
              </span>
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
            <p className={`text-xs ${ink ? "text-ink-200" : "text-text-muted"}`}>
              {state === "AVAILABLE" && (
                <>
                  {t.tierCapacityRemaining}{" "}
                  <strong className={`font-semibold tabular ${ink ? "text-white" : low ? "text-status-warning-text" : "text-text-primary"}`}>
                    {num(remaining, locale)}
                  </strong>{" "}
                  / {num(tier.quota, locale)}
                </>
              )}
              {state === "SOLD_OUT" && <span className="font-medium text-status-warning-text">{t.tierCapacitySoldOutNotice}</span>}
              {state === "CLOSED" && <span className="font-medium">{t.tierClosedNotice}</span>}
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
          {state === "AVAILABLE" ? (
            <>
              <span className={`text-[11px] font-medium leading-tight ${ink ? "text-ink-300" : ""}`}>{c.tierAdmit}</span>
              <span className="text-base font-bold tracking-[0.06em]">{c.tierFree}</span>
              <Icon name={selected ? "check-circle" : "ticket"} size={20} className={ink ? "text-aiteb-orchid" : "opacity-80"} />
            </>
          ) : (
            <>
              <Icon name={state === "SOLD_OUT" ? "users" : "lock"} size={20} />
              <span className="text-xs font-bold leading-tight">
                {state === "SOLD_OUT" ? t.tierStatusSoldOut : t.tierStatusRegistrationClosed}
              </span>
            </>
          )}
        </div>
      </div>
    </label>
  );
}
