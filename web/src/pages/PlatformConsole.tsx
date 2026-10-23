import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { PLATFORM_TOKEN_STORAGE, createApiClient, type PlatformStatusOut } from "../api/client";
import { useAttendeeLocale } from "../lib/i18n";
import { usePageTitle } from "../hooks/usePageTitle";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon, type IconName } from "../components/ui/Icon";
import { FormAlert } from "../components/organizer/WorkspaceUi";
import type { PlatformClient, PlatformOutletContext } from "./platformContext";

type GateProblem = "rejected" | "blocked" | "throttled" | "network" | null;

/** The server's `CONGRESS_ENVIRONMENT`, for the header chip. */
const ENVIRONMENT_LABELS: Record<string, Record<"fa" | "en", string>> = {
  production: { fa: "محیط اصلی", en: "Production" },
  staging: { fa: "محیط آزمایشی", en: "Staging" },
  development: { fa: "محیط توسعه", en: "Development" },
  test: { fa: "محیط تست", en: "Test" },
};

function readToken(): string | null {
  try {
    return sessionStorage.getItem(PLATFORM_TOKEN_STORAGE);
  } catch {
    return null;
  }
}

/**
 * The platform console: settings that belong to the whole platform, not to one organizer (SMS gateway and
 * wording, sign-in rules, organizer accounts). Unlocked with the platform admin token, kept for this tab only.
 * In hosted deployments the edge only lets these requests through from allowed networks (CONGRESS_ADMIN_ALLOW).
 */
export default function PlatformConsole() {
  const { locale, setLocale, isRtl, dir } = useAttendeeLocale();
  const [token, setToken] = useState<string | null>(readToken);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<PlatformStatusOut | null>(null);
  const [problem, setProblem] = useState<GateProblem>(null);
  const [checking, setChecking] = useState(false);

  const client = useMemo(() => (token ? createApiClient({ kind: "platform", token }) : null), [token]);

  // The layout names the tab: a section's own effect would run before this one and be overwritten.
  const { pathname } = useLocation();
  const consoleName = isRtl ? "پنل مدیریت سامانه" : "Platform console";
  const sectionTitles: Record<string, string> = {
    "/platform/sign-in": isRtl ? "قواعد ورود با پیامک" : "SMS sign-in rules",
    "/platform/organizers": isRtl ? "برگزارکنندگان" : "Organizers",
  };
  const unlocked = Boolean(client && status);
  usePageTitle(
    unlocked ? (sectionTitles[pathname.replace(/\/$/, "")] ?? (isRtl ? "پیامک" : "SMS")) : consoleName,
    unlocked ? consoleName : null,
  );

  const signOut = useCallback((reason: GateProblem = null) => {
    try {
      sessionStorage.removeItem(PLATFORM_TOKEN_STORAGE);
    } catch {
      /* storage unavailable */
    }
    setToken(null);
    setStatus(null);
    setProblem(reason);
  }, []);

  const checkResponse = useCallback((code: number) => {
    if (code === 401) signOut("rejected");
  }, [signOut]);

  /** Null when the token works; otherwise why not. */
  const loadStatus = useCallback(async (candidate: PlatformClient): Promise<GateProblem> => {
    const { data, response } = await candidate.GET("/api/platform/status");
    if (data) {
      setStatus(data);
      setProblem(null);
      return null;
    }
    const reason: GateProblem =
      response.status === 401 ? "rejected" : response.status === 404 ? "blocked" : response.status === 429 ? "throttled" : "network";
    setProblem(reason);
    return reason;
  }, []);

  useEffect(() => {
    if (!client || status) return;
    let active = true;
    setChecking(true);
    loadStatus(client)
      .then((reason) => {
        if (active && reason) signOut(reason);
      })
      .catch(() => active && setProblem("network"))
      .finally(() => active && setChecking(false));
    return () => {
      active = false;
    };
    // Only when the token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const candidate = input.trim();
    if (!candidate || checking) return;
    setChecking(true);
    try {
      const reason = await loadStatus(createApiClient({ kind: "platform", token: candidate }));
      if (!reason) {
        try {
          sessionStorage.setItem(PLATFORM_TOKEN_STORAGE, candidate);
        } catch {
          /* kept in memory only */
        }
        setToken(candidate);
        setInput("");
      }
    } catch {
      setProblem("network");
    } finally {
      setChecking(false);
    }
  };

  const problemText: Record<Exclude<GateProblem, null>, string> = {
    rejected: isRtl ? "توکن مدیر سامانه پذیرفته نشد." : "The platform admin token was not accepted.",
    blocked: isRtl
      ? "سرور درخواست‌های مدیریتی را از نشانی شبکه شما نمی‌پذیرد (CONGRESS_ADMIN_ALLOW). از شبکه مجاز یا خود سرور وارد شوید."
      : "The server does not accept platform requests from your network address (CONGRESS_ADMIN_ALLOW). Use an allowed network or the server itself.",
    throttled: isRtl ? "تلاش‌های ناموفق زیاد بود؛ کمی بعد دوباره تلاش کنید." : "Too many failed attempts; try again later.",
    network: isRtl ? "اتصال به سرور برقرار نشد." : "Could not reach the server.",
  };
  const languageButton = (
    <button
      type="button"
      onClick={() => setLocale(locale === "fa" ? "en" : "fa")}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border-default bg-surface-panel px-3.5 text-xs font-semibold text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
    >
      <Icon name="globe" size={16} />
      <span lang={locale === "fa" ? "en" : "fa"}>{locale === "fa" ? "English" : "فارسی"}</span>
    </button>
  );

  if (!client || !status) {
    return (
      <div dir={dir} lang={locale} className="min-h-dvh bg-surface-page font-sans text-text-primary">
        <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-6">
          <div className="flex items-center justify-between">
            <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-text-secondary hover:text-text-primary">
              <Icon name="arrow-left" size={18} />
              {isRtl ? "صفحه اصلی" : "Platform home"}
            </Link>
            {languageButton}
          </div>
          <main className="flex flex-1 flex-col justify-center gap-6">
            <div className="space-y-3">
              <span className="grid size-12 place-items-center rounded-2xl bg-aiteb-lavender text-aiteb-indigo">
                <Icon name="shield" size={24} />
              </span>
              <h1 className="text-[1.75rem] font-semibold tracking-[-0.03em]">{isRtl ? "پنل مدیریت سامانه" : "Platform console"}</h1>
              <p className="text-sm leading-relaxed text-text-secondary">
                {isRtl
                  ? "تنظیمات کل سامانه: درگاه پیامک و متن‌ها، قواعد ورود و حساب برگزارکنندگان."
                  : "Settings for the whole platform: the SMS gateway and wording, sign-in rules and organizer accounts."}
              </p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="platform-token" className="ui-label">{isRtl ? "توکن مدیر سامانه" : "Platform admin token"}</label>
                <input
                  id="platform-token"
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="ui-input min-h-12 font-mono"
                />
                <p className="mt-1.5 text-xs text-text-muted">
                  {isRtl ? "همان CONGRESS_PLATFORM_ADMIN_TOKEN سرور؛ فقط برای همین تب نگه داشته می‌شود." : "The server's CONGRESS_PLATFORM_ADMIN_TOKEN; kept for this tab only."}
                </p>
              </div>
              {problem && <FormAlert>{problemText[problem]}</FormAlert>}
              <Button type="submit" variant="primary" size="lg" isFullWidth disabled={checking || !input.trim()} aria-busy={checking}>
                {checking ? (isRtl ? "در حال بررسی…" : "Checking…") : isRtl ? "ورود به پنل" : "Open the console"}
              </Button>
            </form>
          </main>
        </div>
      </div>
    );
  }

  const nav: [string, string, IconName, boolean][] = [
    ["/platform", isRtl ? "پیامک" : "SMS", "mail", true],
    ["/platform/sign-in", isRtl ? "قواعد ورود" : "Sign-in", "lock", false],
    ["/platform/organizers", isRtl ? "برگزارکنندگان" : "Organizers", "users", false],
  ];
  const context: PlatformOutletContext = {
    client,
    status,
    refreshStatus: async () => {
      await loadStatus(client);
    },
    checkResponse,
    locale,
    isRtl,
  };

  return (
    <div dir={dir} lang={locale} className="min-h-dvh bg-surface-page font-sans text-text-primary">
      <header className="border-b border-border-default bg-surface-panel">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo">
              <Icon name="shield" size={18} />
            </span>
            <span className="font-semibold">{isRtl ? "پنل مدیریت سامانه" : "Platform console"}</span>
            <Badge variant={status.environment === "production" ? "danger" : "neutral"} size="sm" data-testid="platform-environment">
              {ENVIRONMENT_LABELS[status.environment]?.[locale] ?? (isRtl ? "محیط ناشناخته" : status.environment)}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {languageButton}
            <Button type="button" variant="ghost" size="sm" onClick={() => signOut()}>
              <Icon name="logout" size={16} />
              {isRtl ? "خروج" : "Sign out"}
            </Button>
          </div>
        </div>
        <nav aria-label={isRtl ? "بخش‌های پنل" : "Console sections"} className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 sm:px-4">
          {nav.map(([to, label, icon, end]) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold whitespace-nowrap ${
                  isActive ? "border-action-primary text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"
                }`
              }
            >
              <Icon name={icon} size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet context={context} />
      </main>
    </div>
  );
}
