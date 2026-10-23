import type { PublicEvent, PublicVenuePlace } from "../../api/client";
import { attendeeCopy } from "../../copy/attendee";
import { programFilesOf } from "../../lib/programFiles";
import type { AttendeeLocale, TranslationDictionary } from "../../lib/i18n";
import { ScheduleFiles } from "../public/page/ScheduleFiles";
import { MapLinks } from "../public/EventActions";
import { LinkButton } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { PageHeader, SectionHeader } from "../ui/PageHeader";
import { ScheduleEmpty } from "./CongressSchedule";
import { ProgramExplorer } from "./ProgramExplorer";
import { useAgenda } from "./useAgenda";
import { formatDateRange } from "./congressTime";
import type { PanelLabels, PanelPage } from "./panelContent";

interface CongressDetailsViewProps {
  event: PublicEvent;
  /** Kept for the organizer's preview; the program tab no longer shows the page's cover or About. */
  page?: PanelPage;
  labels?: PanelLabels;
  locale: AttendeeLocale;
  /** @deprecated No longer read; the organizer's preview still passes it. */
  t?: TranslationDictionary;
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
 * The Program tab: the program first (day tabs, filters, schedule files), then the venue. The congress's About
 * lives on its public page, one link away. Shared by the attendee page and the organizer's panel preview.
 */
export function CongressDetailsView({ event, locale, agendaOwner }: CongressDetailsViewProps) {
  const agenda = useAgenda(agendaOwner, event.id);
  const pc = attendeeCopy[locale].program;
  const entrances = event.venue.filter((p) => p.kind === "entrance");
  const halls = event.venue.filter((p) => p.kind === "hall");
  const showVenue = event.venue.length > 0 || event.location.trim() !== "";
  const scheduleFiles = programFilesOf(event);

  return (
    <>
      <PageHeader
        title={pc.title}
        meta={<bdi>{formatDateRange(event.starts_at, event.ends_at, locale, event.timezone)}</bdi>}
        actions={
          <LinkButton to={`/e/${event.slug}#about`} variant="ghost" size="sm" iconEnd="arrow-right">
            {pc.aboutLink}
          </LinkButton>
        }
      />

      <section id="program" aria-label={pc.title} className="scroll-mt-24 space-y-5">
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

      {showVenue && (
        <section aria-labelledby="details-venue-title" className="space-y-5">
          <SectionHeader id="details-venue-title" title={pc.venueTitle} />
          <div className="grid items-start gap-8 lg:grid-cols-2">
            {event.location.trim() && (
              <div className="space-y-3 rounded-card bg-surface-panel-subtle p-4">
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
              <div className="space-y-8">
                {entrances.length > 0 && <PlaceList title={pc.entrances} icon="gate" places={entrances} />}
                {halls.length > 0 && <PlaceList title={pc.halls2} icon="pin" places={halls} />}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
