import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createApiClient, type AuthResponse } from "../../api/client";
import { asciiDigits, formatMobile, normalizeIranMobile } from "../../lib/mobile";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

type Locale = "fa" | "en";
type Step = "mobile" | "code" | "profile";

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
    profileLead: "This number is new to us. Your name appears on your pass.",
    fullName: "Full name",
    organization: "Organization (optional)",
    title: "Job title (optional)",
    nameRequired: "Enter your full name.",
    create: "Create my account",
    creating: "Creating…",
    tooMany: (s: string) => `Too many attempts. Try again in ${s} s.`,
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
    codeInvalid: "کد نادرست است یا منقضی شده است.",
    verify: "ادامه",
    verifying: "در حال بررسی…",
    resend: "ارسال دوباره کد",
    resendIn: (s: string) => `ارسال دوباره تا ${s} ثانیه دیگر`,
    profileTitle: "خوش آمدید! خودتان را معرفی کنید",
    profileLead: "این شماره تازه است. نام شما روی کارت ورود چاپ می‌شود.",
    fullName: "نام و نام خانوادگی",
    organization: "سازمان (اختیاری)",
    title: "سمت (اختیاری)",
    nameRequired: "نام و نام خانوادگی را وارد کنید.",
    create: "ساخت حساب",
    creating: "در حال ساخت…",
    tooMany: (s: string) => `تلاش‌های زیادی انجام شد. ${s} ثانیه دیگر دوباره تلاش کنید.`,
    smsFailed: "ارسال پیامک ممکن نشد. لطفاً کمی بعد دوباره تلاش کنید.",
    expired: "زمان تأیید به پایان رسید. کد تازه بگیرید.",
    network: "اتصال به سرور برقرار نشد. اینترنت خود را بررسی و دوباره تلاش کنید.",
    server: "ورود موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.",
  },
} as const;

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
}

function retryAfterSeconds(response: Response): number {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 60;
}

/**
 * Sign-in by mobile number and SMS code, the platform's only way for people to sign in. New numbers finish
 * with a short profile step. Errors are announced; the number and code fields accept Persian digits.
 */
export function MobileOtpForm({ locale, purpose = "signin", onSignedIn, verifyDesk, verifyLabel }: MobileOtpFormProps) {
  const copy = COPY[locale];
  const number = (n: number) => new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(n);
  const ids = {
    mobile: useId(), mobileHelp: useId(), code: useId(), codeHelp: useId(),
    name: useId(), organization: useId(), title: useId(), error: useId(),
  };

  const [step, setStep] = useState<Step>("mobile");
  const [mobileInput, setMobileInput] = useState("");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [codeLength, setCodeLength] = useState(6);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [signupToken, setSignupToken] = useState("");
  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [title, setTitle] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // A response that arrives after the form is gone (dialog closed, page changed) must not sign anyone in.
  const aliveRef = useRef(true);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Resend countdown.
  useEffect(() => {
    if (step !== "code" || resendAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step, resendAt]);

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

  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFormError(null);
    try {
      await work();
    } catch {
      if (aliveRef.current) setFormError(copy.network);
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  };

  const sendCode = (target: string) =>
    run(async () => {
      const { data, response } = await createApiClient({ kind: "anonymous" }).POST("/api/auth/otp/request", {
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
        setFieldError(copy.mobileInvalid);
      } else if (response.status === 429) {
        setFormError(copy.tooMany(number(retryAfterSeconds(response))));
      } else if (response.status === 503) {
        setFormError(copy.smsFailed);
      } else {
        setFormError(copy.server);
      }
    });

  const handleMobile = (event: FormEvent) => {
    event.preventDefault();
    if (!mobileInput.trim()) return setFieldError(copy.mobileRequired);
    const normalized = normalizeIranMobile(mobileInput);
    if (!normalized) return setFieldError(copy.mobileInvalid);
    setFieldError(null);
    void sendCode(normalized);
  };

  const submitCode = (value: string) =>
    run(async () => {
      if (purpose === "desk") {
        const problem = verifyDesk ? await verifyDesk(mobile, value) : copy.server;
        if (problem && aliveRef.current) setFormError(problem);
        return;
      }
      const { data, response } = await createApiClient({ kind: "anonymous" }).POST("/api/auth/otp/verify", {
        body: { mobile, code: value },
      });
      if (!aliveRef.current) return;
      if (data?.status === "signed_in" && data.access_token && data.user) {
        onSignedIn?.({ access_token: data.access_token, token_type: data.token_type, user: data.user });
      } else if (data?.status === "profile_required" && data.signup_token) {
        setSignupToken(data.signup_token);
        setStep("profile");
      } else if (response.status === 401 || response.status === 422) {
        setFieldError(copy.codeInvalid);
      } else if (response.status === 429) {
        setFormError(copy.tooMany(number(retryAfterSeconds(response))));
      } else {
        setFormError(copy.server);
      }
    });

  const handleCode = (event: FormEvent) => {
    event.preventDefault();
    const value = asciiDigits(code).replace(/\D/g, "");
    if (!value) return setFieldError(copy.codeRequired);
    setFieldError(null);
    void submitCode(value);
  };

  const handleProfile = (event: FormEvent) => {
    event.preventDefault();
    if (!fullName.trim()) return setFieldError(copy.nameRequired);
    setFieldError(null);
    void run(async () => {
      const { data, response } = await createApiClient({ kind: "anonymous" }).POST("/api/auth/otp/complete", {
        body: { signup_token: signupToken, full_name: fullName.trim(), organization: organization.trim(), title: title.trim() },
      });
      if (!aliveRef.current) return;
      if (data) {
        onSignedIn?.(data);
      } else if (response.status === 401) {
        setStep("mobile");
        setFormError(copy.expired);
      } else {
        setFormError(copy.server);
      }
    });
  };

  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const errorText = "mt-1.5 flex items-center gap-1.5 text-xs font-medium text-status-danger-text";
  const alert = formError && (
    <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-sm text-status-danger-text">
      <Icon name="alert" size={18} className="mt-px shrink-0" />
      {formError}
    </p>
  );

  if (step === "mobile") {
    return (
      <form onSubmit={handleMobile} noValidate className="space-y-5" data-testid="otp-mobile-step">
        {alert}
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
            onChange={(e) => setMobileInput(e.target.value)}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? ids.error : ids.mobileHelp}
            className="ui-input min-h-12 text-start font-mono tracking-wide"
          />
          {fieldError ? (
            <p id={ids.error} className={errorText}>{fieldError}</p>
          ) : (
            <p id={ids.mobileHelp} className="mt-1.5 text-xs text-text-muted">{copy.mobileHint}</p>
          )}
        </div>
        <Button type="submit" variant="primary" size="lg" isFullWidth disabled={busy} aria-busy={busy}>
          <Icon name="phone" size={18} />
          {busy ? copy.sending : copy.sendCode}
        </Button>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={handleCode} noValidate className="space-y-5" data-testid="otp-code-step">
        {alert}
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
            maxLength={8}
            value={code}
            onChange={(e) => {
              const value = e.target.value;
              setCode(value);
              const digits = asciiDigits(value).replace(/\D/g, "");
              // Submit as soon as the whole code is there (also when the phone autofills it from the SMS).
              if (digits.length === codeLength && !busyRef.current) {
                setFieldError(null);
                void submitCode(digits);
              }
            }}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? ids.error : ids.codeHelp}
            className="ui-input min-h-12 text-center font-mono text-xl tracking-[0.5em]"
          />
          {fieldError ? (
            <p id={ids.error} className={errorText}>{fieldError}</p>
          ) : (
            <p id={ids.codeHelp} className="mt-1.5 text-xs text-text-muted" aria-live="polite">
              {secondsLeft > 0 ? copy.resendIn(number(secondsLeft)) : null}
            </p>
          )}
        </div>
        <Button type="submit" variant="primary" size="lg" isFullWidth disabled={busy} aria-busy={busy}>
          {busy ? copy.verifying : verifyLabel ?? copy.verify}
        </Button>
        {secondsLeft === 0 && (
          <Button type="button" variant="ghost" size="md" isFullWidth disabled={busy} onClick={() => void sendCode(mobile)}>
            <Icon name="sync" size={16} />
            {copy.resend}
          </Button>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={handleProfile} noValidate className="space-y-5" data-testid="otp-profile-step">
      {alert}
      <div className="space-y-1">
        <p className="text-base font-semibold text-text-primary">{copy.profileTitle}</p>
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
          onChange={(e) => setFullName(e.target.value)}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? ids.error : undefined}
          className="ui-input min-h-12"
        />
        {fieldError && <p id={ids.error} className={errorText}>{fieldError}</p>}
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
      <Button type="submit" variant="primary" size="lg" isFullWidth disabled={busy} aria-busy={busy}>
        {busy ? copy.creating : copy.create}
      </Button>
    </form>
  );
}
