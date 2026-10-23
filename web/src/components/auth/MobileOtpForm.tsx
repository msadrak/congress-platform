import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { apiErrorCode, createApiClient, localizedApiError, type AuthResponse } from "../../api/client";
import { errorMessages } from "../../lib/errorMessages";
import { asciiDigits, extractOtpCode, formatMobile, normalizeIranMobile } from "../../lib/mobile";
import { formatCountdown, retryDeadline, secondsLeft } from "../../lib/retryAfter";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

type Locale = "fa" | "en";
export type OtpStep = "mobile" | "code" | "profile";
/** The two throttled actions: asking for a code, and checking one. Each has its own lock. */
type LockScope = "request" | "verify";

const COPY = {
  en: {
    mobile: "Mobile number",
    mobileHint: "We will text you a one-time sign-in code.",
    mobileRequired: "Enter your mobile number.",
    mobileInvalid: "Enter a valid Iranian mobile number, e.g. 0912 345 6789.",
    sendCode: "Send code",
    sending: "Sending…",
    code: "Code from the SMS",
    codeSentTo: "We texted a code to",
    changeNumber: "Change number",
    codeRequired: "Enter the code from the SMS.",
    codeInvalid: "The code is wrong or has expired.",
    verify: "Continue",
    verifying: "Checking…",
    resend: "Send a new code",
    resendIn: (s: string) => `New code available in ${s} s`,
    profileTitle: "Welcome! Tell us who you are",
    profileLead: "This is your first sign-in with this number. Your name will appear on your pass.",
    fullName: "Full name",
    organization: "Organization (optional)",
    title: "Job title (optional)",
    nameRequired: "Enter your full name.",
    create: "Create my account",
    creating: "Creating…",
    lockedRequest: (t: string) => `Too many codes requested. You can ask for a new one in ${t}.`,
    lockedVerify: (t: string) => `Too many attempts. You can try again in ${t}.`,
    announceRequest: (s: string) => `Too many codes requested. You can ask for a new one in ${s} seconds.`,
    announceVerify: (s: string) => `Too many attempts. You can try again in ${s} seconds.`,
    unlocked: "You can try again now.",
    smsFailed: "The SMS could not be sent. Please try again in a moment.",
    expired: "The verification expired. Request a new code.",
    network: "Could not reach the server. Check your connection and try again.",
    server: "Sign-in is temporarily unavailable. Please try again shortly.",
  },
  fa: {
    mobile: "شماره موبایل",
    mobileHint: "یک کد ورود یک‌بارمصرف برایتان پیامک می‌شود.",
    mobileRequired: "شماره موبایل را وارد کنید.",
    mobileInvalid: "یک شماره موبایل معتبر وارد کنید؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹.",
    sendCode: "ارسال کد",
    sending: "در حال ارسال…",
    code: "کد پیامک‌شده",
    codeSentTo: "کد به این شماره پیامک شد:",
    changeNumber: "تغییر شماره",
    codeRequired: "کد پیامک‌شده را وارد کنید.",
    codeInvalid: "کد نادرست است یا اعتبارش تمام شده است.",
    verify: "ادامه",
    verifying: "در حال بررسی…",
    resend: "ارسال دوباره کد",
    resendIn: (s: string) => `ارسال دوباره تا ${s} ثانیه دیگر`,
    profileTitle: "خوش آمدید! خودتان را معرفی کنید",
    profileLead: "اولین بار است که با این شماره وارد می‌شوید. نام شما روی کارت ورود می‌آید.",
    fullName: "نام و نام خانوادگی",
    organization: "سازمان (اختیاری)",
    title: "سمت (اختیاری)",
    nameRequired: "نام و نام خانوادگی را وارد کنید.",
    create: "ساخت حساب",
    creating: "در حال ساخت حساب…",
    lockedRequest: (t: string) => `درخواست کد بیش از حد مجاز بود. ${t} دیگر می‌توانید کد تازه بگیرید.`,
    lockedVerify: (t: string) => `تعداد تلاش‌ها بیش از حد مجاز بود. ${t} دیگر می‌توانید دوباره تلاش کنید.`,
    announceRequest: (s: string) => `درخواست کد بیش از حد مجاز بود. ${s} ثانیه دیگر می‌توانید کد تازه بگیرید.`,
    announceVerify: (s: string) => `تعداد تلاش‌ها بیش از حد مجاز بود. ${s} ثانیه دیگر می‌توانید دوباره تلاش کنید.`,
    unlocked: "اکنون می‌توانید دوباره تلاش کنید.",
    smsFailed: "ارسال پیامک ممکن نشد. لطفاً کمی بعد دوباره تلاش کنید.",
    expired: "زمان تأیید تمام شد. کد تازه بگیرید.",
    network: "اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید.",
    server: "ورود فعلاً ممکن نیست. لطفاً کمی بعد دوباره تلاش کنید.",
  },
} as const;

type MessageKey =
  | "mobileRequired" | "mobileInvalid" | "codeRequired" | "codeInvalid" | "nameRequired"
  | "smsFailed" | "expired" | "network" | "server";

/**
 * What went wrong, kept as a description rather than text so the message follows a language toggle.
 * `api`: a body whose stable code has localized text; `text`: already localized by the host (desk login).
 */
type Problem = { kind: "copy"; key: MessageKey } | { kind: "api"; body: unknown } | { kind: "text"; text: string };
type Announcement = { kind: "locked"; scope: LockScope; seconds: number } | { kind: "unlocked" } | null;

const copyProblem = (key: MessageKey): Problem => ({ kind: "copy", key });

/** The auth routes answer status + English detail: unknown statuses show a localized code or a generic line. */
function apiProblem(body: unknown): Problem {
  const code = apiErrorCode(body);
  return code !== undefined && Object.hasOwn(errorMessages.en, code) ? { kind: "api", body } : copyProblem("server");
}

/**
 * Height of the on-screen keyboard over the layout viewport (iOS keeps the layout viewport and overlays the
 * keyboard; Android usually resizes, giving 0). Only measured while `enabled`.
 */
function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      setInset(0);
    };
  }, [enabled]);
  return inset;
}

export interface MobileOtpFormProps {
  locale: Locale;
  /** signin: attendees and booth staff (accounts are created on first use). desk: front-desk operators. */
  purpose?: "signin" | "desk";
  /** signin: receives the session after sign-in or sign-up. */
  onSignedIn?: (auth: AuthResponse) => void;
  /**
   * desk: exchanges the code for a desk session; resolves to an error message to show, or null on success.
   * A rejected promise is reported as a network error.
   */
  verifyDesk?: (mobile: string, code: string) => Promise<string | null>;
  /** Label of the final button on the code step (defaults to "Continue"). */
  verifyLabel?: string;
  /**
   * Called when the step changes. A host that passes it owns the heading of the profile step, so the form
   * leaves out its own profile title.
   */
  onStepChange?: (step: OtpStep) => void;
  /** Keep the profile step's submit button in view, above the on-screen keyboard (full-page hosts only). */
  stickySubmit?: boolean;
}

/**
 * Sign-in by mobile number and SMS code, the platform's only way for people to sign in. New numbers finish
 * with a short profile step. Errors are announced; the number and code fields accept Persian digits.
 * A 429 locks only the throttled action until its Retry-After deadline, with a visible countdown.
 */
export function MobileOtpForm({
  locale, purpose = "signin", onSignedIn, verifyDesk, verifyLabel, onStepChange, stickySubmit = false,
}: MobileOtpFormProps) {
  const copy = COPY[locale];
  const number = (n: number) => new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(n);
  const ids = {
    mobile: useId(), mobileHelp: useId(), code: useId(), codeHelp: useId(),
    name: useId(), organization: useId(), title: useId(), error: useId(), lock: useId(),
  };

  const [step, setStep] = useState<OtpStep>("mobile");
  const [mobileInput, setMobileInput] = useState("");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [codeLength, setCodeLength] = useState(6);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [locks, setLocks] = useState<Partial<Record<LockScope, number>>>({});
  const [announcement, setAnnouncement] = useState<Announcement>(null);
  const [signupToken, setSignupToken] = useState("");
  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [title, setTitle] = useState("");
  const [fieldError, setFieldError] = useState<Problem | null>(null);
  const [formError, setFormError] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // A response that arrives after the form is gone (dialog closed, page changed) must not sign anyone in.
  const aliveRef = useRef(true);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const keyboardInset = useKeyboardInset(stickySubmit && step === "profile");

  const lockedFor = (scope: LockScope) => {
    const until = locks[scope];
    return until === undefined ? 0 : secondsLeft(until, now);
  };
  const requestLocked = lockedFor("request") > 0;
  const verifyLocked = lockedFor("verify") > 0;
  const hasLock = locks.request !== undefined || locks.verify !== undefined;

  // One clock for the resend countdown and the rate-limit locks; it stops when nothing is counting down.
  // A lock whose deadline has passed is dropped on the tick that reaches it, and its end is announced once.
  useEffect(() => {
    if (!hasLock && (step !== "code" || resendAt <= Date.now())) return;
    const timer = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      const expired = (Object.keys(locks) as LockScope[]).filter((scope) => secondsLeft(locks[scope] ?? 0, at) === 0);
      if (expired.length === 0) return;
      setLocks((current) => {
        const next = { ...current };
        for (const scope of expired) delete next[scope];
        return next;
      });
      setAnnouncement({ kind: "unlocked" });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step, resendAt, hasLock, locks]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
    if (step === "profile") nameRef.current?.focus();
  }, [step]);

  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);

  const lock = (scope: LockScope, response: Response) => {
    const at = Date.now();
    const until = retryDeadline(response.headers.get("Retry-After"), at);
    setNow(at);
    setLocks((current) => ({ ...current, [scope]: until }));
    setAnnouncement({ kind: "locked", scope, seconds: secondsLeft(until, at) });
  };

  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFormError(null);
    try {
      await work();
    } catch {
      if (aliveRef.current) setFormError(copyProblem("network"));
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  };

  const sendCode = (target: string) =>
    run(async () => {
      const { data, error, response } = await createApiClient({ kind: "anonymous" }).POST("/api/auth/otp/request", {
        body: { mobile: target, purpose },
      });
      if (!aliveRef.current) return;
      if (data) {
        setMobile(data.mobile);
        setCodeLength(data.code_length);
        setResendAt(Date.now() + data.resend_after * 1000);
        setNow(Date.now());
        setCode("");
        setFieldError(null);
        setStep("code");
      } else if (response.status === 422) {
        setFieldError(copyProblem("mobileInvalid"));
      } else if (response.status === 429) {
        lock("request", response);
      } else if (response.status === 503) {
        setFormError(copyProblem("smsFailed"));
      } else {
        setFormError(apiProblem(error));
      }
    });

  const handleMobile = (event: FormEvent) => {
    event.preventDefault();
    if (requestLocked) return;
    if (!mobileInput.trim()) return setFieldError(copyProblem("mobileRequired"));
    const normalized = normalizeIranMobile(mobileInput);
    if (!normalized) return setFieldError(copyProblem("mobileInvalid"));
    setFieldError(null);
    void sendCode(normalized);
  };

  const submitCode = (value: string) =>
    run(async () => {
      if (purpose === "desk") {
        const problem = verifyDesk ? await verifyDesk(mobile, value) : null;
        if (!aliveRef.current) return;
        if (!verifyDesk) setFormError(copyProblem("server"));
        else if (problem) setFormError({ kind: "text", text: problem });
        return;
      }
      const { data, error, response } = await createApiClient({ kind: "anonymous" }).POST("/api/auth/otp/verify", {
        body: { mobile, code: value },
      });
      if (!aliveRef.current) return;
      if (data?.status === "signed_in" && data.access_token && data.user) {
        onSignedIn?.({ access_token: data.access_token, token_type: data.token_type, user: data.user });
      } else if (data?.status === "profile_required" && data.signup_token) {
        setSignupToken(data.signup_token);
        setStep("profile");
      } else if (response.status === 401 || response.status === 422) {
        setFieldError(copyProblem("codeInvalid"));
        codeRef.current?.select();
      } else if (response.status === 429) {
        lock("verify", response);
      } else {
        setFormError(apiProblem(error));
      }
    });

  const handleCode = (event: FormEvent) => {
    event.preventDefault();
    if (verifyLocked) return;
    const value = asciiDigits(code).replace(/\D/g, "");
    if (!value) return setFieldError(copyProblem("codeRequired"));
    setFieldError(null);
    void submitCode(value);
  };

  /** Typed, pasted or autofilled code: errors clear on edit, and a complete code submits itself. */
  const takeCode = (shown: string, digits: string) => {
    setCode(shown);
    setFieldError(null);
    setFormError(null);
    // Submit as soon as the whole code is there (also when the phone autofills it from the SMS).
    if (digits.length === codeLength && !busyRef.current && !verifyLocked) void submitCode(digits);
  };

  const handleCodePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!pasted) return;
    event.preventDefault();
    const digits = extractOtpCode(pasted, codeLength);
    takeCode(digits, digits);
  };

  const handleProfile = (event: FormEvent) => {
    event.preventDefault();
    if (!fullName.trim()) return setFieldError(copyProblem("nameRequired"));
    setFieldError(null);
    void run(async () => {
      const { data, error, response } = await createApiClient({ kind: "anonymous" }).POST("/api/auth/otp/complete", {
        body: { signup_token: signupToken, full_name: fullName.trim(), organization: organization.trim(), title: title.trim() },
      });
      if (!aliveRef.current) return;
      if (data) {
        onSignedIn?.(data);
      } else if (response.status === 401) {
        setStep("mobile");
        setFormError(copyProblem("expired"));
      } else {
        setFormError(apiProblem(error));
      }
    });
  };

  const say = (problem: Problem) =>
    problem.kind === "copy" ? copy[problem.key] : problem.kind === "api" ? localizedApiError(problem.body, locale) : problem.text;

  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const errorText = "mt-1.5 flex items-center gap-1.5 text-xs font-medium text-status-danger-text";
  // aria-disabled rather than disabled: a disabled button drops keyboard and screen-reader focus to the page.
  // `run` and the submit handlers ignore activations while busy or locked.
  const lockedButton = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55 aria-disabled:active:scale-100";
  const alert = formError && (
    <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-sm text-status-danger-text">
      <Icon name="alert" size={18} className="mt-px shrink-0" />
      {say(formError)}
    </p>
  );
  // The countdown is visible but not live (it would be read every second); the live region below speaks
  // only when a lock starts and when it ends.
  const lockScope: LockScope | null =
    step === "code" && verifyLocked ? "verify" : step !== "profile" && requestLocked ? "request" : null;
  // The countdown is isolated left-to-right (U+2066…U+2069) so "1:27" never reorders inside Persian text.
  const lockNotice = lockScope && (
    <p id={ids.lock} data-testid="otp-rate-limit" className="flex items-start gap-2.5 rounded-xl border border-status-warning-border bg-status-warning-bg p-3.5 text-sm text-status-warning-text">
      <Icon name="clock" size={18} className="mt-px shrink-0" />
      <span>
        {(lockScope === "verify" ? copy.lockedVerify : copy.lockedRequest)(`\u2066${formatCountdown(lockedFor(lockScope), locale)}\u2069`)}
      </span>
    </p>
  );
  const liveRegion = (
    <span className="sr-only" aria-live="polite" data-testid="otp-announcer">
      {announcement?.kind === "locked"
        ? (announcement.scope === "verify" ? copy.announceVerify : copy.announceRequest)(number(announcement.seconds))
        : announcement?.kind === "unlocked"
          ? copy.unlocked
          : ""}
    </span>
  );
  const countdownBadge = (seconds: number) => (
    <span aria-hidden="true" className="font-mono text-[13px] tabular-nums opacity-80">{formatCountdown(seconds, locale)}</span>
  );

  if (step === "mobile") {
    return (
      <form onSubmit={handleMobile} noValidate className="space-y-5" data-testid="otp-mobile-step">
        {alert}
        {lockNotice}
        {liveRegion}
        <div>
          <label htmlFor={ids.mobile} className="ui-label">{copy.mobile}</label>
          <input
            id={ids.mobile}
            type="tel"
            name="mobile"
            dir="ltr"
            autoComplete="tel-national"
            inputMode="tel"
            placeholder="09xx xxx xxxx"
            value={mobileInput}
            onChange={(e) => {
              setMobileInput(e.target.value);
              setFieldError(null);
            }}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? ids.error : ids.mobileHelp}
            className="ui-input min-h-12 text-start font-mono tracking-wide"
          />
          {fieldError ? (
            <p id={ids.error} role="alert" className={errorText}>{say(fieldError)}</p>
          ) : (
            <p id={ids.mobileHelp} className="mt-1.5 text-xs text-text-muted">{copy.mobileHint}</p>
          )}
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          isFullWidth
          aria-busy={busy}
          aria-disabled={busy || requestLocked || undefined}
          aria-describedby={requestLocked ? ids.lock : undefined}
          className={lockedButton}
        >
          <Icon name="phone" size={18} />
          {busy ? copy.sending : copy.sendCode}
          {requestLocked && countdownBadge(lockedFor("request"))}
        </Button>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={handleCode} noValidate className="space-y-5" data-testid="otp-code-step">
        {alert}
        {lockNotice}
        {liveRegion}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-panel-subtle px-3.5 py-3 text-sm">
          <span className="text-text-secondary">
            {copy.codeSentTo}{" "}
            <bdi dir="ltr" className="font-mono font-semibold text-text-primary">{formatMobile(mobile, locale)}</bdi>
          </span>
          <button
            type="button"
            onClick={() => {
              setStep("mobile");
              setFieldError(null);
              setFormError(null);
            }}
            className="min-h-11 rounded-lg px-1 text-sm font-semibold text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
          >
            {copy.changeNumber}
          </button>
        </div>
        <div>
          <label htmlFor={ids.code} className="ui-label">{copy.code}</label>
          <input
            ref={codeRef}
            id={ids.code}
            type="text"
            name="code"
            dir="ltr"
            autoComplete="one-time-code"
            inputMode="numeric"
            value={code}
            onPaste={handleCodePaste}
            onChange={(e) => {
              // Keep the digits as typed (Persian, Arabic-Indic or ASCII); drop everything else.
              const shown = e.target.value.replace(/[^0-9۰-۹٠-٩]/g, "").slice(0, codeLength);
              takeCode(shown, asciiDigits(shown));
            }}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? ids.error : ids.codeHelp}
            className="ui-input min-h-12 text-center font-mono text-xl tracking-[0.5em]"
          />
          {fieldError ? (
            <p id={ids.error} role="alert" className={errorText}>{say(fieldError)}</p>
          ) : (
            <p id={ids.codeHelp} className="mt-1.5 text-xs text-text-muted">
              {resendSeconds > 0 ? copy.resendIn(number(resendSeconds)) : null}
            </p>
          )}
          <span className="sr-only" aria-live="polite">{resendSeconds === 0 && !requestLocked ? copy.resend : ""}</span>
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          isFullWidth
          aria-busy={busy}
          aria-disabled={busy || verifyLocked || undefined}
          aria-describedby={verifyLocked ? ids.lock : undefined}
          className={lockedButton}
        >
          {busy ? copy.verifying : verifyLabel ?? copy.verify}
          {verifyLocked && countdownBadge(lockedFor("verify"))}
        </Button>
        {resendSeconds === 0 && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            isFullWidth
            aria-disabled={busy || requestLocked || undefined}
            className={lockedButton}
            onClick={() => {
              if (!requestLocked && !busy) void sendCode(mobile);
            }}
          >
            <Icon name="sync" size={16} />
            {copy.resend}
            {requestLocked && countdownBadge(lockedFor("request"))}
          </Button>
        )}
      </form>
    );
  }

  const submit = (
    <Button type="submit" variant="primary" size="lg" isFullWidth aria-busy={busy} aria-disabled={busy || undefined} className={lockedButton}>
      {busy ? copy.creating : copy.create}
    </Button>
  );

  return (
    <form onSubmit={handleProfile} noValidate className="space-y-5" data-testid="otp-profile-step">
      {alert}
      <div className="space-y-1">
        {!onStepChange && <p className="text-base font-semibold text-text-primary">{copy.profileTitle}</p>}
        <p className="text-sm text-text-secondary">{copy.profileLead}</p>
      </div>
      <div>
        <label htmlFor={ids.name} className="ui-label">{copy.fullName}</label>
        <input
          ref={nameRef}
          id={ids.name}
          type="text"
          name="name"
          autoComplete="name"
          maxLength={200}
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            setFieldError(null);
          }}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? ids.error : undefined}
          className="ui-input min-h-12"
        />
        {fieldError && <p id={ids.error} role="alert" className={errorText}>{say(fieldError)}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={ids.organization} className="ui-label">{copy.organization}</label>
          <input id={ids.organization} type="text" name="organization" autoComplete="organization" maxLength={200}
            value={organization} onChange={(e) => setOrganization(e.target.value)} className="ui-input min-h-12" />
        </div>
        <div>
          <label htmlFor={ids.title} className="ui-label">{copy.title}</label>
          <input id={ids.title} type="text" name="title" autoComplete="organization-title" maxLength={100}
            value={title} onChange={(e) => setTitle(e.target.value)} className="ui-input min-h-12" />
        </div>
      </div>
      {stickySubmit ? (
        // Stays in view while the fields scroll, and rises above an on-screen keyboard that overlays the page.
        <div
          data-testid="otp-sticky-submit"
          style={{ bottom: keyboardInset }}
          className="sticky z-10 -mx-4 bg-surface-page/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none"
        >
          {submit}
        </div>
      ) : (
        submit
      )}
    </form>
  );
}
