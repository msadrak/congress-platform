import { useParams } from "react-router-dom";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { LinkButton } from "../components/ui/Button";
import { formatLocalizedDate, formatLocalizedNumber, useAttendeeLocale } from "../lib/i18n";
import { useCongressEvent } from "../lib/congressContext";
import { LoadingBlock, StatusPanel } from "../components/ui/PortalState";

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
    content = <StatusPanel icon="🔍" title={isRtl ? "همایش پیدا نشد" : "Congress not found"} />;
  } else if (congress.status === "error") {
    content = (
      <StatusPanel tone="danger" icon="⚠️" title={isRtl ? "اطلاعات همایش بارگذاری نشد" : "Could not load this congress"}>
        <p>{isRtl ? "اتصال را بررسی کنید و دوباره تلاش کنید." : "Check your connection and try again."}</p>
      </StatusPanel>
    );
  } else {
    const event = congress.event;
    content = (
      <>
        <Card className="p-6 sm:p-8 border-border-default space-y-4">
          <Badge variant="brand" size="sm">{t.navCongressDetails}</Badge>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-primary">{event.name}</h1>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-text-muted">{isRtl ? "زمان" : "When"}</dt>
              <dd className="text-text-primary font-semibold">
                {formatLocalizedDate(event.starts_at, locale)} — {formatLocalizedDate(event.ends_at, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">{t.venueLabel}</dt>
              <dd className="text-text-primary font-semibold">{event.location}</dd>
            </div>
          </dl>
          {event.description && (
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">{event.description}</p>
          )}
        </Card>

        <Card className="p-6 border-border-default space-y-3">
          <h2 className="text-sm font-bold text-text-primary">{isRtl ? "انواع کارت ورود" : "Pass types"}</h2>
          {event.ticket_tiers.length === 0 ? (
            <p className="text-sm text-text-secondary">{isRtl ? "هنوز نوع کارتی تعریف نشده است." : "No pass types have been published yet."}</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {event.ticket_tiers.map((tier) => {
                const left = Math.max(tier.quota - (tier.reserved_count ?? 0), 0);
                return (
                  <li key={tier.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-text-primary">{tier.name}</span>
                    <Badge variant={!tier.is_open ? "neutral" : left === 0 ? "danger" : "success"} size="sm">
                      {!tier.is_open
                        ? (isRtl ? "بسته" : "Closed")
                        : left === 0
                          ? (isRtl ? "تکمیل" : "Sold out")
                          : isRtl ? `${formatLocalizedNumber(left, locale)} جای خالی` : `${left} left`}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
          <LinkButton to={`/e/${slug}`} variant="secondary" size="md">
            {isRtl ? "صفحه عمومی همایش" : "Public congress page"} →
          </LinkButton>
        </Card>
      </>
    );
  }

  return (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="details">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">{content}</div>
    </AttendeeLayout>
  );
}
