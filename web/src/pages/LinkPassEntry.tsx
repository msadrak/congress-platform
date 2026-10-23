import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createApiClient } from "../api/client";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { congressPath } from "../lib/congressContext";
import { linkPassCopy } from "../copy/linkPass";
import { useLocale } from "../lib/i18n";
import { linkOutcome, saveLinkPass, type LinkOutcome } from "../lib/linkPass";
import { signInPath } from "../lib/safeRedirect";
import { MobileOtpForm } from "../components/auth/MobileOtpForm";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon, type IconName } from "../components/ui/Icon";
import { LanguageToggle } from "../components/ui/LanguageToggle";
import { StateBlock } from "../components/ui/StateBlock";

interface Failure {
  outcome: LinkOutcome;
  /** Known for a real link that no longer works (410), so sign-in can go straight to that congress. */
  slug?: string;
}

/**
 * `/t/:code`, the short link in the ticket confirmation SMS (ADR 0015). Resolves the code, keeps the pass on
 * this device and replaces the address with the congress pass page, so the code leaves the address bar and
 * the history. A link that no longer works gets a friendly page with a way to sign in; an expired one (the pass
 * exists, the link is old) has the phone form right on it.
 */
export default function LinkPassEntry() {
  const { code = "" } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { locale, setLocale, dir } = useLocale();
  const c = linkPassCopy[locale];
  const { signIn } = useAttendeeSession();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    createApiClient(null)
      .POST("/api/public/passes/resolve", { body: { code } })
      .then(({ data, error, response }) => {
        if (!active) return;
        if (data) {
          // Without storage (a locked-down browser) the pass still reaches the page once, through history state.
          const stored = saveLinkPass(data);
          navigate(congressPath(data.event.slug, "my-ticket"), { replace: true, state: stored ? null : { linkPass: data } });
          return;
        }
        const slug = error && "event_slug" in error && error.event_slug ? error.event_slug : undefined;
        setFailure({ outcome: linkOutcome(response.status), slug });
      })
      .catch(() => {
        if (active) setFailure({ outcome: "offline" });
      });
    return () => {
      active = false;
    };
  }, [code, attempt, navigate]);

  const page = (content: ReactNode) => (
    <div dir={dir} lang={locale} className="flex min-h-dvh flex-col bg-surface-page text-text-primary">
      <header className="flex min-h-16 items-center justify-end px-4 pt-safe">
        <LanguageToggle locale={locale} onChange={setLocale} />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 pb-12">{content}</main>
    </div>
  );

  if (!failure) {
    return page(
      <div role="status" aria-busy="true" className="flex flex-col items-center gap-4 text-sm text-text-secondary">
        <span aria-hidden="true" className="grid size-14 place-items-center rounded-2xl bg-aiteb-lavender text-aiteb-indigo motion-safe:animate-pulse">
          <Icon name="ticket" size={26} />
        </span>
        {c.opening}
      </div>,
    );
  }

  const copy: Record<LinkOutcome, { icon: IconName; title: string; body: string }> = {
    expired: { icon: "hourglass", title: c.expiredTitle, body: c.expiredBody },
    invalid: { icon: "link", title: c.invalidTitle, body: c.invalidBody },
    throttled: { icon: "clock", title: c.throttledTitle, body: c.throttledBody },
    offline: { icon: "wifi-off", title: c.offlineTitle, body: c.offlineBody },
  };
  const { icon, title, body } = copy[failure.outcome];
  const signInTo = failure.slug
    ? signInPath(failure.slug, congressPath(failure.slug, "my-ticket"))
    : signInPath(undefined, "/me");

  return page(
    // Offline is a polite status; a dead or refused link is an announced error (StateBlock's alert).
    <div role={failure.outcome === "offline" ? "status" : undefined}>
      <StateBlock kind={failure.outcome === "offline" ? "empty" : "error"} icon={icon} headingLevel={1} title={title}>
        <p>{body}</p>
        <div className="flex flex-col gap-3">
          {failure.outcome === "offline" && (
            <Button
              type="button"
              variant="primary"
              size="lg"
              isFullWidth
              onClick={() => {
                setFailure(null);
                setAttempt((n) => n + 1);
              }}
            >
              <Icon name="sync" size={18} />
              {c.retry}
            </Button>
          )}
          {failure.outcome === "expired" ? (
            <MobileOtpForm
              locale={locale}
              onSignedIn={(auth) => {
                signIn(auth.access_token);
                navigate(failure.slug ? congressPath(failure.slug, "my-ticket") : "/me", { replace: true });
              }}
            />
          ) : (
            <LinkButton to={signInTo} variant={failure.outcome === "offline" ? "secondary" : "primary"} size="lg" isFullWidth>
              {c.signIn}
              <Icon name="arrow-right" size={18} />
            </LinkButton>
          )}
        </div>
      </StateBlock>
    </div>,
  );
}
