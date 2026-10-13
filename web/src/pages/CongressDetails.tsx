import { useParams } from "react-router-dom";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { Badge } from "../components/ui/Badge";
import { LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { CongressSignature } from "../components/brand/CongressSignature";
import { formatLocalizedNumber, useAttendeeLocale } from "../lib/i18n";
import { useCongressEvent } from "../lib/congressContext";
import { LoadingBlock, StatusPanel } from "../components/ui/PortalState";
import { PhaseBadge } from "../components/attendee/PhaseBadge";
import { SectionHeader } from "../components/attendee/SectionHeader";
import { congressDays, formatDateRange, sectionIndex } from "../components/attendee/congressTime";

/** Public congress information, read anonymously; no attendee credential is sent. */
export default function CongressDetails() {
  const { slug = "" } = useParams<{ slug: string }>();
  const localeHook = useAttendeeLocale();
  const { locale, t, isRtl } = localeHook;
  const congress = useCongressEvent(slug);

  let content;
  if (congress.status === "loading") {
    content = <LoadingBlock label={t.navCongressDetails} />;
  } else if (congress.status === "missing") {
    content = <div className="mx-auto max-w-3xl"><StatusPanel icon="search" title={isRtl ? "همایش پیدا نشد" : "Congress not found"} /></div>;
  } else if (congress.status === "error") {
    content = (
      <div className="mx-auto max-w-3xl">
        <StatusPanel tone="danger" icon="alert" title={isRtl ? "اطلاعات همایش بارگذاری نشد" : "Could not load this congress"}>
          <p>{isRtl ? "اتصال را بررسی کنید و دوباره تلاش کنید." : "Check your connection and try again."}</p>
        </StatusPanel>
      </div>
    );
  } else {
    const event = congress.event;
    const totalDays = congressDays(event.starts_at, event.ends_at);
    const facts: { icon: "calendar" | "pin" | "clock"; label: string; value: string }[] = [
      {
        icon: "calendar",
        label: isRtl ? "زمان" : "When",
        value: formatDateRange(event.starts_at, event.ends_at, locale),
      },
      { icon: "pin", label: t.venueLabel, value: event.location },
    ];
    if (totalDays !== null) {
      facts.push({
        icon: "clock",
        label: isRtl ? "مدت" : "Duration",
        value: isRtl ? `${formatLocalizedNumber(totalDays, locale)} روز` : `${totalDays} day${totalDays === 1 ? "" : "s"}`,
      });
    }

    content = (
      <>
        {/* Editorial masthead */}
        <div className="grid items-stretch gap-6 lg:grid-cols-12 lg:gap-10">
          <div className="flex flex-col justify-end gap-5 lg:col-span-7 lg:py-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="eyebrow">{t.navCongressDetails}</span>
              <PhaseBadge startsAt={event.starts_at} endsAt={event.ends_at} locale={locale} />
            </div>
            <h1 className="text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] text-text-primary text-balance sm:text-5xl">
              {event.name}
            </h1>
          </div>
          <div aria-hidden="true" className="relative h-44 overflow-hidden shape-arc-lg border border-border-default bg-surface-panel shadow-soft sm:h-56 lg:col-span-5 lg:h-auto lg:min-h-64">
            <div className="bg-meridian absolute inset-0" />
            <CongressSignature seed={event.slug} tone="light" animate className="absolute inset-0 size-full" />
          </div>
        </div>

        {/* Facts typeset in columns */}
        <dl className="grid gap-px overflow-hidden rounded-2xl border border-border-default bg-border-default sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.icon} className="space-y-2 bg-surface-panel p-5 sm:p-6">
              <dt className="flex items-center gap-2 text-xs font-medium text-text-muted">
                <Icon name={f.icon} size={16} className="text-event-accent" />
                {f.label}
              </dt>
              <dd className="text-sm font-semibold leading-relaxed text-text-primary break-words sm:text-[15px]">{f.value}</dd>
            </div>
          ))}
        </dl>

        <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-10">
          {event.description && (
            <section aria-labelledby="details-about-title" className="space-y-5 lg:col-span-7">
              <SectionHeader index={sectionIndex(1, locale)} id="details-about-title" title={isRtl ? "درباره همایش" : "About the congress"} />
              <p dir="auto" className="max-w-prose whitespace-pre-line text-base leading-8 text-text-secondary">{event.description}</p>
            </section>
          )}

          <section aria-labelledby="details-tiers-title" className={`space-y-5 ${event.description ? "lg:col-span-5" : "lg:col-span-12"}`}>
            <SectionHeader
              index={sectionIndex(event.description ? 2 : 1, locale)}
              id="details-tiers-title"
              title={isRtl ? "انواع کارت ورود" : "Pass types"}
            />
            {event.ticket_tiers.length === 0 ? (
              <p className="text-sm text-text-secondary">{isRtl ? "هنوز نوع کارتی تعریف نشده است." : "No pass types have been published yet."}</p>
            ) : (
              <ul className="divide-y divide-border-default border-b border-border-default">
                {event.ticket_tiers.map((tier) => {
                  const left = Math.max(tier.quota - (tier.reserved_count ?? 0), 0);
                  const taken = tier.quota > 0 ? Math.min(1, (tier.reserved_count ?? 0) / tier.quota) : 0;
                  return (
                    <li key={tier.id} className="space-y-3 py-4">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2.5 font-semibold text-text-primary">
                          <Icon name="ticket" size={18} className="shrink-0 text-ink-400" />
                          <span className="break-words">{tier.name}</span>
                        </span>
                        <Badge variant={!tier.is_open ? "neutral" : left === 0 ? "danger" : "success"} size="md">
                          {!tier.is_open
                            ? (isRtl ? "بسته" : "Closed")
                            : left === 0
                              ? (isRtl ? "تکمیل" : "Sold out")
                              : isRtl ? `${formatLocalizedNumber(left, locale)} جای خالی` : `${left} left`}
                        </Badge>
                      </div>
                      {tier.is_open && tier.quota > 0 && (
                        <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-surface-panel-inset">
                          <div className="h-full rounded-full bg-event-accent" style={{ inlineSize: `${Math.round(taken * 100)}%` }} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <LinkButton to={`/e/${slug}`} variant="secondary" size="lg">
              <Icon name="globe" size={18} />
              {isRtl ? "صفحه عمومی همایش" : "Public congress page"}
              <Icon name="arrow-right" size={18} />
            </LinkButton>
          </section>
        </div>
      </>
    );
  }

  return (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="details">
      <div className="mx-auto max-w-6xl space-y-10 px-4 pt-6 sm:space-y-14 sm:px-6 sm:pt-10">{content}</div>
    </AttendeeLayout>
  );
}
