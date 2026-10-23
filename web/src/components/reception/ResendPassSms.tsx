import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PassSmsResendOut } from "../../api/client";
import { formatMobile } from "../../lib/mobile";
import { codeFontClass, type AttendeeLocale } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export type ResendOutcome =
  | { kind: "result"; data: PassSmsResendOut }
  /** 429: this pass was sent moments ago. */
  | { kind: "throttled"; retryAfter: number }
  /** 401 is handled by the caller (authority loss); anything else is a message to show. */
  | { kind: "error"; message: string }
  | { kind: "unauthorized" };

interface ResendPassSmsProps {
  mobile: string;
  locale: AttendeeLocale;
  isRtl: boolean;
  /** Sends the pass link again; resolves to what to show. A rejected promise is reported as a network error. */
  onResend: () => Promise<ResendOutcome>;
}

type State = { status: "idle" } | { status: "sending" } | { status: "done"; outcome: ResendOutcome };

/**
 * "Send the pass link again" for an attendee whose SMS did not arrive. Each press is a real SMS, so the
 * outcome is shown plainly and a press within the cooldown is refused by the API (429).
 */
export function ResendPassSms({ mobile, locale, isRtl, onResend }: ResendPassSmsProps) {
  const [state, setState] = useState<State>({ status: "idle" });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const send = async () => {
    if (state.status === "sending") return;
    setState({ status: "sending" });
    let outcome: ResendOutcome;
    try {
      outcome = await onResend();
    } catch {
      outcome = { kind: "error", message: isRtl ? "اتصال برقرار نشد؛ پیامک ارسال نشد. دوباره تلاش کنید." : "Could not reach the server; nothing was sent. Please try again." };
    }
    if (mounted.current && outcome.kind !== "unauthorized") setState({ status: "done", outcome });
  };

  const number = <bdi dir="ltr" className={codeFontClass(formatMobile(mobile, locale))}>{formatMobile(mobile, locale)}</bdi>;
  const outcome = state.status === "done" ? state.outcome : null;
  let tone: "success" | "warning" | "danger" = "success";
  let message: ReactNode = null;
  if (outcome?.kind === "result") {
    const { status, test_mode } = outcome.data;
    if (status === "sent") {
      message = test_mode ? (
        <>{isRtl ? "حالت آزمایشی: پیامک فقط ثبت شد و به گوشی نرسید " : "Test mode: recorded only, nothing reached "}{number}</>
      ) : (
        <>{isRtl ? "لینک کارت دوباره پیامک شد به " : "Pass link sent again to "}{number}</>
      );
      tone = test_mode ? "warning" : "success";
    } else if (status === "unknown") {
      tone = "warning";
      message = isRtl ? "پاسخ سامانه پیامک نرسید؛ ممکن است پیامک رسیده باشد. پیش از ارسال دوباره، کمی صبر کنید." : "The SMS gateway did not answer; the message may still arrive. Wait a moment before sending again.";
    } else {
      tone = "danger";
      message = isRtl ? "سامانه پیامک ارسال را نپذیرفت. کمی بعد دوباره تلاش کنید یا کارت را چاپ کنید." : "The SMS gateway refused the message. Try again shortly, or print the pass.";
    }
  } else if (outcome?.kind === "throttled") {
    tone = "warning";
    message = isRtl
      ? `این لینک همین الان ارسال شد. حدود ${new Intl.NumberFormat("fa-IR").format(outcome.retryAfter)} ثانیه دیگر دوباره تلاش کنید.`
      : `The link was just sent. Try again in about ${outcome.retryAfter} seconds.`;
  } else if (outcome?.kind === "error") {
    tone = "danger";
    message = outcome.message;
  }

  const toneClass = {
    success: "border-status-success-border bg-status-success-bg text-status-success-text",
    warning: "border-status-warning-border bg-status-warning-bg text-status-warning-text",
    danger: "border-status-danger-border bg-status-danger-bg text-status-danger-text",
  }[tone];

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" size="lg" isFullWidth className="whitespace-normal" onClick={() => void send()} disabled={state.status === "sending"} aria-busy={state.status === "sending"}>
        <Icon name={state.status === "sending" ? "sync" : "mail"} size={18} className={state.status === "sending" ? "motion-safe:animate-spin" : ""} />
        <span>
          {state.status === "sending"
            ? isRtl ? "در حال ارسال پیامک..." : "Sending SMS..."
            : isRtl ? "ارسال دوباره لینک کارت با پیامک" : "Resend pass link by SMS"}
        </span>
      </Button>
      <div role="status" aria-live="polite">
        {message && (
          <p className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed ${toneClass}`}>
            <Icon name={tone === "success" ? "check" : "alert"} size={16} className="mt-0.5 shrink-0" />
            <span>{message}</span>
          </p>
        )}
      </div>
    </div>
  );
}
