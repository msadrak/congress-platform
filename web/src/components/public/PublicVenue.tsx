import type { PublicSession, PublicVenuePlace } from "../../api/client";
import { Icon, type IconName } from "../ui/Icon";
import { num, publicCopy, type PublicLocale } from "./copy";
import { MapLinks } from "./EventActions";

function PlaceList({ title, icon, places, sessions, locale }: {
  title: string;
  icon: IconName;
  places: PublicVenuePlace[];
  sessions: readonly PublicSession[];
  locale: PublicLocale;
}) {
  const c = publicCopy[locale];
  if (places.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Icon name={icon} size={18} className="text-event-accent" />
        {title}
      </h3>
      <ul className="grid gap-3 sm:grid-cols-2">
        {places.map((place) => {
          const count = sessions.filter((s) => s.hall_id === place.id).length;
          return (
            <li
              key={place.id}
              id={`venue-${place.id}`}
              className="scroll-mt-24 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft target:border-event-accent target:ring-2 target:ring-event-accent/30 sm:p-5"
            >
              <p dir="auto" className="text-base font-semibold leading-snug tracking-[-0.01em] text-text-primary break-words">{place.name}</p>
              {place.location && (
                <p dir="auto" className="mt-1.5 flex items-start gap-1.5 text-sm leading-relaxed text-text-secondary break-words">
                  <Icon name="pin" size={15} className="mt-0.5 shrink-0 text-text-muted" />
                  <span>{place.location}</span>
                </p>
              )}
              {place.kind === "hall" && count > 0 && (
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-text-muted">
                  <Icon name="calendar" size={14} />
                  {c.hallSessions(num(count, locale), count)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Where the congress happens: the address with map-app links, then the entrances (with the organizer's
 * directions) and the halls (with how many program sessions each hosts).
 */
export function PublicVenue({ address, venue, sessions, locale }: {
  address: string;
  venue: readonly PublicVenuePlace[];
  sessions: readonly PublicSession[];
  locale: PublicLocale;
}) {
  const c = publicCopy[locale];
  const entrances = venue.filter((p) => p.kind === "entrance");
  const halls = venue.filter((p) => p.kind === "hall");
  return (
    <div className="space-y-8">
      {address.trim() && (
        <div className="flex flex-col gap-4 rounded-card bg-surface-panel-subtle p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold text-text-muted">{c.venueAddress}</p>
            <p dir="auto" className="text-base font-semibold text-text-primary break-words">{address}</p>
          </div>
          <MapLinks query={address} locale={locale} />
        </div>
      )}
      <PlaceList title={c.venueEntrances} icon="gate" places={entrances} sessions={sessions} locale={locale} />
      <PlaceList title={c.venueHalls} icon="congress" places={halls} sessions={sessions} locale={locale} />
    </div>
  );
}
