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
} from "../lib/i18n";
import { useParams } from "react-router-dom";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { useCongressEvent } from "../lib/congressContext";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
export default function MyNetwork() {
  const localeHook = useAttendeeLocale();
  const { locale, t, isRtl } = localeHook;

  const { slug } = useParams<{ slug?: string }>();
  const congress = useCongressEvent(slug);
  const [connections, setConnections] = useState<ConnectionOut[]>([]);
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
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

    setSubmittingConnect(true);
    setConnectModalError(null);
    const client = createApiClient({ kind: "user", token });
    const { data, error: err, response } = await client.POST(
      "/api/attendees/me/network/scan",
      {
        body: {
          qr_secret: peerQrSecret.trim(),
          private_notes: initialNotes.trim(),
        },
      }
    );

    const stillCurrent = isStoredAttendeeToken(token);
    if (response.status === 401) rejectAttendeeToken(token);
    setSubmittingConnect(false);
    if (!stillCurrent) return;
    if (err) {
      setConnectModalError(formatApiError(err));
    } else if (data) {
      setPeerQrSecret("");
      setInitialNotes("");
      setIsConnectModalOpen(false);
      setScopeNotice(
        slug && activeEventId && data.event_id !== activeEventId
          ? isRtl
            ? "این کارت متعلق به همایش دیگری است؛ ارتباط در همان همایش ذخیره شد و اینجا نمایش داده نمی‌شود."
            : "This badge belongs to another congress. The contact was saved there and is not shown here."
          : null
      );
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
        <div className="max-w-md mx-auto px-4 py-20 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-action-subtle text-action-primary mx-auto flex items-center justify-center text-3xl shadow-xs">
            🤝
          </div>
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
              {t.unauthenticatedTitle}
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              {t.unauthenticatedDesc}
            </p>
          </div>
          <div className="pt-2">
            <LinkButton to="/" variant="primary" size="lg" isFullWidth>
              {t.loginAction} →
            </LinkButton>
          </div>
        </div>
      </AttendeeLayout>
    );
  }

  return (
    <AttendeeLayout activeTab="network" localeProps={localeHook} eventSlug={slug} destination="my-network">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        {/* Top Header & Connect Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="brand" size="md">
                {isRtl ? "ارتباطات علمی و حرفه‌ای" : "Professional Network"}
              </Badge>
              <span className="text-xs text-text-muted">
                ({visibleConnections.length} {isRtl ? "همراه" : "contacts"})
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-primary">
              {t.networkHeading}
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary">
              {t.networkDesc}
            </p>
          </div>

          <div className="shrink-0">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setIsConnectModalOpen(true)}
              className="gap-2 shadow-xs"
            >
              <span>+</span>
              <span>{t.connectButton}</span>
            </Button>
          </div>
        </div>

        {/* Global Feedback Notifications */}
        {privacyFeedback && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-action-subtle text-action-primary border border-action-subtle-border text-xs leading-relaxed animate-in fade-in"
          >
            {privacyFeedback}
          </div>
        )}

        {scopeNotice && (
          <div role="status" className="p-3 rounded-xl bg-status-warning-bg text-status-warning-text border border-status-warning-border text-xs">
            {scopeNotice}
          </div>
        )}

        {noteFeedback && (
          <div
            role="status"
            className="p-3 rounded-xl bg-action-subtle text-action-primary border border-action-subtle-border text-xs animate-in fade-in"
          >
            {noteFeedback}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
          >
            {error}
          </div>
        )}

        {/* Privacy & Contact Consent Card (Issue #19) */}
        {privacyPref && (
          <Card className="border-border-default shadow-xs overflow-hidden">
            <div className="p-5 sm:p-6 bg-surface-panel flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center gap-2">
                  <span className="text-sm">🔒</span>
                  <h2 className="text-sm sm:text-base font-bold text-text-primary tracking-tight">
                    {t.privacyHeading}
                  </h2>
                  {slug && (
                    <span className="text-[11px] text-text-muted">
                      {isRtl ? "(برای همه همایش‌ها)" : "(applies to all congresses)"}
                    </span>
                  )}
                  <Badge
                    variant={privacyPref.share_contact_with_peers ? "success" : "neutral"}
                    size="sm"
                  >
                    {privacyPref.share_contact_with_peers
                      ? t.emailSharedStatus
                      : t.emailHiddenStatus}
                  </Badge>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {t.shareEmailToggleDesc}
                </p>
              </div>

              <div className="shrink-0">
                <Button
                  type="button"
                  variant={privacyPref.share_contact_with_peers ? "outline" : "secondary"}
                  size="sm"
                  disabled={updatingPrivacy}
                  onClick={handleTogglePrivacyConsent}
                >
                  {updatingPrivacy
                    ? "..."
                    : privacyPref.share_contact_with_peers
                    ? (isRtl ? "تغییر به محرمانه (غیرفعال)" : "Make Email Private")
                    : (isRtl ? "فعال‌سازی اشتراک ایمیل" : "Enable Email Sharing")}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Connections List / Cards */}
        {loading || (slug && congress.status === "loading") ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-28 bg-surface-panel rounded-2xl border border-border-default" />
            <div className="h-28 bg-surface-panel rounded-2xl border border-border-default" />
          </div>
        ) : visibleConnections.length === 0 ? (
          <Card className="p-8 sm:p-12 text-center space-y-4 border-border-default">
            <div className="w-14 h-14 rounded-2xl bg-action-subtle text-action-primary mx-auto flex items-center justify-center text-2xl font-bold">
              🤝
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-lg font-bold text-text-primary">
                {t.noConnectionsTitle}
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                {t.noConnectionsDesc}
              </p>
            </div>
            <div className="pt-2">
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => setIsConnectModalOpen(true)}
              >
                {t.connectButton}
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {visibleConnections.map((conn) => (
              <article
                key={conn.id}
                aria-labelledby={`conn-${conn.id}`}
                className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-4"
              >
                {/* Header Row: Identity & vCard download */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="space-y-1">
                    <h2 id={`conn-${conn.id}`} className="text-base sm:text-lg font-bold text-text-primary tracking-tight">
                      {conn.full_name}
                    </h2>
                    {(conn.title || conn.organization) && (
                      <p className="text-xs text-text-secondary font-medium">
                        {conn.title}
                        {conn.title && conn.organization ? " • " : ""}
                        {conn.organization}
                      </p>
                    )}

                    {/* Email display with privacy consent logic & Bidi isolation */}
                    <div className="pt-1 text-xs">
                      {conn.email ? (
                        <a
                          href={`mailto:${conn.email}`}
                          className="text-action-primary hover:underline font-mono inline-flex items-center gap-1.5 focus-visible:outline-focus-ring"
                        >
                          <span aria-hidden="true">✉</span>
                          <bdi dir="ltr">{conn.email}</bdi>
                        </a>
                      ) : (
                        <span className="text-text-muted inline-flex items-center gap-1.5">
                          <span aria-hidden="true">🔒</span>
                          <span>{t.emailNotSharedNotice}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions: vCard download */}
                  <div className="shrink-0 flex items-center gap-2 pt-1 sm:pt-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadVcard(conn.id, conn.full_name)}
                      className="text-xs"
                    >
                      <span>📇</span>
                      <span>{t.downloadVCardAction}</span>
                    </Button>
                  </div>
                </div>

                {/* Private Notes Section */}
                <div className="pt-3 border-t border-border-subtle space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-text-muted">
                      {t.privateNotesLabel}
                    </span>
                    {editingId !== conn.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(conn.id);
                          setEditNotesText(conn.private_notes || "");
                        }}
                        className="text-action-primary hover:underline font-medium text-[11px] cursor-pointer"
                      >
                        {t.editNotesAction}
                      </button>
                    )}
                  </div>

                  {editingId === conn.id ? (
                    <div className="space-y-2">
                      <textarea
                        rows={3}
                        value={editNotesText}
                        onChange={(e) => setEditNotesText(e.target.value)}
                        placeholder={t.privateNotesPlaceholder}
                        className="w-full p-2.5 bg-white border border-border-default rounded-xl text-xs sm:text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          disabled={savingNote}
                          onClick={() => handleSaveNotes(conn.id)}
                        >
                          {savingNote ? "..." : t.saveNotesAction}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={savingNote}
                          onClick={() => setEditingId(null)}
                        >
                          {isRtl ? "انصراف" : "Cancel"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line bg-surface-page p-3 rounded-xl border border-border-subtle">
                      {conn.private_notes || (
                        <span className="text-text-muted italic">
                          {isRtl ? "یادداشتی ثبت نشده است." : "No private notes recorded."}
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {/* Date stamp with Bidi isolation */}
                <div className="pt-1 text-[11px] text-text-muted">
                  <span>{isRtl ? "تاریخ ثبت ارتباط: " : "Connected on: "}</span>
                  <span>{formatLocalizedDate(conn.created_at, locale)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
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
        <form onSubmit={handleConnectPeer} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.peerCodeLabel} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={peerQrSecret}
              onChange={(e) => setPeerQrSecret(e.target.value)}
              placeholder="e.g. 7A8B9C0D..."
              className="w-full px-3 py-2 bg-white border border-border-default rounded-lg text-sm text-text-primary font-mono focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
            <span className="text-[11px] text-text-muted mt-1 block">
              {isRtl
                ? "کد نشان درج شده در زیر کیوآرکد همکار خود را وارد کنید."
                : "Enter the credential code printed beneath your peer's badge QR."}
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.privateNotesLabel}
            </label>
            <textarea
              rows={3}
              value={initialNotes}
              onChange={(e) => setInitialNotes(e.target.value)}
              placeholder={t.privateNotesPlaceholder}
              className="w-full p-2.5 bg-white border border-border-default rounded-lg text-xs sm:text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
          </div>

          {connectModalError && (
            <div
              role="alert"
              aria-live="assertive"
              className="p-3 rounded-lg bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
            >
              {connectModalError}
            </div>
          )}

          <div className="pt-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              isFullWidth
              disabled={submittingConnect}
            >
              {submittingConnect
                ? "..."
                : `${t.saveConnectionAction} →`}
            </Button>
          </div>
        </form>
      </Dialog>
    </AttendeeLayout>
  );
}
