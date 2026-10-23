import { useState } from "react";
import { Link } from "react-router-dom";
import type { EventOut } from "../../api/client";
import { formatLocalizedDate, formatLocalizedNumber } from "../../lib/i18n";
import { eventSectionNumber, eventTimeStatus, eventWorkspacePath } from "../../lib/organizerWorkspace";
import { Badge } from "../../components/ui/Badge";
import { Button, LinkButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { CongressSignature } from "../../components/brand/CongressSignature";
import { EventStatusBadge, FormAlert, Meter, SectionIndex } from "../../components/organizer/WorkspaceUi";
import { EventEditDialog } from "../../components/organizer/EventEditDialog";
import { eventTiming } from "../../components/organizer/eventTiming";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import {
  loadBooths,
  loadCheckInPoints,
  loadDeskOperators,
  loadSessions,
  loadTicketTiers,
  loadVenuePlaces,
  sectionLoad,
  useEventList,
} from "./eventLists";

/** `/organizer/events/:eventId`: the congress at a glance, with a count and a link for every section. */
export default function EventOverview() {
  const { event, error, apiKey, onKeyRejected, replaceEvent, locale, t, isRtl } = useEventWorkspace();
  const tiers = useEventList(loadTicketTiers);
  const points = useEventList(loadCheckInPoints);
  const booths = useEventList(loadBooths);
  const operators = useEventList(loadDeskOperators);
  // Counts only: the program and venue pages hold their lists.
  const sessions = useEventList(loadSessions);
  const places = useEventList(loadVenuePlaces);
  const lists = sectionLoad([tiers, points, booths, operators, sessions, places]);
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [editingEvent, setEditingEvent] = useState<EventOut | null>(null);
  // Fixed at mount so the derived event status never flickers between renders.
  const [now] = useState(() => Date.now());

  if (!event || error || !lists.loaded) return <EventSectionGate listsLoaded={lists.loaded} />;

  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const status = eventTimeStatus(event.starts_at, event.ends_at, now);
  const totalReserved = tiers.items.reduce((n, x) => n + x.reserved_count, 0);
  const totalQuota = tiers.items.reduce((n, x) => n + x.quota, 0);
  const capacityPct = totalQuota > 0 ? Math.min(100, Math.round((totalReserved / totalQuota) * 100)) : 0;
  const activeOperators = operators.items.filter((o) => !o.is_revoked).length;

  return (
    <div className="space-y-8 sm:space-y-10">
      {/* The congress hero */}
      <section aria-labelledby="event-hero-title" className="org-ink relative isolate overflow-hidden shape-arc-lg bg-surface-ink text-white shadow-lift">
        <CongressSignature seed={event.slug} tone="ink" animate className="absolute inset-0 -z-10 h-full w-full" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-surface-ink via-surface-ink/90 to-surface-ink/0 rtl:bg-gradient-to-l" />
        <div className="px-5 py-7 sm:px-10 sm:py-10 lg:px-12 lg:py-12">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-300">
            <span className="flex items-center gap-2.5 font-semibold">
              <SectionIndex n={1} className="text-aiteb-orchid" />
              {t.tabOverview}
            </span>
            <span aria-hidden="true" className="h-3 w-px bg-white/20" />
            <EventStatusBadge status={status} isRtl={isRtl} />
            <span>{eventTiming(event.starts_at, event.ends_at, now, locale)}</span>
          </div>
          <h1
            id="event-hero-title"
            className="mt-5 max-w-3xl font-display text-[2rem] font-[680] leading-[1.08] tracking-[-0.035em] [overflow-wrap:anywhere] sm:text-[2.75rem] lg:text-[3.25rem]"
          >
            <bdi>{event.name}</bdi>
          </h1>
          {event.description && (
            <p className="mt-4 line-clamp-3 max-w-2xl text-sm leading-relaxed text-ink-200 sm:text-base">
              <bdi>{event.description}</bdi>
            </p>
          )}
          <dl className="mt-8 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-6 lg:grid-cols-4">
            {([
              [isRtl ? "آغاز" : "Starts", formatLocalizedDate(event.starts_at, locale)],
              [isRtl ? "پایان" : "Ends", formatLocalizedDate(event.ends_at, locale)],
              [isRtl ? "محل برگزاری" : "Venue", event.location],
            ] as const).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[0.6875rem] font-semibold text-ink-400">{label}</dt>
                <dd className="mt-1 break-words text-sm text-white">
                  <bdi>{value}</bdi>
                </dd>
              </div>
            ))}
            <div className="min-w-0">
              <dt className="text-[0.6875rem] font-semibold text-ink-400">{isRtl ? "نشانی عمومی" : "Public URL"}</dt>
              <dd className="mt-1 break-all font-mono text-[0.8125rem] text-aiteb-orchid">
                <bdi dir="ltr">/e/{event.slug}</bdi>
              </dd>
            </div>
          </dl>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Button onClick={() => setEditingEvent(event)} variant="light" size="md">
              <Icon name="note" size={18} />
              <span>{t.editEventAction || (isRtl ? "ویرایش همایش" : "Edit Event")}</span>
            </Button>
            <a
              href={`/e/${encodeURIComponent(event.slug)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] px-4 text-sm font-semibold text-white ring-1 ring-white/20 transition-colors hover:bg-white/[0.08]"
            >
              {t.openPublicPageAction}
              <Icon name="arrow-up-right" size={18} />
            </a>
          </div>
        </div>
      </section>

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
      <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />

      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border-default bg-border-default shadow-soft lg:grid-cols-3">
          {([
            ["program", t.tabProgram, sessions.items.length, isRtl ? "جلسه در برنامه" : "Program sessions", "calendar"],
            ["venue", t.tabVenue, places.items.length, isRtl ? "سالن و ورودی" : "Halls & entrances", "pin"],
            ["tiers", t.tabTiers, tiers.items.length, isRtl ? "رده بلیط" : "Ticket tiers", "ticket"],
            ["check-in", t.tabPoints, points.items.length, isRtl ? "ایستگاه اسکن بارکد" : "Scanner stations", "gate"],
            ["booths", t.tabBooths, booths.items.length, isRtl ? "غرفه ثبت‌شده" : "Registered booths", "booth"],
            ["operators", t.tabOperators, activeOperators, isRtl ? "اپراتور فعال" : "Active operators", "users"],
          ] as const).map(([key, label, count, caption, icon]) => (
            <Link
              key={key}
              to={eventWorkspacePath(event.id, `/${key}`)}
              className="group relative flex min-w-0 flex-col gap-4 bg-surface-panel p-4 transition-colors hover:bg-aiteb-lavender/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring sm:p-6"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-2">
                  <SectionIndex n={eventSectionNumber(key)} />
                  <span className="text-xs font-semibold leading-snug text-text-muted">{label}</span>
                </span>
                <Icon name={icon} size={18} className="shrink-0 text-aiteb-indigo/60" />
              </span>
              <span className="org-kpi-value text-[2.25rem] text-text-primary sm:text-[2.75rem]">{fmt(count)}</span>
              <span className="flex items-center justify-between gap-2 text-xs text-text-secondary">
                <span className="leading-snug">{caption}</span>
                <Icon
                  name="arrow-right"
                  size={16}
                  className="shrink-0 text-aiteb-indigo opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </span>
            </Link>
          ))}
        </div>

        {tiers.error ? (
          <FormAlert>{t.sectionLoadFailed}</FormAlert>
        ) : tiers.items.length === 0 ? (
          <section
            aria-labelledby="capacity-title"
            className="flex flex-col gap-4 rounded-2xl border border-dashed border-border-strong bg-surface-panel p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7"
          >
            <div className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-status-warning-bg text-status-warning-text">
                <Icon name="ticket" size={22} />
              </span>
              <div className="space-y-1">
                <h2 id="capacity-title" className="text-base font-bold text-text-primary">
                  {isRtl ? "ظرفیت و رزرو بلیط" : "Ticket capacity & reservations"}
                </h2>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {isRtl
                    ? "هنوز رده بلیطی تعریف نشده است؛ بدون رده بلیط، شرکت‌کنندگان نمی‌توانند ثبت‌نام کنند."
                    : "No ticket tier is defined yet; attendees cannot reserve a pass until you add one."}
                </p>
              </div>
            </div>
            <LinkButton to={eventWorkspacePath(event.id, "/tiers")} variant="secondary" size="sm" className="shrink-0 self-start sm:self-center">
              {t.tabTiers}
              <Icon name="arrow-right" size={16} />
            </LinkButton>
          </section>
        ) : (
          <section
            aria-labelledby="capacity-title"
            className="grid overflow-clip rounded-2xl border border-border-default bg-surface-panel shadow-soft lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
          >
            <div className="flex flex-col gap-6 border-b border-border-subtle bg-meridian p-5 sm:p-7 lg:border-b-0 lg:border-e">
              <div className="flex items-center justify-between gap-3">
                <h2 id="capacity-title" className="text-base font-bold tracking-tight text-text-primary">
                  {isRtl ? "ظرفیت و رزرو بلیط" : "Ticket capacity & reservations"}
                </h2>
                <Icon name="ticket" size={20} className="text-aiteb-indigo/60" />
              </div>
              <p className="text-sm text-text-secondary">
                <span className="block">
                  <span className="org-kpi-value text-[3.25rem] text-text-primary sm:text-[4rem]">{fmt(totalReserved)}</span>
                  <span className="org-kpi-value text-2xl text-text-muted sm:text-[1.75rem]">
                    {" / "}
                    {fmt(totalQuota)}
                  </span>
                </span>
                <span className="mt-2.5 block">{isRtl ? "بلیط رزروشده از کل ظرفیت" : "passes reserved of total quota"}</span>
              </p>
              <div className="mt-auto space-y-2.5">
                <Meter value={capacityPct} label={isRtl ? "ظرفیت کل" : "Total capacity"} size="lg" tone={capacityPct >= 100 ? "full" : "default"} />
                <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
                  <span className="tabular">
                    {fmt(capacityPct)}% {isRtl ? "تکمیل" : "filled"}
                  </span>
                  <span className="tabular">
                    {fmt(Math.max(0, totalQuota - totalReserved))} {isRtl ? "جای خالی" : "seats open"}
                  </span>
                </div>
              </div>
              <LinkButton to={eventWorkspacePath(event.id, "/tiers")} variant="secondary" size="sm" className="self-start">
                {t.tabTiers}
                <Icon name="arrow-right" size={16} />
              </LinkButton>
            </div>
            <ul className="divide-y divide-border-subtle px-5 py-2 sm:px-7 sm:py-3">
              {tiers.items.map((tier) => {
                const pct = tier.quota > 0 ? Math.min(100, Math.round(((tier.reserved_count ?? 0) / tier.quota) * 100)) : 0;
                return (
                  <li key={tier.id} className="space-y-2.5 py-4">
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0 break-words font-semibold text-text-primary">
                        <bdi>{tier.name}</bdi>
                      </span>
                      <span className="flex shrink-0 items-center gap-2.5 text-xs text-text-secondary">
                        <Badge variant={tier.is_open ? "success" : "neutral"} size="sm">
                          {tier.is_open ? (isRtl ? "باز" : "Open") : isRtl ? "بسته" : "Closed"}
                        </Badge>
                        <bdi dir="ltr" className="tabular font-semibold text-text-primary">
                          {fmt(tier.reserved_count)} / {fmt(tier.quota)}
                        </bdi>
                      </span>
                    </div>
                    <Meter value={pct} label={tier.name} tone={pct >= 100 ? "full" : tier.is_open ? "default" : "muted"} />
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {([
            ["chart", t.openAnalyticsAction, t.analyticsStationDesc, "/analytics", isRtl ? "مشاهده" : "View"],
            [
              "id-card",
              t.openDeskAction,
              isRtl
                ? "میز پذیرش دسترسی جداگانه اپراتور دارد؛ با کلید مدیر هم می‌توان در حالت مدیر وارد شد."
                : "Reception has its own operator access; you can also enter it in Organizer mode.",
              "/desk",
              isRtl ? "ورود" : "Open",
            ],
          ] as const).map(([icon, title, desc, path, cta]) => (
            <div key={path} className="flex items-start gap-4 shape-arc border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo">
                <Icon name={icon} size={22} />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-sm font-bold text-text-primary">{title}</h3>
                <p className="text-xs leading-relaxed text-text-secondary">{desc}</p>
              </div>
              <LinkButton to={eventWorkspacePath(event.id, path)} variant="secondary" size="sm" className="shrink-0">
                {cta}
                <Icon name="arrow-right" size={16} />
              </LinkButton>
            </div>
          ))}
        </div>
      </div>

      <EventEditDialog
        event={editingEvent}
        apiKey={apiKey}
        onKeyRejected={onKeyRejected}
        t={t}
        isRtl={isRtl}
        onClose={() => setEditingEvent(null)}
        onSaved={(saved) => {
          replaceEvent(saved);
          setEditingEvent(null);
          setNotice({ tone: "ok", text: isRtl ? "تنظیمات همایش ذخیره شد." : "Event settings saved." });
        }}
      />
    </div>
  );
}
