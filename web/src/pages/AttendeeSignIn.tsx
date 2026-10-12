import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ATTENDEE_TOKEN_STORAGE, createApiClient, type UserOut } from "../api/client";
import { Button, LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { LoadingBlock } from "../components/ui/PortalState";
import { SkipLink } from "../components/ui/SkipLink";
import { congressPath, useCongressEvent } from "../lib/congressContext";
import { isStoredAttendeeToken, rejectAttendeeToken } from "../lib/attendeeSession";
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
  },
} as const;

const inputClass =
  "w-full px-3 py-3 min-h-[48px] bg-surface-panel border rounded-lg text-base text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary";

/**
 * Direct attendee sign-in: anonymous login against the existing User auth endpoint, then a
 * validated return to the intended congress destination. A still-valid session is kept.
 */
export default function AttendeeSignIn() {
  const { slug, boothId } = useParams<{ slug?: string; boothId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const localeHook = useAttendeeLocale();
  const { locale, setLocale, isRtl, dir } = localeHook;
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

  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-surface-page text-text-primary flex flex-col font-sans">
      <SkipLink targetId="attendee-sign-in">{copy.skip}</SkipLink>
      <header className="bg-surface-panel border-b border-border-default">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="font-bold text-sm sm:text-base tracking-tight rounded-lg focus-visible:outline-2 focus-visible:outline-focus-ring">
            {boothId ? (isRtl ? "پرتال غرفه" : "Exhibitor Portal") : isRtl ? "سامانه شرکت‌کنندگان" : "Attendee Portal"}
          </Link>
          <button
            type="button"
            onClick={() => setLocale(locale === "fa" ? "en" : "fa")}
            aria-label={copy.toggleLabel}
            className="text-xs font-semibold px-3 py-2 min-h-[40px] rounded-lg bg-surface-panel-subtle text-text-secondary border border-border-default hover:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
          >
            🌐 {copy.toggle}
          </button>
        </div>
      </header>

      <main id="attendee-sign-in" tabIndex={-1} className="flex-1 w-full max-w-md mx-auto px-4 py-8 sm:py-14 focus:outline-none">
        <Card className="p-6 sm:p-8 border-border-default space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">{boothId ? copy.boothTitle : copy.title}</h1>
            <p className="text-sm text-text-secondary">
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
            <p role="status" className="text-sm rounded-lg border border-border-default bg-surface-panel-subtle p-3 text-text-secondary">
              {copy.congressMissing}
            </p>
          )}

          {session.status === "checking" && <LoadingBlock label={copy.title} />}

          {session.status === "valid" && (
            <div className="space-y-4" data-testid="existing-session">
              <p className="text-sm text-text-secondary">
                {copy.signedInAs} <bdi className="font-semibold text-text-primary">{session.user.email}</bdi>
              </p>
              <LinkButton to={destination} replace variant="primary" size="lg" isFullWidth>
                {copy.continue} {isRtl ? "←" : "→"}
              </LinkButton>
              <Button type="button" variant="ghost" size="md" isFullWidth onClick={signOut}>
                {copy.signOut}
              </Button>
            </div>
          )}

          {session.status === "none" && (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {formError && (
                <p role="alert" className="text-sm rounded-lg border p-3 bg-status-danger-bg text-status-danger-text border-status-danger-border">
                  {formError}
                </p>
              )}

              <div>
                <label htmlFor={ids.email} className="block text-sm font-semibold text-text-primary mb-1.5">
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
                  className={`${inputClass} ${fieldErrors.email ? "border-status-danger-border" : "border-border-default"}`}
                />
                {fieldErrors.email && (
                  <p id={ids.emailError} className="mt-1.5 text-xs text-status-danger-text">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <label htmlFor={ids.password} className="block text-sm font-semibold text-text-primary mb-1.5">
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
                  className={`${inputClass} ${fieldErrors.password ? "border-status-danger-border" : "border-border-default"}`}
                />
                {fieldErrors.password && (
                  <p id={ids.passwordError} className="mt-1.5 text-xs text-status-danger-text">{fieldErrors.password}</p>
                )}
              </div>

              <Button type="submit" variant="primary" size="lg" isFullWidth disabled={submitting} aria-busy={submitting}>
                {submitting ? copy.submitting : copy.submit}
              </Button>
            </form>
          )}

          <div className="pt-4 border-t border-border-subtle text-sm text-text-secondary space-y-2">
            {boothId ? (
              <p>
                <Link to="/" className="font-semibold text-action-primary hover:underline">{copy.home}</Link>
              </p>
            ) : knownSlug ? (
              <p>
                {copy.noAccount}{" "}
                <Link to={`/e/${encodeURIComponent(knownSlug)}`} className="font-semibold text-action-primary hover:underline">
                  {copy.reserve}
                </Link>
              </p>
            ) : (
              <p>
                <Link to="/" className="font-semibold text-action-primary hover:underline">{copy.home}</Link>
              </p>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
