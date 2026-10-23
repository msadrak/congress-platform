import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { apiErrorCode, createApiClient, localizedApiError, type ConnectionOut } from "../api/client";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { useAttendeeLocale } from "../lib/i18n";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { congressPath, useCongressEvent } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { errorMessages, networkErrorMessage } from "../lib/errorMessages";
import { retryDeadline, secondsLeft } from "../lib/retryAfter";
import { loadOwnerScopedTickets, saveOwnerScopedTickets } from "../lib/ticketCache";
import { appendPage, removeContact, replaceContact, withContactFirst } from "../lib/networkList";
import { Button, LinkButton } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";
import { SignInPrompt } from "../components/attendee/SignInPrompt";
import { contactsPhrase, n, networkCopy } from "../components/attendee/attendeeCopy";
import { ContactCard } from "../components/attendee/network/ContactCard";
import { MyCodePanel, type MyPass } from "../components/attendee/network/MyCodePanel";
import { ScanPanel, type ScanError, type ScanResult } from "../components/attendee/network/ScanPanel";

/** Contacts per page of `/network/search`. */
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

type Mode = "code" | "scan";

interface ContactList {
  /** The request this list answers (session, congress, search, reload); another key means it is loading. */
  key: string | null;
  status: "ready" | "error";
  items: ConnectionOut[];
  total: number;
  cursor: string | null;
  error?: unknown;
}

const EMPTY_LIST: ContactList = { key: null, status: "ready", items: [], total: 0, cursor: null };

type Notice = { tone: "ok" | "error"; text: string } | null;

export default function MyNetwork() {
  const localeHook = useAttendeeLocale();
  const { locale } = localeHook;
  const c = networkCopy[locale];
  const { slug } = useParams<{ slug?: string }>();
  const congress = useCongressEvent(slug);
  const eventId = congress.status === "ready" ? congress.event.id : null;
  const { token } = useAttendeeSession();
  const registerTo = slug ? `/e/${encodeURIComponent(slug)}` : "/";

  // Link contract: `/c/:slug/my-network?scan=1` opens the scan sheet (the camera still waits for a tap).
  const [searchParams, setSearchParams] = useSearchParams();
  const scanRequested = searchParams.get("scan") === "1";
  const [mode, setMode] = useState<Mode>(scanRequested ? "scan" : "code");
  useEffect(() => {
    if (!scanRequested) return;
    // The parameter is removed so refresh/back does not reopen the sheet.
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("scan");
        return next;
      },
      { replace: true },
    );
  }, [scanRequested, setSearchParams]);

  const [myPass, setMyPass] = useState<MyPass>({ status: "loading" });
  const [list, setList] = useState<ContactList>(EMPTY_LIST);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ConnectionOut | null>(null);

  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<ScanError | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [result, setResult] = useState<ScanResult | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [freshId, setFreshId] = useState<string | null>(null);
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ code: null, scan: null });
  const request = useRef(0);

  // A different session must never inherit the previous owner's contacts, notes or scan.
  const [owner, setOwner] = useState(token);
  if (owner !== token) {
    setOwner(token);
    setList(EMPTY_LIST);
    setMyPass({ status: "loading" });
    setResult(null);
    setFreshId(null);
    setNotice(null);
    setScanError(null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // The rate-limit countdown ticks every second until the server's Retry-After has passed.
  useEffect(() => {
    if (retryUntil === null) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= retryUntil) setRetryUntil(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  // Inside a congress the list is that congress's contacts; the legacy page lists every congress.
  const listReady = Boolean(token) && (!slug || eventId !== null);
  const searchPage = useCallback(
    (cursor: string | null) => {
      const client = createApiClient({ kind: "user", token: token ?? "" }, { networkErrors: "result" });
      return client.GET("/api/attendees/me/network/search", {
        params: { query: { q: debouncedQuery || undefined, event_id: eventId ?? undefined, limit: PAGE_SIZE, cursor: cursor ?? undefined } },
      });
    },
    [token, debouncedQuery, eventId],
  );

  const listKey = `${token}|${eventId}|${debouncedQuery}|${reloadKey}`;
  const listLoading = listReady && list.key !== listKey;
  useEffect(() => {
    if (!listReady || !token) return;
    const id = ++request.current;
    void searchPage(null).then(({ data, error, response }) => {
      if (id !== request.current || attendeeResponseState(token, response.status) !== "current") return;
      if (data) setList({ key: listKey, status: "ready", items: data.items, total: data.total, cursor: data.next_cursor });
      else setList((prev) => ({ ...prev, key: listKey, status: "error", error }));
    });
  }, [listReady, token, searchPage, listKey]);

  // "My code" is this congress's active pass; offline, the owner's cached copy.
  useEffect(() => {
    if (!token || !slug) return;
    let active = true;
    createApiClient({ kind: "user", token })
      .GET("/api/attendees/me/tickets")
      .then(({ data, response }) => {
        if (!active || attendeeResponseState(token, response.status) !== "current") return;
        if (data) saveOwnerScopedTickets(token, data);
        const cache = loadOwnerScopedTickets(token);
        const tickets = data ?? (cache.status === "valid" ? cache.tickets : null);
        if (!tickets) return setMyPass({ status: "unavailable" });
        setMyPass({ status: "ready", pass: tickets.find((t) => t.event_slug === slug && t.status === "active") ?? null, fromCache: !data });
      })
      .catch(() => {
        if (!active) return;
        const cache = loadOwnerScopedTickets(token);
        const pass = cache.status === "valid" ? (cache.tickets.find((t) => t.event_slug === slug && t.status === "active") ?? null) : null;
        setMyPass(cache.status === "valid" ? { status: "ready", pass, fromCache: true } : { status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [token, slug]);

  const loadMore = async () => {
    if (!token || !list.cursor || loadingMore) return;
    setLoadingMore(true);
    const id = request.current;
    try {
      const { data, error, response } = await searchPage(list.cursor);
      if (id !== request.current || attendeeResponseState(token, response.status) !== "current") return;
      if (data) {
        setList((prev) => ({ ...prev, status: "ready", items: appendPage(prev.items, data.items), total: data.total, cursor: data.next_cursor }));
      } else if (apiErrorCode(error) === "CURSOR_INVALID") {
        // The list changed under the cursor: start again from the top.
        setReloadKey((k) => k + 1);
      } else {
        setNotice({ tone: "error", text: localizedApiError(error, locale) });
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const retrySeconds = retryUntil === null ? null : Math.max(1, secondsLeft(retryUntil, clock));

  const submitScan = async (rawSecret: string) => {
    const secret = rawSecret.trim();
    if (!token || !secret || scanBusy || retryUntil !== null) return;
    if (!isStoredAttendeeToken(token)) return setScanError({ text: sessionChangedMessage(locale) });
    // The scan is bound to this congress: the server refuses a badge from another one before writing.
    if (!eventId) return setScanError({ text: c.loading });
    setScanBusy(true);
    setScanError(null);
    setNotice(null);
    try {
      const { data, error, response } = await createApiClient({ kind: "user", token }).POST("/api/attendees/me/network/scan", {
        body: { qr_secret: secret, private_notes: "", event_id: eventId },
      });
      if (attendeeResponseState(token, response.status) !== "current") return;
      if (data) {
        const already = response.status === 200;
        setResult({ contact: data, already });
        setNoteSaved(false);
        setFreshId(data.id);
        setList((prev) => ({ ...prev, items: withContactFirst(prev.items, data), total: prev.total + (already ? 0 : 1) }));
        return;
      }
      const code = apiErrorCode(error);
      if (response.status === 429) {
        setClock(Date.now());
        setRetryUntil(retryDeadline(response.headers.get("Retry-After"), Date.now()));
      } else if (code === "ACTIVE_TICKET_REQUIRED") {
        setScanError({ text: errorMessages[locale].ACTIVE_TICKET_REQUIRED, register: true });
      } else if (!code && response.status === 409) {
        setScanError({ text: errorMessages[locale].BADGE_OTHER_EVENT });
      } else {
        setScanError({ text: localizedApiError(error, locale) });
      }
    } catch {
      setScanError({ text: networkErrorMessage[locale] });
    } finally {
      setScanBusy(false);
    }
  };

  /** PATCH the private note; true when saved (the list and the scan result show the stored value). */
  const saveNote = async (contactId: string, note: string): Promise<boolean> => {
    if (!token) return false;
    if (!isStoredAttendeeToken(token)) {
      setNotice({ tone: "error", text: sessionChangedMessage(locale) });
      return false;
    }
    try {
      const { data, error, response } = await createApiClient({ kind: "user", token }).PATCH("/api/attendees/me/network/{connection_id}", {
        params: { path: { connection_id: contactId } },
        body: { private_notes: note },
      });
      if (attendeeResponseState(token, response.status) !== "current") return false;
      if (!data) {
        setNotice({ tone: "error", text: localizedApiError(error, locale) });
        return false;
      }
      setList((prev) => ({ ...prev, items: replaceContact(prev.items, data) }));
      setResult((prev) => (prev && prev.contact.id === data.id ? { ...prev, contact: data } : prev));
      return true;
    } catch {
      setNotice({ tone: "error", text: networkErrorMessage[locale] });
      return false;
    }
  };

  const saveScanNote = async (note: string) => {
    if (!result || noteBusy) return;
    setNoteBusy(true);
    try {
      if (await saveNote(result.contact.id, note)) setNoteSaved(true);
    } finally {
      setNoteBusy(false);
    }
  };

  const saveCardNote = async (contactId: string, note: string) => {
    setSavingNoteId(contactId);
    try {
      const saved = await saveNote(contactId, note);
      if (saved) setNotice({ tone: "ok", text: c.noteSaved });
      return saved;
    } finally {
      setSavingNoteId(null);
    }
  };

  const confirmRemove = async () => {
    const contact = removing;
    setRemoving(null);
    if (!token || !contact) return;
    if (!isStoredAttendeeToken(token)) return setNotice({ tone: "error", text: sessionChangedMessage(locale) });
    try {
      const { error, response } = await createApiClient({ kind: "user", token }).DELETE("/api/attendees/me/network/{connection_id}", {
        params: { path: { connection_id: contact.id } },
      });
      if (attendeeResponseState(token, response.status) !== "current") return;
      // 404: already gone (removed on another device); the list catches up either way.
      if (response.ok || response.status === 404) {
        setList((prev) => ({ ...prev, items: removeContact(prev.items, contact.id), total: Math.max(0, prev.total - 1) }));
        if (result?.contact.id === contact.id) setResult(null);
        setNotice({ tone: "ok", text: c.removed(contact.full_name) });
      } else {
        setNotice({ tone: "error", text: localizedApiError(error, locale) });
      }
    } catch {
      setNotice({ tone: "error", text: networkErrorMessage[locale] });
    }
  };

  const downloadVcard = async (contact: ConnectionOut) => {
    if (!token) return;
    if (!isStoredAttendeeToken(token)) return setNotice({ tone: "error", text: sessionChangedMessage(locale) });
    try {
      const { data: blob, response } = await createApiClient({ kind: "user", token }).GET("/api/attendees/me/network/{connection_id}/vcard", {
        params: { path: { connection_id: contact.id } },
        parseAs: "blob",
      });
      // No completion feedback for a session that has since changed or expired (the page signs out).
      if (attendeeResponseState(token, response.status) !== "current") return;
      if (!response.ok || !blob) return setNotice({ tone: "error", text: c.vcardFailed });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const cleanName = contact.full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      link.download = `${cleanName || "contact"}.vcf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch {
      setNotice({ tone: "error", text: c.vcardFailed });
    }
  };

  const chooseMode = (next: Mode) => {
    setMode(next);
    tabRefs.current[next]?.focus();
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    chooseMode(mode === "code" ? "scan" : "code");
  };

  const layout = (content: ReactNode) => (
    <AttendeeLayout activeTab="network" localeProps={localeHook} eventSlug={slug} destination="my-network">
      {content}
    </AttendeeLayout>
  );

  // Unauthenticated view (fails closed)
  if (!token) {
    return layout(
      <SignInPrompt
        seed={slug}
        icon="users"
        title={localeHook.t.unauthenticatedTitle}
        description={localeHook.t.unauthenticatedDesc}
        actionLabel={localeHook.t.loginAction}
        to={signInPath(slug, slug ? congressPath(slug, "my-network") : "/my-network")}
      />,
    );
  }

  const searching = debouncedQuery !== "";
  const loadError = list.status === "error" && list.items.length === 0;
  const tabId = (m: Mode) => `network-tab-${m}`;

  return layout(
    <div className="mx-auto max-w-3xl space-y-8 px-4 pt-6 sm:space-y-10 sm:px-6 sm:pt-10">
      {/* Masthead */}
      <div className="space-y-3">
        <span className="eyebrow">{c.eyebrow}</span>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-text-primary text-balance sm:text-4xl">{slug ? c.title : localeHook.t.networkHeading}</h1>
        {!listLoading || list.items.length > 0 ? (
          <p className={`font-semibold ${list.total === 0 ? "text-base text-text-secondary" : "text-lg text-event-accent"}`}>{contactsPhrase(list.total, locale)}</p>
        ) : null}
      </div>

      {/* My code / Scan */}
      {slug && (
        <section aria-label={c.modes} className="relative overflow-hidden shape-arc border border-border-default bg-surface-panel shadow-soft">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-[image:var(--grad-aiteb)]" />
          <div className="space-y-6 p-5 sm:p-7">
            <div role="tablist" aria-label={c.modes} className="grid grid-cols-2 gap-1 rounded-full border border-border-default bg-surface-panel-subtle p-1">
              {(["code", "scan"] as const).map((m) => (
                <button
                  key={m}
                  ref={(el) => {
                    tabRefs.current[m] = el;
                  }}
                  type="button"
                  role="tab"
                  id={tabId(m)}
                  aria-selected={mode === m}
                  aria-controls="network-mode-panel"
                  tabIndex={mode === m ? 0 : -1}
                  onClick={() => setMode(m)}
                  onKeyDown={onTabKey}
                  className={`press inline-flex min-h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                    mode === m ? "bg-surface-ink text-white shadow-soft" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <Icon name={m === "code" ? "qr" : "scan"} size={18} />
                  {m === "code" ? c.myCode : c.scan}
                </button>
              ))}
            </div>
            <div id="network-mode-panel" role="tabpanel" aria-labelledby={tabId(mode)}>
              {mode === "code" ? (
                <MyCodePanel myPass={myPass} locale={locale} registerTo={registerTo} />
              ) : (
                <ScanPanel
                  locale={locale}
                  busy={scanBusy}
                  error={scanError}
                  retrySeconds={retrySeconds}
                  registerTo={registerTo}
                  result={result}
                  noteBusy={noteBusy}
                  noteSaved={noteSaved}
                  onSubmit={(secret) => void submitScan(secret)}
                  onSaveNote={(note) => void saveScanNote(note)}
                  onNext={() => {
                    setResult(null);
                    setNoteSaved(false);
                  }}
                />
              )}
            </div>
          </div>
        </section>
      )}

      {/* Contacts */}
      <section aria-labelledby="network-list-title" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="network-list-title" className="text-lg font-semibold tracking-[-0.02em] text-text-primary sm:text-xl">{c.listTitle}</h2>
          {list.status === "ready" && list.total > 0 && (
            <p className="text-xs font-medium text-text-muted tabular">{c.shownOf(n(list.items.length, locale), n(list.total, locale))}</p>
          )}
        </div>

        {(list.total > 0 || searching) && (
          <div className="relative">
            <label htmlFor="network-search" className="sr-only">{c.searchLabel}</label>
            <Icon name="search" size={18} className="pointer-events-none absolute inset-y-0 start-3.5 my-auto text-ink-400" />
            <input
              id="network-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={c.searchPlaceholder}
              className="ui-input ps-10"
            />
          </div>
        )}

        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
              notice.tone === "error" ? "border-status-danger-border bg-status-danger-bg text-status-danger-text" : "border-action-subtle-border bg-action-subtle text-action-primary"
            }`}
          >
            <Icon name={notice.tone === "error" ? "alert" : "check-circle"} size={18} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{notice.text}</span>
          </div>
        )}

        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-status-danger-border bg-status-danger-bg p-4 text-sm text-status-danger-text">
            <p className="flex items-center gap-2">
              <Icon name="alert" size={18} />
              {list.error === undefined ? c.loadFailed : localizedApiError(list.error, locale)}
            </p>
            <Button type="button" variant="secondary" size="md" onClick={() => setReloadKey((k) => k + 1)}>
              <Icon name="sync" size={16} />
              {c.retry}
            </Button>
          </div>
        ) : listLoading && list.items.length === 0 ? (
          <div role="status" aria-label={c.listTitle} className="space-y-4">
            <div className="skeleton h-44 rounded-2xl" />
            <div className="skeleton h-44 rounded-2xl" />
          </div>
        ) : list.items.length === 0 ? (
          searching ? (
            <p className="text-sm text-text-secondary">{c.noResults}</p>
          ) : (
            <div className="relative overflow-hidden rounded-[var(--radius-xl)] border border-dashed border-border-strong p-8 text-center sm:p-10">
              <div aria-hidden="true" className="bg-meridian absolute inset-0 opacity-60" />
              <div className="relative mx-auto max-w-md space-y-4">
                <span aria-hidden="true" className="mx-auto grid size-16 place-items-center rounded-2xl [border-start-end-radius:26px] bg-surface-ink text-white shadow-lift">
                  <Icon name="users" size={28} />
                </span>
                <h3 className="text-lg font-semibold tracking-[-0.02em] text-text-primary">{c.emptyTitle}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{c.emptyBody}</p>
                {slug && (
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    onClick={() => {
                      chooseMode("scan");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <Icon name="scan" size={18} />
                    {c.scan}
                  </Button>
                )}
              </div>
            </div>
          )
        ) : (
          <ul className="space-y-4" aria-busy={listLoading}>
            {list.items.map((contact) => (
              <li key={contact.id}>
                <ContactCard
                  contact={contact}
                  locale={locale}
                  fresh={contact.id === freshId}
                  savingNote={savingNoteId === contact.id}
                  onSaveNote={(note) => saveCardNote(contact.id, note)}
                  onVcard={() => void downloadVcard(contact)}
                  onRemove={() => setRemoving(contact)}
                />
              </li>
            ))}
          </ul>
        )}

        {list.cursor && list.items.length > 0 && (
          <Button type="button" variant="secondary" size="lg" isFullWidth disabled={loadingMore} aria-busy={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? c.loadingMore : c.loadMore}
          </Button>
        )}

        {slug && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border-subtle pt-5 text-xs text-text-muted">
            <Icon name="shield" size={15} />
            <span>{c.privacyLink}</span>
            <LinkButton to={congressPath(slug, "my-profile")} variant="ghost" size="sm" className="min-h-11">
              {c.openProfile}
              <Icon name="arrow-right" size={14} />
            </LinkButton>
          </p>
        )}
      </section>

      <ConfirmDialog
        isOpen={removing !== null}
        title={c.removeTitle}
        description={removing ? c.removeBody(removing.full_name) : ""}
        confirmLabel={c.removeConfirm}
        cancelLabel={c.cancel}
        tone="danger"
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </div>,
  );
}
