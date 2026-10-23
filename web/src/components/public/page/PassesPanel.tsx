import { Link } from "react-router-dom";
import type { TicketTierOut } from "../../../api/client";
import type { AccentChoice } from "../../../lib/pageDocument";
import { CongressSignature } from "../../brand/CongressSignature";
import { Button, LinkButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Bidi } from "../Bidi";
import { num, publicCopy, type PublicLocale } from "../copy";
import { tierState } from "../format";
import { PassStub } from "../PassStub";

interface PassesPanelProps {
  slug: string;
  tiers: TicketTierOut[];
  locale: PublicLocale;
  accent: AccentChoice;
  selectedTierId: string | null;
  onSelectTier: (id: string) => void;
  onReserve: () => void;
  submitting?: boolean;
  /** The attendee holds a pass for this congress (found on load, reserved now, or refused as a duplicate). */
  alreadyHasTicket?: boolean;
  /** Why the last reservation failed, shown above the dock until the attendee retries. */
  error?: string | null;
  /** Set in the Page Studio preview: the dock is shown but cannot reserve. */
  disabledNote?: string;
}

/** Live ticket tiers (operational data, never page content) with the reservation dock. */
export function PassesPanel({
  slug,
  tiers,
  locale,
  accent,
  selectedTierId,
  onSelectTier,
  onReserve,
  submitting = false,
  alreadyHasTicket = false,
  error = null,
  disabledNote,
}: PassesPanelProps) {
  const c = publicCopy[locale];
  const passPath = `/c/${encodeURIComponent(slug)}/my-ticket`;
  const selectedTier = tiers.find((tier) => tier.id === selectedTierId) ?? tiers[0] ?? null;
  const state = selectedTier ? tierState(selectedTier) : "CLOSED";
  const available = state === "AVAILABLE";
  const remaining = selectedTier ? Math.max(0, selectedTier.quota - (selectedTier.reserved_count ?? 0)) : 0;
  const reserveLabel = submitting
    ? c.processing
    : state === "SOLD_OUT"
      ? c.tierStatusSoldOut
      : state === "CLOSED"
        ? c.tierStatusClosed
        : c.reserve;

  return (
    <div className="space-y-4">
      {tiers.length === 0 ? (
        <div className="flex items-start gap-4 rounded-2xl border border-dashed border-border-strong bg-surface-panel p-6 sm:p-8">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-panel-subtle text-text-muted">
            <Icon name="lock" size={22} />
          </span>
          <div className="space-y-1">
            <p className="text-base font-semibold text-text-primary">{c.noTiersTitle}</p>
            <p className="text-sm text-text-secondary">{c.noTiersBody}</p>
          </div>
        </div>
      ) : (
        <fieldset className="grid gap-5 md:grid-cols-2">
          <legend className="sr-only">{c.tierLegend}</legend>
          {tiers.map((tier, i) => (
            <PassStub key={tier.id} tier={tier} index={i} locale={locale} selected={tier.id === selectedTier?.id} onSelect={() => onSelectTier(tier.id)} />
          ))}
        </fieldset>
      )}

      {alreadyHasTicket && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-action-subtle-border bg-aiteb-lavender p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-panel text-aiteb-indigo shadow-soft">
            <Icon name="ticket" size={20} />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-aiteb-indigo">{c.activePassTitle}</p>
            <p className="text-sm text-text-secondary">{c.activePassBody}</p>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-sm leading-relaxed text-status-danger-text"
        >
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Reservation dock: one compact row right after the passes (never floating over them). Once the
          attendee holds a pass for this congress it opens that pass instead. */}
      <div>
        <div className="flex min-h-[72px] items-center gap-3 bg-surface-ink py-3 ps-4 pe-3 text-white shadow-pop shape-arc sm:gap-5 sm:ps-5">
          <span aria-hidden="true" className="relative hidden size-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/15 [border-start-end-radius:18px] sm:block">
            <CongressSignature seed={slug} accent={accent} tone="ink" className="absolute inset-0 size-full scale-150" />
          </span>
          {alreadyHasTicket ? (
            <>
              <p className="min-w-0 flex-1 text-sm font-semibold leading-snug sm:text-[15px]">{c.passReady}</p>
              <LinkButton to={passPath} variant="light" size="md" className="shrink-0">
                <Icon name="qr" size={18} />
                {c.viewMyPass}
              </LinkButton>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-ink-300 max-sm:sr-only">{c.selectedPass}</p>
                <p className="truncate text-[15px] font-semibold">{selectedTier ? <Bidi text={selectedTier.name} /> : c.noTiersTitle}</p>
                {selectedTier && available && (
                  <p className="truncate text-xs text-ink-300">
                    {c.freeAdmission} · <span className="max-sm:sr-only">{c.capacityRemaining} </span>
                    <span className="tabular text-white">{num(remaining, locale)}</span>
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="light"
                size="md"
                className="shrink-0 sm:min-w-[13rem]"
                disabled={submitting || tiers.length === 0 || !available || Boolean(disabledNote)}
                aria-busy={submitting}
                title={disabledNote}
                onClick={onReserve}
              >
                {reserveLabel}
                {!submitting && available && <Icon name="arrow-right" size={18} className="max-sm:hidden" />}
              </Button>
            </>
          )}
        </div>
        {disabledNote && <p className="mt-2 text-center text-xs font-medium text-text-muted">{disabledNote}</p>}
      </div>

      <div className="flex flex-col items-center gap-1.5 text-center text-sm text-text-muted lg:flex-row lg:justify-center lg:gap-3">
        <span className="inline-flex items-center gap-2">
          <Icon name="device" size={16} />
          {c.digitalNote}
        </span>
        {!alreadyHasTicket && (
          <>
            <span aria-hidden="true" className="hidden lg:inline">
              ·
            </span>
            <span>
              {c.alreadyRegistered}{" "}
              <Link to={passPath} className="inline-flex min-h-11 items-center font-semibold text-event-accent hover:underline lg:min-h-0">
                {c.viewExisting}
              </Link>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
