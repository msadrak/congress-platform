import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  apiErrorCode,
  createApiClient,
  localizedApiError,
  type PublicBoothOut,
} from "../api/client";
import { attendeeResponseState, isStoredAttendeeToken } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { usePageTitle } from "../hooks/usePageTitle";
import { PublicLayout } from "../layouts/PublicLayout";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Notice } from "../components/ui/Notice";
import { StateBlock } from "../components/ui/StateBlock";
import { contentLocale, proseDir, publicCopy, usePublicLocale } from "../components/public/copy";
import { Bidi } from "../components/public/Bidi";
import { BoothLogo } from "../components/BoothLogo";
import { signInPath } from "../lib/safeRedirect";
import { networkErrorMessage } from "../lib/errorMessages";

/** Bookmark feedback, always rendered in the page language. */
type FeedbackKey = "fbSessionChanged" | "fbSessionExpired" | "fbSaved" | "fbRemoved" | "fbUpdateFailed" | "fbLoadFailed";

/** A refusal with a stable code, in the page language; `register` offers the way to a pass. */
interface CodedFeedback {
  text: string;
  register?: boolean;
}

/** The standee QR's one-tap save (`?b=<secret>`). */
type StandeeState = { status: "idle" | "saving" } | { status: "saved"; already: boolean };

const LATIN_CODE = /^[\x20-\x7E]+$/;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function PublicBooth() {
  const { slug, boothId } = useParams<{ slug: string; boothId: string }>();
  const location = useLocation();
  // Standee QR: `/e/<slug>/booths/<id>?b=<secret>` lets a signed-in attendee save the booth in one tap.
  const [searchParams, setSearchParams] = useSearchParams();
  const standeeCode = searchParams.get("b")?.trim() || null;
  const [standee, setStandee] = useState<StandeeState>({ status: "idle" });
  const [codedFeedback, setCodedFeedback] = useState<CodedFeedback | null>(null);

  const [booth, setBooth] = useState<PublicBoothOut | null>(null);
  const [loading, setLoading] = useState(true);
  /** Why the profile could not be shown: the booth does not exist (404) or loading failed. */
  const [loadError, setLoadError] = useState<"notFound" | "failed" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [bookmarking, setBookmarking] = useState(false);
  const [bookmarkFeedback, setBookmarkFeedback] = useState<FeedbackKey | null>(null);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const bookmarkContext = useRef<{ active: boolean } | null>(null);

  const { token, expired } = useAttendeeSession();

  useEffect(() => {
    if (!slug || !boothId) return;
    let active = true;

    const loadBooth = async () => {
      setLoading(true);
      setBooth(null);
      setLoadError(null);
      setBookmarkFeedback(null);
      setCodedFeedback(null);
      try {
        const client = createApiClient({ kind: "anonymous" });
        const { data, error: err, response } = await client.GET(
          "/api/public/events/{slug}/booths/{booth_id}",
          { params: { path: { slug, booth_id: boothId } } }
        );
        if (!active) return;
        if (err) setLoadError(response.status === 404 ? "notFound" : "failed");
        else if (data) setBooth(data);
      } catch {
        if (active) setLoadError("failed");
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadBooth();
    return () => { active = false; };
  }, [slug, boothId, reloadKey]);

  useEffect(() => {
    const context = { active: true };
    bookmarkContext.current = context;
    const loadBookmarks = async () => {
      setIsBookmarked(false);
      setBookmarking(false);
      setBookmarkLoading(Boolean(token));
      if (!token || !slug || !boothId) return;
      try {
        const client = createApiClient({ kind: "user", token });
        const { data, error: err, response } = await client.GET("/api/attendees/me/bookmarks/booths");
        if (!context.active) return;
        const session = attendeeResponseState(token, response.status);
        if (session === "changed") return;
        if (session === "expired" || err) {
          setBookmarkFeedback(session === "expired" ? "fbSessionExpired" : "fbLoadFailed");
        } else if (data) {
          setIsBookmarked(data.some((saved) => saved.booth_id === boothId && saved.event_slug === slug));
        }
      } catch {
        if (context.active && isStoredAttendeeToken(token)) setBookmarkFeedback("fbLoadFailed");
      } finally {
        if (context.active) setBookmarkLoading(false);
      }
    };
    void loadBookmarks();
    return () => { context.active = false; };
  }, [slug, boothId, token]);

  const handleToggleBookmark = async () => {
    if (!token || !boothId || !booth || bookmarkLoading || bookmarking) return;
    // The rendered token can outlive the stored session (e.g. another tab signed in or out).
    if (!isStoredAttendeeToken(token)) {
      setBookmarkFeedback("fbSessionChanged");
      return;
    }

    const context = bookmarkContext.current;
    if (!context?.active) return;
    setBookmarking(true);
    setBookmarkFeedback(null);
    setCodedFeedback(null);
    try {
      const client = createApiClient({ kind: "user", token });
      const options = { params: { path: { booth_id: boothId } } };
      const { data, error: err, response } = isBookmarked
        ? await client.DELETE("/api/attendees/me/bookmarks/booths/{booth_id}", options)
        : await client.POST("/api/attendees/me/bookmarks/booths/{booth_id}", options);
      if (!context.active) return;
      const session = attendeeResponseState(token, response.status);
      if (session === "changed") return;
      if (session !== "expired" && apiErrorCode(err)) {
        setCodedFeedback(codedFeedbackFor(err));
      } else if (session === "expired" || err) {
        setBookmarkFeedback(session === "expired" ? "fbSessionExpired" : "fbUpdateFailed");
      } else if (data) {
        setIsBookmarked(data.bookmarked);
        setBookmarkFeedback(data.bookmarked ? "fbSaved" : "fbRemoved");
      }
    } catch {
      if (context.active && isStoredAttendeeToken(token)) setBookmarkFeedback("fbUpdateFailed");
    } finally {
      if (context.active) setBookmarking(false);
    }
  };

  const { locale, setLocale } = usePublicLocale(booth ? contentLocale(booth.event_name) : undefined);
  const c = publicCopy[locale];

  function codedFeedbackFor(error: unknown): CodedFeedback {
    return apiErrorCode(error) === "ACTIVE_TICKET_REQUIRED" ? { text: c.needsPass, register: true } : { text: localizedApiError(error, locale) };
  }

  // One tap on the standee card: the code is the booth's secret, checked by the server.
  const saveFromStandee = async () => {
    if (!token || !standeeCode || standee.status === "saving") return;
    if (!isStoredAttendeeToken(token)) {
      setBookmarkFeedback("fbSessionChanged");
      return;
    }
    const context = bookmarkContext.current;
    setStandee({ status: "saving" });
    setBookmarkFeedback(null);
    setCodedFeedback(null);
    try {
      const { data, error, response } = await createApiClient({ kind: "user", token }).POST("/api/attendees/me/bookmarks/booths/scan", {
        body: { code: standeeCode },
      });
      if (!context?.active) return;
      const session = attendeeResponseState(token, response.status);
      if (session === "changed") return;
      if (data) {
        setIsBookmarked(true);
        setStandee({ status: "saved", already: response.status === 200 });
        setBookmarkFeedback("fbSaved");
        // The secret has done its job: keep it out of the history and of a shared link.
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.delete("b");
          return next;
        }, { replace: true });
        return;
      }
      setStandee({ status: "idle" });
      if (session === "expired") setBookmarkFeedback("fbSessionExpired");
      else setCodedFeedback(apiErrorCode(error) ? codedFeedbackFor(error) : { text: c.fbUpdateFailed });
    } catch {
      if (!context?.active) return;
      setStandee({ status: "idle" });
      setCodedFeedback({ text: networkErrorMessage[locale] });
    }
  };
  usePageTitle(booth?.name, booth?.event_name);

  // Loading skeleton
  if (loading) {
    return (
      <PublicLayout locale={locale} onLocaleChange={setLocale}>
        {/* Fills the viewport so the footer never sits in view and jumps when content arrives (CLS). */}
        <section aria-busy="true" aria-label={c.loadingBooth} className="min-h-[100svh] bg-surface-ink">
          <div className="mx-auto max-w-7xl space-y-5 px-4 pt-10 pb-32 sm:px-6 lg:px-10 motion-safe:animate-pulse">
            <div className="h-4 w-40 rounded-full bg-white/10" />
            <div className="h-12 w-3/4 rounded-card bg-white/10" />
            <div className="h-5 w-1/3 rounded-full bg-white/10" />
          </div>
        </section>
      </PublicLayout>
    );
  }

  // Error / Not Found state
  if (loadError || !booth) {
    const notFound = loadError !== "failed";
    return (
      <PublicLayout locale={locale} onLocaleChange={setLocale} congressName="">
        <div className="mx-auto max-w-xl px-4 py-16 sm:py-24">
          <StateBlock
            kind={notFound ? "empty" : "error"}
            icon={notFound ? "booth" : undefined}
            title={notFound ? c.boothNotFound : c.boothLoadFailedTitle}
            body={notFound ? c.boothNotFoundBody : c.boothLoadFailed}
            action={
              <div className="flex flex-wrap justify-center gap-3">
                {!notFound && (
                  <Button type="button" variant="secondary" icon="sync" onClick={() => setReloadKey((k) => k + 1)}>
                    {c.retry}
                  </Button>
                )}
                <LinkButton to={slug ? `/e/${slug}` : "/"} variant={notFound ? "secondary" : "ghost"} icon="arrow-left">
                  {slug ? c.backToEvent : c.platformHome}
                </LinkButton>
              </div>
            }
          />
        </div>
      </PublicLayout>
    );
  }

  const brochureUrl = booth.brochure_url && /^https?:\/\//i.test(booth.brochure_url) ? booth.brochure_url : null;
  const websiteUrl = booth.website_url && /^https?:\/\//i.test(booth.website_url) ? booth.website_url : null;
  // A short Latin stand code ("A12") reads as a placard; anything else is a line of text under the name.
  const latinCode = Boolean(booth.location) && LATIN_CODE.test(booth.location) && booth.location.length <= 8;
  const feedbackKey: FeedbackKey | null = expired ? "fbSessionExpired" : bookmarkFeedback;
  // Saved / removed show in the button itself; screen readers still hear them.
  const quietFeedback = feedbackKey === "fbSaved" || feedbackKey === "fbRemoved";
  // A standee code saves through the booth's secret (one tap from the stand); otherwise the plain toggle.
  const useStandee = Boolean(token && standeeCode && !isBookmarked);
  const busy = bookmarking || standee.status === "saving";
  const linkCard = "flex min-h-14 items-center gap-3 rounded-card border border-border-default bg-surface-panel px-4 py-3 shadow-soft transition-colors hover:border-border-strong";

  return (
    <PublicLayout locale={locale} onLocaleChange={setLocale} congressName={booth.event_name}>
      <section aria-labelledby="booth-title" className="surface-ink bg-surface-ink text-white">
        <div className="mx-auto max-w-7xl space-y-6 px-4 pt-6 pb-10 sm:px-6 sm:pt-10 sm:pb-14 lg:px-10">
          <nav aria-label={c.breadcrumb}>
            <Link to={`/e/${slug}`} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-control text-body-sm font-semibold text-ink-200 transition-colors hover:text-white">
              <Icon name="arrow-left" size={18} />
              <span className="truncate">
                {c.backTo("")}
                <Bidi text={booth.event_name} />
              </span>
            </Link>
          </nav>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <BoothLogo src={booth.logo_url} alt={booth.name} size="header" className="border-transparent" />
              <div className="min-w-0 space-y-2">
                <h1 id="booth-title" className="text-title-lg font-bold text-white break-words sm:text-display">
                  <Bidi text={booth.name} />
                </h1>
                {booth.location && !latinCode && (
                  <p className="text-title-sm font-semibold text-ink-100 break-words">
                    <Bidi text={booth.location} />
                  </p>
                )}
              </div>
            </div>
            {latinCode && (
              <p className="shrink-0 rounded-card bg-white px-5 py-3 text-surface-ink">
                <span className="block text-caption font-semibold text-text-muted">{c.stand}</span>
                <span dir="ltr" className="block font-mono text-display font-medium leading-none text-event-accent">
                  {booth.location}
                </span>
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 pt-8 pb-16 sm:px-6 sm:pt-12 lg:grid-cols-12 lg:gap-16 lg:px-10">
        {/* Save, brochure, website */}
        <aside className="space-y-3 lg:order-last lg:col-span-5">
          <div className="space-y-4 rounded-card border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6">
            {token ? (
              <Button
                type="button"
                variant={isBookmarked ? "secondary" : "primary"}
                size="lg"
                isFullWidth
                aria-pressed={isBookmarked}
                disabled={bookmarkLoading}
                loading={busy}
                onClick={() => void (useStandee ? saveFromStandee() : handleToggleBookmark())}
              >
                <Icon name="bookmark" size={18} fill={isBookmarked ? "currentColor" : "none"} />
                {isBookmarked ? c.saved : c.save}
              </Button>
            ) : (
              <>
                <p className="text-body font-semibold text-text-primary">{c.signInToSave}</p>
                <LinkButton to={signInPath(slug, `${location.pathname}${location.search}`)} variant="primary" size="lg" isFullWidth icon="user">
                  {c.signInAndSave}
                </LinkButton>
              </>
            )}

            {codedFeedback && (
              <Notice
                tone="danger"
                action={
                  codedFeedback.register ? (
                    <Link to={`/e/${slug}`} className="inline-flex min-h-11 items-center gap-1 font-semibold underline underline-offset-4">
                      {c.getPass}
                      <Icon name="arrow-right" size={14} />
                    </Link>
                  ) : undefined
                }
              >
                {codedFeedback.text}
              </Notice>
            )}
            {feedbackKey && !quietFeedback && <Notice tone="warning">{c[feedbackKey]}</Notice>}
            {feedbackKey && quietFeedback && (
              <p role="status" className="sr-only">
                {c[feedbackKey]}
              </p>
            )}
          </div>

          {brochureUrl && (
            <a href={brochureUrl} target="_blank" rel="noopener noreferrer" className={linkCard}>
              <Icon name="download" size={20} className="shrink-0 text-event-accent" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-text-primary">{c.brochure}</span>
                <span className="block truncate text-caption text-text-muted">
                  <bdi dir="ltr">{hostOf(brochureUrl)}</bdi>
                </span>
              </span>
              <span className="sr-only">{c.opensNewTab}</span>
              <Icon name="arrow-up-right" size={18} className="shrink-0 text-text-muted" />
            </a>
          )}
          {websiteUrl && (
            <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className={linkCard}>
              <Icon name="globe" size={20} className="shrink-0 text-text-secondary" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-text-primary">{c.website}</span>
                <span className="block truncate text-caption text-text-muted">
                  <bdi dir="ltr">{hostOf(websiteUrl)}</bdi>
                </span>
              </span>
              <span className="sr-only">{c.opensNewTab}</span>
              <Icon name="arrow-up-right" size={18} className="shrink-0 text-text-muted" />
            </a>
          )}
        </aside>

        <div className="space-y-8 lg:col-span-7">
          {booth.description && (
            <section aria-labelledby="exhibitor-about" className="space-y-3">
              <h2 id="exhibitor-about" className="text-title font-bold text-text-primary">
                {c.aboutExhibitor}
              </h2>
              <p {...proseDir(booth.description)} className="whitespace-pre-line text-body leading-relaxed text-text-primary sm:text-title-sm">
                {booth.description}
              </p>
            </section>
          )}
          <p className="flex items-center gap-3 text-body-sm text-text-secondary">
            <Icon name="qr" size={20} className="shrink-0 text-aiteb-indigo" />
            {c.onSite}
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}
