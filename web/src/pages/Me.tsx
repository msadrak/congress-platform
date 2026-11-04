import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createApiClient, type AttendeeTicketDetail, type BookmarkedBoothOut } from "../api/client";
import { attendeeCopy } from "../copy/attendee";
import { commonCopy } from "../copy/common";
import { readableApiError } from "../lib/attendeeErrors";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { loadOwnerScopedTickets, saveOwnerScopedTickets } from "../lib/ticketCache";
import { loadLinkPasses } from "../lib/linkPass";
import { groupCongresses, type CongressCard, type CongressTiming } from "../lib/attendeePasses";
import { congressPath } from "../lib/congressContext";
import { useLocale, type AttendeeLocale } from "../lib/i18n";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { Button, IconButton, LinkButton } from "../components/ui/Button";
import { Icon, type IconName } from "../components/ui/Icon";
import { Notice } from "../components/ui/Notice";
import { PageHeader, SectionHeader } from "../components/ui/PageHeader";
import { ErrorState, StateBlock } from "../components/ui/StateBlock";
import { CongressSignature } from "../components/brand/CongressSignature";
import { InlineSignIn } from "../components/attendee/InlineSignIn";
import { PhaseBadge } from "../components/attendee/PhaseBadge";
import { n } from "../components/attendee/attendeeCopy";
import { formatDateRange } from "../components/attendee/congressTime";
import { PublicEventList } from "../components/public/PublicEventList";
import { useStaffAccess } from "../hooks/useStaffAccess";
import type { StaffDestinations } from "../lib/staffAccess";

const GROUP_ORDER: CongressTiming[] = ["live", "upcoming", "past"];

const cardShell =
  "flex flex-col rounded-card border border-border-default bg-surface-panel shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-lift sm:flex-row sm:items-stretch";
const cardLink =
  "press group flex min-w-0 flex-1 items-center gap-4 rounded-card p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** One congress: its card opens the congress; while it is live, the QR button next to it opens the pass. */
function CongressCardLink({ card, locale, live }: { card: CongressCard; locale: AttendeeLocale; live: boolean }) {
  const copy = attendeeCopy[locale].me;
  // A congress known only from an SMS link opens its pass: everything else in the panel needs a sign-in.
  const to = congressPath(card.slug, card.fromLink ? "my-ticket" : "my-congress");
  return (
    <div className={cardShell}>
      <Link to={to} data-testid="congress-card" className={cardLink}>
        <span aria-hidden="true" className="size-14 shrink-0 overflow-hidden rounded-xl [border-start-end-radius:22px]">
          <CongressSignature seed={card.slug} tone="ink" className="size-full" />
        </span>
        <span className="min-w-0 flex-1 space-y-1.5">
          <span dir="auto" className="block text-base font-semibold leading-snug tracking-[-0.01em] text-text-primary break-words">{card.name}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="calendar" size={14} className="text-ink-400" />
              {formatDateRange(card.startsAt, card.endsAt, locale)}
            </span>
            {card.location && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon name="pin" size={14} className="text-ink-400" />
                <span className="break-words">{card.location}</span>
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <PhaseBadge startsAt={card.startsAt} endsAt={card.endsAt} locale={locale} className="!px-2.5 !py-1" />
            {card.passCount > 1 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border-default px-2.5 py-1 text-xs font-semibold text-text-secondary">
                <Icon name="ticket" size={13} />
                {copy.passes(n(card.passCount, locale))}
              </span>
            )}
            {card.fromLink && (
              <span className="inline-flex items-center gap-1 rounded-full bg-action-subtle px-2.5 py-1 text-xs font-semibold text-action-primary">
                <Icon name="link" size={13} />
                {copy.fromLink}
              </span>
            )}
          </span>
        </span>
      </Link>
      {live && !card.fromLink && (
        <LinkButton
          to={congressPath(card.slug, "my-ticket")}
          variant="secondary"
          size="sm"
          icon="qr"
          aria-label={copy.qrFor(card.name)}
          className="mx-4 mb-4 sm:m-3 sm:ms-0 sm:self-center"
        >
          {copy.qr}
        </LinkButton>
      )}
    </div>
  );
}

function StaffCard({ to, icon, kicker, title, detail, action }: { to: string; icon: IconName; kicker: string; title: string; detail?: string; action: string }) {
  return (
    <Link
      to={to}
      aria-label={`${action}: ${title}`}
      data-testid="staff-card"
      className="press group flex h-full items-center gap-4 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo [border-start-end-radius:20px]">
        <Icon name={icon} size={22} />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span dir="auto" className="block text-caption font-semibold text-aiteb-indigo break-words">{kicker}</span>
        <span dir="auto" className="block text-base font-semibold leading-snug tracking-[-0.01em] text-text-primary break-words">{title}</span>
        {detail && (
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <Icon name="pin" size={14} className="shrink-0 text-ink-400" />
            <span dir="auto" className="break-words">{detail}</span>
          </span>
        )}
        <span className="block text-xs font-semibold text-action-primary">{action}</span>
      </span>
      <Icon name="arrow-right" size={18} className="shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
    </Link>
  );
}

/** Booths the person staffs and desks they operate: the way into `/booth/:id` and `/reception/:eventId`. */
function StaffSection({ destinations, locale }: { destinations: StaffDestinations; locale: AttendeeLocale }) {
  const copy = attendeeCopy[locale].me;
  return (
    <section aria-labelledby="me-staff" data-testid="staff-section" className="space-y-4">
      <SectionHeader id="me-staff" title={copy.staffHeading} />
      {destinations.booths.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-text-muted">{copy.myBooths}</h3>
          <ul className="grid gap-3">
            {destinations.booths.map((booth) => (
              <li key={booth.id}>
                <StaffCard
                  to={`/booth/${encodeURIComponent(booth.id)}`}
                  icon="booth"
                  kicker={booth.eventName}
                  title={booth.name || copy.boothFallback}
                  detail={booth.location || undefined}
                  action={copy.openBooth}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {destinations.desks.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-text-muted">{copy.receptionDesk}</h3>
          <ul className="grid gap-3">
            {destinations.desks.map((desk) => (
              <li key={desk.eventId}>
                <StaffCard to={`/reception/${encodeURIComponent(desk.eventId)}`} icon="id-card" kicker={copy.receptionDesk} title={desk.eventName} action={copy.openDesk} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** `/me`: the attendee's congresses (upcoming / live / past), each opening its panel; link passes when signed out. */
export default function Me() {
  const localeHook = useLocale();
  const { locale } = localeHook;
  const copy = attendeeCopy[locale].me;
  const { token } = useAttendeeSession();
  // Booths and reception desks this person works at (descriptive; each portal authorizes on its own).
  const staff = useStaffAccess(token);

  const [tickets, setTickets] = useState<AttendeeTicketDetail[]>([]);
  const [fromCache, setFromCache] = useState(false);
  // The tickets request has finished (either way): until then no failed side request is reported as an error.
  const [settled, setSettled] = useState(false);
  const [loading, setLoading] = useState(Boolean(token));
  // The failed response body (worded at render time, in the current language), or `null` for no response at all.
  const [error, setError] = useState<{ body: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [booths, setBooths] = useState<BookmarkedBoothOut[]>([]);
  const [removingBoothId, setRemovingBoothId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    text: string;
    tone: "success" | "danger";
    undo?: { booth: BookmarkedBoothOut; index: number };
  } | null>(null);
  // Passes opened from the SMS link on this device: listed while nobody is signed in.
  const [linkPasses] = useState(() => loadLinkPasses(undefined));

  useEffect(() => {
    let active = true;
    if (!token) {
      // oxlint-disable-next-line react/set-state-in-effect -- owner isolation: a signed-out page never keeps the previous owner's list.
      setTickets([]);
      setBooths([]);
      setLoading(false);
      return;
    }
    const cache = loadOwnerScopedTickets(token);
    const cached = cache.status === "valid" ? cache.tickets : [];
    // A different session never inherits the previous owner's congresses or saved booths.
    setTickets(cached);
    setFromCache(false);
    setSettled(false);
    setBooths([]);
    setError(null);
    setLoading(cached.length === 0);

    const client = createApiClient({ kind: "user", token });
    Promise.all([client.GET("/api/attendees/me/tickets"), client.GET("/api/attendees/me/bookmarks/booths")])
      .then(([ticketsRes, boothsRes]) => {
        if (!active) return;
        if (attendeeResponseState(token, ticketsRes.response.status) !== "current") return;
        if (ticketsRes.data) {
          setTickets(ticketsRes.data);
          saveOwnerScopedTickets(token, ticketsRes.data);
        } else if (cached.length === 0) {
          setError({ body: ticketsRes.error });
        } else {
          setFromCache(true);
        }
        if (boothsRes.data) setBooths(boothsRes.data);
      })
      .catch(() => {
        if (!active) return;
        if (cached.length === 0) setError({ body: null });
        else setFromCache(true);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setSettled(true);
        }
      });
    return () => {
      active = false;
    };
  }, [token, attempt]);

  const groups = useMemo(() => groupCongresses(token ? tickets : [], token ? [] : linkPasses), [token, tickets, linkPasses]);
  const hasCards = GROUP_ORDER.some((g) => groups[g].length > 0);

  const removeBooth = async (boothId: string) => {
    if (!token) return;
    if (!isStoredAttendeeToken(token)) {
      setFeedback({ text: sessionChangedMessage(locale), tone: "danger" });
      return;
    }
    const index = booths.findIndex((b) => b.booth_id === boothId);
    const booth = booths[index];
    if (!booth) return;
    setRemovingBoothId(boothId);
    setFeedback(null);
    let failed = false;
    try {
      const { error: err } = await createApiClient({ kind: "user", token }).DELETE("/api/attendees/me/bookmarks/booths/{booth_id}", {
        params: { path: { booth_id: boothId } },
      });
      failed = Boolean(err);
    } catch {
      failed = true;
    }
    if (isStoredAttendeeToken(token)) {
      if (failed) {
        setFeedback({ text: copy.removeFailed, tone: "danger" });
      } else {
        setBooths((prev) => prev.filter((b) => b.booth_id !== boothId));
        setFeedback({ text: copy.boothRemoved, tone: "success", undo: { booth, index } });
      }
    }
    setRemovingBoothId(null);
  };

  const undoRemove = async (undo: { booth: BookmarkedBoothOut; index: number }) => {
    if (!token) return;
    if (!isStoredAttendeeToken(token)) {
      setFeedback({ text: sessionChangedMessage(locale), tone: "danger" });
      return;
    }
    setRemovingBoothId(undo.booth.booth_id);
    let failed = false;
    try {
      const { error: err } = await createApiClient({ kind: "user", token }).POST("/api/attendees/me/bookmarks/booths/{booth_id}", {
        params: { path: { booth_id: undo.booth.booth_id } },
      });
      failed = Boolean(err);
    } catch {
      failed = true;
    }
    if (isStoredAttendeeToken(token)) {
      if (failed) {
        setFeedback({ text: copy.restoreFailed, tone: "danger", undo });
      } else {
        setBooths((prev) =>
          prev.some((b) => b.booth_id === undo.booth.booth_id) ? prev : [...prev.slice(0, undo.index), undo.booth, ...prev.slice(undo.index)],
        );
        setFeedback(null);
      }
    }
    setRemovingBoothId(null);
  };

  const staffDestinations = staff.state.status === "ready" ? staff.state.destinations : null;
  const hasStaff = Boolean(staffDestinations && (staffDestinations.booths.length > 0 || staffDestinations.desks.length > 0));
  const staffSection = staffDestinations && hasStaff ? <StaffSection destinations={staffDestinations} locale={locale} /> : null;
  const savedBooths =
    token && booths.length > 0 ? (
      <section aria-labelledby="saved-booths-heading" className="space-y-4">
        <SectionHeader id="saved-booths-heading" title={copy.savedBooths} />
        <ul className="divide-y divide-border-default border-y border-border-default">
          {booths.map((booth) => (
            <li key={booth.booth_id} className="flex items-start gap-3 py-3">
              <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo">
                <Icon name="bookmark" size={18} fill="currentColor" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <span className="block text-caption font-semibold text-aiteb-indigo">{booth.event_name}</span>
                <h3 className="text-base font-semibold tracking-[-0.01em] text-text-primary break-words">{booth.name}</h3>
                {booth.location && (
                  <p className="flex items-center gap-1.5 text-xs text-text-muted">
                    <Icon name="pin" size={14} className="text-ink-400" />
                    {booth.location}
                  </p>
                )}
                <Link
                  to={`/e/${booth.event_slug}/booths/${booth.booth_id}`}
                  className="inline-flex min-h-12 items-center gap-1.5 rounded text-xs font-semibold text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
                >
                  {copy.viewBooth}
                  <Icon name="arrow-right" size={15} />
                </Link>
              </div>
              <IconButton
                icon="x"
                label={copy.removeBoothNamed(booth.name)}
                disabled={removingBoothId === booth.booth_id}
                onClick={() => removeBooth(booth.booth_id)}
                className="hover:text-status-danger-text"
              />
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  const sideColumn = staffSection || savedBooths ? (
    <div data-testid="me-column" className={`space-y-8 ${!hasCards && hasStaff ? "max-lg:order-first" : ""}`}>
      {staffSection}
      {savedBooths}
    </div>
  ) : null;

  let body;
  if (loading && tickets.length === 0) {
    body = (
      <div role="status" aria-label={copy.title} className="space-y-3">
        <div className="skeleton h-24 rounded-card" />
        <div className="skeleton h-24 rounded-card" />
      </div>
    );
  } else if (error && tickets.length === 0) {
    body = <ErrorState title={copy.loadFailed} body={error.body !== null ? (readableApiError(error.body, locale) ?? undefined) : undefined} onRetry={() => setAttempt((count) => count + 1)} />;
  } else if (!hasCards && token && hasStaff) {
    // Booth staff and desk operators without a pass of their own: their workplaces beside, a quiet note here.
    body = (
      <p className="flex items-center gap-2.5 rounded-card border border-dashed border-border-strong px-4 py-3 text-sm text-text-secondary">
        <Icon name="ticket" size={18} className="shrink-0 text-ink-300" />
        {copy.noPassNote}
      </p>
    );
  } else if (!hasCards && token) {
    body = <StateBlock icon="congress" title={copy.emptyTitle} body={copy.emptyBody} />;
  } else if (hasCards) {
    body = (
      <div className="space-y-8">
        {GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => (
          <section key={g} aria-labelledby={`me-${g}`} className="space-y-3">
            <h2 id={`me-${g}`} className="text-sm font-semibold text-text-muted">{copy.groups[g]}</h2>
            <ul className="grid gap-3">
              {groups[g].map((card) => (
                <li key={card.slug}>
                  <CongressCardLink card={card} locale={locale} live={g === "live"} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <AttendeeLayout localeProps={localeHook}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 pt-5 sm:px-6 sm:pt-8">
        <PageHeader title={copy.title} />

        {feedback && (
          <Notice
            tone={feedback.tone}
            action={
              feedback.undo ? (
                <Button type="button" variant="ghost" size="sm" disabled={removingBoothId === feedback.undo.booth.booth_id} onClick={() => feedback.undo && undoRemove(feedback.undo)}>
                  {copy.undo}
                </Button>
              ) : undefined
            }
          >
            {feedback.text}
          </Notice>
        )}

        {/* One offline chip instead of a red alert per failed request: the saved list is what is shown. */}
        {fromCache && (
          <Notice tone="warning" icon="wifi-off">
            {copy.offline}
          </Notice>
        )}
        {staff.state.status === "error" && settled && !fromCache && (
          <Notice
            tone="danger"
            action={
              <Button type="button" variant="ghost" size="sm" icon="sync" onClick={staff.retry}>
                {commonCopy[locale].retry}
              </Button>
            }
          >
            {copy.staffFailed}
          </Notice>
        )}

        {(body || sideColumn) && (
          <div className={`grid grid-cols-1 items-start gap-8 ${sideColumn && body ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}>
            {body && <div data-testid="me-column">{body}</div>}
            {sideColumn}
          </div>
        )}

        {!token && <InlineSignIn locale={locale} title={copy.signInTitle} body={copy.signInBody} />}

        {/* Nobody signed in, or no congress yet: never a dead end, the listed congresses are one tap away. */}
        {!hasCards && !loading && !error && <PublicEventList locale={locale} variant="panel" headingId="me-public-events" />}
      </div>
    </AttendeeLayout>
  );
}
