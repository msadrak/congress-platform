import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { apiErrorCode, createApiClient, localizedApiError, type AuthResponse } from "../../api/client";
import { errorMessages } from "../../lib/errorMessages";
import { asciiDigits, extractOtpCode, normalizeIranMobile } from "../../lib/mobile";
import { codeFontClass, formatMobile, formatNumber } from "../../lib/format";
import { formatCountdown, retryDeadline, secondsLeft } from "../../lib/retryAfter";
import { otpCopy } from "../../copy/public";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { CodeInput, TextInput } from "../ui/Input";
import { Notice } from "../ui/Notice";

type Locale = "fa" | "en";
export type OtpStep = "mobile" | "code" | "profile";
/** The two throttled actions: asking for a code, and checking one. Each has its own lock. */
type LockScope = "request" | "verify";

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
  /**
   * signin: attendees and booth staff (accounts are created on first use). desk: front-desk operators.
   * organizer: organizer console members. Codes for desk and organizer only reach registered numbers.
   */
  purpose?: "signin" | "desk" | "organizer";
  /** signin: receives the session after sign-in or sign-up. */
  onSignedIn?: (auth: AuthResponse) => void;
  /**
   * desk and organizer: exchanges the code for a session; resolves to an error message to show, or null on
   * success. A rejected promise is reported as a network error.
   */
  verifyCode?: (mobile: string, code: string) => Promise<string | null>;
  /** Label of the final button on the code step (defaults to "Continue"). */
  verifyLabel?: string;
  /**
   * Called when the step changes. A host that passes it owns the heading of the profile step, so the form
   * leaves out its own profile title.
   */
  onStepChange?: (step: OtpStep) => void;
  /**
   * Keep the profile step's submit button in view while the fields scroll: `true` on a full page (it also rises
   * above an on-screen keyboard), `"dialog"` inside a `Dialog` body.
   */
  stickySubmit?: boolean | "dialog";
  /** Show the line under the mobile field (default true). A host whose button already says it leaves it out. */
  showMobileHint?: boolean;
  /** Heading of the profile step (default «خوش آمدید! …»); left out when the host passes `onStepChange`. */
  profileTitle?: string;
  /** The line under the profile heading; `null` leaves it out. */
  profileLead?: string | null;
  /** Label of the profile step's submit button (default «ساخت حساب»). */
  profileSubmitLabel?: string;
}

/**
 * Sign-in by mobile number and SMS code, the platform's only way for people to sign in. New numbers finish
 * with a short profile step. Errors are announced; the number and code fields accept Persian digits.
 * A 429 locks only the throttled action until its Retry-After deadline, with a visible countdown.
 */
export function MobileOtpForm({
  locale, purpose = "signin", onSignedIn, verifyCode, verifyLabel, onStepChange, stickySubmit = false,
  showMobileHint = true, profileTitle, profileLead, profileSubmitLabel,
}: MobileOtpFormProps) {
  const copy = otpCopy[locale];
  const number = (n: number) => formatNumber(n, locale);
  const lockId = useId();

  const [step, setStep] = useState<OtpStep>("mobile");
  const [mobileInput, setMobileInput] = useState("");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [codeLength, setCodeLength] = useState(6);
  // sms.ir did not confirm the send in time: the code may still arrive.
  const [deliveryUncertain, setDeliveryUncertain] = useState(false);
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
  const keyboardInset = useKeyboardInset(stickySubmit === true && step === "profile");

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
        setDeliveryUncertain(data.delivery === "uncertain");
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
        // Not configured or a platform SMS cap reached have their own text; anything else is a failed send.
        const known = apiProblem(error);
        setFormError(known.kind === "api" ? known : copyProblem("smsFailed"));
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
      if (purpose !== "signin") {
        const problem = verifyCode ? await verifyCode(mobile, value) : null;
        if (!aliveRef.current) return;
        if (!verifyCode) setFormError(copyProblem("server"));
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
  /** Field messages are announced as they appear. */
  const fieldMessage = fieldError ? <span role="alert">{say(fieldError)}</span> : undefined;
  // aria-disabled rather than disabled: a disabled button drops keyboard and screen-reader focus to the page.
  // `run` and the submit handlers ignore activations while busy or locked.
  const lockedButton = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55 aria-disabled:active:scale-100";
  const alert = formError && <Notice tone="danger">{say(formError)}</Notice>;
  // The countdown is visible but not live (it would be read every second); the live region below speaks
  // only when a lock starts and when it ends.
  const lockScope: LockScope | null =
    step === "code" && verifyLocked ? "verify" : step !== "profile" && requestLocked ? "request" : null;
  // The countdown is isolated left-to-right (U+2066…U+2069) so "1:27" never reorders inside Persian text.
  const lockNotice = lockScope && (
    <p id={lockId} data-testid="otp-rate-limit" className="flex items-start gap-2.5 rounded-control border border-status-warning-border bg-status-warning-bg p-3.5 text-body-sm text-status-warning-text">
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
    <span aria-hidden="true" className="tabular text-meta opacity-80">{formatCountdown(seconds, locale)}</span>
  );

  if (step === "mobile") {
    return (
      <form onSubmit={handleMobile} noValidate className="space-y-5" data-testid="otp-mobile-step">
        {alert}
        {lockNotice}
        {liveRegion}
        <Field label={copy.mobile} hint={showMobileHint ? copy.mobileHint : undefined} error={fieldMessage}>
          <TextInput
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
            className="text-start tabular tracking-wide"
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          isFullWidth
          icon="phone"
          aria-busy={busy}
          aria-disabled={busy || requestLocked || undefined}
          aria-describedby={requestLocked ? lockId : undefined}
          className={lockedButton}
        >
          {busy ? copy.sending : copy.sendCode}
          {requestLocked && countdownBadge(lockedFor("request"))}
        </Button>
      </form>
    );
  }

  if (step === "code") {
    const shownMobile = formatMobile(mobile, locale);
    return (
      <form onSubmit={handleCode} noValidate className="space-y-5" data-testid="otp-code-step">
        {alert}
        {lockNotice}
        {liveRegion}
        {deliveryUncertain && (
          <p role="status" data-testid="otp-delivery-uncertain" className="flex items-start gap-2.5 rounded-control border border-status-warning-border bg-status-warning-bg p-3.5 text-body-sm text-status-warning-text">
            <Icon name="clock" size={18} className="mt-px shrink-0" />
            <span>{copy.mayStillArrive}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-panel-subtle px-3.5 py-3 text-body-sm">
          <span className="text-text-secondary">
            {copy.codeSentTo}{" "}
            <bdi dir="ltr" className={`${codeFontClass(shownMobile)} font-semibold text-text-primary`}>{shownMobile}</bdi>
          </span>
          <button
            type="button"
            onClick={() => {
              setStep("mobile");
              setFieldError(null);
              setFormError(null);
            }}
            className="min-h-11 rounded-control px-1 text-body-sm font-semibold text-action-primary underline-offset-4 hover:underline cursor-pointer"
          >
            {copy.changeNumber}
          </button>
        </div>
        <div>
          <Field label={copy.code} hint={resendSeconds > 0 ? copy.resendIn(number(resendSeconds)) : undefined} error={fieldMessage}>
            <CodeInput
              ref={codeRef}
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              value={code}
              onPaste={handleCodePaste}
              onChange={(e) => {
                // Keep the digits as typed (Persian, Arabic-Indic or ASCII); drop everything else.
                const shown = e.target.value.replace(/[^0-9۰-۹٠-٩]/g, "").slice(0, codeLength);
                takeCode(shown, asciiDigits(shown));
              }}
              className="text-center text-title-sm tracking-[0.5em]"
            />
          </Field>
          <span className="sr-only" aria-live="polite">{resendSeconds === 0 && !requestLocked ? copy.resend : ""}</span>
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          isFullWidth
          aria-busy={busy}
          aria-disabled={busy || verifyLocked || undefined}
          aria-describedby={verifyLocked ? lockId : undefined}
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
            icon="sync"
            aria-disabled={busy || requestLocked || undefined}
            className={lockedButton}
            onClick={() => {
              if (!requestLocked && !busy) void sendCode(mobile);
            }}
          >
            {copy.resend}
            {requestLocked && countdownBadge(lockedFor("request"))}
          </Button>
        )}
      </form>
    );
  }

  const submit = (
    <Button type="submit" variant="primary" size="lg" isFullWidth aria-busy={busy} aria-disabled={busy || undefined} className={lockedButton}>
      {busy ? copy.creating : profileSubmitLabel ?? copy.create}
    </Button>
  );
  const lead = profileLead === undefined ? copy.profileLead : profileLead;

  return (
    <form onSubmit={handleProfile} noValidate className="space-y-5" data-testid="otp-profile-step">
      {alert}
      {(!onStepChange || lead) && (
        <div className="space-y-1">
          {!onStepChange && <p className="text-body font-semibold text-text-primary">{profileTitle ?? copy.profileTitle}</p>}
          {lead && <p className="text-body-sm text-text-secondary">{lead}</p>}
        </div>
      )}
      <Field label={copy.fullName} error={fieldMessage}>
        <TextInput
          ref={nameRef}
          name="name"
          autoComplete="name"
          maxLength={200}
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            setFieldError(null);
          }}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={copy.organization}>
          <TextInput name="organization" autoComplete="organization" maxLength={200} value={organization} onChange={(e) => setOrganization(e.target.value)} />
        </Field>
        <Field label={copy.title}>
          <TextInput name="title" autoComplete="organization-title" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      {stickySubmit === "dialog" ? (
        // Stays at the bottom of the dialog body while the fields scroll under it.
        <div data-testid="otp-sticky-submit" className="sticky bottom-0 z-10 -mx-5 bg-surface-panel px-5 pt-3 pb-1 sm:-mx-7 sm:px-7">
          {submit}
        </div>
      ) : stickySubmit ? (
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
