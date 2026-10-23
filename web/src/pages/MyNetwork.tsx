import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { apiErrorCode, createApiClient, localizedApiError, type ConnectionOut } from "../api/client";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { attendeeCopy } from "../copy/attendee";
import { useAttendeeLocale } from "../lib/i18n";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { congressPath, useCongressEvent } from "../lib/congressContext";
import { errorMessages, networkErrorMessage } from "../lib/errorMessages";
import { retryDeadline, secondsLeft } from "../lib/retryAfter";
import { loadOwnerScopedTickets, saveOwnerScopedTickets } from "../lib/ticketCache";
import { appendPage, removeContact, replaceContact, withContactFirst } from "../lib/networkList";
import { Button, LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";
import { SearchInput } from "../components/ui/Input";
import { Notice } from "../components/ui/Notice";
import { PageHeader } from "../components/ui/PageHeader";
import { ErrorState, StateBlock } from "../components/ui/StateBlock";
import { InlineSignIn } from "../components/attendee/InlineSignIn";
import { contactsPhrase, n } from "../components/attendee/attendeeCopy";
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

type Message = { tone: "ok" | "error"; text: string } | null;

export default function MyNetwork() {
  const localeHook = useAttendeeLocale();
  const { locale } = localeHook;
  const c = attendeeCopy[locale].network;
  // Every route to this page carries a congress (`/my-network` without one redirects to `/me`).
  const { slug = "" } = useParams<{ slug: string }>();
  const congress = useCongressEvent(slug);
  const eventId = congress.status === "ready" ? congress.event.id : null;
  const { token } = useAttendeeSession();
  const registerTo = `/e/${encodeURIComponent(slug)}`;

  // Link contract: `/c/:slug/my-network?scan=1` opens the scan sheet, and the camera starts by itself when the
  // browser already allows it (otherwise the person presses the button, as the prompt must wait for them).
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
  const [notice, setNotice] = useState<Message>(null);
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

  // The list is this congress's contacts: it loads once the congress is known.
  const listReady = Boolean(token) && eventId !== null;
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
    if (!token) return;
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

  // Unauthenticated view (fails closed): the phone form, in place.
  if (!token) {
    return layout(
      <div className="mx-auto max-w-3xl space-y-6 px-4 pt-5 sm:px-6 sm:pt-8">
        <PageHeader title={c.title} />
        <InlineSignIn locale={locale} title={c.signInTitle} body={c.signInBody} />
      </div>,
    );
  }

  const searching = debouncedQuery !== "";
  const loadError = list.status === "error" && list.items.length === 0;
  const tabId = (m: Mode) => `network-tab-${m}`;

  return layout(
    <div className="mx-auto max-w-3xl space-y-6 px-4 pt-5 sm:space-y-8 sm:px-6 sm:pt-8">
      <PageHeader title={c.title} meta={list.status === "ready" && list.total > 0 ? contactsPhrase(list.total, locale) : undefined} />

      {/* My code / Scan */}
      <Card className="space-y-5 p-4 sm:p-6">
        <div role="tablist" aria-label={c.modes} className="grid grid-cols-2 gap-1 rounded-control border border-border-default bg-surface-panel-subtle p-1">
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
              className={`press inline-flex min-h-12 items-center justify-center gap-2 rounded-control text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
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
              autoStart
              onSubmit={(secret) => void submitScan(secret)}
              onSaveNote={(note) => void saveScanNote(note)}
              onNext={() => {
                setResult(null);
                setNoteSaved(false);
              }}
            />
          )}
        </div>
      </Card>

      {/* Contacts */}
      <section aria-label={c.title} className="space-y-4">
        {list.status === "ready" && list.total > 0 && <p className="text-xs font-medium text-text-muted tabular">{c.shownOf(n(list.items.length, locale), n(list.total, locale))}</p>}

        {(list.total > 0 || searching) && (
          <SearchInput
            aria-label={c.searchLabel}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder={c.searchPlaceholder}
          />
        )}

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        {loadError ? (
          <ErrorState title={c.loadFailed} body={list.error === undefined ? undefined : localizedApiError(list.error, locale)} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : listLoading && list.items.length === 0 ? (
          <div role="status" aria-label={c.title} className="space-y-4">
            <div className="skeleton h-44 rounded-card" />
            <div className="skeleton h-44 rounded-card" />
          </div>
        ) : list.items.length === 0 ? (
          searching ? (
            <p className="text-sm text-text-secondary">{c.noResults}</p>
          ) : (
            <div data-testid="network-empty">
              <StateBlock
                icon="users"
                title={c.emptyTitle}
                action={
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    icon="scan"
                    onClick={() => {
                      chooseMode("scan");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    {c.scan}
                  </Button>
                }
              />
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

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border-subtle pt-4 text-xs text-text-muted">
          <Icon name="shield" size={15} />
          <span>{c.privacyLink}</span>
          <LinkButton to={congressPath(slug, "my-profile")} variant="ghost" size="sm" iconEnd="arrow-right">
            {c.openProfile}
          </LinkButton>
        </p>
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
