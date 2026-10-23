import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { PLATFORM_TOKEN_STORAGE, createApiClient, isNetworkFailure, type PlatformStatusOut } from "../api/client";
import { commonCopy } from "../copy/common";
import { platformCopy } from "../copy/platform";
import { useLocale } from "../lib/i18n";
import { usePageTitle } from "../hooks/usePageTitle";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { CodeInput } from "../components/ui/Input";
import { Icon, type IconName } from "../components/ui/Icon";
import { LanguageToggle } from "../components/ui/LanguageToggle";
import { Notice } from "../components/ui/Notice";
import { ErrorState, LoadingState } from "../components/ui/StateBlock";
import { SMS_TAB, platformSection, type PlatformClient, type PlatformOutletContext, type PlatformSection } from "./platformContext";

type GateProblem = "rejected" | "blocked" | "throttled" | "network" | "server" | null;

const ENVIRONMENTS = ["production", "staging", "development", "test"] as const;

const TABS: readonly { section: PlatformSection; to: string; icon: IconName }[] = [
  { section: "status", to: "/platform", icon: "activity" },
  { section: "sms", to: SMS_TAB, icon: "mail" },
  { section: "signIn", to: "/platform/sign-in", icon: "lock" },
  { section: "organizers", to: "/platform/organizers", icon: "users" },
];

/** Same look as `TabNav`; the Status and SMS tabs share a path, so the current tab is worked out here. */
const TAB_LINK =
  "relative inline-flex min-h-11 items-center gap-2 px-3 text-body-sm font-semibold whitespace-nowrap text-text-muted transition-colors hover:text-text-primary aria-[current=page]:text-text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full aria-[current=page]:after:bg-action-primary";

function readToken(): string | null {
  try {
    return sessionStorage.getItem(PLATFORM_TOKEN_STORAGE);
  } catch {
    return null;
  }
}

/** Why a status request failed; null when it worked. */
function gateProblem(response: Response): Exclude<GateProblem, null> {
  if (isNetworkFailure(response)) return "network";
  if (response.status === 401) return "rejected";
  if (response.status === 404) return "blocked";
  if (response.status === 429) return "throttled";
  return "server";
}

/**
 * Platform admin: settings for the whole platform, not one organizer (SMS gateway and wording, sign-in rules,
 * organizer accounts). Unlocked with the platform admin token, kept for this tab only. Hosted deployments only
 * let these requests through from allowed networks (CONGRESS_ADMIN_ALLOW). No install prompt here (UX T6).
 */
export default function PlatformConsole() {
  const { locale, setLocale, dir } = useLocale();
  const copy = platformCopy[locale];
  const [token, setToken] = useState<string | null>(readToken);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<PlatformStatusOut | null>(null);
  const [problem, setProblem] = useState<GateProblem>(null);
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);

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

  // Any 401 on the console's client means the token no longer works: back to the gate.
  const client = useMemo(
    () => (token ? createApiClient({ kind: "platform", token }, { networkErrors: "result", onUnauthorized: () => signOut("rejected") }) : null),
    [token, signOut],
  );

  const { pathname, search } = useLocation();
  const section = platformSection(pathname, search);
  const unlocked = Boolean(client && status);
  // The layout names the tab: a section's own effect would run before this one and be overwritten.
  usePageTitle(unlocked ? copy.tabs[section] : copy.portal, unlocked ? copy.portal : null);

  /** Null when the token works; otherwise why not. */
  const loadStatus = useCallback(async (candidate: PlatformClient): Promise<GateProblem> => {
    const { data, response } = await candidate.GET("/api/platform/status");
    if (data) {
      setStatus(data);
      setProblem(null);
      return null;
    }
    return gateProblem(response);
  }, []);

  // A token kept from earlier in this tab: check it. A refusal signs out; no connection offers a retry.
  useEffect(() => {
    if (!client || status) return;
    let active = true;
    setChecking(true);
    loadStatus(client)
      .then((reason) => {
        if (!active || !reason) return;
        if (reason === "rejected" || reason === "blocked") signOut(reason);
        else setProblem(reason);
      })
      .finally(() => active && setChecking(false));
    return () => {
      active = false;
    };
    // Only when the token changes or on retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, attempt]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const candidate = input.trim();
    if (!candidate || checking) return;
    setChecking(true);
    try {
      const reason = await loadStatus(createApiClient({ kind: "platform", token: candidate }, { networkErrors: "result", onUnauthorized: null }));
      setProblem(reason);
      if (!reason) {
        try {
          sessionStorage.setItem(PLATFORM_TOKEN_STORAGE, candidate);
        } catch {
          /* kept in memory only */
        }
        setToken(candidate);
        setInput("");
      }
    } finally {
      setChecking(false);
    }
  };

  const problemText = (reason: Exclude<GateProblem, null>) =>
    reason === "network" ? commonCopy[locale].network : reason === "server" ? commonCopy[locale].generic : copy.gate[reason];
  const languageToggle = <LanguageToggle locale={locale} onChange={setLocale} />;

  if (!client) {
    return (
      <div dir={dir} lang={locale} className="min-h-dvh bg-surface-page font-sans text-text-primary">
        <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6 sm:px-5">
          <div className="flex items-center justify-between">
            <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-body-sm font-semibold text-text-secondary hover:text-text-primary">
              <Icon name="arrow-left" size={18} />
              {copy.home}
            </Link>
            {languageToggle}
          </div>
          <main className="flex flex-1 flex-col justify-center gap-6">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-control bg-aiteb-lavender text-aiteb-indigo">
                <Icon name="shield" size={24} />
              </span>
              <h1 className="text-title font-bold tracking-tight">{copy.portal}</h1>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <Field label={copy.gate.token}>
                <CodeInput id="platform-token" type="password" value={input} onChange={(e) => setInput(e.target.value)} />
              </Field>
              {problem && <Notice tone="danger">{problemText(problem)}</Notice>}
              <Button type="submit" variant="primary" size="lg" isFullWidth loading={checking} disabled={!input.trim()}>
                {copy.gate.submit}
              </Button>
            </form>
          </main>
        </div>
      </div>
    );
  }

  const environment = status && (ENVIRONMENTS as readonly string[]).includes(status.environment)
    ? copy.environment[status.environment as (typeof ENVIRONMENTS)[number]]
    : copy.environment.unknown;
  const signOutButton = (
    <Button type="button" variant="ghost" size="sm" icon="logout" onClick={() => signOut()}>
      {copy.signOut}
    </Button>
  );

  const context: PlatformOutletContext | null = status
    ? {
        client,
        status,
        refreshStatus: async () => {
          await loadStatus(client);
        },
        locale,
      }
    : null;

  return (
    <div dir={dir} lang={locale} className="min-h-dvh bg-surface-page font-sans text-text-primary">
      <header className="border-b border-border-default bg-surface-panel">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
          <div className="flex min-h-11 items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-control bg-aiteb-lavender text-aiteb-indigo">
              <Icon name="shield" size={18} />
            </span>
            <span className="font-bold">{copy.portal}</span>
            {status && (
              <Badge variant={status.environment === "production" ? "danger" : "neutral"} size="sm" data-testid="platform-environment">
                {environment}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {languageToggle}
            {signOutButton}
          </div>
        </div>
        {status && (
          <nav aria-label={copy.sections} className="mx-auto max-w-6xl px-1 sm:px-3">
            <ul className="-mb-px flex overflow-x-auto [scrollbar-width:none]">
              {TABS.map((tab) => (
                <li key={tab.section} className="shrink-0">
                  <Link to={tab.to} aria-current={section === tab.section ? "page" : undefined} className={TAB_LINK}>
                    <Icon name={tab.icon} size={18} />
                    {copy.tabs[tab.section]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {context ? (
          <Outlet context={context} />
        ) : problem ? (
          <ErrorState title={copy.gate.loadFailed} body={problemText(problem)} offline={problem === "network"} onRetry={() => {
              setProblem(null);
              setAttempt((n) => n + 1);
            }}
          />
        ) : (
          <LoadingState />
        )}
      </main>
    </div>
  );
}
