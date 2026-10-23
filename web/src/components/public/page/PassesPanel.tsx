import { Link } from "react-router-dom";
import type { TicketTierOut } from "../../../api/client";
import type { AccentChoice } from "../../../lib/pageDocument";
import { Button, LinkButton } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { Bidi } from "../Bidi";
import { num, publicCopy, type PublicLocale } from "../copy";
import { formatMoment } from "../format";
import { PassStub } from "../PassStub";
import { useNow } from "../../attendee/useNow";
import { tierAvailability, type RegistrationFields } from "../../../lib/registrationWindow";

/** No window fields: nothing restricts the tiers beyond their own switch and quota (Page Studio preview). */
const UNRESTRICTED: RegistrationFields = { ends_at: "" };

interface PassesPanelProps {
  slug: string;
  tiers: TicketTierOut[];
  locale: PublicLocale;
  /** Kept for the callers; the dock no longer draws the congress artwork. */
  accent?: AccentChoice;
  selectedTierId: string | null;
  onSelectTier: (id: string) => void;
  onReserve: () => void;
  submitting?: boolean;
  /** The attendee holds a pass for this congress (found on load, reserved now, or refused as a duplicate). */
  alreadyHasTicket?: boolean;
  /** Signed in: the "already registered?" link is left out (a held pass is found on its own). */
  signedIn?: boolean;
  /** Why the last reservation failed, shown above the dock until the attendee retries. */
  error?: string | null;
  /** Set in the Page Studio preview: the dock is shown but cannot reserve. */
  disabledNote?: string;
  /** The congress's registration window (switch, opening/closing instants, end of the congress). */
  registration?: RegistrationFields;
  /** The congress's zone, for "opens at" / "closes at" times. */
  timeZone?: string;
  /** The page's ticking clock (ms). */
  now?: number;
}

const dock = "flex min-h-[72px] items-center gap-3 rounded-card bg-surface-ink py-3 ps-4 pe-3 text-white shadow-soft surface-ink sm:gap-5 sm:ps-5";

/**
 * Live pass types (operational data, never page content) with the reservation dock. Once the attendee holds a
 * pass for this congress, only the dock remains and it opens that pass.
 */
export function PassesPanel({
  slug,
  tiers,
  locale,
  selectedTierId,
  onSelectTier,
  onReserve,
  submitting = false,
  alreadyHasTicket = false,
  signedIn = false,
  error = null,
  disabledNote,
  registration = UNRESTRICTED,
  timeZone,
  now: givenNow,
}: PassesPanelProps) {
  const tick = useNow();
  const now = givenNow ?? tick;
  const c = publicCopy[locale];
  const passPath = `/c/${encodeURIComponent(slug)}/my-ticket`;

  if (alreadyHasTicket) {
    return (
      <div className={dock} data-testid="passes-held">
        <p className="min-w-0 flex-1 text-body-sm font-semibold leading-snug sm:text-body">{c.passReady}</p>
        <LinkButton to={passPath} variant="primary" tone="ink" icon="qr" className="shrink-0">
          {c.viewMyPass}
        </LinkButton>
      </div>
    );
  }

  const selectedTier = tiers.find((tier) => tier.id === selectedTierId) ?? tiers[0] ?? null;
  const availability = selectedTier ? tierAvailability(registration, selectedTier, now) : ({ kind: "closed", reason: "tier" } as const);
  const available = availability.kind === "open";
  const remaining = selectedTier ? Math.max(0, selectedTier.quota - (selectedTier.reserved_count ?? 0)) : 0;
  const reserveLabel = submitting
    ? c.processing
    : availability.kind === "full"
      ? c.tierStatusSoldOut
      : availability.kind === "opens"
        ? c.dockOpens(formatMoment(availability.at, locale, timeZone))
        : availability.kind === "closed"
          ? availability.reason === "sales"
            ? c.tierStatusSalesEnded
            : c.tierStatusClosed
          : c.reserve;
  const closesAt = availability.kind === "open" ? availability.closesAt : null;

  return (
    <div className="space-y-4">
      {tiers.length > 0 && (
        <fieldset className="grid gap-5 md:grid-cols-2">
          <legend className="sr-only">{c.sectionPasses}</legend>
          {tiers.map((tier) => (
            <PassStub
              key={tier.id}
              tier={tier}
              locale={locale}
              selected={tier.id === selectedTier?.id}
              onSelect={() => onSelectTier(tier.id)}
              availability={tierAvailability(registration, tier, now)}
              timeZone={timeZone}
            />
          ))}
        </fieldset>
      )}

      {error && (
        <Notice tone="danger">{error}</Notice>
      )}

      <div>
        <div className={dock}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-semibold sm:text-body">{selectedTier ? <Bidi text={selectedTier.name} /> : c.noTiersTitle}</p>
            {selectedTier && available && (
              <p className="truncate text-caption text-ink-300">
                {c.capacityRemaining} <span className="tabular text-white">{num(remaining, locale)}</span>
              </p>
            )}
            {closesAt && (
              <p data-testid="registration-closes" className="truncate text-caption text-ink-300">
                {c.dockCloses(formatMoment(closesAt, locale, timeZone))}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="primary"
            tone="ink"
            className="shrink-0 sm:min-w-[13rem]"
            disabled={tiers.length === 0 || !available || Boolean(disabledNote)}
            loading={submitting}
            iconEnd={!submitting && available ? "arrow-right" : undefined}
            title={disabledNote}
            onClick={onReserve}
          >
            {reserveLabel}
          </Button>
        </div>
        {disabledNote && <p className="mt-2 text-center text-caption font-medium text-text-muted">{disabledNote}</p>}
      </div>

      {!signedIn && (
        <p className="text-center text-body-sm text-text-muted">
          {c.alreadyRegistered}{" "}
          <Link to={passPath} className="inline-flex min-h-11 items-center font-semibold text-event-accent hover:underline">
            {c.viewExisting}
          </Link>
        </p>
      )}
    </div>
  );
}
