import type { LeadOut } from "../../api/client";
import { formatMobile, telHref } from "../../lib/mobile";
import { codeFontClass } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { RatingChip } from "./RatingControl";
import { RATING_META, asRating, initialsOf } from "./rating";

/** Rating-tinted monogram; decorative, the name is always printed beside it. */
export function LeadMonogram({ name, rating, size = "md" }: { name: string; rating: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={`${RATING_META[asRating(rating)].tone} grid shrink-0 place-items-center rounded-full bg-[var(--rating-bg)] font-bold text-[var(--rating-fg)] shadow-[inset_0_0_0_1px_var(--rating-border)] ${
        size === "lg" ? "size-14 text-lg" : "size-11 text-sm"
      }`}
    >
      {initialsOf(name)}
    </span>
  );
}

export interface LeadCardLabels {
  captured: string;
  tier: string;
  mobile: string;
  call: string;
  text: string;
  notes: string;
  qualify: string;
  contactShared: string;
  contactNotShared: string;
  contactNotSharedHint: string;
  delete: string;
  deleteOf: (name: string) => string;
  restore: string;
  restoreOf: (name: string) => string;
  deletedAt: string;
}

interface LeadCardProps {
  lead: LeadOut;
  locale: "fa" | "en";
  capturedAt: string;
  /** Set for a lead in the trash: the card offers Restore instead of Qualify and Delete. */
  deletedAt?: string;
  labels: LeadCardLabels;
  onQualify?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  /** Its delete or restore request is in flight. */
  busy?: boolean;
}

export function LeadCard({ lead, locale, capturedAt, deletedAt, labels, onQualify, onDelete, onRestore, busy = false }: LeadCardProps) {
  const tone = RATING_META[asRating(lead.rating)].tone;
  const role = [lead.title, lead.organization].filter(Boolean).join(" · ");
  return (
    <article
      aria-labelledby={`lead-name-${lead.id}`}
      className={`booth-lead ${tone} relative overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft transition-[border-color,box-shadow] duration-200 hover:border-border-strong hover:shadow-lift ${deletedAt ? "opacity-90" : ""}`}
    >
      <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[3px] bg-[var(--rating-solid)]" />
      <div className="flex flex-col gap-4 p-4 ps-5 sm:p-5 sm:ps-6">
        <div className="flex items-start gap-3">
          <LeadMonogram name={lead.attendee_name} rating={lead.rating} />
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 id={`lead-name-${lead.id}`} className="text-base font-bold leading-snug tracking-[-0.01em] text-text-primary break-words sm:text-[17px]">
              {lead.attendee_name}
            </h3>
            {role && <p className="mt-0.5 text-[13px] leading-snug text-text-secondary break-words">{role}</p>}
          </div>
          <RatingChip rating={lead.rating} locale={locale} size="sm" />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border-subtle pt-3 sm:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <dt className="booth-meta-label">{labels.mobile}</dt>
            <dd className="mt-1">
              {lead.attendee_mobile ? (
                <>
                  <span className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
                    <a
                      href={telHref(lead.attendee_mobile)}
                      aria-label={`${labels.call} ${lead.attendee_name}`}
                      className="inline-flex min-h-[44px] max-w-full items-center gap-1.5 rounded-sm px-1 text-[13px] font-medium text-action-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      <Icon name="phone" size={15} className="shrink-0" />
                      <bdi dir="ltr" className={`min-w-0 break-all ${codeFontClass(formatMobile(lead.attendee_mobile, locale))} text-[12.5px]`}>{formatMobile(lead.attendee_mobile, locale)}</bdi>
                    </a>
                    <a
                      href={telHref(lead.attendee_mobile, "sms")}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-sm px-1 text-[12.5px] font-medium text-text-secondary hover:text-action-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      <Icon name="mail" size={14} className="shrink-0" />
                      {labels.text}
                    </a>
                  </span>
                  <span data-testid="lead-consent" className="flex items-center gap-1 px-1 text-[11.5px] font-medium text-status-success-text">
                    <Icon name="check-circle" size={13} className="shrink-0" />
                    <span>{labels.contactShared}</span>
                  </span>
                </>
              ) : (
                // The API sends a mobile only with the attendee's consent; say so rather than show a bare dash.
                <span data-testid="lead-consent" title={labels.contactNotSharedHint} className="flex min-h-[44px] items-center gap-1.5 text-[13px] text-text-muted">
                  <Icon name="eye-off" size={15} className="shrink-0" />
                  <span>{labels.contactNotShared}</span>
                  <span className="sr-only">{labels.contactNotSharedHint}</span>
                </span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="booth-meta-label">{deletedAt ? labels.deletedAt : labels.captured}</dt>
            <dd className="mt-1 text-[13px] text-text-primary">{deletedAt ?? capturedAt}</dd>
          </div>
          <div className="min-w-0">
            <dt className="booth-meta-label">{labels.tier}</dt>
            <dd className="mt-1 text-[13px] text-text-primary break-words">{lead.ticket_tier_name}</dd>
          </div>
        </dl>

        {lead.notes && (
          <div className="booth-note rounded-xl px-3.5 py-3 text-[13px] leading-relaxed text-text-secondary">
            <p className="booth-meta-label mb-1 flex items-center gap-1.5">
              <Icon name="note" size={13} />
              <span>{labels.notes}</span>
            </p>
            <p className="whitespace-pre-line break-words">{lead.notes}</p>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          {lead.tags && lead.tags.length > 0 ? (
            <ul className="flex min-w-0 flex-wrap gap-1.5">
              {lead.tags.map((tag) => (
                <li key={tag} className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-panel-subtle px-2 py-1 text-[12px] font-medium text-text-secondary">
                  <Icon name="tag" size={12} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 truncate">{tag}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex w-full shrink-0 gap-2 sm:w-auto">
            {deletedAt ? (
              onRestore && (
                <Button type="button" variant="secondary" size="md" disabled={busy} aria-busy={busy} onClick={onRestore} aria-label={labels.restoreOf(lead.attendee_name)} className="flex-1 sm:flex-none">
                  <Icon name="sync" size={16} />
                  <span>{labels.restore}</span>
                </Button>
              )
            ) : (
              <>
                {onDelete && (
                  <Button type="button" variant="ghost" size="md" disabled={busy} aria-busy={busy} onClick={onDelete} aria-label={labels.deleteOf(lead.attendee_name)} className="shrink-0 text-status-danger-text hover:text-status-danger-text">
                    <Icon name="trash" size={16} />
                    <span className="max-[359px]:sr-only">{labels.delete}</span>
                  </Button>
                )}
                {onQualify && (
                  <Button type="button" variant="secondary" size="md" onClick={onQualify} className="min-w-0 flex-1 sm:flex-none">
                    <Icon name="sliders" size={16} />
                    <span>{labels.qualify}</span>
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
