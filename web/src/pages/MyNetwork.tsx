import React, { useEffect, useState } from "react";
import {
  ATTENDEE_TOKEN_STORAGE,
  createApiClient,
  formatApiError,
  type ConnectionOut,
  type PrivacyPreferenceOut,
} from "../api/client";
import {
  isStoredAttendeeToken,
  rejectAttendeeToken,
  SESSION_CHANGED_MESSAGE,
} from "../lib/attendeeSession";
import {
  useAttendeeLocale,
  formatLocalizedDate,
  formatLocalizedNumber,
} from "../lib/i18n";
import { useParams } from "react-router-dom";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { congressPath, useCongressEvent } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { formatMobile, telHref } from "../lib/mobile";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { Monogram } from "../components/attendee/Monogram";
import { SignInPrompt } from "../components/attendee/SignInPrompt";
export default function MyNetwork() {
  const localeHook = useAttendeeLocale();
  const { locale, t, isRtl } = localeHook;

  const { slug } = useParams<{ slug?: string }>();
  const congress = useCongressEvent(slug);
  const [connections, setConnections] = useState<ConnectionOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Privacy preference state (Issue #19)
  const [privacyPref, setPrivacyPref] = useState<PrivacyPreferenceOut | null>(null);
  const [updatingPrivacy, setUpdatingPrivacy] = useState(false);
  const [privacyFeedback, setPrivacyFeedback] = useState<string | null>(null);

  // Connect modal state
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [peerQrSecret, setPeerQrSecret] = useState("");
  const [initialNotes, setInitialNotes] = useState("");
  const [submittingConnect, setSubmittingConnect] = useState(false);
  const [connectModalError, setConnectModalError] = useState<string | null>(null);

  // Notes editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotesText, setEditNotesText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteFeedback, setNoteFeedback] = useState<string | null>(null);

  // Inside a congress portal only that congress's connections are shown and actionable. The list
  // endpoint returns every event, so the filter uses each connection's own event_id.
  const activeEventId = congress.status === "ready" ? congress.event.id : null;
  const visibleConnections = slug
    ? connections.filter((c) => c.event_id === activeEventId)
    : connections;
  const isVisibleConnection = (id: string) => visibleConnections.some((c) => c.id === id);

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
      : null;

  const loadData = async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const client = createApiClient({ kind: "user", token });

    const [connRes, privacyRes] = await Promise.all([
      client.GET("/api/attendees/me/network"),
      client.GET("/api/attendees/me/network/privacy"),
    ]);

    // The stored session changed while the request was in flight: ignore this response and
    // never delete the newer session. The re-render re-reads the current token.
    if (!isStoredAttendeeToken(token)) {
      setLoading(false);
      return;
    }
    if (connRes.response.status === 401 || privacyRes.response.status === 401) {
      rejectAttendeeToken(token);
    }

    if (connRes.error) {
      setError(formatApiError(connRes.error));
    } else if (connRes.data) {
      setConnections(connRes.data);
    }

    if (privacyRes.data) {
      setPrivacyPref(privacyRes.data);
    }

    setLoading(false);
  };

  useEffect(() => {
    // A different session must never inherit the previous owner's contacts or notes.
    setConnections([]);
    setPrivacyPref(null);
    setEditingId(null);
    setNoteFeedback(null);
    setPrivacyFeedback(null);
    loadData();
  }, [token]);

  const handleTogglePrivacyConsent = async () => {
    if (!token || !privacyPref) return;
    if (!isStoredAttendeeToken(token)) {
      setError(SESSION_CHANGED_MESSAGE);
      return;
    }
    setUpdatingPrivacy(true);
    setPrivacyFeedback(null);
    const newConsent = !privacyPref.share_contact_with_peers;
    const client = createApiClient({ kind: "user", token });

    const { data, error: err, response } = await client.PATCH(
      "/api/attendees/me/network/privacy",
      {
        body: { share_contact_with_peers: newConsent },
      }
    );

    const stillCurrent = isStoredAttendeeToken(token);
    if (response.status === 401) rejectAttendeeToken(token);
    if (stillCurrent) {
      if (err) {
        setError(formatApiError(err));
      } else if (data) {
        setPrivacyPref(data);
        setPrivacyFeedback(t.privacySavedFeedback);
      }
    }
    setUpdatingPrivacy(false);
  };

  const handleConnectPeer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !peerQrSecret.trim()) return;
    if (!isStoredAttendeeToken(token)) {
      setConnectModalError(SESSION_CHANGED_MESSAGE);
      return;
    }

    // Inside a congress portal the scan is bound to that congress: the server refuses a badge
    // from another congress before writing anything. Without the congress id it cannot be bound.
    if (slug && !activeEventId) {
      setConnectModalError(
        isRtl ? "اطلاعات همایش هنوز بارگذاری نشده است. کمی بعد دوباره تلاش کنید." : "This congress is still loading. Try again in a moment."
      );
      return;
    }

    setSubmittingConnect(true);
    setConnectModalError(null);
    const client = createApiClient({ kind: "user", token });
    const { data, error: err, response } = await client.POST(
      "/api/attendees/me/network/scan",
      {
        body: {
          qr_secret: peerQrSecret.trim(),
          private_notes: initialNotes.trim(),
          event_id: activeEventId,
        },
      }
    );

    const stillCurrent = isStoredAttendeeToken(token);
    if (response.status === 401) rejectAttendeeToken(token);
    setSubmittingConnect(false);
    if (!stillCurrent) return;
    if (err) {
      setConnectModalError(
        response.status === 409
          ? isRtl
            ? "این کارت متعلق به همایش دیگری است و ذخیره نشد. کارت یکی از شرکت‌کنندگان همین همایش را اسکن کنید."
            : "This badge belongs to another congress and was not saved. Scan a badge from this congress."
          : formatApiError(err)
      );
    } else if (data) {
      setPeerQrSecret("");
      setInitialNotes("");
      setIsConnectModalOpen(false);
      loadData();
    }
  };

  const handleSaveNotes = async (connectionId: string) => {
    if (!token || !isVisibleConnection(connectionId)) return;
    if (!isStoredAttendeeToken(token)) {
      setError(SESSION_CHANGED_MESSAGE);
      return;
    }
    setSavingNote(true);
    setNoteFeedback(null);
    const client = createApiClient({ kind: "user", token });
    const { data, error: err, response } = await client.PATCH(
      "/api/attendees/me/network/{connection_id}",
      {
        params: { path: { connection_id: connectionId } },
        body: { private_notes: editNotesText.trim() },
      }
    );
    const stillCurrent = isStoredAttendeeToken(token);
    if (response.status === 401) rejectAttendeeToken(token);
    setSavingNote(false);
    if (!stillCurrent) return;
    if (err) {
      setError(formatApiError(err));
    } else if (data) {
      setConnections((prev) =>
        prev.map((c) => (c.id === connectionId ? data : c))
      );
      setEditingId(null);
      setNoteFeedback(t.notesSavedFeedback);
    }
  };

  const handleDownloadVcard = async (connectionId: string, fullName: string) => {
    if (!token || !isVisibleConnection(connectionId)) return;
    if (!isStoredAttendeeToken(token)) {
      setError(SESSION_CHANGED_MESSAGE);
      return;
    }
    try {
      const client = createApiClient({ kind: "user", token });
      const { data: blob, response } = await client.GET(
        "/api/attendees/me/network/{connection_id}/vcard",
        { params: { path: { connection_id: connectionId } }, parseAs: "blob" }
      );
      const stillCurrent = isStoredAttendeeToken(token);
      if (response.status === 401) rejectAttendeeToken(token);
      // No completion feedback for a session that has since changed.
      if (!stillCurrent) return;
      if (!response.ok || !blob) {
        setError(
          response.status === 401
            ? "Your session is no longer valid. Please sign in again."
            : "Failed to download the contact card."
        );
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const cleanName = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      link.download = `${cleanName || "contact"}.vcf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch {
      setError("Failed to download the contact card.");
    }
  };

  // Unauthenticated view (fails closed)
  if (!token) {
    return (
      <AttendeeLayout activeTab="network" localeProps={localeHook} eventSlug={slug} destination="my-network">
        <SignInPrompt
          seed={slug}
          icon="users"
          title={t.unauthenticatedTitle}
          description={t.unauthenticatedDesc}
          actionLabel={t.loginAction}
          to={signInPath(slug, slug ? congressPath(slug, "my-network") : "/my-network")}
        />
      </AttendeeLayout>
    );
  }

  const sharing = privacyPref?.share_contact_with_peers ?? false;
  const contactCount = isRtl ? formatLocalizedNumber(visibleConnections.length, locale) : String(visibleConnections.length);

  return (
    <AttendeeLayout activeTab="network" localeProps={localeHook} eventSlug={slug} destination="my-network">
      <div className="mx-auto max-w-6xl space-y-8 px-4 pt-6 sm:space-y-10 sm:px-6 sm:pt-10">
        {/* Masthead & connect action */}
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <div className="space-y-3 lg:col-span-8">
            <span className="eyebrow">{isRtl ? "ارتباطات علمی و حرفه‌ای" : "Professional Network"}</span>
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-text-primary text-balance sm:text-4xl">
              {t.networkHeading}
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">{t.networkDesc}</p>
          </div>
          <div className="flex items-end justify-between gap-4 lg:col-span-4 lg:flex-col lg:items-end">
            <p className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold leading-none tracking-[-0.04em] text-event-accent tabular">{contactCount}</span>
              <span className="text-sm text-text-muted">{isRtl ? "همراه" : visibleConnections.length === 1 ? "contact" : "contacts"}</span>
            </p>
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={() => setIsConnectModalOpen(true)}
            >
              <Icon name="user-plus" size={18} />
              <span>{t.connectButton}</span>
            </Button>
          </div>
        </div>

        {/* Global feedback */}
        {(privacyFeedback || noteFeedback || error) && (
          <div className="space-y-3">
            {privacyFeedback && (
              <div
                role="status"
                className="flex items-center gap-2.5 rounded-2xl border border-action-subtle-border bg-action-subtle px-4 py-3 text-xs font-medium text-action-primary motion-safe:animate-fade"
              >
                <Icon name="shield" size={18} />
                {privacyFeedback}
              </div>
            )}
            {noteFeedback && (
              <div
                role="status"
                className="flex items-center gap-2.5 rounded-2xl border border-action-subtle-border bg-action-subtle px-4 py-3 text-xs font-medium text-action-primary motion-safe:animate-fade"
              >
                <Icon name="check-circle" size={18} />
                {noteFeedback}
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-2xl border border-status-danger-border bg-status-danger-bg p-4 text-xs leading-relaxed text-status-danger-text"
              >
                <Icon name="alert" size={18} className="shrink-0" />
                {error}
              </div>
            )}
          </div>
        )}

        <div className="grid items-start gap-8 lg:grid-cols-12 lg:gap-10">
          {/* Privacy & contact consent (Issue #19) */}
          {privacyPref && (
            <aside
              aria-labelledby="network-privacy-title"
              className="relative overflow-hidden shape-arc border border-border-default bg-surface-panel shadow-soft lg:sticky lg:top-32 lg:order-last lg:col-span-4"
            >
              <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-[3px] ${sharing ? "bg-status-success-solid" : "bg-[image:var(--grad-aiteb)]"}`} />
              <div className="space-y-4 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-ink text-white">
                    <Icon name="lock" size={18} />
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <h2 id="network-privacy-title" className="text-base font-semibold tracking-[-0.01em] text-text-primary">
                      {t.privacyHeading}
                    </h2>
                    {slug && (
                      <p className="text-[11px] text-text-muted">
                        {isRtl ? "(برای همه همایش‌ها)" : "(applies to all congresses)"}
                      </p>
                    )}
                  </div>
                </div>
                <p
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    sharing
                      ? "border-status-success-border bg-status-success-bg text-status-success-text"
                      : "border-border-default bg-surface-panel-subtle text-text-secondary"
                  }`}
                >
                  <Icon name={sharing ? "eye" : "eye-off"} size={15} />
                  {sharing ? t.mobileSharedStatus : t.mobileHiddenStatus}
                </p>
                <p className="text-xs leading-relaxed text-text-secondary">{t.shareMobileToggleDesc}</p>
                <Button
                  type="button"
                  variant={sharing ? "outline" : "secondary"}
                  size="md"
                  isFullWidth
                  disabled={updatingPrivacy}
                  onClick={handleTogglePrivacyConsent}
                  className="whitespace-normal"
                >
                  <Icon name={sharing ? "eye-off" : "eye"} size={17} />
                  {updatingPrivacy
                    ? "..."
                    : sharing
                    ? (isRtl ? "تغییر به محرمانه (غیرفعال)" : "Make Mobile Number Private")
                    : (isRtl ? "فعال‌سازی اشتراک شماره موبایل" : "Enable Mobile Number Sharing")}
                </Button>
              </div>
            </aside>
          )}

          {/* Connections */}
          <div className={privacyPref ? "lg:col-span-8" : "lg:col-span-12"}>
            {loading || (slug && congress.status === "loading") ? (
              <div role="status" aria-label={t.networkHeading} className="space-y-4">
                <div className="skeleton h-44 rounded-2xl" />
                <div className="skeleton h-44 rounded-2xl" />
              </div>
            ) : visibleConnections.length === 0 ? (
              <div className="relative overflow-hidden rounded-[var(--radius-xl)] border border-dashed border-border-strong p-8 text-center sm:p-12">
                <div aria-hidden="true" className="bg-meridian absolute inset-0 opacity-60" />
                <div className="relative mx-auto max-w-md space-y-4">
                  <span aria-hidden="true" className="mx-auto grid size-16 place-items-center rounded-2xl [border-start-end-radius:26px] bg-surface-ink text-white shadow-lift">
                    <Icon name="users" size={28} />
                  </span>
                  <h2 className="text-lg font-semibold tracking-[-0.02em] text-text-primary">{t.noConnectionsTitle}</h2>
                  <p className="text-sm leading-relaxed text-text-secondary">{t.noConnectionsDesc}</p>
                  <Button type="button" variant="primary" size="md" onClick={() => setIsConnectModalOpen(true)}>
                    <Icon name="user-plus" size={18} />
                    {t.connectButton}
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="space-y-4">
                {visibleConnections.map((conn) => (
                  <li key={conn.id}>
                    <article
                      aria-labelledby={`conn-${conn.id}`}
                      className="overflow-hidden rounded-[var(--radius-xl)] border border-border-default bg-surface-panel shadow-soft transition-shadow hover:shadow-lift"
                    >
                      {/* Identity */}
                      <div className="flex items-start gap-4 p-5 sm:p-6">
                        <Monogram name={conn.full_name} seed={conn.connected_user_id} size="lg" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <h2 id={`conn-${conn.id}`} className="text-lg font-semibold leading-snug tracking-[-0.02em] text-text-primary break-words">
                            {conn.full_name}
                          </h2>
                          {(conn.title || conn.organization) && (
                            <p dir="auto" className="text-sm text-text-secondary break-words">
                              {conn.title}
                              {conn.title && conn.organization ? " · " : ""}
                              {conn.organization && <span className="font-medium text-text-primary">{conn.organization}</span>}
                            </p>
                          )}
                          {/* Mobile number, only when the peer consented to share it; LTR island inside RTL text */}
                          <div className="pt-1 text-xs">
                            {conn.mobile ? (
                              <a
                                href={telHref(conn.mobile)}
                                className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded font-mono text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
                              >
                                <Icon name="phone" size={15} />
                                <bdi dir="ltr" className="truncate">{formatMobile(conn.mobile, locale)}</bdi>
                              </a>
                            ) : (
                              <span className="inline-flex items-start gap-1.5 rounded-lg bg-surface-panel-subtle px-2.5 py-1.5 leading-snug text-text-muted">
                                <Icon name="lock" size={13} className="mt-px" />
                                <span>{t.mobileNotSharedNotice}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Private notes */}
                      <div className="mx-5 mb-5 rounded-xl border border-border-subtle bg-surface-panel-subtle p-4 sm:mx-6">
                        <div className="flex items-center justify-between gap-3">
                          {editingId === conn.id ? (
                            <label htmlFor={`notes-${conn.id}`} className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                              <Icon name="note" size={14} />
                              {t.privateNotesLabel}
                            </label>
                          ) : (
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                              <Icon name="note" size={14} />
                              {t.privateNotesLabel}
                            </span>
                          )}
                          {editingId !== conn.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(conn.id);
                                setEditNotesText(conn.private_notes || "");
                              }}
                              className="-my-2 -me-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-action-primary underline-offset-4 hover:underline cursor-pointer focus-visible:outline-2 focus-visible:outline-focus-ring"
                            >
                              {t.editNotesAction}
                            </button>
                          )}
                        </div>

                        {editingId === conn.id ? (
                          <div className="mt-3 space-y-3">
                            <textarea
                              id={`notes-${conn.id}`}
                              rows={3}
                              value={editNotesText}
                              onChange={(e) => setEditNotesText(e.target.value)}
                              placeholder={t.privateNotesPlaceholder}
                              className="ui-textarea text-sm"
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="primary"
                                size="md"
                                disabled={savingNote}
                                onClick={() => handleSaveNotes(conn.id)}
                              >
                                {savingNote ? "..." : t.saveNotesAction}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="md"
                                disabled={savingNote}
                                onClick={() => setEditingId(null)}
                              >
                                {isRtl ? "انصراف" : "Cancel"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p dir="auto" className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-secondary">
                            {conn.private_notes || (
                              <span className="text-text-muted italic">
                                {isRtl ? "یادداشتی ثبت نشده است." : "No private notes recorded."}
                              </span>
                            )}
                          </p>
                        )}
                      </div>

                      {/* Footer: date & vCard */}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3 sm:px-6">
                        <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
                          <Icon name="calendar" size={14} />
                          <span>{isRtl ? "تاریخ ثبت ارتباط: " : "Connected on: "}</span>
                          <span>{formatLocalizedDate(conn.created_at, locale)}</span>
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="md"
                          onClick={() => handleDownloadVcard(conn.id, conn.full_name)}
                          className="text-xs"
                        >
                          <Icon name="id-card" size={17} />
                          <span>{t.downloadVCardAction}</span>
                        </Button>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Connect with Peer Dialog */}
      <Dialog
        isOpen={isConnectModalOpen}
        onClose={() => {
          if (!submittingConnect) {
            setIsConnectModalOpen(false);
            setConnectModalError(null);
          }
        }}
        title={t.connectModalTitle}
        description={t.connectModalDesc}
        size="md"
      >
        <form onSubmit={handleConnectPeer} className="space-y-5">
          <div>
            <label htmlFor="peer-code" className="ui-label">
              {t.peerCodeLabel} <span aria-hidden="true" className="text-status-danger-text">*</span>
            </label>
            <div className="relative">
              <Icon name="qr" size={18} className="pointer-events-none absolute inset-y-0 start-3.5 my-auto text-ink-400" />
              <input
                id="peer-code"
                type="text"
                required
                dir="ltr"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={peerQrSecret}
                onChange={(e) => setPeerQrSecret(e.target.value)}
                placeholder="e.g. 7A8B9C0D..."
                aria-describedby="peer-code-hint"
                className="ui-input ps-10 font-mono text-start"
              />
            </div>
            <span id="peer-code-hint" className="mt-1.5 block text-xs text-text-muted">
              {isRtl
                ? "کد نشان درج شده در زیر کیوآرکد همکار خود را وارد کنید."
                : "Enter the credential code printed beneath your peer's badge QR."}
            </span>
          </div>

          <div>
            <label htmlFor="peer-notes" className="ui-label">
              {t.privateNotesLabel}
            </label>
            <textarea
              id="peer-notes"
              rows={3}
              value={initialNotes}
              onChange={(e) => setInitialNotes(e.target.value)}
              placeholder={t.privateNotesPlaceholder}
              className="ui-textarea text-sm"
            />
          </div>

          {connectModalError && (
            <div
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3 text-xs leading-relaxed text-status-danger-text"
            >
              <Icon name="alert" size={16} className="shrink-0" />
              {connectModalError}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isFullWidth
            disabled={submittingConnect}
          >
            {submittingConnect ? "..." : (
              <>
                {t.saveConnectionAction}
                <Icon name="arrow-right" size={18} />
              </>
            )}
          </Button>
        </form>
      </Dialog>
    </AttendeeLayout>
  );
}
