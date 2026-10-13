import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createApiClient } from "../api/client";
import { AitebAttribution, ArcMotif } from "../components/brand/Aiteb";
import { ReceptionStation } from "../components/reception/ReceptionStation";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { SkipLink } from "../components/ui/SkipLink";
import { useAttendeeLocale } from "../lib/i18n";
import "../styles/reception.css";

const EVENT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SLUG = /^[A-Za-z0-9_-]+$/;

/** Independent Reception shell: no Organizer navigation, no Organizer credential, Desk authority only. */
function ReceptionShell({ children }: { children: React.ReactNode }) {
  const { locale, setLocale, isRtl, dir } = useAttendeeLocale();
  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-surface-page text-text-primary flex flex-col font-sans">
      <SkipLink targetId="reception-main-content">{isRtl ? "پرش به محتوای میز پذیرش" : "Skip to reception content"}</SkipLink>
      <header className="sticky top-0 z-40 border-b border-border-default bg-surface-panel/90 backdrop-blur-md pt-safe">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/reception" className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-ink">
              <ArcMotif className="size-6" weight={9} />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{isRtl ? "میز پذیرش همایش" : "Congress Reception"}</span>
              <span className="block truncate text-[11px] font-medium text-text-muted">{isRtl ? "ایستگاه اپراتور" : "Operator workstation"}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setLocale(locale === "fa" ? "en" : "fa")}
            aria-label={isRtl ? "Switch language to English" : "تغییر زبان به فارسی"}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border border-border-default bg-surface-panel px-3.5 text-[13px] font-semibold text-text-secondary transition-colors duration-100 hover:border-border-strong hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring cursor-pointer"
          >
            <Icon name="globe" size={17} />
            <span lang={locale === "fa" ? "en" : "fa"}>{locale === "fa" ? "English" : "فارسی"}</span>
          </button>
        </div>
      </header>
      <main id="reception-main-content" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 focus:outline-none sm:px-6 sm:py-8 lg:px-8">
        {children}
      </main>
      <footer className="pb-safe">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rule-arc" />
          <div className="flex flex-wrap items-center justify-between gap-3 py-5">
            <span className="text-xs text-text-muted">{isRtl ? "میز پذیرش همایش" : "Congress Reception"}</span>
            <AitebAttribution locale={locale} />
          </div>
        </div>
      </footer>
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
        <div className="mx-auto my-6 max-w-md shape-arc-lg border border-border-default bg-surface-panel p-8 text-center shadow-soft sm:my-14 sm:p-10">
          <div className="space-y-4">
            <span aria-hidden="true" className="mx-auto grid size-14 place-items-center rounded-2xl bg-status-warning-bg text-status-warning-text">
              <Icon name="link" size={26} />
            </span>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">{isRtl ? "نشانی میز پذیرش معتبر نیست" : "This reception link is not valid"}</h1>
            <p className="text-sm leading-relaxed text-text-secondary">{isRtl ? "از نشانی اختصاصی همایش استفاده کنید یا کد همایش را وارد نمایید." : "Use the congress's reception link or enter its congress code."}</p>
            <Link to="/reception" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-action-primary hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring">
              <span>{isRtl ? "ورود کد همایش" : "Enter congress code"}</span>
              <Icon name="arrow-right" size={16} />
            </Link>
          </div>
        </div>
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
    return (
      <ReceptionShell>
        <p role="status" className="my-16 flex items-center justify-center gap-3 text-sm text-text-muted">
          <Icon name="sync" size={18} className="motion-safe:animate-spin" />
          <span>{isRtl ? "در حال یافتن همایش..." : "Finding the congress..."}</span>
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
  const messages: Record<string, string> = {
    invalid: isRtl ? "کد همایش را وارد کنید (مثلاً ai-health-2026)." : "Enter the congress code (for example ai-health-2026).",
    missing: isRtl ? "همایشی با این کد پیدا نشد." : "No congress with that code was found.",
    failed: isRtl ? "اتصال برقرار نشد. دوباره تلاش کنید." : "Could not reach the server. Please try again.",
  };
  const showError = state === "invalid" || state === "missing" || state === "failed";
  const steps = isRtl
    ? [
        { icon: "congress" as const, text: "کد همایش را وارد کنید" },
        { icon: "lock" as const, text: "با حساب اپراتور همان همایش وارد شوید" },
        { icon: "print" as const, text: "جستجو، چاپ کارت و ثبت حضوری" },
      ]
    : [
        { icon: "congress" as const, text: "Enter the congress code" },
        { icon: "lock" as const, text: "Sign in with that congress's operator account" },
        { icon: "print" as const, text: "Search, print passes, register walk-ins" },
      ];
  return (
    <ReceptionShell>
      <div className="mx-auto max-w-5xl sm:my-6 lg:my-10">
        <div className="grid overflow-hidden shape-arc-lg border border-border-default bg-surface-panel shadow-lift md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="relative isolate overflow-hidden bg-surface-ink p-7 text-white sm:p-9 md:p-11">
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-meridian-ink" />
            <ArcMotif className="pointer-events-none absolute -bottom-16 -end-14 -z-10 size-64 opacity-80 md:size-80" weight={4} />
            <div className="space-y-6 md:space-y-10">
              <p className="eyebrow text-ink-300">{isRtl ? "ایستگاه پذیرش" : "Reception station"}</p>
              <h1 className="text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[2.5rem]">
                {isRtl ? "ورود به میز پذیرش" : "Open the reception desk"}
              </h1>
              <ol className="space-y-4">
                {steps.map((step, i) => (
                  <li key={step.text} className="flex items-center gap-3.5 text-sm text-ink-200">
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white ring-1 ring-white/12">
                      <Icon name={step.icon} size={17} />
                    </span>
                    <span className="min-w-0">
                      <span aria-hidden="true" className="me-2 font-mono text-[11px] text-aiteb-orchid">0{i + 1}</span>
                      {step.text}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="flex flex-col justify-center p-7 sm:p-9 md:p-11">
            <form onSubmit={onSubmit} className="space-y-5" noValidate>
              <div className="space-y-2">
                <p className="font-mono text-[11px] text-aiteb-indigo">01</p>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {isRtl ? "کد همایش را وارد کنید؛ سپس با حساب اپراتور همان همایش وارد می‌شوید." : "Enter the congress code, then sign in with your operator account for that congress."}
                </p>
              </div>
              <div>
                <label htmlFor="reception-code" className="ui-label">{isRtl ? "کد همایش یا نشانی صفحه عمومی" : "Congress code or public page link"}</label>
                <div className="relative">
                  <Icon name="congress" size={20} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-text-muted" />
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
                    className="ui-input min-h-[56px] ps-12 font-mono text-lg"
                  />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-text-muted">
                  {isRtl ? "همان بخش پس از " : "The part after "}
                  <bdi dir="ltr" className="font-mono text-text-secondary">/e/</bdi>
                  {isRtl ? " در نشانی صفحه عمومی همایش." : " in the congress's public page address."}
                </p>
              </div>
              {showError && (
                <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-sm text-status-danger-text">
                  <Icon name="alert" size={18} className="mt-px" />
                  <span>{messages[state]}</span>
                </p>
              )}
              <Button type="submit" variant="primary" size="xl" isFullWidth disabled={state === "resolving"} aria-busy={state === "resolving"}>
                {state === "resolving" ? "..." : isRtl ? "ادامه" : "Continue"}
                {state !== "resolving" && <Icon name="arrow-right" size={20} />}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </ReceptionShell>
  );
}
