import type { LeadOut } from "../../api/client";
import { boothCopy } from "../../copy/booth";
import { codeFontClass } from "../../lib/format";
import { formatMobile, telHref } from "../../lib/mobile";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { RatingChip } from "./RatingControl";
import { leadWhen } from "./leadTime";
import { RATING_META, asRating } from "./rating";

interface LeadCardProps {
  lead: LeadOut;
  locale: "fa" | "en";
  /** Opens qualification when tapping the card; absent in the trash and when the congress is archived. */
  onQualify?: () => void;
  onDelete?: () => void;
  /** Set for a lead in the trash: the card offers Restore instead of Delete. */
  onRestore?: () => void;
  /** Delete and restore cannot work now (no connection, archived). */
  actionsDisabled?: boolean;
  /** Its delete or restore request is in flight. */
  busy?: boolean;
}

/**
 * One lead: name, role, rating, when it was captured, tags and the note. Tapping the card opens qualification;
 * the trash button and the phone links sit above that tap area.
 */
export function LeadCard({ lead, locale, onQualify, onDelete, onRestore, actionsDisabled = false, busy = false }: LeadCardProps) {
  const text = boothCopy[locale];
  const tone = RATING_META[asRating(lead.rating)].tone;
  const role = [lead.title, lead.organization].filter(Boolean).join(" · ");
  const when = lead.deleted_at ? text.deletedOn(leadWhen(lead.deleted_at, locale)) : leadWhen(lead.created_at, locale);
  const rawMobile = lead.attendee_mobile;
  const mobile = rawMobile ? formatMobile(rawMobile, locale) : null;

  return (
    <article
      aria-labelledby={`lead-name-${lead.id}`}
      className={`booth-lead ${tone} relative flex flex-col gap-2 rounded-card border border-border-default bg-surface-panel p-4 ps-5 transition-colors ${
        onQualify ? "hover:border-border-strong" : ""
      }`}
    >
      <span aria-hidden="true" className="absolute inset-y-3 start-0 w-1 rounded-e-full bg-[var(--rating-solid)]" />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={`lead-name-${lead.id}`} className="text-body font-bold leading-snug text-text-primary break-words">
            {onQualify ? (
              // The whole card is this button's tap area (after:inset-0); the other controls sit above it.
              <button
                type="button"
                onClick={onQualify}
                className="text-start cursor-pointer after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring"
              >
                <bdi>{lead.attendee_name}</bdi>
              </button>
            ) : (
              <bdi>{lead.attendee_name}</bdi>
            )}
          </h3>
          {role && (
            <p className="mt-0.5 text-body-sm leading-snug text-text-secondary break-words">
              <bdi>{role}</bdi>
            </p>
          )}
        </div>
        <RatingChip rating={lead.rating} locale={locale} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="clock" size={14} />
          <span data-testid="lead-time">{when}</span>
        </span>
        {rawMobile && mobile ? (
          <span className="relative z-10 inline-flex items-center gap-1">
            <a
              href={telHref(rawMobile)}
              aria-label={text.callOf(lead.attendee_name)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-sm px-1 font-medium text-action-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <Icon name="phone" size={15} />
              <bdi dir="ltr" className={codeFontClass(mobile)}>
                {mobile}
              </bdi>
            </a>
            <a
              href={telHref(rawMobile, "sms")}
              className="inline-flex min-h-11 items-center gap-1 rounded-sm px-1 font-medium text-text-secondary hover:text-action-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <Icon name="mail" size={14} />
              {text.textMessage}
            </a>
          </span>
        ) : (
          <span data-testid="lead-number-hidden" className="inline-flex min-h-11 items-center gap-1.5">
            <Icon name="eye-off" size={14} />
            <span>{text.numberHidden}</span>
          </span>
        )}
      </div>

      {lead.notes && <p dir="auto" className="line-clamp-2 text-body-sm leading-relaxed whitespace-pre-line text-text-secondary break-words">{lead.notes}</p>}

      {((lead.tags && lead.tags.length > 0) || onDelete || onRestore) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <ul className="flex min-w-0 flex-wrap gap-1.5">
            {(lead.tags ?? []).map((tag) => (
              <li key={tag} className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-panel-subtle px-2 py-1 text-caption font-medium text-text-secondary">
                <Icon name="tag" size={12} className="text-text-muted" />
                <span className="min-w-0 truncate">{tag}</span>
              </li>
            ))}
          </ul>
          {onRestore ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon="sync"
              loading={busy}
              disabled={actionsDisabled}
              onClick={onRestore}
              aria-label={text.restoreLeadOf(lead.attendee_name)}
              className="relative z-10 shrink-0"
            >
              {text.restore}
            </Button>
          ) : (
            onDelete && (
              <IconButton
                icon="trash"
                label={text.deleteLeadOf(lead.attendee_name)}
                disabled={busy || actionsDisabled}
                aria-busy={busy || undefined}
                onClick={onDelete}
                className="relative z-10 -me-2 -mb-2 shrink-0 text-status-danger-text"
              />
            )
          )}
        </div>
      )}
    </article>
  );
}
