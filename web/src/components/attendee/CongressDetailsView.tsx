import type { PublicEvent, PublicVenuePlace } from "../../api/client";
import { programFilesOf } from "../../lib/programFiles";
import { formatLocalizedNumber, type AttendeeLocale, type TranslationDictionary } from "../../lib/i18n";
import { CongressSignature } from "../brand/CongressSignature";
import { PageImg } from "../public/page/PageImg";
import { ScheduleFiles } from "../public/page/ScheduleFiles";
import { RichText } from "../public/page/RichText";
import { LinkButton } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { MapLinks } from "../public/EventActions";
import { programCopy } from "./attendeeCopy";
import { ScheduleEmpty } from "./CongressSchedule";
import { ProgramExplorer } from "./ProgramExplorer";
import { useAgenda } from "./useAgenda";
import { congressDays, formatDateRange, sectionIndex } from "./congressTime";
import type { PanelLabels, PanelPage } from "./panelContent";
import { PhaseBadge } from "./PhaseBadge";
import { SectionHeader } from "./SectionHeader";

interface CongressDetailsViewProps {
  event: PublicEvent;
  page: PanelPage;
  labels: PanelLabels;
  locale: AttendeeLocale;
  t: TranslationDictionary;
  /** Whose personal agenda the program shows (user id, or the guest owner); null keeps it in memory (preview). */
  agendaOwner: string | null;
}

function PlaceList({ title, icon, places }: { title: string; icon: IconName; places: PublicVenuePlace[] }) {
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Icon name={icon} size={17} className="text-event-accent" />
        {title}
      </h3>
      <ul className="divide-y divide-border-subtle border-y border-border-subtle">
        {places.map((p) => (
          <li key={p.id} className="space-y-0.5 py-3">
            <p dir="auto" className="text-sm font-semibold text-text-primary break-words">{p.name}</p>
            {p.location && <p dir="auto" className="text-xs leading-relaxed text-text-secondary break-words">{p.location}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Congress details: masthead, general facts, about, venue (entrances and halls) and the full program.
 * Shared by the attendee page and the organizer's panel preview.
 */
export function CongressDetailsView({ event, page, labels, locale, t, agendaOwner }: CongressDetailsViewProps) {
  const isRtl = locale === "fa";
  const agenda = useAgenda(agendaOwner, event.id);
  const pc = programCopy[locale];
  const { doc, images } = page;
  const cover = doc.hero.layout !== "signature" && doc.hero.cover_asset_id ? (images[doc.hero.cover_asset_id] ?? null) : null;
  const totalDays = congressDays(event.starts_at, event.ends_at, event.timezone);
  const entrances = event.venue.filter((p) => p.kind === "entrance");
  const halls = event.venue.filter((p) => p.kind === "hall");
  const n = (value: number) => formatLocalizedNumber(value, locale);

  const facts: { icon: IconName; label: string; value: string }[] = [
    { icon: "calendar", label: isRtl ? "زمان" : "When", value: formatDateRange(event.starts_at, event.ends_at, locale, event.timezone) },
  ];
  if (event.location) facts.push({ icon: "pin", label: t.venueLabel, value: event.location });
  if (totalDays !== null) {
    facts.push({ icon: "clock", label: isRtl ? "مدت" : "Duration", value: isRtl ? `${n(totalDays)} روز` : `${totalDays} day${totalDays === 1 ? "" : "s"}` });
  }
  if (event.sessions.length > 0) {
    const sessions = isRtl ? `${n(event.sessions.length)} جلسه` : `${event.sessions.length} session${event.sessions.length === 1 ? "" : "s"}`;
    const hallCount = isRtl ? `${n(halls.length)} سالن` : `${halls.length} hall${halls.length === 1 ? "" : "s"}`;
    facts.push({ icon: "list", label: isRtl ? "برنامه" : "Program", value: halls.length > 0 ? `${sessions} · ${hallCount}` : sessions });
  }

  const aboutText = labels.aboutBody ?? (event.description || null);
  const showAbout = labels.showAbout && aboutText !== null;
  const showVenue = event.venue.length > 0 || event.location.trim() !== "";
  const scheduleFiles = programFilesOf(event);
  let index = 0;

  return (
    <>
      {/* Editorial masthead */}
      <div className="grid items-stretch gap-6 lg:grid-cols-12 lg:gap-10">
        <div className="flex flex-col justify-end gap-5 lg:col-span-7 lg:py-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="eyebrow">{t.navCongressDetails}</span>
            <PhaseBadge startsAt={event.starts_at} endsAt={event.ends_at} locale={locale} timeZone={event.timezone} />
          </div>
          <h1 className="text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] text-text-primary text-balance break-words sm:text-5xl">{event.name}</h1>
        </div>
        <div aria-hidden="true" className="relative h-44 overflow-hidden shape-arc-lg border border-border-default bg-surface-panel shadow-soft sm:h-56 lg:col-span-5 lg:h-auto lg:min-h-64">
          {cover ? (
            <PageImg image={cover} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <>
              <div className="bg-meridian absolute inset-0" />
              <CongressSignature seed={event.slug} tone="light" accent={doc.branding.accent} animate className="absolute inset-0 size-full" />
            </>
          )}
        </div>
      </div>

      {/* Facts typeset in columns */}
      <dl className={`grid gap-px overflow-hidden rounded-2xl border border-border-default bg-border-default sm:grid-cols-2 ${facts.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
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

      {(showAbout || showVenue) && (
        <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-10">
          {showAbout && (
            <section aria-labelledby="details-about-title" className={`space-y-5 ${showVenue ? "lg:col-span-7" : "lg:col-span-12"}`}>
              <SectionHeader index={sectionIndex(++index, locale)} id="details-about-title" title={<bdi>{labels.aboutTitle}</bdi>} />
              {labels.aboutBody ? (
                <RichText text={labels.aboutBody} className="max-w-prose" />
              ) : (
                <p dir="auto" className="max-w-prose whitespace-pre-line text-base leading-8 text-text-secondary">{aboutText}</p>
              )}
            </section>
          )}

          {showVenue && (
            <section aria-labelledby="details-venue-title" className={`space-y-5 ${showAbout ? "lg:col-span-5" : "lg:col-span-12"}`}>
              <SectionHeader index={sectionIndex(++index, locale)} id="details-venue-title" title={pc.venueTitle} />
              {event.location.trim() && (
                <div className="space-y-3 rounded-2xl bg-surface-panel-subtle p-4">
                  <p className="flex items-start gap-2 text-sm font-semibold text-text-primary break-words">
                    <Icon name="pin" size={17} className="mt-0.5 shrink-0 text-event-accent" />
                    <span dir="auto">{event.location}</span>
                  </p>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-text-muted">{pc.directions}</p>
                    <MapLinks query={event.location} locale={locale} />
                  </div>
                </div>
              )}
              {event.venue.length > 0 && (
                <div className={`grid gap-8 ${showAbout ? "" : "sm:grid-cols-2"}`}>
                  {entrances.length > 0 && <PlaceList title={pc.entrances} icon="gate" places={entrances} />}
                  {halls.length > 0 && <PlaceList title={pc.halls2} icon="pin" places={halls} />}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <section id="program" aria-labelledby="details-program-title" className="scroll-mt-24 space-y-5">
        <SectionHeader
          index={sectionIndex(++index, locale)}
          id="details-program-title"
          title={<bdi>{labels.scheduleTitle}</bdi>}
          description={labels.scheduleLead ? <bdi>{labels.scheduleLead}</bdi> : undefined}
        />
        <ScheduleFiles files={scheduleFiles} locale={locale} />
        {/* With schedule files but no sessions, the files are the program: no "no sessions yet" note. */}
        {event.sessions.length > 0 ? (
          <ProgramExplorer
            sessions={event.sessions}
            locale={locale}
            timeZone={event.timezone}
            event={{ slug: event.slug, name: event.name, location: event.location }}
            agenda={agenda}
          />
        ) : (
          scheduleFiles.length === 0 && <ScheduleEmpty locale={locale} />
        )}
      </section>

      <LinkButton to={`/e/${event.slug}`} variant="secondary" size="lg">
        <Icon name="globe" size={18} />
        {isRtl ? "صفحه عمومی همایش" : "Public congress page"}
        <Icon name="arrow-right" size={18} />
      </LinkButton>
    </>
  );
}
