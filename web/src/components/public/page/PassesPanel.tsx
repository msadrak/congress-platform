import { Link } from "react-router-dom";
import type { TicketTierOut } from "../../../api/client";
import { translations } from "../../../lib/i18n";
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
  const t = translations[locale];
  const selectedTier = tiers.find((tier) => tier.id === selectedTierId) ?? tiers[0] ?? null;
  const state = selectedTier ? tierState(selectedTier) : "CLOSED";
  const available = state === "AVAILABLE";
  const remaining = selectedTier ? Math.max(0, selectedTier.quota - (selectedTier.reserved_count ?? 0)) : 0;
  const reserveLabel = submitting
    ? c.processing
    : state === "SOLD_OUT"
      ? t.reserveButtonSoldOut
      : state === "CLOSED"
        ? t.reserveButtonClosed
        : c.reserve;

  return (
    <div className="space-y-6">
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
        <div
          role="alert"
          className="flex flex-col gap-4 rounded-2xl border border-action-subtle-border bg-aiteb-lavender p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-panel text-aiteb-indigo shadow-soft">
              <Icon name="ticket" size={20} />
            </span>
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-aiteb-indigo">{c.activePassTitle}</p>
              <p className="text-sm text-text-secondary">{c.activePassBody}</p>
            </div>
          </div>
          <LinkButton to={`/c/${slug}/my-ticket`} variant="primary" size="md">
            {c.viewMyPass}
            <Icon name="arrow-right" size={16} />
          </LinkButton>
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

      {/* Reservation dock: sticks to the viewport bottom while the passes are on screen. */}
      <div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 lg:static">
        <div className="flex flex-col gap-4 bg-surface-ink p-4 text-white shadow-pop shape-arc sm:flex-row sm:items-center sm:gap-6 sm:p-5">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span aria-hidden="true" className="relative hidden size-12 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/15 [border-start-end-radius:20px] sm:block">
              <CongressSignature seed={slug} accent={accent} tone="ink" className="absolute inset-0 size-full scale-150" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-ink-300">{c.selectedPass}</p>
              <p className="truncate text-base font-semibold">{selectedTier ? <Bidi text={selectedTier.name} /> : c.noTiersTitle}</p>
              {selectedTier && available && (
                <p className="text-xs text-ink-300">
                  {c.freeAdmission} · {t.tierCapacityRemaining} <span className="tabular text-white">{num(remaining, locale)}</span>
                </p>
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="light"
            size="lg"
            className="w-full sm:w-auto sm:min-w-[14rem]"
            disabled={submitting || tiers.length === 0 || !available || Boolean(disabledNote)}
            aria-busy={submitting}
            title={disabledNote}
            onClick={onReserve}
          >
            {reserveLabel}
            {!submitting && available && <Icon name="arrow-right" size={18} />}
          </Button>
        </div>
        {disabledNote && <p className="mt-2 text-center text-xs font-medium text-text-muted">{disabledNote}</p>}
      </div>

      <div className="flex flex-col items-center gap-1.5 text-center text-sm text-text-muted lg:flex-row lg:justify-center lg:gap-3">
        <span className="inline-flex items-center gap-2">
          <Icon name="device" size={16} />
          {c.digitalNote}
        </span>
        <span aria-hidden="true" className="hidden lg:inline">
          ·
        </span>
        <span>
          {c.alreadyRegistered}{" "}
          <Link to="/my-tickets" className="font-semibold text-event-accent hover:underline">
            {c.viewExisting}
          </Link>
        </span>
      </div>
    </div>
  );
}
