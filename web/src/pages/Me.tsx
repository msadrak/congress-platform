import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createApiClient, localizedApiError, type AttendeeTicketDetail, type BookmarkedBoothOut } from "../api/client";
import { readableApiError } from "../lib/attendeeErrors";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { loadOwnerScopedTickets, saveOwnerScopedTickets } from "../lib/ticketCache";
import { loadLinkPasses } from "../lib/linkPass";
import { groupCongresses, type CongressCard, type CongressTiming } from "../lib/attendeePasses";
import { congressPath } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { formatLocalizedNumber, useAttendeeLocale, type AttendeeLocale } from "../lib/i18n";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon, type IconName } from "../components/ui/Icon";
import { CongressSignature } from "../components/brand/CongressSignature";
import { PhaseBadge } from "../components/attendee/PhaseBadge";
import { SectionHeader } from "../components/attendee/SectionHeader";
import { formatDateRange } from "../components/attendee/congressTime";
import { PublicEventList } from "../components/public/PublicEventList";
import { useStaffAccess } from "../hooks/useStaffAccess";
import type { StaffDestinations } from "../lib/staffAccess";

const COPY = {
  fa: {
    title: "همایش‌های من",
    lead: "هر همایش را باز کنید تا کارت ورود، برنامه و شبکه‌تان را ببینید.",
    groups: { live: "در حال برگزاری", upcoming: "پیش رو", past: "گذشته" } satisfies Record<CongressTiming, string>,
    passes: (n: string) => `${n} کارت ورود`,
    fromLink: "از پیوند پیامک",
    emptyTitle: "هنوز در همایشی ثبت‌نام نکرده‌اید",
    emptyBody: "برای ثبت‌نام، پیوند صفحه همایش را از برگزارکننده بگیرید و کارت ورود رزرو کنید؛ کارت ورود اینجا نمایش داده می‌شود.",
    findTitle: "کارت ورود خود را پیدا کنید",
    findBody: "با همان شماره موبایلی که با آن ثبت‌نام کرده‌اید وارد شوید تا همایش‌ها و کارت‌های ورودتان را ببینید.",
    findAction: "ورود و دیدن کارت ورود",
    registerHint: "هنوز ثبت‌نام نکرده‌اید؟ پیوند صفحه همایش را از برگزارکننده بگیرید.",
    linkNote: "این کارت‌های ورود از پیوند پیامک روی همین دستگاه باز شده‌اند. برای دیدن همه همایش‌هایتان وارد شوید.",
    loadFailed: "فهرست همایش‌ها بارگذاری نشد",
    offlineCopy: "آفلاین: فهرست ذخیره‌شده در این دستگاه",
    retry: "تلاش دوباره",
    removeFailed: "حذف نشد؛ دوباره تلاش کنید.",
    restoreFailed: "بازگردانده نشد؛ دوباره تلاش کنید.",
    undo: "بازگرداندن",
    staffHeading: "محل کار شما در همایش‌ها",
    staffLead: "پنل غرفه‌هایی که نماینده‌شان هستید و میزهای پذیرشی که اپراتورشان هستید.",
    myBooths: "غرفه‌های من",
    receptionDesk: "میز پذیرش",
    boothFallback: "غرفه",
    openBooth: "باز کردن پنل غرفه",
    openDesk: "باز کردن میز پذیرش",
    staffFailed: "غرفه‌ها و میزهای پذیرش شما بارگذاری نشد.",
    noPassNote: "برای خودتان هنوز کارت ورودی در همایشی رزرو نکرده‌اید.",
  },
  en: {
    title: "My congresses",
    lead: "Open a congress to see your pass, the program and your network.",
    groups: { live: "Happening now", upcoming: "Upcoming", past: "Past" } satisfies Record<CongressTiming, string>,
    passes: (n: string) => `${n} passes`,
    fromLink: "From your SMS link",
    emptyTitle: "You haven't registered for a congress yet",
    emptyBody: "To register, get the congress page link from the organizer and reserve a pass; it will show up here.",
    findTitle: "Find your pass",
    findBody: "Sign in with the mobile number you registered with to see your congresses and passes.",
    findAction: "Sign in to see your pass",
    registerHint: "Not registered yet? Get the congress page link from the organizer.",
    linkNote: "These passes were opened from an SMS link on this device. Sign in to see all your congresses.",
    loadFailed: "Couldn't load your congresses",
    offlineCopy: "Offline: the list saved on this device",
    retry: "Try again",
    removeFailed: "Couldn't remove — try again.",
    restoreFailed: "Couldn't restore — try again.",
    undo: "Undo",
    staffHeading: "Where you work at congresses",
    staffLead: "The booths you staff and the reception desks you operate.",
    myBooths: "My booths",
    receptionDesk: "Reception desk",
    boothFallback: "Booth",
    openBooth: "Open booth workspace",
    openDesk: "Open reception desk",
    staffFailed: "Couldn't load your booths and reception desks.",
    noPassNote: "You haven't reserved a pass for a congress yet.",
  },
} as const;

const GROUP_ORDER: CongressTiming[] = ["live", "upcoming", "past"];

function CongressCardLink({ card, locale }: { card: CongressCard; locale: AttendeeLocale }) {
  const copy = COPY[locale];
  // A congress known only from an SMS link opens its pass: everything else in the panel needs a sign-in.
  const to = congressPath(card.slug, card.fromLink ? "my-ticket" : "my-congress");
  return (
    <Link
      to={to}
      data-testid="congress-card"
      className="press group flex items-center gap-4 rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
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
              {copy.passes(formatLocalizedNumber(card.passCount, locale))}
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
      <Icon name="arrow-right" size={18} className="shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
    </Link>
  );
}

function StaffCard({ to, icon, kicker, title, detail, action }: { to: string; icon: IconName; kicker: string; title: string; detail?: string; action: string }) {
  return (
    <Link
      to={to}
      aria-label={`${action}: ${title}`}
      data-testid="staff-card"
      className="press group flex h-full items-center gap-4 rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo [border-start-end-radius:20px]">
        <Icon name={icon} size={22} />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span dir="auto" className="block text-[11px] font-semibold text-aiteb-indigo break-words">{kicker}</span>
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
  const copy = COPY[locale];
  return (
    <section aria-labelledby="me-staff" data-testid="staff-section" className="space-y-5">
      <SectionHeader id="me-staff" title={copy.staffHeading} description={copy.staffLead} />
      {destinations.booths.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-text-muted">{copy.myBooths}</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
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
          <ul className="grid gap-3 sm:grid-cols-2">
            {destinations.desks.map((desk) => (
              <li key={desk.eventId}>
                <StaffCard
                  to={`/reception/${encodeURIComponent(desk.eventId)}`}
                  icon="id-card"
                  kicker={copy.receptionDesk}
                  title={desk.eventName}
                  action={copy.openDesk}
                />
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
  const localeHook = useAttendeeLocale();
  const { locale, t } = localeHook;
  const copy = COPY[locale];
  const { token } = useAttendeeSession();
  // Booths and reception desks this person works at (descriptive; each portal authorizes on its own).
  const staff = useStaffAccess(token);

  const [tickets, setTickets] = useState<AttendeeTicketDetail[]>([]);
  const [fromCache, setFromCache] = useState(false);
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
    setFromCache(cached.length > 0);
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
          setFromCache(false);
          saveOwnerScopedTickets(token, ticketsRes.data);
        } else if (cached.length === 0) {
          setError({ body: ticketsRes.error });
        }
        if (boothsRes.data) setBooths(boothsRes.data);
      })
      .catch(() => {
        if (active && cached.length === 0) setError({ body: null });
      })
      .finally(() => {
        if (active) setLoading(false);
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
        setFeedback({ text: t.bookmarkRemovedFeedback, tone: "success", undo: { booth, index } });
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

  const signIn = signInPath(undefined, "/me");
  const staffDestinations = staff.state.status === "ready" ? staff.state.destinations : null;
  const hasStaff = Boolean(staffDestinations && (staffDestinations.booths.length > 0 || staffDestinations.desks.length > 0));
  const staffSection = staffDestinations && hasStaff ? <StaffSection destinations={staffDestinations} locale={locale} /> : null;
  let body;
  if (loading && tickets.length === 0) {
    body = (
      <div role="status" aria-label={copy.title} className="space-y-3">
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" />
      </div>
    );
  } else if (error && tickets.length === 0) {
    body = (
      <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-status-danger-border bg-status-danger-bg p-5 text-sm text-status-danger-text">
        <p className="flex items-start gap-2.5 font-semibold">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          {copy.loadFailed}
        </p>
        {error.body !== null && readableApiError(error.body, locale) && <p className="text-xs leading-relaxed">{readableApiError(error.body, locale)}</p>}
        <Button type="button" variant="secondary" size="md" className="self-start" onClick={() => setAttempt((n) => n + 1)}>
          <Icon name="sync" size={16} />
          {copy.retry}
        </Button>
      </div>
    );
  } else if (!hasCards && token && hasStaff) {
    // Booth staff and desk operators without a pass of their own: their workplaces above, a quiet note here.
    body = (
      <p className="flex items-center gap-2.5 rounded-2xl border border-dashed border-border-strong px-4 py-3 text-sm text-text-secondary">
        <Icon name="ticket" size={18} className="shrink-0 text-ink-300" />
        {copy.noPassNote}
      </p>
    );
  } else if (!hasCards && token) {
    body = (
      <div className="rounded-2xl border border-dashed border-border-strong p-6 text-center sm:p-8">
        <Icon name="congress" size={28} className="mx-auto text-ink-300" />
        <h2 className="mt-3 text-lg font-semibold text-text-primary">{copy.emptyTitle}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-secondary">{copy.emptyBody}</p>
      </div>
    );
  } else {
    body = (
      <div className="space-y-8">
        {fromCache && (
          <p role="status" className="flex items-center gap-2 text-xs font-medium text-status-warning-text">
            <Icon name="wifi-off" size={16} />
            {copy.offlineCopy}
          </p>
        )}
        {GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => (
          <section key={g} aria-labelledby={`me-${g}`} className="space-y-3">
            <h2 id={`me-${g}`} className="text-sm font-semibold text-text-muted">{copy.groups[g]}</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {groups[g].map((card) => (
                <li key={card.slug}>
                  <CongressCardLink card={card} locale={locale} />
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
      <div className="mx-auto max-w-4xl space-y-8 px-4 pt-6 sm:px-6 sm:pt-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text-primary sm:text-3xl">{copy.title}</h1>
          {(token || hasCards) && <p className="text-sm text-text-secondary">{copy.lead}</p>}
        </header>

        {feedback && (
          <div
            role={feedback.tone === "danger" ? "alert" : "status"}
            className={`flex flex-wrap items-center gap-2.5 rounded-2xl border px-4 py-3 text-xs font-medium motion-safe:animate-fade ${
              feedback.tone === "danger"
                ? "border-status-danger-border bg-status-danger-bg text-status-danger-text"
                : "border-action-subtle-border bg-action-subtle text-action-primary"
            }`}
          >
            <Icon name={feedback.tone === "danger" ? "alert" : "check-circle"} size={18} />
            <span className="flex-1">{feedback.text}</span>
            {feedback.undo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={removingBoothId === feedback.undo.booth.booth_id}
                onClick={() => feedback.undo && undoRemove(feedback.undo)}
                className="min-h-11"
              >
                {copy.undo}
              </Button>
            )}
          </div>
        )}

        {/* With passes of their own, the congresses come first; without, the workplaces lead. */}
        {!hasCards && staffSection}
        {staff.state.status === "error" && (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-status-danger-border bg-status-danger-bg px-4 py-3 text-xs text-status-danger-text">
            <Icon name="alert" size={16} className="shrink-0" />
            <span className="flex-1">
              <span className="font-semibold">{copy.staffFailed}</span>
              {staff.state.error !== null && <> {localizedApiError(staff.state.error, locale)}</>}
            </span>
            <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={staff.retry}>
              <Icon name="sync" size={16} />
              {copy.retry}
            </Button>
          </div>
        )}

        {body}
        {hasCards && staffSection}

        {!token && (
          <section
            aria-labelledby="me-find"
            className="relative overflow-hidden shape-arc-lg border border-border-default bg-surface-panel p-6 shadow-soft sm:p-8"
          >
            <div aria-hidden="true" className="bg-meridian absolute inset-0 opacity-60" />
            <div className="relative space-y-4">
              {hasCards && <p className="text-xs leading-relaxed text-text-secondary">{copy.linkNote}</p>}
              <div className="space-y-2">
                <h2 id="me-find" className="text-xl font-semibold tracking-[-0.02em] text-text-primary">{copy.findTitle}</h2>
                <p className="text-sm leading-relaxed text-text-secondary">{copy.findBody}</p>
              </div>
              <LinkButton to={signIn} variant="primary" size="lg">
                {copy.findAction}
                <Icon name="arrow-right" size={18} />
              </LinkButton>
              <p className="text-xs text-text-muted">{copy.registerHint}</p>
            </div>
          </section>
        )}

        {/* Nobody signed in, or no congress yet: never a dead end, the listed congresses are one tap away. */}
        {!hasCards && !loading && !error && <PublicEventList locale={locale} variant="panel" headingId="me-public-events" />}

        {token && booths.length > 0 && (
          <section aria-labelledby="saved-booths-heading" className="space-y-5">
            <SectionHeader id="saved-booths-heading" title={t.savedBoothsHeading} description={t.savedBoothsDesc} />
            <ul className="divide-y divide-border-default border-y border-border-default">
              {booths.map((booth) => (
                <li key={booth.booth_id} className="flex items-start gap-4 py-4">
                  <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo">
                    <Icon name="bookmark" size={18} fill="currentColor" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <span className="block text-[11px] font-semibold text-aiteb-indigo">{booth.event_name}</span>
                    <h3 className="text-base font-semibold tracking-[-0.01em] text-text-primary break-words">{booth.name}</h3>
                    {booth.location && (
                      <p className="flex items-center gap-1.5 text-xs text-text-muted">
                        <Icon name="pin" size={14} className="text-ink-400" />
                        {booth.location}
                      </p>
                    )}
                    <Link
                      to={`/e/${booth.event_slug}/booths/${booth.booth_id}`}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded text-xs font-semibold text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
                    >
                      {t.viewBoothAction}
                      <Icon name="arrow-right" size={15} />
                    </Link>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={removingBoothId === booth.booth_id}
                    onClick={() => removeBooth(booth.booth_id)}
                    className="min-h-11 min-w-11 shrink-0 rounded-full px-0 hover:text-status-danger-text"
                    title={t.removeBookmarkAction}
                    aria-label={`${t.removeBookmarkAction}: ${booth.name}`}
                  >
                    <Icon name="x" size={18} />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AttendeeLayout>
  );
}
