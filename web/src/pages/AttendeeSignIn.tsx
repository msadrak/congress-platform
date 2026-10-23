import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createApiClient, type AuthResponse, type UserOut } from "../api/client";
import { MobileOtpForm, type OtpStep } from "../components/auth/MobileOtpForm";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { SkipLink } from "../components/ui/SkipLink";
import { AitebAttribution } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";
import { Avatar } from "../components/ui/Avatar";
import { PhaseBadge } from "../components/attendee/PhaseBadge";
import { formatDateRange } from "../components/attendee/congressTime";
import { congressPath, useCongressEvent } from "../lib/congressContext";
import { attendeeResponseState } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { usePageTitle } from "../hooks/usePageTitle";
import { eventAccentStyle } from "../lib/eventAccent";
import { formatMobile } from "../lib/mobile";
import { useLocale } from "../lib/i18n";
import { signInCopy } from "../copy/signIn";
import { safeNextPath } from "../lib/safeRedirect";

const OTHER_LOCALE = { fa: "en", en: "fa" } as const;

/** How long a still-valid session is shown before continuing on its own. */
const AUTO_CONTINUE_MS = 2000;

type SessionCheck =
  | { status: "checking" }
  | { status: "none" }
  // A token is stored but the server cannot confirm it (no network, or it is down): the destination takes over.
  | { status: "unverified" }
  | { status: "valid"; user: UserOut };

/**
 * Direct attendee sign-in by mobile number and SMS code (new numbers create their account here), then a
 * validated return to the intended congress destination. A still-valid session continues on its own after a
 * moment (unless the person reaches for the card), with a way to sign out instead.
 */
export default function AttendeeSignIn() {
  const { slug, boothId } = useParams<{ slug?: string; boothId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { locale, setLocale, dir } = useLocale();
  const copy = signInCopy[locale];
  const congress = useCongressEvent(slug);
  const congressMissing = Boolean(slug) && congress.status === "missing";
  const knownSlug = slug && !congressMissing ? slug : undefined;

  const fallback = boothId ? `/booth/${boothId}` : knownSlug ? congressPath(knownSlug, "my-congress") : "/me";
  const destination = safeNextPath(searchParams.get("next"), fallback);

  const { token, signIn, signOut: endSession } = useAttendeeSession();
  const [checkedSession, setSession] = useState<SessionCheck>(() => (token ? { status: "checking" } : { status: "none" }));
  // A session removed meanwhile (a 401 here or elsewhere, another tab) is never shown as signed in.
  const session: SessionCheck = token ? checkedSession : { status: "none" };

  useEffect(() => {
    if (!token) return;
    let active = true;
    createApiClient({ kind: "user", token })
      .GET("/api/auth/me")
      .then(({ data, response }) => {
        if (!active || attendeeResponseState(token, response.status) === "changed") return;
        if (data) setSession({ status: "valid", user: data });
        else setSession({ status: response.status >= 500 ? "unverified" : "none" });
      })
      .catch(() => {
        if (active) setSession({ status: "unverified" });
      });
    return () => {
      active = false;
    };
  }, [token]);

  // A stored session that cannot be checked right now (the phone is offline, e.g. the installed app opened at
  // the gate) is not a signed-out one: carry on, and let the destination show the cached pass. A rejected
  // token (401) is removed by the API client and never gets here.
  useEffect(() => {
    if (session.status === "unverified") navigate(destination, { replace: true });
  }, [session.status, destination, navigate]);

  // A valid session continues by itself; touching or focusing the card stops the timer so it can be read.
  const [autoContinue, setAutoContinue] = useState(true);
  useEffect(() => {
    if (session.status !== "valid" || !autoContinue) return;
    const timer = window.setTimeout(() => navigate(destination, { replace: true }), AUTO_CONTINUE_MS);
    return () => window.clearTimeout(timer);
  }, [session.status, autoContinue, destination, navigate]);

  const [step, setStep] = useState<OtpStep>("mobile");

  const signOut = () => {
    endSession();
    setSession({ status: "none" });
  };

  const handleSignedIn = (auth: AuthResponse) => {
    signIn(auth.access_token);
    navigate(destination, { replace: true });
  };

  const congressName = congress.status === "ready" ? congress.event.name : null;
  usePageTitle(boothId ? copy.boothTitle : copy.title, congressName);
  const seed = boothId ? `booth-${boothId}` : knownSlug ?? "attendee-portal";
  const portalLabel = boothId ? copy.portalExhibitor : copy.portalAttendee;
  const heading = boothId ? copy.boothTitle : step === "profile" ? copy.profileHeading : copy.title;
  const labelContent = (
    <>
      <Icon name={boothId ? "booth" : "ticket"} size={18} className="shrink-0" />
      {/* Below lg the panel is a slim strip that names the congress; the large panel names it on its own. */}
      <span className="truncate lg:hidden">{congressName ?? portalLabel}</span>
      <span className="hidden lg:inline">{portalLabel}</span>
    </>
  );
  const labelClass = "inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg text-sm font-semibold text-white/90";

  return (
    <div
      dir={dir}
      lang={locale}
      style={eventAccentStyle(knownSlug)}
      className="min-h-screen bg-surface-page text-text-primary font-sans lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <SkipLink targetId="attendee-sign-in">{copy.skip}</SkipLink>

      {/* Artwork: the congress (or booth) this sign-in leads to */}
      <section className="relative isolate overflow-hidden bg-surface-ink text-white lg:sticky lg:top-0 lg:h-screen">
        <CongressSignature seed={seed} tone="ink" animate className="absolute inset-0 -z-20 size-full" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-surface-ink via-surface-ink/60 to-surface-ink/10" />

        <div className="flex flex-col justify-between gap-8 px-4 pt-[env(safe-area-inset-top)] sm:px-8 lg:h-full lg:p-12">
          <div className="flex min-h-16 items-center justify-between gap-3">
            {knownSlug && !boothId ? (
              <Link
                to={`/e/${encodeURIComponent(knownSlug)}`}
                className={`${labelClass} hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid`}
              >
                {labelContent}
              </Link>
            ) : (
              <p className={labelClass}>{labelContent}</p>
            )}
            <button
              type="button"
              onClick={() => setLocale(OTHER_LOCALE[locale])}
              aria-label={copy.toggleLabel}
              className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15 hover:bg-white/15 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid"
            >
              <Icon name="globe" size={16} />
              <span lang={OTHER_LOCALE[locale]}>{copy.toggle}</span>
            </button>
          </div>

          <div className="hidden space-y-4 motion-safe:animate-rise lg:block">
            {!boothId && congress.status === "ready" ? (
              <>
                <PhaseBadge startsAt={congress.event.starts_at} endsAt={congress.event.ends_at} locale={locale} tone="ink" />
                <p className="max-w-md text-display font-semibold leading-tight text-balance">{congress.event.name}</p>
                <dl className="hidden max-w-md gap-x-8 gap-y-3 border-t border-white/15 pt-4 text-sm sm:grid sm:grid-cols-[auto_minmax(0,1fr)]">
                  <div className="space-y-0.5">
                    <dt className="text-xs text-ink-300">{copy.when}</dt>
                    <dd className="font-semibold">{formatDateRange(congress.event.starts_at, congress.event.ends_at, locale)}</dd>
                  </div>
                  {congress.event.location && (
                    <div className="min-w-0 space-y-0.5">
                      <dt className="text-xs text-ink-300">{copy.where}</dt>
                      <dd className="font-semibold break-words">{congress.event.location}</dd>
                    </div>
                  )}
                </dl>
              </>
            ) : (
              !boothId &&
              slug &&
              congress.status === "loading" && (
                <div aria-hidden="true" className="space-y-3">
                  <div className="h-3 w-28 rounded bg-white/10" />
                  <div className="h-9 w-64 max-w-full rounded-lg bg-white/10" />
                </div>
              )
            )}
          </div>
        </div>
      </section>

      {/* Form column */}
      <div className="flex min-h-full flex-col">
        <main id="attendee-sign-in" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 py-10 focus:outline-none sm:px-8 sm:py-14 lg:items-center lg:px-12">
          <div className="w-full max-w-md space-y-8">
            <div className="space-y-3">
              <span aria-hidden="true" className="hidden size-12 place-items-center rounded-card bg-aiteb-lavender text-aiteb-indigo sm:grid">
                <Icon name={boothId ? "booth" : "key"} size={22} />
              </span>
              <h1 className="text-title-lg font-semibold leading-tight text-text-primary text-balance">
                {heading}
              </h1>
              {boothId && <p className="text-body-sm leading-relaxed text-text-secondary">{copy.boothSubtitle}</p>}
            </div>

            {congressMissing && (
              <p role="status" className="flex items-start gap-2.5 rounded-xl border border-border-default bg-surface-panel-subtle p-3.5 text-sm text-text-secondary">
                <Icon name="info" size={18} className="mt-px shrink-0 text-aiteb-slate" />
                {copy.congressMissing}
              </p>
            )}

            {(session.status === "checking" || session.status === "unverified") && (
              <div role="status" aria-label={copy.title} className="space-y-4">
                <div className="skeleton h-5 w-2/3" />
                <div className="skeleton h-12" />
                <div className="skeleton h-12" />
              </div>
            )}

            {session.status === "valid" && (
              <div
                className="space-y-4"
                data-testid="existing-session"
                onFocus={() => setAutoContinue(false)}
                onPointerDown={() => setAutoContinue(false)}
              >
                <div className="flex items-center gap-4 rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft">
                  <Avatar name={session.user.full_name} seed={session.user.id} size="md" ring />
                  <p className="min-w-0 text-sm text-text-secondary">
                    {copy.signedInAs}{" "}
                    <bdi className="block truncate font-semibold text-text-primary">{session.user.full_name}</bdi>
                    {session.user.mobile && (
                      <bdi dir="ltr" className="block tabular text-caption text-text-muted">{formatMobile(session.user.mobile, locale)}</bdi>
                    )}
                  </p>
                </div>
                <LinkButton to={destination} replace variant="primary" size="lg" isFullWidth>
                  {copy.continue}
                  <Icon name="arrow-right" size={18} />
                </LinkButton>
                <p role="status" className="min-h-5 text-center text-xs text-text-muted">{autoContinue ? copy.continuing : ""}</p>
                <Button type="button" variant="ghost" size="md" isFullWidth onClick={signOut}>
                  {copy.signOut}
                </Button>
              </div>
            )}

            {session.status === "none" && (
              <MobileOtpForm locale={locale} onSignedIn={handleSignedIn} onStepChange={setStep} stickySubmit />
            )}

            {!boothId && step !== "profile" && (
              <div className="border-t border-border-default pt-5 text-sm text-text-secondary">
                {knownSlug ? (
                  <p>
                    {copy.noAccount}{" "}
                    <Link to={`/e/${encodeURIComponent(knownSlug)}`} className="inline-flex min-h-11 items-center rounded font-semibold text-action-primary underline-offset-4 hover:underline">
                      {copy.reserve}
                    </Link>
                  </p>
                ) : (
                  <p>{copy.noAccountGeneric}</p>
                )}
              </div>
            )}
          </div>
        </main>
        <footer className="px-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-8 lg:px-12">
          <div className="mx-auto max-w-md">
            <AitebAttribution locale={locale} />
          </div>
        </footer>
      </div>
    </div>
  );
}
