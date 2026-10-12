import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createApiClient } from "../api/client";
import { ReceptionStation } from "../components/reception/ReceptionStation";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { SkipLink } from "../components/ui/SkipLink";
import { useAttendeeLocale } from "../lib/i18n";

const EVENT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SLUG = /^[A-Za-z0-9_-]+$/;

/** Independent Reception shell: no Organizer navigation, no Organizer credential, Desk authority only. */
function ReceptionShell({ children }: { children: React.ReactNode }) {
  const { locale, setLocale, isRtl, dir } = useAttendeeLocale();
  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-surface-page text-text-primary flex flex-col font-sans">
      <SkipLink targetId="reception-main-content">{isRtl ? "پرش به محتوای میز پذیرش" : "Skip to reception content"}</SkipLink>
      <header className="sticky top-0 z-40 bg-surface-panel/95 backdrop-blur-xs border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
          <Link to="/reception" className="flex items-center gap-2.5 rounded-lg font-bold text-sm sm:text-base tracking-tight focus-visible:outline-2 focus-visible:outline-focus-ring">
            <span aria-hidden="true" className="w-8 h-8 rounded-lg bg-action-primary text-text-inverse flex items-center justify-center">🖨️</span>
            <span>{isRtl ? "میز پذیرش همایش" : "Congress Reception"}</span>
          </Link>
          <button
            type="button"
            onClick={() => setLocale(locale === "fa" ? "en" : "fa")}
            aria-label={isRtl ? "Switch language to English" : "تغییر زبان به فارسی"}
            className="text-xs font-semibold px-3 py-2 min-h-[40px] rounded-lg bg-surface-panel-subtle text-text-secondary border border-border-default hover:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
          >
            🌐 {locale === "fa" ? "English" : "فارسی"}
          </button>
        </div>
      </header>
      <main id="reception-main-content" tabIndex={-1} className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 focus:outline-none">
        {children}
      </main>
    </div>
  );
}

/** `/reception/:eventId` — the event-specific operator workspace. */
export default function ReceptionPortal() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const { locale, t, isRtl } = useAttendeeLocale();
  if (!EVENT_ID.test(eventId)) {
    return (
      <ReceptionShell>
        <Card className="max-w-md mx-auto p-8 text-center space-y-3 border-border-default">
          <h1 className="text-xl font-bold">{isRtl ? "نشانی میز پذیرش معتبر نیست" : "This reception link is not valid"}</h1>
          <p className="text-sm text-text-secondary">{isRtl ? "از نشانی اختصاصی همایش استفاده کنید یا کد همایش را وارد نمایید." : "Use the congress's reception link or enter its congress code."}</p>
          <Link to="/reception" className="text-sm font-semibold text-action-primary hover:underline">{isRtl ? "ورود کد همایش" : "Enter congress code"}</Link>
        </Card>
      </ReceptionShell>
    );
  }
  // Remount per event: an event A session or response can never act in event B.
  return (
    <ReceptionShell>
      <ReceptionStation key={eventId} eventId={eventId} organizer={null} locale={locale} t={t} isRtl={isRtl} />
    </ReceptionShell>
  );
}

/**
 * `/reception` and `/reception/e/:slug` — resolve a public congress code (the `/e/<slug>` of its
 * public page) to the event workspace through the existing anonymous public event endpoint.
 * No privileged event discovery exists or is invented.
 */
export function ReceptionEntry() {
  const { slug: routeSlug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { isRtl } = useAttendeeLocale();
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
    return <ReceptionShell><p role="status" className="text-center text-sm text-text-muted animate-pulse">{isRtl ? "در حال یافتن همایش..." : "Finding the congress..."}</p></ReceptionShell>;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setState("invalid");
      return;
    }
    void resolve(code);
  };
  const messages: Record<string, string> = {
    invalid: isRtl ? "کد همایش را وارد کنید (مثلاً ai-health-2026)." : "Enter the congress code (for example ai-health-2026).",
    missing: isRtl ? "همایشی با این کد پیدا نشد." : "No congress with that code was found.",
    failed: isRtl ? "اتصال برقرار نشد. دوباره تلاش کنید." : "Could not reach the server. Please try again.",
  };
  return (
    <ReceptionShell>
      <Card className="max-w-md mx-auto p-6 sm:p-8 border-border-default space-y-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight">{isRtl ? "ورود به میز پذیرش" : "Open the reception desk"}</h1>
          <p className="text-sm text-text-secondary">
            {isRtl ? "کد همایش را وارد کنید؛ سپس با حساب اپراتور همان همایش وارد می‌شوید." : "Enter the congress code, then sign in with your operator account for that congress."}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="reception-code" className="block text-sm font-semibold mb-1.5">{isRtl ? "کد همایش یا نشانی صفحه عمومی" : "Congress code or public page link"}</label>
            <input
              id="reception-code"
              type="text"
              dir="ltr"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={state === "invalid" || state === "missing"}
              placeholder="ai-health-2026"
              className="w-full px-3.5 py-3 min-h-[48px] bg-white border border-border-default rounded-xl text-base font-mono focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
          </div>
          {(state === "invalid" || state === "missing" || state === "failed") && (
            <p role="alert" className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs">{messages[state]}</p>
          )}
          <Button type="submit" variant="primary" size="lg" isFullWidth disabled={state === "resolving"} aria-busy={state === "resolving"}>
            {state === "resolving" ? "..." : isRtl ? "ادامه" : "Continue"}
          </Button>
        </form>
      </Card>
    </ReceptionShell>
  );
}
