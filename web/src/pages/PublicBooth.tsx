import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  createApiClient,
  type PublicBoothOut,
} from "../api/client";
import { PublicLayout } from "../layouts/PublicLayout";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { CongressSignature } from "../components/brand/CongressSignature";
import { contentLocale, indexLabel, proseDir, publicCopy, usePublicLocale } from "../components/public/copy";
import { Bidi } from "../components/public/Bidi";

type FeedbackKey = "fbSignIn" | "fbSessionChanged" | "fbSaved" | "fbRemoved" | "fbUpdateFailed" | "fbLoadFailed";
/** Bookmark feedback: a page-copy message (rendered in the page language) or a server message as received. */
type BookmarkFeedback = { key: FeedbackKey } | { text: string };

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

  const [booth, setBooth] = useState<PublicBoothOut | null>(null);
  const [loading, setLoading] = useState(true);
  /** A server message as received, or `null` + `loadFailed` for a network failure (rendered in the page language). */
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [bookmarkFeedback, setBookmarkFeedback] = useState<BookmarkFeedback | null>(null);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const bookmarkContext = useRef<{ active: boolean } | null>(null);

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
      : null;

  useEffect(() => {
    if (!slug || !boothId) return;
    let active = true;

    const loadBooth = async () => {
      setLoading(true);
      setBooth(null);
      setError(null);
      setLoadFailed(false);
      setBookmarkFeedback(null);
      try {
        const client = createApiClient({ kind: "anonymous" });
        const { data, error: err } = await client.GET(
          "/api/public/events/{slug}/booths/{booth_id}",
          { params: { path: { slug, booth_id: boothId } } }
        );
        if (!active) return;
        if (err) setError(formatApiError(err));
        else if (data) setBooth(data);
      } catch {
        if (active) setLoadFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadBooth();
    return () => { active = false; };
  }, [slug, boothId]);

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
        if (!context.active || localStorage.getItem(ATTENDEE_TOKEN_STORAGE) !== token) return;
        if (err) {
          if (response.status === 401) localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
          setBookmarkFeedback({ text: `${response.status}: ${formatApiError(err)}` });
        } else if (data) {
          setIsBookmarked(data.some((saved) => saved.booth_id === boothId && saved.event_slug === slug));
        }
      } catch {
        if (context.active && localStorage.getItem(ATTENDEE_TOKEN_STORAGE) === token) setBookmarkFeedback({ key: "fbLoadFailed" });
      } finally {
        if (context.active) setBookmarkLoading(false);
      }
    };
    void loadBookmarks();
    return () => { context.active = false; };
  }, [slug, boothId, token]);

  const handleToggleBookmark = async () => {
    if (!boothId || !booth || bookmarkLoading || bookmarking) return;
    if (!token) {
      setBookmarkFeedback({ key: "fbSignIn" });
      return;
    }
    // The rendered token can outlive the stored session (e.g. another tab signed in or out).
    if (localStorage.getItem(ATTENDEE_TOKEN_STORAGE) !== token) {
      setBookmarkFeedback({ key: "fbSessionChanged" });
      return;
    }

    const context = bookmarkContext.current;
    if (!context?.active) return;
    setBookmarking(true);
    setBookmarkFeedback(null);
    try {
      const client = createApiClient({ kind: "user", token });
      const options = { params: { path: { booth_id: boothId } } };
      const { data, error: err, response } = isBookmarked
        ? await client.DELETE("/api/attendees/me/bookmarks/booths/{booth_id}", options)
        : await client.POST("/api/attendees/me/bookmarks/booths/{booth_id}", options);
      if (!context.active || localStorage.getItem(ATTENDEE_TOKEN_STORAGE) !== token) return;
      if (err) {
        if (response.status === 401) localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
        setBookmarkFeedback({ text: `${response.status}: ${formatApiError(err)}` });
      } else if (data) {
        setIsBookmarked(data.bookmarked);
        setBookmarkFeedback({ key: data.bookmarked ? "fbSaved" : "fbRemoved" });
      }
    } catch {
      if (context.active && localStorage.getItem(ATTENDEE_TOKEN_STORAGE) === token) setBookmarkFeedback({ key: "fbUpdateFailed" });
    } finally {
      if (context.active) setBookmarking(false);
    }
  };

  const { locale, setLocale } = usePublicLocale(booth ? contentLocale(booth.event_name) : undefined);
  const c = publicCopy[locale];

  // Loading skeleton
  if (loading) {
    return (
      <PublicLayout locale={locale} onLocaleChange={setLocale}>
        {/* Fills the viewport so the footer never sits in view and jumps when content arrives (CLS). */}
        <section aria-busy="true" className="relative min-h-[100svh] overflow-hidden bg-surface-ink">
          <div aria-hidden="true" className="absolute inset-0 bg-meridian-ink opacity-70" />
          <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 pt-10 pb-32 sm:px-6 lg:grid-cols-12 lg:items-end lg:px-10 motion-safe:animate-pulse">
            <div className="space-y-5 lg:col-span-8">
              <div className="h-4 w-40 rounded-full bg-white/10" />
              <div className="h-3 w-28 rounded-full bg-white/10" />
              <div className="h-14 w-3/4 rounded-2xl bg-white/10 sm:h-20" />
            </div>
            <div className="h-48 bg-white/10 shape-arc-lg lg:col-span-4" />
          </div>
        </section>
      </PublicLayout>
    );
  }

  // Error / Not Found state
  if (error || loadFailed || !booth) {
    return (
      <PublicLayout locale={locale} onLocaleChange={setLocale} congressName="">
        <section className="relative isolate overflow-hidden">
          <CongressSignature seed={slug ?? "booth"} tone="light" className="absolute inset-0 -z-10 size-full opacity-70" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-b from-surface-page/30 via-surface-page/85 to-surface-page" />
          <div className="mx-auto max-w-xl space-y-7 px-4 py-24 text-center sm:py-36">
            <span className="mx-auto grid size-16 place-items-center bg-surface-panel text-aiteb-indigo shadow-lift shape-arc">
              <Icon name="booth" size={28} />
            </span>
            <div className="space-y-3">
              <h1 className="text-3xl font-bold tracking-[-0.03em] text-text-primary sm:text-4xl">{c.boothNotFound}</h1>
              <p className="text-base leading-relaxed text-text-secondary">{error ?? (loadFailed ? c.boothLoadFailed : c.boothNotFoundBody)}</p>
            </div>
            <LinkButton to={slug ? `/e/${slug}` : "/"} variant="secondary" size="lg">
              <Icon name="arrow-left" size={18} />
              {slug ? c.backToEvent : c.platformHome}
            </LinkButton>
          </div>
        </section>
      </PublicLayout>
    );
  }

  const brochureUrl = booth.brochure_url && /^https?:\/\//i.test(booth.brochure_url) ? booth.brochure_url : null;
  const websiteUrl = booth.website_url && /^https?:\/\//i.test(booth.website_url) ? booth.website_url : null;
  const code = booth.location || c.mainFloor;
  const latinCode = Boolean(booth.location) && LATIN_CODE.test(booth.location) && booth.location.length <= 8;
  const feedbackText = bookmarkFeedback ? ("key" in bookmarkFeedback ? c[bookmarkFeedback.key] : bookmarkFeedback.text) : null;
  const feedbackOk = bookmarkFeedback !== null && "key" in bookmarkFeedback && (bookmarkFeedback.key === "fbSaved" || bookmarkFeedback.key === "fbRemoved");

  return (
    <PublicLayout locale={locale} onLocaleChange={setLocale} congressName={booth.event_name}>
      {/* Booth hero: exhibitor name + stand placard over the congress signature */}
      <section aria-labelledby="booth-title" className="relative isolate overflow-hidden bg-surface-ink text-white">
        <CongressSignature seed={slug ?? booth.event_slug} tone="ink" className="absolute inset-0 -z-20 size-full opacity-80 rtl:-scale-x-100" />
        <div aria-hidden="true" className="pub-hero-grid absolute inset-0 -z-10 bg-meridian-ink" />
        <div aria-hidden="true" className="pub-hero-scrim absolute inset-0 -z-10" />

        <div className="mx-auto max-w-7xl px-4 pt-6 pb-24 sm:px-6 sm:pt-10 sm:pb-32 lg:px-10">
          <nav aria-label={c.breadcrumb}>
            <Link
              to={`/e/${slug}`}
              className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-lg text-sm font-semibold text-ink-200 transition-colors hover:text-white focus-visible:outline-aiteb-orchid"
            >
              <Icon name="arrow-left" size={18} />
              <span className="truncate">{c.backTo("")}<Bidi text={booth.event_name} /></span>
            </Link>
          </nav>

          <div className="mt-8 grid grid-cols-1 gap-10 sm:mt-12 lg:grid-cols-12 lg:items-end lg:gap-12">
            <div className="space-y-5 lg:col-span-7 motion-safe:animate-rise">
              <p className="eyebrow text-ink-300">{c.exhibitorBooth}</p>
              <h1 id="booth-title" className="pub-display text-[clamp(2.4rem,7vw,5.5rem)] text-white break-words">
                <Bidi text={booth.name} />
              </h1>
              <p className="flex items-center gap-2 text-base text-ink-200">
                <Icon name="congress" size={18} className="text-aiteb-orchid" />
                <Bidi text={booth.event_name} />
              </p>
            </div>

            {/* Stand placard */}
            <div className="lg:col-span-5 motion-safe:animate-pop [animation-delay:160ms]">
              <div className="relative overflow-hidden bg-surface-panel p-6 text-text-primary shadow-glow shape-arc-lg sm:p-8">
                <div aria-hidden="true" className="absolute -end-20 -top-20 size-64 overflow-hidden rounded-full opacity-45">
                  <CongressSignature seed={`${slug}-${booth.slug}`} tone="light" className="size-full" />
                </div>
                <div className="relative">
                  <p className="eyebrow">{c.stand}</p>
                  <p
                    className={`mt-3 break-words text-event-accent ${
                      latinCode ? "pub-placard-code text-[clamp(3.5rem,13vw,6.5rem)]" : "text-[clamp(2rem,7vw,3.25rem)] font-bold leading-tight tracking-[-0.02em]"
                    }`}
                  >
                    {code}
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border-default pt-4 text-xs text-text-muted">
                    <span className="font-mono ltr-isolate">/{booth.slug}</span>
                    <span className="truncate"><Bidi text={booth.event_name} /></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="pub-sheet">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-4 pt-12 pb-20 sm:px-6 sm:pt-16 sm:pb-28 lg:grid-cols-12 lg:gap-16 lg:px-10">
          {/* Actions: bookmark, brochure, website */}
          <aside className="space-y-4 lg:order-last lg:col-span-5">
            <div className="space-y-4 rounded-2xl border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6">
              <div className="flex items-start gap-3">
                <span
                  className={`grid size-11 shrink-0 place-items-center rounded-xl transition-colors ${
                    isBookmarked ? "bg-event-accent text-white" : "bg-event-accent-soft text-event-accent"
                  }`}
                >
                  <Icon name="bookmark" size={20} fill={isBookmarked ? "currentColor" : "none"} />
                </span>
                <p className="pt-0.5 text-sm leading-relaxed text-text-secondary">{isBookmarked ? c.bookmarkedHint : c.bookmarkHint}</p>
              </div>
              <Button
                type="button"
                variant={isBookmarked ? "secondary" : "primary"}
                size="lg"
                isFullWidth
                aria-pressed={isBookmarked}
                disabled={bookmarking || bookmarkLoading}
                onClick={handleToggleBookmark}
              >
                <Icon name="bookmark" size={18} fill={isBookmarked ? "currentColor" : "none"} className={isBookmarked ? "text-event-accent" : ""} />
                <span>{isBookmarked ? c.bookmarked : c.bookmark}</span>
              </Button>

              {/* Bookmark Feedback Message */}
              {feedbackText && (
                <div
                  role="status"
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm leading-relaxed motion-safe:animate-fade ${
                    feedbackOk
                      ? "border-status-success-border bg-status-success-bg text-status-success-text"
                      : "border-status-warning-border bg-status-warning-bg text-status-warning-text"
                  }`}
                >
                  <Icon name={feedbackOk ? "check-circle" : "info"} size={18} className="mt-0.5" />
                  <span>{feedbackText}</span>
                </div>
              )}
            </div>

            {brochureUrl ? (
              <a
                href={brochureUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="press group flex items-center gap-4 bg-event-accent p-5 text-white shadow-lift transition-[filter] hover:brightness-110 shape-arc sm:p-6"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/15">
                  <Icon name="download" size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold leading-snug">{c.brochureDownload}</span>
                  <span className="block truncate text-xs text-white/75">
                    <span className="ltr-isolate">{hostOf(brochureUrl)}</span> · {c.opensNewTab}
                  </span>
                </span>
                <Icon name="arrow-up-right" size={20} className="shrink-0 transition-transform group-hover:-translate-y-0.5" />
              </a>
            ) : (
              <div className="flex items-center gap-4 rounded-2xl border border-dashed border-border-strong p-5 text-sm text-text-muted sm:p-6">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-surface-panel-subtle">
                  <Icon name="file" size={22} />
                </span>
                {c.brochureMissing}
              </div>
            )}

            {websiteUrl && (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 rounded-2xl border border-border-default bg-surface-panel p-5 shadow-soft transition-colors hover:border-border-strong sm:p-6"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-surface-panel-subtle text-text-secondary">
                  <Icon name="globe" size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-text-primary">{c.website}</span>
                  <span className="block truncate text-xs text-text-muted">
                    <span className="ltr-isolate">{hostOf(websiteUrl)}</span> · {c.opensNewTab}
                  </span>
                </span>
                <Icon name="arrow-up-right" size={20} className="shrink-0 text-text-muted transition-transform group-hover:-translate-y-0.5" />
              </a>
            )}
          </aside>

          {/* Company profile */}
          <div className="space-y-12 lg:col-span-7">
            <section aria-labelledby="exhibitor-about" className="space-y-5">
              <p className="flex items-center gap-3">
                <span className="pub-index">{indexLabel(1, locale)}</span>
                <span className="text-xs font-semibold text-text-muted">{c.sectionAboutEyebrow}</span>
              </p>
              <h2 id="exhibitor-about" className="text-3xl font-bold tracking-[-0.03em] text-text-primary sm:text-4xl rtl:leading-[1.4]">
                {c.aboutExhibitor}
              </h2>
              {booth.description ? (
                <p {...proseDir(booth.description)} className="whitespace-pre-line text-xl leading-[1.6] text-text-primary sm:text-2xl sm:leading-[1.55] rtl:leading-[1.95]">
                  {booth.description}
                </p>
              ) : (
                <p className="text-lg leading-relaxed text-text-secondary">
                  {c.defaultBoothDescription(booth.location || c.exhibitionArea)}
                </p>
              )}
            </section>

            {/* Standee QR information note */}
            <div className="flex gap-4 border-t border-border-default pt-8">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo [border-start-end-radius:18px]">
                <Icon name="qr" size={22} />
              </span>
              <div className="space-y-1">
                <p className="text-base font-semibold text-text-primary">{c.onSiteTitle}</p>
                <p className="text-sm leading-relaxed text-text-secondary">{c.onSiteBody}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
