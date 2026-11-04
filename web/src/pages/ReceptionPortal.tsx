import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createApiClient } from "../api/client";
import { OperatorGate } from "../components/operator/OperatorGate";
import { ReceptionStation } from "../components/reception/ReceptionStation";
import { Button, LinkButton } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { CodeInput } from "../components/ui/Input";
import { LanguageToggle } from "../components/ui/LanguageToggle";
import { SkipLink } from "../components/ui/SkipLink";
import { Spinner } from "../components/ui/Spinner";
import { commonCopy } from "../copy/common";
import { deskCopy } from "../copy/desk";
import { useCopy } from "../copy/useCopy";
import { usePageTitle } from "../hooks/usePageTitle";
import { useLocale } from "../lib/i18n";
import "../styles/reception.css";

const EVENT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SLUG = /^[A-Za-z0-9_-]+$/;
const MAIN_ID = "reception-main-content";

/** Independent reception shell: no organizer navigation, no organizer credential, desk authority only. */
function ReceptionShell({ children }: { children: ReactNode }) {
  const { locale, dir } = useLocale();
  const c = useCopy(deskCopy, locale);
  usePageTitle(c.title);
  return (
    <div dir={dir} lang={locale} className="min-h-dvh bg-surface-page font-sans text-text-primary">
      <SkipLink targetId={MAIN_ID}>{c.skipLink}</SkipLink>
      <main id={MAIN_ID} tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
    </div>
  );
}

/** `/reception/:eventId`: the event's reception desk. */
export default function ReceptionPortal() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const { locale, setLocale } = useLocale();
  const c = useCopy(deskCopy, locale);
  if (!EVENT_ID.test(eventId)) {
    return (
      <ReceptionShell>
        <OperatorGate
          locale={locale}
          kind="unavailable"
          icon="link"
          title={c.invalidLinkTitle}
          body={c.codeInvalid}
          action={
            <LinkButton to="/reception" variant="primary" size="lg" isFullWidth iconEnd="arrow-right">
              {c.enterCode}
            </LinkButton>
          }
          secondary={<LanguageToggle locale={locale} onChange={setLocale} className="self-center" />}
        />
      </ReceptionShell>
    );
  }
  // Remount per event: an event A session or response can never act in event B.
  return (
    <ReceptionShell>
      <ReceptionStation key={eventId} eventId={eventId} organizer={null} locale={locale} />
    </ReceptionShell>
  );
}

/**
 * `/reception` and `/reception/e/:slug`: resolve a public congress code (the `/e/<slug>` of its public page) to
 * the event's desk through the existing anonymous public event endpoint. No privileged event discovery exists.
 */
export function ReceptionEntry() {
  const { slug: routeSlug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { locale, setLocale } = useLocale();
  const c = useCopy(deskCopy, locale);
  const formId = useId();
  const [code, setCode] = useState(routeSlug ?? "");
  const [state, setState] = useState<"idle" | "resolving" | "missing" | "failed" | "invalid">("idle");

  const resolve = async (raw: string) => {
    const fromUrl = /\/e\/([A-Za-z0-9_-]+)/.exec(raw.trim());
    const candidate = (fromUrl ? fromUrl[1] : raw.trim()).replace(/^\/+|\/+$/g, "");
    if (!SLUG.test(candidate)) {
      setState("invalid");
      return;
    }
    setState("resolving");
    try {
      const { data, response } = await createApiClient({ kind: "anonymous" }).GET("/api/public/events/{slug}", { params: { path: { slug: candidate } } });
      if (data) navigate(`/reception/${data.id}`, { replace: true });
      else setState(response.status === 404 ? "missing" : "failed");
    } catch {
      setState("failed");
    }
  };

  useEffect(() => {
    if (routeSlug) void resolve(routeSlug);
    // resolve only depends on navigate; the route slug is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSlug]);

  if (routeSlug && (state === "resolving" || state === "idle")) {
    return (
      <ReceptionShell>
        <p role="status" className="flex min-h-dvh items-center justify-center gap-3 text-body-sm text-text-muted">
          <Spinner size={24} />
          <span>{c.finding}</span>
        </p>
      </ReceptionShell>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setState("invalid");
      return;
    }
    void resolve(code);
  };
  const error = state === "invalid" ? c.codeInvalid : state === "missing" ? c.codeMissing : state === "failed" ? commonCopy[locale].network : undefined;
  return (
    <ReceptionShell>
      <OperatorGate
        locale={locale}
        kind="signIn"
        icon="congress"
        title={c.title}
        body={null}
        action={
          <Button type="submit" form={formId} variant="primary" size="lg" isFullWidth loading={state === "resolving"} iconEnd="arrow-right">
            {c.continue}
          </Button>
        }
        secondary={<LanguageToggle locale={locale} onChange={setLocale} className="self-center" />}
      >
        <form id={formId} onSubmit={onSubmit} noValidate>
          <Field label={c.codeLabel} hint={c.codeHelp("/e/")} error={error}>
            <CodeInput
              size="lg"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ai-health-2026"
            />
          </Field>
        </form>
      </OperatorGate>
    </ReceptionShell>
  );
}
