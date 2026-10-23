import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createApiClient, type BoothOut, type LeadOut } from "../api/client";
import { boothCopy } from "../copy/booth";
import { commonCopy } from "../copy/common";
import { operatorCopy } from "../copy/operator";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../lib/attendeeSession";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { useHidScanner } from "../hooks/useHidScanner";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatLocalizedNumber, useLocale } from "../lib/i18n";
import { recordOperatorLaunch } from "../lib/launchTarget";
import { accessBlockOf, totalOf, type AccessBlock } from "../lib/leadList";
import { boothSignInPath } from "../lib/safeRedirect";
import { InstallHint } from "../components/attendee/InstallHint";
import { OperatorBar } from "../components/operator/OperatorBar";
import { OperatorGate } from "../components/operator/OperatorGate";
import { OperatorMenu, type OperatorMenuItem } from "../components/operator/OperatorMenu";
import { StatusPill } from "../components/operator/StatusPill";
import { Button, LinkButton } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { MetaList } from "../components/ui/MetaList";
import { SkipLink } from "../components/ui/SkipLink";
import { LoadingState } from "../components/ui/StateBlock";
import { CaptureDialog } from "../components/booth/CaptureDialog";
import { LeadList } from "../components/booth/LeadList";
import { boothTimeZone } from "../components/booth/leadTime";
import { QualifyDialog } from "../components/booth/QualifyDialog";
import { codedMessage } from "../components/booth/boothText";
import { useLeadCounts, useLeadList } from "../components/booth/useLeadList";
import { useLeadQueue } from "../components/booth/useLeadQueue";
import type { OperatorStatus } from "../copy/operator";
import "../styles/exhibitor.css";

// Remount per booth so a late response for booth A can never write into booth B's state.
export default function ExhibitorPortal() {
  const { boothId } = useParams<{ boothId: string }>();
  return <ExhibitorPortalContent key={boothId} />;
}

function ExhibitorPortalContent() {
  const { boothId } = useParams<{ boothId: string }>();
  const navigate = useNavigate();
  const { locale, setLocale, dir } = useLocale();
  const text = boothCopy[locale];
  const op = operatorCopy[locale];

  const [booth, setBooth] = useState<BoothOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [eventContext, setEventContext] = useState<{ name: string; slug: string } | null>(null);
  // Final for this page, nothing is fetched or sent any more: 403 BOOTH_STAFF_REQUIRED (this account was removed
  // from the booth's staff) or 403 BOOTH_ACCESS_SUSPENDED (the platform suspended the congress's organizer).
  const [accessBlock, setAccessBlock] = useState<AccessBlock | null>(null);
  // Learned from a 409 EVENT_ARCHIVED on a lead change after the booth loaded (it arrives with the booth too).
  const [archivedLater, setArchivedLater] = useState(false);
  const [otherBooths, setOtherBooths] = useState<BoothOut[]>([]);
  // One success line for the toast, and one error line above the list.
  const [notice, setNotice] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // Capture sheet: remounted for every opening (session), so each capture starts clean; `code` is a gun scan.
  const [capture, setCapture] = useState<{ open: boolean; session: number; code?: string }>({ open: false, session: 0 });
  const [capturedOnce, setCapturedOnce] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadOut | null>(null);

  const { token, signOut } = useAttendeeSession();
  // A new version waits: offered in the pill and the menu (the general update prompt is hidden on /booth).
  const update = useAppUpdate();

  const sessionRef = useRef<string | null>(token);
  const revoke = useCallback((block: AccessBlock) => setAccessBlock((current) => current ?? block), []);
  const markArchived = useCallback(() => setArchivedLater(true), []);
  // A child found the stored session changed (another tab): say so, and re-render so the session store hands over
  // the current token. Kept here, so the line survives the reload for the new session.
  const noteSessionChanged = () => setPageError(sessionChangedMessage(locale));
  const live = !accessBlock && Boolean(token);
  const archived = Boolean(booth?.event_archived) || archivedLater;

  const list = useLeadList({ boothId, token, locale, enabled: live, onAccessBlocked: revoke });
  const counts = useLeadCounts({ boothId, token, enabled: live, onAccessBlocked: revoke });
  const { reload: reloadList } = list;
  const { refresh: refreshCounts } = counts;
  const queue = useLeadQueue({
    boothId,
    token,
    enabled: live,
    onAccessBlocked: revoke,
    onArchived: markArchived,
    onSynced: (synced) => {
      setNotice(text.syncedCount(formatLocalizedNumber(synced.length, locale)));
      reloadList();
      refreshCounts();
    },
  });

  useEffect(() => {
    let isMounted = true;
    // Another account must never inherit the previous staff member's booth view or leads.
    if (sessionRef.current !== token) {
      sessionRef.current = token;
      setBooth(null);
      setEventContext(null);
      setCapture((current) => ({ ...current, open: false }));
      setEditingLead(null);
      setAuthError(null);
      setAccessBlock(null);
      setArchivedLater(false);
      setNotice(null);
    }
    if (!boothId) return;
    // Without a token the render returns the sign-in gate before `loading` is ever read, and the
    // fetch below sets `loading` itself once a token exists, so no reset is needed here.
    if (!token) return;

    const fetchData = async () => {
      setLoading(true);
      setAuthError(null);
      setLoadFailed(false);
      try {
        const client = createApiClient({ kind: "user", token });
        const [boothRes, accessRes] = await Promise.all([
          client.GET("/api/booths/{booth_id}", { params: { path: { booth_id: boothId } } }),
          client.GET("/api/me/access"),
        ]);

        if (!isMounted) return;
        // The stored session changed, or a 401 removed it, while the request was in flight: ignore
        // this response and never delete a newer session. The re-render reads the current token.
        if (attendeeResponseState(token, boothRes.response.status) !== "current") {
          setLoading(false);
          return;
        }

        if (boothRes.error) {
          const block = accessBlockOf(boothRes.response.status, boothRes.error);
          if (boothRes.response.status >= 500) setLoadFailed(true);
          else if (block === "suspended") setAccessBlock(block);
          else setAuthError(codedMessage(boothRes.error, locale) ?? boothCopy[locale].refusedBody);
        } else if (boothRes.data) {
          setBooth(boothRes.data);
          const mine = accessRes.data?.events.find((e) => e.booth_ids.includes(boothId));
          setEventContext(mine ? { name: mine.event_name, slug: mine.event_slug } : null);
        }
      } catch {
        if (isMounted) setLoadFailed(true);
      }
      if (isMounted) setLoading(false);
    };

    fetchData();
    return () => {
      isMounted = false;
    };
    // `locale` only words an error message; switching language does not refetch.
  }, [boothId, token, reloadNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Removed from this booth: offer the booths this account still staffs (one request, no retry).
  useEffect(() => {
    if (accessBlock !== "removed" || !token) return;
    let current = true;
    void createApiClient({ kind: "user", token })
      .GET("/api/booths/me")
      .then((res) => {
        if (current && res.data) setOtherBooths(res.data.filter((b) => b.id !== boothId));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [accessBlock, token, boothId]);

  // The home-screen icon reopens this booth once it has loaded.
  const loadedBoothId = booth?.id;
  useEffect(() => {
    if (loadedBoothId && boothId) recordOperatorLaunch("booth", `/booth/${boothId}`);
  }, [loadedBoothId, boothId]);

  const openCapture = useCallback((code?: string) => {
    setCapture((current) => ({ open: true, session: current.session + 1, code }));
  }, []);

  // A barcode-gun scan with nothing open captures straight away (the sheet opens on its result).
  useHidScanner((code) => openCapture(code), Boolean(booth) && live && !archived && !capture.open && !editingLead);

  usePageTitle(text.portal, booth?.name);

  const handleSignOut = () => {
    signOut();
    navigate(boothId ? boothSignInPath(boothId) : "/");
  };

  const exportCsv = async (includeDeleted: boolean) => {
    if (!booth || !token) return;
    if (!isStoredAttendeeToken(token)) {
      noteSessionChanged();
      return;
    }
    setExporting(true);
    setPageError(null);
    setNotice(null);
    try {
      const { data: blob, error, response } = await createApiClient({ kind: "user", token }).GET("/api/booths/{booth_id}/leads/export-csv", {
        params: { path: { booth_id: booth.id }, ...(includeDeleted ? { query: { include_deleted: true } } : {}) },
        parseAs: "blob",
      });
      // No download or completion feedback for a session that has since changed or expired.
      if (attendeeResponseState(token, response.status) !== "current") return;
      const block = accessBlockOf(response.status, error);
      if (block) {
        revoke(block);
        return;
      }
      if (!response.ok || !blob) {
        setPageError(text.exportFailed);
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${booth.slug || "booth"}-leads.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      setNotice(text.exportStarted);
    } catch {
      setPageError(text.exportFailed);
    } finally {
      setExporting(false);
    }
  };

  const home = (
    <LinkButton to="/" variant="ghost" size="lg" isFullWidth>
      {text.home}
    </LinkButton>
  );
  const otherAccount = (variant: "primary" | "ghost") =>
    boothId && (
      <LinkButton to={boothSignInPath(boothId)} variant={variant} size="lg" isFullWidth>
        {text.otherAccount}
      </LinkButton>
    );
  const unsent = queue.scans.length;
  const unsentLine = unsent > 0 && <p className="font-medium text-status-warning-text">{text.unsent(formatLocalizedNumber(unsent, locale))}</p>;

  // Unauthenticated view (fails closed)
  if (!token) {
    return (
      <OperatorGate
        locale={locale}
        kind="signIn"
        title={text.signInTitle}
        body={text.signInBody}
        action={
          <LinkButton to={boothId ? boothSignInPath(boothId) : "/"} variant="primary" size="lg" isFullWidth iconEnd="arrow-right">
            {text.signIn}
          </LinkButton>
        }
      />
    );
  }

  if (loading && !booth) {
    return (
      <div dir={dir} lang={locale} aria-busy="true" className="grid min-h-dvh place-items-center bg-surface-page">
        <LoadingState />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <OperatorGate
        locale={locale}
        kind="unavailable"
        title={text.unavailableTitle}
        body={text.unavailableBody}
        action={
          <Button type="button" variant="primary" size="lg" isFullWidth icon="sync" onClick={() => setReloadNonce((n) => n + 1)}>
            {commonCopy[locale].retry}
          </Button>
        }
      />
    );
  }

  // A suspension is shown even before the booth loads (every booth call is refused); "removed" only once the booth
  // had loaded, so an account that never was staff keeps the "no access" screen below.
  if (accessBlock === "suspended") {
    return (
      <OperatorGate locale={locale} kind="suspended" title={text.suspendedTitle} body={text.suspendedBody} secondary={home}>
        {unsentLine && <div data-testid="access-suspended">{unsentLine}</div>}
      </OperatorGate>
    );
  }

  if (authError || !booth) {
    return (
      <OperatorGate locale={locale} kind="removed" title={text.refusedTitle} body={authError ?? text.refusedBody} action={otherAccount("primary")} secondary={home} />
    );
  }

  if (accessBlock === "removed") {
    return (
      <OperatorGate
        locale={locale}
        kind="removed"
        title={text.removedTitle}
        body={text.removedBody}
        action={otherAccount(otherBooths.length ? "ghost" : "primary")}
        secondary={home}
      >
        {(unsentLine || otherBooths.length > 0) && (
          <div data-testid="access-removed" className="space-y-3">
            {unsentLine}
            {otherBooths.length > 0 && (
              <div className="space-y-2">
                <p className="font-semibold text-text-primary">{text.otherBooths}</p>
                {otherBooths.map((other) => (
                  <LinkButton key={other.id} to={`/booth/${encodeURIComponent(other.id)}`} variant="secondary" size="lg" isFullWidth icon="booth">
                    <span className="truncate">{other.name}</span>
                  </LinkButton>
                ))}
              </div>
            )}
          </div>
        )}
      </OperatorGate>
    );
  }

  const activeTotal = counts.known ? totalOf(counts.counts) : list.total;
  const canExport = queue.online && !exporting;
  const status: OperatorStatus = archived
    ? "archived"
    : !queue.online
      ? "offline"
      : queue.sendingId
        ? "syncing"
        : unsent > 0
          ? "queued"
          : update.waiting
            ? "update"
            : "online";

  const menuItems: OperatorMenuItem[] = [
    { id: "language", label: op.menu.language, lang: op.menu.languageLang, icon: "globe", onSelect: () => setLocale(op.menu.languageLang) },
    ...(eventContext && boothId
      ? [
          {
            id: "profile",
            label: text.publicProfile,
            icon: "arrow-up-right" as const,
            onSelect: () => navigate(`/e/${encodeURIComponent(eventContext.slug)}/booths/${encodeURIComponent(boothId)}`),
          },
        ]
      : []),
    { id: "export", label: text.exportCsv, icon: "download", divider: true, disabled: !canExport || activeTotal === 0, onSelect: () => void exportCsv(false) },
    {
      id: "export-deleted",
      label: text.exportWithDeleted,
      icon: "download",
      disabled: !canExport || activeTotal + counts.deleted === 0,
      onSelect: () => void exportCsv(true),
    },
    ...(update.waiting ? [{ id: "update", label: op.menu.update, icon: "download" as const, divider: true, onSelect: update.apply }] : []),
    { id: "sign-out", label: op.menu.signOut, icon: "logout", danger: true, divider: true, onSelect: () => setConfirmSignOut(true) },
  ];

  return (
    <div dir={dir} lang={locale} className="booth-portal min-h-dvh bg-surface-page font-sans text-text-primary">
      <SkipLink targetId="booth-leads">{text.skipToLeads}</SkipLink>
      <OperatorBar
        title={booth.name}
        subtitle={eventContext?.name}
        icon="booth"
        actions={
          !archived && (
            <Button type="button" variant="primary" icon="scan" onClick={() => openCapture()} className="max-md:hidden">
              {text.capture}
            </Button>
          )
        }
        status={<StatusPill locale={locale} status={status} count={unsent} onClick={status === "update" ? update.apply : undefined} />}
        menu={
          <OperatorMenu
            locale={locale}
            items={menuItems}
            header={
              <MetaList
                items={[
                  ...(booth.location ? [{ label: text.stand, value: booth.location }] : []),
                  { label: text.boothCode, value: <bdi data-testid="booth-code" dir="ltr" className="font-mono whitespace-nowrap">{booth.slug}</bdi>, dir: "ltr" as const },
                ]}
                columns={1}
              />
            }
          />
        }
      />

      <main id="booth-leads" tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 pb-32 focus:outline-none md:pb-10 lg:max-w-6xl">
        <LeadList
          boothId={booth.id}
          token={token}
          locale={locale}
          timeZone={boothTimeZone(booth)}
          list={list}
          counts={counts}
          queue={queue}
          archived={archived}
          notice={notice}
          onNotice={setNotice}
          error={pageError}
          onQualify={setEditingLead}
          onAccessBlocked={revoke}
          onArchived={markArchived}
          onSessionChanged={noteSessionChanged}
        >
          {capturedOnce && !archived && <InstallHint locale={locale} persona="booth" />}
        </LeadList>
      </main>

      {/* Phones and small tablets: the one primary action stays under the thumb. */}
      {!archived && (
        <div data-testid="capture-dock" className="fixed inset-x-0 bottom-0 z-30 border-t border-border-default bg-surface-panel/95 px-4 pb-safe backdrop-blur-sm md:hidden">
          <div className="mx-auto max-w-3xl py-3">
            <Button type="button" variant="primary" size="lg" isFullWidth icon="scan" onClick={() => openCapture()}>
              {text.capture}
            </Button>
          </div>
        </div>
      )}

      <CaptureDialog
        key={capture.session}
        isOpen={capture.open && !archived}
        initialCode={capture.code}
        onClose={() => setCapture((current) => ({ ...current, open: false }))}
        boothId={booth.id}
        token={token}
        locale={locale}
        onCaptured={() => {
          setNotice(null);
          setPageError(null);
          setCapturedOnce(true);
          reloadList();
          refreshCounts();
        }}
        onLeadChanged={(lead) => {
          list.applyLead(lead);
          refreshCounts();
        }}
        onQualify={setEditingLead}
        onQueue={async (input) => {
          const kept = await queue.enqueue(input);
          if (kept) setCapturedOnce(true);
          return kept;
        }}
        onAccessBlocked={revoke}
        onArchived={markArchived}
        onSessionChanged={noteSessionChanged}
      />

      <QualifyDialog
        lead={editingLead}
        onClose={() => setEditingLead(null)}
        boothId={booth.id}
        token={token}
        locale={locale}
        onSaved={(saved) => {
          list.applyLead(saved);
          refreshCounts();
        }}
        onAccessBlocked={revoke}
        onArchived={markArchived}
        onSessionChanged={noteSessionChanged}
      />

      <ConfirmDialog
        isOpen={confirmSignOut}
        title={text.signOutTitle}
        confirmLabel={op.menu.signOut}
        tone="danger"
        onConfirm={handleSignOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}
