import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ATTENDEE_TOKEN_STORAGE, createApiClient, type UserOut } from "../api/client";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { SkipLink } from "../components/ui/SkipLink";
import { AitebAttribution } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";
import { Monogram } from "../components/attendee/Monogram";
import { PhaseBadge } from "../components/attendee/PhaseBadge";
import { formatDateRange } from "../components/attendee/congressTime";
import { congressPath, useCongressEvent } from "../lib/congressContext";
import { isStoredAttendeeToken, rejectAttendeeToken } from "../lib/attendeeSession";
import { eventAccentStyle } from "../lib/eventAccent";
import { useAttendeeLocale } from "../lib/i18n";
import { safeNextPath } from "../lib/safeRedirect";
import { clearOwnerScopedTickets } from "../lib/ticketCache";

type SessionCheck =
  | { status: "checking" }
  | { status: "none" }
  | { status: "valid"; user: UserOut };

type FieldErrors = { email?: string; password?: string };

const COPY = {
  en: {
    title: "Sign in to your attendee portal",
    subtitleCongress: "Continue to",
    subtitleGeneric: "Your passes and networking, in one place.",
    email: "Email address",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    emailRequired: "Enter your email address.",
    emailInvalid: "Enter a valid email address.",
    passwordRequired: "Enter your password.",
    invalid: "The email or password is incorrect.",
    network: "Could not reach the server. Check your connection and try again.",
    server: "Sign-in is temporarily unavailable. Please try again shortly.",
    signedInAs: "You are signed in as",
    continue: "Continue",
    signOut: "Use a different account",
    noAccount: "No account yet?",
    reserve: "Reserve a pass for this congress",
    congressMissing: "That congress could not be found. After signing in you will see your passes instead.",
    home: "Platform home",
    skip: "Skip to sign-in",
    boothTitle: "Sign in to your booth workspace",
    boothSubtitle: "Use the account your organizer assigned to this booth.",
    toggleLabel: "تغییر زبان به فارسی",
    toggle: "فارسی",
    portalAttendee: "Attendee Portal",
    portalExhibitor: "Exhibitor Portal",
    panelGeneric: "Your congress, in your pocket.",
    panelGenericLead: "Your pass, your connections and the exhibition — one sign-in for every congress you attend.",
    panelBoothLead: "Capture, qualify and export the leads your booth team meets.",
    when: "When",
    where: "Where",
  },
  fa: {
    title: "ورود به سامانه شرکت‌کنندگان",
    subtitleCongress: "ادامه به",
    subtitleGeneric: "کارت‌های ورود و شبکه ارتباطی شما در یک‌جا.",
    email: "نشانی ایمیل",
    password: "گذرواژه",
    submit: "ورود",
    submitting: "در حال ورود…",
    emailRequired: "نشانی ایمیل را وارد کنید.",
    emailInvalid: "یک نشانی ایمیل معتبر وارد کنید.",
    passwordRequired: "گذرواژه را وارد کنید.",
    invalid: "ایمیل یا گذرواژه نادرست است.",
    network: "اتصال به سرور برقرار نشد. اینترنت خود را بررسی و دوباره تلاش کنید.",
    server: "ورود موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.",
    signedInAs: "شما وارد شده‌اید با حساب",
    continue: "ادامه",
    signOut: "ورود با حساب دیگر",
    noAccount: "هنوز حساب ندارید؟",
    reserve: "رزرو کارت ورود برای این همایش",
    congressMissing: "این همایش پیدا نشد. پس از ورود، کارت‌های خودتان نمایش داده می‌شود.",
    home: "صفحه اصلی سامانه",
    skip: "پرش به فرم ورود",
    boothTitle: "ورود به فضای کاری غرفه",
    boothSubtitle: "با حسابی وارد شوید که برگزارکننده به این غرفه اختصاص داده است.",
    toggleLabel: "Switch language to English",
    toggle: "English",
    portalAttendee: "سامانه شرکت‌کنندگان",
    portalExhibitor: "پرتال غرفه",
    panelGeneric: "همایش شما، همیشه همراه شما.",
    panelGenericLead: "کارت ورود، ارتباطات و نمایشگاه؛ یک ورود برای همه همایش‌هایی که در آن شرکت می‌کنید.",
    panelBoothLead: "ثبت، ارزیابی و خروجی گرفتن از سرنخ‌هایی که تیم غرفه با آن‌ها آشنا می‌شود.",
    when: "زمان برگزاری",
    where: "محل برگزاری",
  },
} as const;

/**
 * Direct attendee sign-in: anonymous login against the existing User auth endpoint, then a
 * validated return to the intended congress destination. A still-valid session is kept.
 */
export default function AttendeeSignIn() {
  const { slug, boothId } = useParams<{ slug?: string; boothId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const localeHook = useAttendeeLocale();
  const { locale, setLocale, dir } = localeHook;
  const copy = COPY[locale];
  const congress = useCongressEvent(slug);
  const congressMissing = Boolean(slug) && congress.status === "missing";
  const knownSlug = slug && !congressMissing ? slug : undefined;

  const fallback = boothId ? `/booth/${boothId}` : knownSlug ? congressPath(knownSlug, "my-congress") : "/my-tickets";
  const destination = safeNextPath(searchParams.get("next"), fallback);

  const [session, setSession] = useState<SessionCheck>(() =>
    localStorage.getItem(ATTENDEE_TOKEN_STORAGE) ? { status: "checking" } : { status: "none" }
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const ids = { email: useId(), password: useId(), emailError: useId(), passwordError: useId() };

  useEffect(() => {
    const token = localStorage.getItem(ATTENDEE_TOKEN_STORAGE);
    if (!token) return;
    let active = true;
    createApiClient({ kind: "user", token })
      .GET("/api/auth/me")
      .then(({ data, response }) => {
        if (!active || !isStoredAttendeeToken(token)) return;
        if (data) {
          setSession({ status: "valid", user: data });
        } else {
          if (response.status === 401) rejectAttendeeToken(token);
          setSession({ status: "none" });
        }
      })
      .catch(() => {
        if (active) setSession({ status: "none" });
      });
    return () => {
      active = false;
    };
  }, []);

  const signOut = () => {
    clearOwnerScopedTickets(localStorage.getItem(ATTENDEE_TOKEN_STORAGE));
    localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
    setSession({ status: "none" });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const trimmed = email.trim();
    const errors: FieldErrors = {};
    if (!trimmed) errors.email = copy.emailRequired;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) errors.email = copy.emailInvalid;
    if (!password) errors.password = copy.passwordRequired;
    setFieldErrors(errors);
    setFormError(null);
    if (errors.email || errors.password) return;

    setSubmitting(true);
    try {
      const { data, response } = await createApiClient({ kind: "anonymous" }).POST("/api/auth/login", {
        body: { email: trimmed, password },
      });
      if (data) {
        localStorage.setItem(ATTENDEE_TOKEN_STORAGE, data.access_token);
        setPassword("");
        navigate(destination, { replace: true });
        return;
      }
      if (response.status === 401) setFormError(copy.invalid);
      else if (response.status === 422) setFieldErrors({ email: copy.emailInvalid });
      else setFormError(copy.server);
    } catch {
      setFormError(copy.network);
    }
    setSubmitting(false);
  };

  const congressName = congress.status === "ready" ? congress.event.name : null;
  const seed = boothId ? `booth-${boothId}` : knownSlug ?? "attendee-portal";
  const fieldError = "mt-1.5 flex items-center gap-1.5 text-xs font-medium text-status-danger-text";

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
        <div aria-hidden="true" className="bg-meridian-ink absolute inset-0 -z-10 opacity-50" />

        <div className="flex min-h-[15rem] flex-col justify-between gap-8 p-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:min-h-[18rem] sm:p-8 lg:h-full lg:p-12">
          <div className="flex items-center justify-between gap-3 pt-1">
            <Link
              to="/"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-white/90 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid"
            >
              <Icon name={boothId ? "booth" : "ticket"} size={18} />
              {boothId ? copy.portalExhibitor : copy.portalAttendee}
            </Link>
            <button
              type="button"
              onClick={() => setLocale(locale === "fa" ? "en" : "fa")}
              aria-label={copy.toggleLabel}
              className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15 hover:bg-white/15 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid"
            >
              <Icon name="globe" size={16} />
              <span lang={locale === "fa" ? "en" : "fa"}>{copy.toggle}</span>
            </button>
          </div>

          <div className="space-y-4 motion-safe:animate-rise">
            {boothId ? (
              <>
                <p className="max-w-md text-2xl font-semibold leading-[1.15] tracking-[-0.03em] text-balance sm:text-3xl lg:text-4xl">{copy.panelBoothLead}</p>
              </>
            ) : congress.status === "ready" ? (
              <>
                <PhaseBadge startsAt={congress.event.starts_at} endsAt={congress.event.ends_at} locale={locale} tone="ink" />
                <p className="max-w-md text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-balance sm:text-4xl lg:text-5xl">{congress.event.name}</p>
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
            ) : slug && congress.status === "loading" ? (
              <div aria-hidden="true" className="space-y-3">
                <div className="h-3 w-28 rounded bg-white/10" />
                <div className="h-9 w-64 max-w-full rounded-lg bg-white/10" />
              </div>
            ) : (
              <>
                <p className="max-w-md text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-balance sm:text-4xl lg:text-5xl">{copy.panelGeneric}</p>
                <p className="max-w-sm text-sm leading-relaxed text-ink-300">{copy.panelGenericLead}</p>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Form column */}
      <div className="flex min-h-full flex-col">
        <main id="attendee-sign-in" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 py-10 focus:outline-none sm:px-8 sm:py-14 lg:items-center lg:px-12">
          <div className="w-full max-w-md space-y-8">
            <div className="space-y-3">
              <span aria-hidden="true" className="grid size-12 place-items-center rounded-2xl [border-start-end-radius:20px] bg-aiteb-lavender text-aiteb-indigo">
                <Icon name={boothId ? "booth" : "key"} size={22} />
              </span>
              <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-text-primary text-balance sm:text-3xl">
                {boothId ? copy.boothTitle : copy.title}
              </h1>
              <p className="text-sm leading-relaxed text-text-secondary">
                {boothId ? (
                  copy.boothSubtitle
                ) : congressName ? (
                  <>
                    {copy.subtitleCongress} <span className="font-semibold text-text-primary">{congressName}</span>
                  </>
                ) : (
                  copy.subtitleGeneric
                )}
              </p>
            </div>

            {congressMissing && (
              <p role="status" className="flex items-start gap-2.5 rounded-xl border border-border-default bg-surface-panel-subtle p-3.5 text-sm text-text-secondary">
                <Icon name="info" size={18} className="mt-px shrink-0 text-aiteb-slate" />
                {copy.congressMissing}
              </p>
            )}

            {session.status === "checking" && (
              <div role="status" aria-label={copy.title} className="space-y-4">
                <div className="skeleton h-5 w-2/3" />
                <div className="skeleton h-12" />
                <div className="skeleton h-12" />
              </div>
            )}

            {session.status === "valid" && (
              <div className="space-y-4" data-testid="existing-session">
                <div className="flex items-center gap-4 rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft">
                  <Monogram name={session.user.full_name || session.user.email} seed={session.user.id} size="md" />
                  <p className="min-w-0 text-sm text-text-secondary">
                    {copy.signedInAs}{" "}
                    <bdi className="block truncate font-semibold text-text-primary">{session.user.email}</bdi>
                  </p>
                </div>
                <LinkButton to={destination} replace variant="primary" size="lg" isFullWidth>
                  {copy.continue}
                  <Icon name="arrow-right" size={18} />
                </LinkButton>
                <Button type="button" variant="ghost" size="md" isFullWidth onClick={signOut}>
                  {copy.signOut}
                </Button>
              </div>
            )}

            {session.status === "none" && (
              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                {formError && (
                  <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-sm text-status-danger-text">
                    <Icon name="alert" size={18} className="mt-px shrink-0" />
                    {formError}
                  </p>
                )}

                <div>
                  <label htmlFor={ids.email} className="ui-label">
                    {copy.email}
                  </label>
                  <input
                    id={ids.email}
                    type="email"
                    name="email"
                    dir="ltr"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? ids.emailError : undefined}
                    className="ui-input min-h-12 text-start"
                  />
                  {fieldErrors.email && (
                    <p id={ids.emailError} className={fieldError}>{fieldErrors.email}</p>
                  )}
                </div>

                <div>
                  <label htmlFor={ids.password} className="ui-label">
                    {copy.password}
                  </label>
                  <input
                    id={ids.password}
                    type="password"
                    name="password"
                    dir="ltr"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? ids.passwordError : undefined}
                    className="ui-input min-h-12 text-start"
                  />
                  {fieldErrors.password && (
                    <p id={ids.passwordError} className={fieldError}>{fieldErrors.password}</p>
                  )}
                </div>

                <Button type="submit" variant="primary" size="lg" isFullWidth disabled={submitting} aria-busy={submitting}>
                  {submitting ? copy.submitting : copy.submit}
                </Button>
              </form>
            )}

            <div className="border-t border-border-default pt-5 text-sm text-text-secondary">
              {boothId ? (
                <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action-primary underline-offset-4 hover:underline">
                  {copy.home}
                  <Icon name="arrow-right" size={16} />
                </Link>
              ) : knownSlug ? (
                <p>
                  {copy.noAccount}{" "}
                  <Link to={`/e/${encodeURIComponent(knownSlug)}`} className="font-semibold text-action-primary underline-offset-4 hover:underline">
                    {copy.reserve}
                  </Link>
                </p>
              ) : (
                <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action-primary underline-offset-4 hover:underline">
                  {copy.home}
                  <Icon name="arrow-right" size={16} />
                </Link>
              )}
            </div>
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
