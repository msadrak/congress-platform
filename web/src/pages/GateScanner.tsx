import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { createScannerApiClient, formatApiError, type CheckInManifest } from "../api/client";
import { playErrorBuzz, playSuccessChime, playProvisionalChime } from "../lib/audioFeedback";
import { useAttendeeLocale } from "../lib/i18n";
import jsQR from "jsqr";
import {
  evaluateOfflineAuthorization,
  formatRemainingWindow,
  getJwtExpiryIso,
  isServerReachable,
  type OfflineAuthVerdict,
} from "../lib/scannerAuthPolicy";
import { hidCharacter, normalizeScannedCode, qrHash } from "../lib/scannerInput";
import { MANIFEST_POLL_MS, mergeManifest, upgradeLegacyManifest } from "../lib/scannerManifest";
import {
  clearPersistedToken,
  getPersistedScannerCredential,
  markScannerDeactivationPending,
  persistScannerToken,
  type PersistedScannerCredential,
} from "../lib/scannerTokenStore";
import {
  applyServerScan,
  evaluateLocalScan,
  reconstructLocalState,
  type LocalPolicyConfig,
  type LocalScanResult,
  type LocalTicket,
} from "../lib/scannerEngine";
import {
  acknowledgeConflict,
  clientVerdictFor,
  discardUnsyncedScans,
  getAllScansForPoint,
  getCachedManifestMeta,
  getConflictsForPoint,
  getRecentScans,
  getUnsyncedScans,
  purgeExpiredScans,
  reconcileBatchOutcomes,
  requestPersistentStorage,
  saveCachedManifest,
  saveQueuedScan,
  ScannerStorageBlockedError,
  wipePointData,
  type QueuedScan,
  type ServerScanResult,
} from "../lib/scannerStorage";
import { DiscardUnsynced } from "../components/scanner/DiscardUnsynced";
import { Icon } from "../components/ui/Icon";
import { scannerCopy, clockTime, takeoverKind, type ScannerCopy } from "../components/scanner/copy";
import { BiHeading, BiLabel, ScannerScreen, SetupFrame, SetupPanel, SystemReadout } from "../components/scanner/ScannerChrome";
import { ScannerHeader } from "../components/scanner/ScannerHeader";
import { Viewfinder } from "../components/scanner/Viewfinder";
import { ResultTakeover } from "../components/scanner/ResultTakeover";
import { ManualEntry } from "../components/scanner/ManualEntry";
import { BufferBar, ScanLog } from "../components/scanner/ScanLog";
import { DeviceSettings } from "../components/scanner/DeviceSettings";
import { ConflictDrawer } from "../components/scanner/ConflictDrawer";
import "../styles/scanner.css";

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement | ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}

interface WindowWithBarcodeDetector extends Window {
  BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorInstance;
}

/** How long an online scan waits for the server's verdict before deciding locally (provisionally). */
const SERVER_SCAN_TIMEOUT_MS = 2000;
/** Largest batch the server accepts; longer queues upload in chunks. */
const SYNC_CHUNK = 200;
/** Scans shown in the log. */
const LOG_SIZE = 10;
/** A sync refreshes the manifest afterwards unless it was requested this recently. */
const MANIFEST_AFTER_SYNC_MIN_MS = 5000;
/** While the server does not answer, the manifest request (the reachability probe) is retried this often. */
const MANIFEST_RETRY_MS = 10_000;

type ManifestRefresh = { kind: "ok" } | { kind: "blocked" | "transient"; detail: string };

/** A cached manifest record as stored by this or an older scanner. */
function isManifest(value: unknown): value is CheckInManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "checkin_point" in value &&
    "tickets" in value &&
    Array.isArray(value.tickets)
  );
}

export default function GateScanner() {
  const { pointId } = useParams<{ pointId: string }>();
  const { locale, setLocale, t } = useAttendeeLocale();
  const toggleLocale = () => { setLocale(locale === "fa" ? "en" : "fa"); };
  const [tokenInput, setTokenInput] = useState("");
  const [manualCode, setManualCode] = useState("");
  // Persisted scanner credential (survives browser restart via IndexedDB)
  const [persistedCredential, setPersistedCredential] = useState<PersistedScannerCredential | null>(null);
  // Authorization lifecycle: definitive server rejects + offline-window verdict
  type AuthBlock = { kind: "REVOKED" | "FORBIDDEN" | "EXPIRED"; message: string };
  const [authBlocked, setAuthBlockedState] = useState<AuthBlock | null>(null);
  // Long-lived callbacks (sync timer, online handler, HID listener, camera loop) and back-to-back
  // scans read these refs, never a render's snapshot: they are written synchronously with the state.
  const authBlockedRef = useRef<AuthBlock | null>(null);
  const setAuthBlocked = (value: AuthBlock | null) => {
    authBlockedRef.current = value;
    setAuthBlockedState(value);
  };
  const [authVerdict, setAuthVerdict] = useState<OfflineAuthVerdict | null>(null);
  // Unpair flow state — durable local lockout remains until server revocation.
  const [showUnpairConfirm, setShowUnpairConfirm] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [deactivationPending, setDeactivationPending] = useState(false);
  const deactivationRef = useRef(false);
  // Rendered with the current copy, so the notice follows a language switch.
  const [unpairNotice, setUnpairNoticeState] = useState<((c: ScannerCopy) => string) | null>(null);
  const setUnpairNotice = (notice: ((c: ScannerCopy) => string) | null) => setUnpairNoticeState(() => notice);
  // A scan this device decided but could not store: its admission would never reach the server.
  const [storageFailed, setStorageFailed] = useState(false);
  const storageFailedRef = useRef(false);
  const getStoredScannerToken = useCallback((): string | null => {
    if (!pointId || typeof window === "undefined") return null;
    return (
      sessionStorage.getItem(`congress_scanner_token_${pointId}`) ||
      persistedCredential?.token ||
      null
    );
  }, [pointId, persistedCredential]);

  // Explicit device authority bound to this check-in point. Without a device credential nothing is
  // dispatched, so no other session (User, organizer, desk) can ever be attached to scanner requests.
  const scannerClient = (token: string | null) =>
    pointId && token ? createScannerApiClient({ kind: "scanner", token, pointId }, { pointId }) : null;

  // One scanning tab per check-in point (Web Locks): two tabs would each count capacity and duplicates
  // against their own state and upload in parallel. A second tab waits and takes over when the first
  // closes; the waiting request also recovers the lock a StrictMode remount briefly lost.
  type TabLock = "pending" | "held" | "busy" | "unsupported";
  const [tabLock, setTabLockState] = useState<TabLock>("pending");
  const tabLockRef = useRef<TabLock>("pending");
  const ownsPoint = () => tabLockRef.current === "held" || tabLockRef.current === "unsupported";

  // Last successful and failed server requests: the scanner is online only while the latest one
  // succeeded recently (navigator.onLine alone says nothing about a captive portal or a dead backend).
  const contactRef = useRef<{ lastSuccessAt: number | null; lastFailureAt: number | null }>({
    lastSuccessAt: null,
    lastFailureAt: null,
  });
  const [isOnline, setIsOnline] = useState(false);
  const serverReachable = () =>
    isServerReachable(Date.now(), { browserOnline: navigator.onLine, ...contactRef.current });
  const noteServerContact = (ok: boolean) => {
    const now = Date.now();
    contactRef.current = ok
      ? { lastSuccessAt: now, lastFailureAt: null }
      : { ...contactRef.current, lastFailureAt: now };
    setIsOnline(serverReachable());
  };

  // On mount: restore persisted credential from IndexedDB into memory.
  useEffect(() => {
    if (!pointId) return;
    getPersistedScannerCredential(pointId).then((credential) => {
      if (credential) {
        setPersistedCredential(credential);
        deactivationRef.current = credential.deactivation_pending === true;
        setDeactivationPending(credential.deactivation_pending === true);
        sessionStorage.setItem(`congress_scanner_token_${pointId}`, credential.token);
      }
    });
  }, [pointId]);

  // Closes over pointId and stable setters/refs only, so its identity changes exactly when pointId does.
  const storeCredential = useCallback(async (token: string) => {
    if (!pointId) return;
    const credential: PersistedScannerCredential = {
      pointId,
      token,
      stored_at: new Date().toISOString(),
      device_id: null,
      token_issued_at: new Date().toISOString(),
      token_expires_at: getJwtExpiryIso(token),
      deactivation_pending: false,
    };
    await persistScannerToken(pointId, token, {
      device_id: credential.device_id,
      token_issued_at: credential.token_issued_at,
      token_expires_at: credential.token_expires_at,
    });
    sessionStorage.setItem(`congress_scanner_token_${pointId}`, token);
    setPersistedCredential(credential);
    deactivationRef.current = false;
    setDeactivationPending(false);
    setUnpairNoticeState(null);
  }, [pointId]);


  // Handle token from URL query parameter (?token=...) — persist then strip
  useEffect(() => {
    const tokenFromUrl =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("token");
    if (tokenFromUrl && pointId && typeof window !== "undefined") {
      const trimmed = tokenFromUrl.trim();
      sessionStorage.setItem(`congress_scanner_token_${pointId}`, trimmed);
      // oxlint-disable-next-line react/set-state-in-effect -- storeCredential only sets state after awaiting IndexedDB persistence; the effect syncs the ?token= handoff into storage.
      void storeCredential(trimmed);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [pointId, storeCredential]);

  // Authorization failure classification (Phase 3):
  // - 401 missing/invalid/expired/revoked  -> definitive credential failure.
  // - 403 wrong point/event/scope         -> definitive scope failure.
  // - Network throw / no status            -> transient. Keep scanning, retry later.
  const classifyAuthFailure = (
    status: number | undefined,
    detail: string
  ): "REVOKED" | "FORBIDDEN" | "EXPIRED" | "TRANSIENT" => {
    const lowered = detail.toLowerCase();
    if (status === 403 || lowered.includes("not authorized") || lowered.includes("insufficient permissions")) {
      return "FORBIDDEN";
    }
    if (status === 401) {
      if (lowered.includes("revoked")) return "REVOKED";
      if (lowered.includes("expir")) return "EXPIRED";
      return "REVOKED";
    }
    return "TRANSIENT";
  };

  // A device that lost its authority keeps no attendee data: the cached manifest and every synced scan
  // are deleted. Unsynced scans stay (the only copy) until re-pairing uploads them or an operator
  // discards them.
  const enterAuthBlocked = (kind: "REVOKED" | "FORBIDDEN" | "EXPIRED", message: string) => {
    setAuthBlocked({ kind, message });
    applyManifest(null);
    applyAdmissionState({}, 0);
    setRecentScans([]);
    setConflicts([]);
    setShowConflictDrawer(false);
    if (pointId) {
      wipePointData(pointId)
        .then(() => updatePendingCount())
        .catch(() => undefined);
    }
  };

  // Manifest freshness tracking (Phase 4: enforced, not just displayed): time of the last successful
  // manifest fetch, full or delta.
  const [manifestCachedAt, setManifestCachedAt] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hidBufferRef = useRef<string>("");
  const hidLastKeyTimeRef = useRef<number>(0);
  const isScanningRef = useRef<boolean>(false);
  // The badge whose result is still on screen, and the timer that clears it.
  const lastProcessedCodeRef = useRef<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectionActiveRef = useRef<boolean>(false);
  const lastScannedCodeRef = useRef<{ code: string; time: number } | null>(null);
  const [trackingIdWarning, setTrackingIdWarning] = useState(false);

  // Stop camera stream cleanly on unmount
  useEffect(() => {
    return () => {
      detectionActiveRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);
  const [manifest, setManifest] = useState<CheckInManifest | null>(null);
  // The manifest scans and refreshes work from; written together with the state.
  const manifestRef = useRef<CheckInManifest | null>(null);
  const applyManifest = (value: CheckInManifest | null) => {
    manifestRef.current = value;
    setManifest(value);
  };
  // When the last manifest request started (polls and post-sync refreshes are spaced from it), and the
  // request in flight, which later callers join instead of sending a second one.
  const manifestAttemptAtRef = useRef(0);
  const manifestInFlightRef = useRef<Promise<ManifestRefresh> | null>(null);
  const [ticketMap, setTicketMap] = useState<Record<string, LocalTicket>>({});
  // The admission state every scan evaluates against. evaluateLocalScan mutates the ticket entries in
  // place, so the map and the admitted count are only ever read and advanced through this ref.
  const admissionRef = useRef<{ ticketMap: Record<string, LocalTicket>; admittedCount: number }>({
    ticketMap: {},
    admittedCount: 0,
  });
  const applyAdmissionState = (map: Record<string, LocalTicket>, admittedCount: number) => {
    admissionRef.current = { ticketMap: map, admittedCount };
    setTicketMap(map);
  };
  // Scans evaluated here but not yet written to IndexedDB, and a counter bumped whenever a scan is
  // evaluated or written. A rebuild (manifest load/refresh, sync conflicts) may only replace the live
  // state if no scan happened while it read the history; otherwise it reads again.
  const unsavedScansRef = useRef<QueuedScan[]>([]);
  const scanEpochRef = useRef(0);
  const rebuildAdmissionState = async (source: CheckInManifest): Promise<void> => {
    if (!pointId) return;
    for (;;) {
      const epoch = scanEpochRef.current;
      const stored = await getAllScansForPoint(pointId);
      // Records written by an older scanner carry only the raw code: hash them to find their ticket.
      const history = await Promise.all(
        stored.map(async (s) => (s.qr_hash ? s : { ...s, qr_hash: await qrHash(source.event_id, s.qr_secret) }))
      );
      if (epoch !== scanEpochRef.current) continue;
      const saved = new Set(history.map((s) => s.scan_id));
      const { ticketMap: map, currentAdmittedCount } = reconstructLocalState(source.tickets, [
        ...history,
        ...unsavedScansRef.current.filter((s) => !saved.has(s.scan_id)),
      ]);
      applyAdmissionState(map, currentAdmittedCount);
      return;
    }
  };
  const [conflicts, setConflicts] = useState<QueuedScan[]>([]);
  const [showConflictDrawer, setShowConflictDrawer] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // Sync states
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFailCount, setSyncFailCount] = useState(0);

  // Recompute the offline-window verdict whenever its inputs change
  useEffect(() => {
    const verdict = evaluateOfflineAuthorization(Date.now(), {
      tokenExpiresAt: persistedCredential?.token_expires_at ?? getJwtExpiryIso(getStoredScannerToken()),
      manifestFetchedAt: manifestCachedAt,
      isOnline,
    });
    // oxlint-disable-next-line react/set-state-in-effect -- the verdict is a Date.now() snapshot taken when its inputs change (and overwritten by the scan handler); computing it during render would be impure and re-evaluate the window on every render.
    setAuthVerdict(verdict);
  }, [persistedCredential, manifestCachedAt, isOnline, getStoredScannerToken]);

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<"cameraBlocked" | "cameraNotFound" | "cameraUnavailable" | "cameraInsecure" | null>(null);

  // Audio mute state
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Current flash evaluation result
  const [activeResult, setActiveResult] = useState<LocalScanResult | null>(null);
  // Bumped with every verdict so the takeover and halo remount and replay their entrance, even for two alike in a row.
  const [verdictKey, setVerdictKey] = useState(0);

  // Recent audit feed
  const [recentScans, setRecentScans] = useState<QueuedScan[]>([]);
  const refreshRecentScans = async () => {
    if (!pointId || authBlockedRef.current) return;
    setRecentScans(await getRecentScans(pointId, LOG_SIZE));
  };

  const updatePendingCount = async () => {
    if (!pointId) return;
    const pending = await getUnsyncedScans(pointId);
    setPendingCount(pending.length);
  };

  /**
   * Fetches the manifest — a delta from the cached cursor unless `full` — merges it into the cache, stores
   * it with the fetch time (the offline window's baseline) and rebuilds the admission state. A definitive
   * 401/403 blocks the device; anything else leaves the cached manifest in use.
   */
  const refreshManifest = (full = false): Promise<ManifestRefresh> => {
    if (manifestInFlightRef.current) return manifestInFlightRef.current;
    const run = (async (): Promise<ManifestRefresh> => {
      const client = scannerClient(getStoredScannerToken());
      if (!pointId || !client) return { kind: "transient", detail: "No scanner credential available" };
      manifestAttemptAtRef.current = Date.now();
      const fetchManifest = (since: string | null) =>
        client.GET("/api/checkin-points/{point_id}/manifest", {
          params: { path: { point_id: pointId }, query: since ? { since } : undefined },
        });
      try {
        const cached = manifestRef.current;
        let res = await fetchManifest(!full && cached?.cursor ? cached.cursor : null);
        let merged = res.data ? mergeManifest(cached, res.data) : null;
        if (merged?.needsFull) {
          res = await fetchManifest(null);
          merged = res.data ? mergeManifest(null, res.data) : null;
        }
        if (!res.data || !merged || !Array.isArray(merged.manifest.tickets)) {
          const status = res.response.status;
          const detail = res.error ? formatApiError(res.error) : `HTTP ${status}`;
          const kind = classifyAuthFailure(status, detail);
          if (kind !== "TRANSIENT") {
            enterAuthBlocked(kind, detail);
            return { kind: "blocked", detail };
          }
          if (status >= 500 || status === 429) noteServerContact(false);
          return { kind: "transient", detail };
        }
        noteServerContact(true);
        if (authBlockedRef.current) return { kind: "ok" };
        const delta = res.data;
        const changed =
          !delta.is_delta || delta.tickets.length > 0 || (delta.removed_qr_hashes?.length ?? 0) > 0 || !cached;
        const fetchedAt = new Date().toISOString();
        await saveCachedManifest(pointId, merged.manifest, fetchedAt);
        applyManifest(merged.manifest);
        setManifestCachedAt(fetchedAt);
        if (changed || cached?.checkin_point.max_capacity !== merged.manifest.checkin_point.max_capacity) {
          await rebuildAdmissionState(merged.manifest);
        }
        return { kind: "ok" };
      } catch {
        noteServerContact(false);
        return { kind: "transient", detail: "Failed to connect to event server." };
      } finally {
        manifestInFlightRef.current = null;
      }
    })();
    manifestInFlightRef.current = run;
    return run;
  };

  // Every 5 s tick: a delta every 30 s while the server answers; while it does not, a retry every 10 s
  // (the request doubles as the reachability probe that brings the scanner back online).
  const pollManifest = () => {
    if (!navigator.onLine || !ownsPoint() || authBlockedRef.current || deactivationRef.current || !manifestRef.current) return;
    const due = serverReachable() ? MANIFEST_POLL_MS : MANIFEST_RETRY_MS;
    if (Date.now() - manifestAttemptAtRef.current >= due) void refreshManifest();
  };

  // 1. Initial Load: IndexedDB cache first, then live refresh if online.
  // Definitive 401/403 enters authBlocked; transient network failures keep cached state usable.
  const loadManifest = async (forceRefresh = false) => {
    if (!pointId) return;
    setLoading(true);

    const credential = await getPersistedScannerCredential(pointId);
    const urlToken =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("token")?.trim();
    const token =
      urlToken ||
      sessionStorage.getItem(`congress_scanner_token_${pointId}`) ||
      credential?.token ||
      null;
    if (credential) setPersistedCredential(credential);
    if (credential?.deactivation_pending && !urlToken) {
      deactivationRef.current = true;
      setDeactivationPending(true);
      applyManifest(null);
      applyAdmissionState({}, 0);
      setRecentScans([]);
      setConflicts([]);
      setLoading(false);
      updatePendingCount();
      return;
    }
    if (!token) {
      applyManifest(null);
      applyAdmissionState({}, 0);
      setRecentScans([]);
      setInitError("Pair this scanner with a valid device token before loading attendee data.");
      setLoading(false);
      updatePendingCount();
      return;
    }
    if (!credential || credential.token !== token || credential.deactivation_pending) {
      await storeCredential(token);
    }

    // Cached manifests contain attendee data; load only after a scanner
    // credential has been restored or supplied.
    let cached: CheckInManifest | null = null;
    try {
      const cachedMeta = await getCachedManifestMeta(pointId);
      if (cachedMeta && isManifest(cachedMeta.manifest)) {
        const upgrade = await upgradeLegacyManifest(cachedMeta.manifest, qrHash);
        cached = upgrade.manifest;
        // Rewritten without raw secrets; the fetch time (the offline window's baseline) is kept.
        if (upgrade.upgraded) await saveCachedManifest(pointId, cached, cachedMeta.cached_at);
        applyManifest(cached);
        setManifestCachedAt(cachedMeta.cached_at || null);
        await rebuildAdmissionState(cached);
        await refreshRecentScans();
        setLoading(false);
      }
    } catch (error) {
      setInitError(error instanceof ScannerStorageBlockedError ? error.message : "Scanner storage is unavailable on this device.");
      setLoading(false);
      return;
    }

    if (navigator.onLine || forceRefresh) {
      const outcome = await refreshManifest(forceRefresh || !cached);
      if (outcome.kind === "ok") {
        setInitError(null);
        setAuthBlocked(null);
        await refreshRecentScans();
      } else if (!cached) {
        setInitError(outcome.kind === "blocked" ? outcome.detail : "Failed to connect to event server.");
      }
    } else if (!cached) {
      setInitError("Failed to connect to event server.");
    }

    if (!authBlockedRef.current) setConflicts(await getConflictsForPoint(pointId));
    setLoading(false);
    updatePendingCount();
    void purgeExpiredScans(Date.now()).catch(() => undefined);
    void requestPersistentStorage();
  };

  // 2. Background queue flush with per-record reconciliation, in chunks the server accepts.
  // Definitive 401/403 stops new admissions (authBlocked) while preserving every queued record.
  // Network throws stay transient: the 5 s interval gates retries, so no infinite hot loop exists.
  const syncOnce = async () => {
    if (!pointId || !navigator.onLine || authBlockedRef.current || !ownsPoint()) return;
    const unsynced = await getUnsyncedScans(pointId);
    if (unsynced.length === 0) return;
    const client = scannerClient(getStoredScannerToken());
    // No credential: nothing is sent and every queued record stays on the device.
    if (!client) return;

    setIsSyncing(true);
    let uploaded = false;
    let conflicted = false;
    try {
      for (let i = 0; i < unsynced.length; i += SYNC_CHUNK) {
        const chunk = unsynced.slice(i, i + SYNC_CHUNK);
        const { data, error: err, response } = await client.POST(
          "/api/checkin-points/{point_id}/scans/batch",
          {
            params: { path: { point_id: pointId } },
            body: {
              scans: chunk.map((s) => ({
                scan_id: s.scan_id,
                qr_secret: s.qr_secret,
                scanned_at: s.scanned_at,
                ...clientVerdictFor(s),
              })),
            },
          }
        );
        if (data && Array.isArray(data.results)) {
          noteServerContact(true);
          const report = await reconcileBatchOutcomes(pointId, data.results);
          uploaded = true;
          if (report.conflictCount > 0) conflicted = true;
          setSyncFailCount(0);
          continue;
        }
        if (err) {
          const kind = classifyAuthFailure(response.status, formatApiError(err));
          if (kind !== "TRANSIENT") {
            enterAuthBlocked(kind, formatApiError(err));
            return;
          }
          if (response.status >= 500 || response.status === 429) noteServerContact(false);
        }
        setSyncFailCount((c) => c + 1);
        break;
      }
    } catch {
      noteServerContact(false);
      setSyncFailCount((c) => c + 1);
    } finally {
      setIsSyncing(false);
    }

    if (!uploaded || authBlockedRef.current) return;
    if (conflicted) {
      setConflicts(await getConflictsForPoint(pointId));
      // The server overruled provisional admissions: later scans evaluate against its verdict.
      if (manifestRef.current) await rebuildAdmissionState(manifestRef.current);
    }
    await refreshRecentScans();
    void updatePendingCount();
    // Uploaded scans may have been decided against tickets this device has not seen yet.
    if (Date.now() - manifestAttemptAtRef.current >= MANIFEST_AFTER_SYNC_MIN_MS) void refreshManifest();
  };

  // Timers, the online handler, the HID listener and the camera loop live for the whole mount, so they
  // call through these refs and always run the latest render's code (credential, manifest, policy).
  const syncOnceRef = useRef(syncOnce);
  const processScanRef = useRef<(rawCode: string) => Promise<void>>(async () => undefined);
  const tickRef = useRef<() => void>(() => undefined);
  const loadManifestRef = useRef(loadManifest);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const syncAgainRef = useRef(false);

  // One sync at a time per scanner. A trigger that arrives mid-sync (timer, reconnect, a new scan)
  // joins the running one and asks for one more pass, so its records go out right after, never in
  // parallel. Callers that await (unpair) wait for the whole run.
  const flushQueue = (): Promise<void> => {
    if (syncInFlightRef.current) {
      syncAgainRef.current = true;
      return syncInFlightRef.current;
    }
    const run = (async () => {
      try {
        do {
          syncAgainRef.current = false;
          await syncOnceRef.current();
        } while (syncAgainRef.current && !authBlockedRef.current);
      } finally {
        syncInFlightRef.current = null;
      }
    })();
    syncInFlightRef.current = run;
    return run;
  };

  useEffect(() => {
    if (!pointId) return;
    const setLock = (value: TabLock) => {
      const wasBusy = tabLockRef.current === "busy";
      tabLockRef.current = value;
      setTabLockState(value);
      // Taking over from another tab: its scans are in the shared database, so start from them.
      if (wasBusy && value === "held") void loadManifestRef.current();
    };
    if (!("locks" in navigator)) {
      setLock("unsupported");
      return;
    }
    const name = `congress-scanner-point:${pointId}`;
    const waiting = new AbortController();
    const { promise: released, resolve: release } = Promise.withResolvers<void>();
    let active = true;
    const hold = () => {
      if (active) setLock("held");
      return released;
    };
    navigator.locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (lock) return hold();
        if (active) setLock("busy");
        navigator.locks.request(name, { signal: waiting.signal }, hold).catch(() => undefined);
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      active = false;
      waiting.abort();
      release();
    };
  }, [pointId]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loadManifest's state updates are the manifest fetch for this pointId (IndexedDB + network sync).
    loadManifest();

    const handleOnline = () => {
      tickRef.current();
      void flushQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Every 5 seconds: reachability readout, queue flush, manifest poll.
    const interval = setInterval(() => {
      tickRef.current();
      if (navigator.onLine) void flushQueue();
    }, 5000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- bound once per pointId: loadManifest runs once per point, and flushQueue/tickRef only touch refs (they call the latest code).
  }, [pointId]);

  /** The online path: the server decides. Null when it cannot (timeout, network, server error). */
  const askServer = async (scanId: string, code: string, scannedAt: string): Promise<ServerScanResult | "blocked" | null> => {
    const client = scannerClient(getStoredScannerToken());
    if (!pointId || !client) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_SCAN_TIMEOUT_MS);
    try {
      const { data, error, response } = await client.POST("/api/checkin-points/{point_id}/scan", {
        params: { path: { point_id: pointId } },
        body: { scan_id: scanId, qr_secret: code, scanned_at: scannedAt },
        signal: controller.signal,
      });
      if (data && typeof data.status === "string") {
        noteServerContact(true);
        return data;
      }
      if (error) {
        const detail = formatApiError(error);
        const kind = classifyAuthFailure(response.status, detail);
        if (kind !== "TRANSIENT") {
          enterAuthBlocked(kind, detail);
          return "blocked";
        }
      }
      if (response.status >= 500 || response.status === 429) noteServerContact(false);
      return null;
    } catch {
      noteServerContact(false);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // 3. Central Scan Processor: the server decides while it answers (2 s at most); otherwise the scan is
  // decided locally and provisionally against the manifest, and queued under the same scan_id.
  // Hard gates: definitively deauthorized devices and expired offline windows stop NEW admissions.
  const processScannedCode = async (rawCode: string) => {
    const current = manifestRef.current;
    if (!pointId || !current) return;
    if (storageFailedRef.current || tabLockRef.current === "busy") {
      if (soundEnabled) playErrorBuzz();
      return;
    }
    if (
      !persistedCredential?.token ||
      persistedCredential.deactivation_pending ||
      deactivationRef.current ||
      deactivationPending ||
      !getStoredScannerToken()
    ) {
      if (soundEnabled) playErrorBuzz();
      return;
    }
    if (authBlockedRef.current) {
      if (soundEnabled) playErrorBuzz();
      return;
    }
    const offlineVerdict = evaluateOfflineAuthorization(Date.now(), {
      tokenExpiresAt: persistedCredential.token_expires_at,
      manifestFetchedAt: manifestCachedAt,
      isOnline: serverReachable(),
    });
    if (!offlineVerdict.ok) {
      setAuthVerdict(offlineVerdict);
      if (soundEnabled) playErrorBuzz();
      return;
    }
    const code = normalizeScannedCode(rawCode);
    if (!code) return;

    // The same badge presented again while its own result is still showing (a camera or reader
    // re-reading it) is ignored; a DIFFERENT badge is always evaluated, never silently dropped.
    if (isScanningRef.current && lastProcessedCodeRef.current === code) return;
    lastProcessedCodeRef.current = code;
    isScanningRef.current = true;

    const scanId = crypto.randomUUID();
    const scannedAt = new Date().toISOString();
    const hash = await qrHash(current.event_id, code);
    const server = serverReachable() ? await askServer(scanId, code, scannedAt) : null;
    if (server === "blocked") {
      isScanningRef.current = false;
      lastProcessedCodeRef.current = null;
      if (soundEnabled) playErrorBuzz();
      return;
    }

    // Read and advance the live admission state in one synchronous step, so back-to-back scans
    // (HID bursts, camera frames, manual entry) each see every admission before them.
    const admission = admissionRef.current;
    let result: LocalScanResult;
    let scanRecord: QueuedScan;
    if (server) {
      result = applyServerScan(admission, hash, server);
      scanRecord = {
        scan_id: scanId,
        point_id: pointId,
        qr_secret: code,
        qr_hash: hash,
        scanned_at: scannedAt,
        status: result.status,
        rejection_reason: result.rejection_reason,
        synced: true,
        sync_state: result.status === "ADMITTED" ? "CONFIRMED" : "LOCAL_REJECTED",
        attendee_name: server.attendee_name ?? result.ticket?.attendee_name,
        ticket_tier_name: server.ticket_tier_name ?? result.ticket?.ticket_tier_name,
        reconciled_at: new Date().toISOString(),
      };
    } else {
      const policy: LocalPolicyConfig = {
        policy_type: current.checkin_point.policy_type as LocalPolicyConfig["policy_type"],
        allowed_tier_ids: current.checkin_point.allowed_tier_ids ?? [],
        max_capacity: current.checkin_point.max_capacity,
        current_admitted_count: admission.admittedCount,
        // A device that cannot reach the server cannot know the room's count across gates.
        is_offline: true,
        fail_closed_offline_capacity: true,
      };
      result = evaluateLocalScan(admission.ticketMap, policy, hash);
      scanRecord = {
        scan_id: scanId,
        point_id: pointId,
        qr_secret: code,
        qr_hash: hash,
        scanned_at: scannedAt,
        status: result.status,
        rejection_reason: result.rejection_reason,
        synced: false,
        sync_state: result.status === "ADMITTED" ? "PROVISIONAL" : "LOCAL_REJECTED",
        attendee_name: result.ticket?.attendee_name,
        ticket_tier_name: result.ticket?.ticket_tier_name,
      };
    }
    admissionRef.current = { ticketMap: admission.ticketMap, admittedCount: result.current_admitted_count };
    scanEpochRef.current += 1;
    setActiveResult(result);
    setVerdictKey((k) => k + 1);

    // Sound feedback distinguishing Confirmed vs Provisional vs Rejected
    if (soundEnabled) {
      if (result.status === "ADMITTED") {
        if (result.is_provisional) {
          playProvisionalChime();
        } else {
          playSuccessChime();
        }
      } else {
        playErrorBuzz();
      }
    }
    // Haptics only for verdicts that need a second look; they also reach an operator who muted the sound.
    if (result.status !== "ADMITTED") navigator.vibrate?.([90, 50, 90]);
    else if (result.is_provisional) navigator.vibrate?.(40);

    // The verdict stays up longer when it needs reading; the next scan replaces it at once either way.
    clearTimeout(flashTimerRef.current ?? undefined);
    flashTimerRef.current = setTimeout(() => {
      setActiveResult(null);
      isScanningRef.current = false;
      lastProcessedCodeRef.current = null;
    }, result.status === "ADMITTED" ? 1500 : 3000);

    unsavedScansRef.current.push(scanRecord);
    try {
      await saveQueuedScan(scanRecord);
    } catch {
      // A server-decided scan is already recorded there; a local decision exists only here, so the
      // operator must not act on it and scanning stops until the page is reloaded.
      if (!scanRecord.synced) {
        storageFailedRef.current = true;
        setStorageFailed(true);
        clearTimeout(flashTimerRef.current ?? undefined);
        setActiveResult(null);
        if (soundEnabled) playErrorBuzz();
        navigator.vibrate?.([200, 80, 200]);
        return;
      }
    } finally {
      unsavedScansRef.current = unsavedScansRef.current.filter((s) => s.scan_id !== scanRecord.scan_id);
      scanEpochRef.current += 1;
    }
    void refreshRecentScans();
    void updatePendingCount();

    if (!scanRecord.synced && navigator.onLine) void flushQueue();
  };

  useLayoutEffect(() => {
    syncOnceRef.current = syncOnce;
    processScanRef.current = processScannedCode;
    loadManifestRef.current = loadManifest;
    tickRef.current = () => {
      setIsOnline(serverReachable());
      pollManifest();
    };
  });

  // 4. USB / Bluetooth HID Laser Scanner Listener (Buffered keystrokes with <60ms delta). Characters
  // come from the physical key (hidCharacter), so a Persian keyboard layout cannot garble a code.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is focused on a text input element
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = performance.now();
      const delta = now - hidLastKeyTimeRef.current;
      hidLastKeyTimeRef.current = now;

      if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") {
        if (hidBufferRef.current.length >= 4) {
          const barcode = hidBufferRef.current;
          hidBufferRef.current = "";
          void processScanRef.current(barcode);
        } else {
          hidBufferRef.current = "";
        }
        return;
      }
      const character = hidCharacter(e);
      if (character === null) return;
      // If delta is larger than 60ms and buffer was idle, reset buffer (new barcode scan started)
      if (delta > 60 && hidBufferRef.current.length > 0) {
        hidBufferRef.current = "";
      }
      hidBufferRef.current += character;
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  // Locally disable first, then report server revocation only after an
  // authenticated, successful self-revoke response.
  const handleUnpair = async () => {
    if (!pointId || unpairing) return;
    setUnpairing(true);
    deactivationRef.current = true;
    setDeactivationPending(true);
    setUnpairNotice(null);
    try {
      const credential = await getPersistedScannerCredential(pointId);
      if (credential) {
        const pendingCredential = { ...credential, deactivation_pending: true };
        setPersistedCredential(pendingCredential);
        await markScannerDeactivationPending(pointId);
      }
      const token = credential?.token ?? getStoredScannerToken();
      if (!navigator.onLine) {
        setUnpairNotice((c) => c.unpairNoticeOffline);
        return;
      }
      if (!token) {
        setUnpairNotice((c) => c.unpairNoticeNoCredential);
        return;
      }

      let remaining = await getUnsyncedScans(pointId);
      if (remaining.length > 0) {
        await flushQueue();
        remaining = await getUnsyncedScans(pointId);
        if (remaining.length > 0) {
          const unsynced = remaining.length;
          setUnpairNotice((c) => c.unpairNoticeUnsynced(unsynced));
          return;
        }
      }

      const client = scannerClient(token);
      if (!client) return;
      const { data: result, response } = await client.POST(
        "/api/checkin-points/{point_id}/devices/self/revoke",
        { params: { path: { point_id: pointId } } }
      );
      if (!response.ok || result?.is_revoked !== true) {
        const status = response.status;
        setUnpairNotice((c) => c.unpairNoticeNotConfirmed(status));
        return;
      }

      sessionStorage.removeItem(`congress_scanner_token_${pointId}`);
      await clearPersistedToken(pointId);
      // Revoked: the cached manifest and the uploaded scans leave the device with the credential.
      await wipePointData(pointId);
      setPersistedCredential(null);
      setAuthBlocked(null);
      applyManifest(null);
      setManifestCachedAt(null);
      applyAdmissionState({}, 0);
      setRecentScans([]);
      setConflicts([]);
      void updatePendingCount();
      setUnpairNotice((c) => c.unpairNoticeConfirmed);
    } catch {
      setUnpairNotice((c) => c.unpairNoticeFailed);
    } finally {
      setUnpairing(false);
      setShowUnpairConfirm(false);
    }
  };

  const discardUnsynced = async (): Promise<number> => {
    if (!pointId) return 0;
    const discarded = await discardUnsyncedScans(pointId);
    await updatePendingCount();
    return discarded;
  };


  // 5. Mobile / Desktop Camera Detection Loop (Dual Native & jsQR fallback)
  const startCamera = async () => {
    setCameraError(null);
    // Browsers expose the camera only on https (or localhost); a LAN http address has no mediaDevices.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("cameraInsecure");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          // Autoplay may be deferred by browser policy; element is muted
        }
      }
      setCameraActive(true);
      startDetectionLoop();
    } catch (err: unknown) {
      const errorName = err instanceof Error ? err.name : "";
      if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
        setCameraError("cameraBlocked");
      } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
        setCameraError("cameraNotFound");
      } else {
        setCameraError("cameraUnavailable");
      }
    }
  };

  const stopCamera = () => {
    detectionActiveRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const startDetectionLoop = () => {
    detectionActiveRef.current = true;
    const win = window as WindowWithBarcodeDetector;

    let nativeDetector: BarcodeDetectorInstance | null = null;
    if (typeof win.BarcodeDetector !== "undefined") {
      try {
        nativeDetector = new win.BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        nativeDetector = null;
      }
    }

    // In-memory canvas fallback for jsQR when native BarcodeDetector is unavailable
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    if (!nativeDetector) {
      canvas = document.createElement("canvas");
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    }

    const checkFrame = async () => {
      if (!detectionActiveRef.current) return;
      const video = videoRef.current;

      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        if (detectionActiveRef.current) {
          requestAnimationFrame(checkFrame);
        }
        return;
      }

      // Frames keep being read while a verdict is up: a re-read of the same badge is dropped below and in
      // processScannedCode, and a different badge replaces the verdict at once.
      try {
        let detectedValue: string | null = null;

        if (nativeDetector) {
          const codes = await nativeDetector.detect(video);
          if (codes && codes.length > 0 && codes[0].rawValue) {
            detectedValue = codes[0].rawValue;
          }
        } else if (canvas && ctx) {
          const width = video.videoWidth;
          const height = video.videoHeight;
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          ctx.drawImage(video, 0, 0, width, height);
          const imgData = ctx.getImageData(0, 0, width, height);
          const decoded = jsQR(imgData.data, width, height, {
            inversionAttempts: "dontInvert",
          });
          if (decoded && decoded.data) {
            detectedValue = decoded.data;
          }
        }

        if (detectedValue) {
          const normalized = normalizeScannedCode(detectedValue);
          const now = Date.now();
          // Prevent duplicate submissions from repeated video frames within 3 seconds
          const isDuplicateFrame =
            lastScannedCodeRef.current?.code === normalized &&
            now - lastScannedCodeRef.current.time < 3000;

          if (!isDuplicateFrame) {
            lastScannedCodeRef.current = { code: normalized, time: now };
            void processScanRef.current(normalized);
          }
        }
      } catch {
        // ignore detection frame errors
      }

      if (detectionActiveRef.current) {
        setTimeout(() => requestAnimationFrame(checkFrame), 80);
      }
    };

    requestAnimationFrame(checkFrame);
  };

  const copy = scannerCopy[locale];
  const frameProps = { locale, product: copy.product, languageLabel: t.languageToggle, onToggleLocale: toggleLocale };
  // Persian shows the translated notice with the English sentence verbatim underneath, like the setup screens.
  const unpairNoticeText = unpairNotice ? unpairNotice(copy) : null;
  const unpairNoticeDetail = unpairNotice && locale === "fa" ? unpairNotice(scannerCopy.en) : null;

  // Pair / re-pair a device token (shared by the pairing and deactivated screens).
  const submitPairing = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!pointId || !tokenInput.trim()) return;
    await storeCredential(tokenInput.trim());
    setTokenInput("");
    setInitError(null);
    setAuthBlocked(null);
    await loadManifest(true);
  };

  if (loading) {
    return (
      <ScannerScreen locale={locale} className="flex flex-col">
        <div className="flex flex-1 items-center justify-center bg-meridian-ink p-4">
          <div role="status" className="flex flex-col items-center gap-4 text-center">
            <span aria-hidden="true" className="scanner-spinner motion-safe:animate-spin" />
            <p className="text-sm text-ink-300">{copy.loading}</p>
          </div>
        </div>
      </ScannerScreen>
    );
  }

  if (tabLock === "busy") {
    return (
      <SetupFrame {...frameProps}>
        <SetupPanel tone="warning" icon="layers">
          <h1 className="text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-white">
            <BiHeading locale={locale} label={copy.otherTabTitle} />
          </h1>
          <p role="status" className="text-[14px] leading-relaxed text-ink-200">{copy.otherTabBody}</p>
        </SetupPanel>
      </SetupFrame>
    );
  }

  if (deactivationPending) {
    return (
      <SetupFrame {...frameProps}>
        <SetupPanel tone="danger" icon="lock">
          <div className="space-y-1.5">
            <p className="font-mono text-[11.5px] text-ink-400">
              <span className="ltr-isolate">{pointId}</span>
            </p>
            <h1 className="text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-white">
              <BiHeading locale={locale} label={copy.deactivated} />
            </h1>
          </div>
          <p role="alert" dir="auto" className="text-[14px] leading-relaxed text-[#FFD08A]">
            {unpairNoticeText ?? copy.deactivatedDefault}
          </p>
          <SystemReadout label={copy.systemDetail} lines={[unpairNoticeDetail]} />
          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-300">
            <Icon name="layers" size={16} className="mt-0.5 text-ink-400" />
            <span>
              {copy.remaining(pendingCount)}
              {!isOnline && ` ${copy.reconnectFirst}`}
            </span>
          </p>
          {persistedCredential?.token && (
            <button
              type="button"
              disabled={unpairing || !isOnline}
              onClick={handleUnpair}
              className="scanner-tool inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-status-danger-solid px-4 text-[14px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              <Icon name="sync" size={17} />
              {unpairing ? copy.revoking : copy.retryRevoke}
            </button>
          )}
          <DiscardUnsynced locale={locale} copy={copy} pendingCount={pendingCount} onDiscard={discardUnsynced} />
          <form onSubmit={submitPairing} className="space-y-2.5 border-t border-white/10 pt-4">
            <label htmlFor="scanner-repair-token" className="block text-[13px] font-semibold text-ink-200">
              {copy.repairLabel}
            </label>
            <input
              id="scanner-repair-token"
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={copy.repairPlaceholder}
              autoComplete="off"
              dir="ltr"
              className="scanner-input w-full font-mono"
            />
            <button
              type="submit"
              disabled={!tokenInput.trim()}
              className="scanner-tool inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-[14px] font-semibold text-ink-950 hover:bg-aiteb-lavender disabled:bg-white/[0.08] disabled:text-ink-300"
            >
              <Icon name="key" size={17} />
              {copy.repairAction}
            </button>
          </form>
          <Link to="/organizer" className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-ink-300 hover:text-white">
            <Icon name="arrow-left" size={16} />
            {copy.backToOrganizer}
          </Link>
        </SetupPanel>
      </SetupFrame>
    );
  }

  if (initError || !manifest) {
    const en = scannerCopy.en;
    const kind = authBlocked?.kind ?? (getStoredScannerToken() ? "UNAVAILABLE" : "UNPAIRED");
    const message = authBlocked?.message ?? initError ?? "Manifest not found.";
    const view = {
      REVOKED: { icon: "alert", tone: "danger", title: [copy.revokedTitle, en.revokedTitle], hint: [copy.revokedBody(pendingCount), en.revokedBody(pendingCount)] },
      FORBIDDEN: { icon: "gate", tone: "warning", title: [copy.forbiddenTitle, en.forbiddenTitle], hint: [copy.forbiddenBody, en.forbiddenBody] },
      EXPIRED: { icon: "clock", tone: "warning", title: [copy.expiredTitle, en.expiredTitle], hint: [copy.expiredBody, en.expiredBody] },
      UNAVAILABLE: { icon: "wifi-off", tone: "neutral", title: [copy.unavailableTitle, en.unavailableTitle], hint: [copy.unavailableBody, null] },
      UNPAIRED: { icon: "shield", tone: "neutral", title: [copy.pairTitle, en.pairTitle], hint: [copy.pairBody, null] },
    } as const;
    const v = view[kind];
    // English keeps the system's own sentences as the body; Persian translates them and shows the English
    // diagnostic verbatim underneath (supervisors and the audit trail use it).
    const body = locale === "en" ? (kind === "UNPAIRED" ? message : v.hint[1]) : v.hint[0];
    const readout =
      locale === "en"
        ? kind === "UNPAIRED"
          ? []
          : [message]
        : kind === "UNPAIRED"
          ? [message]
          : [v.title[1], message, v.hint[1]];
    return (
      <SetupFrame {...frameProps}>
        <SetupPanel tone={v.tone} icon={v.icon}>
          <div className="space-y-1.5">
            <p className="flex flex-wrap items-center gap-x-2 text-[12px] font-semibold text-ink-400">
              <span>{copy.setupEyebrow}</span>
              <span aria-hidden="true">·</span>
              <span>{copy.point}</span>
              <span className="font-mono text-[11.5px] font-normal text-ink-300" dir="ltr">
                {pointId}
              </span>
            </p>
            <h1 className="text-[1.65rem] font-semibold leading-tight tracking-[-0.02em] text-white">{v.title[0]}</h1>
          </div>
          {body && <p className="text-[14px] leading-relaxed text-ink-200">{body}</p>}
          <SystemReadout label={copy.systemDetail} lines={readout} />
          <form onSubmit={submitPairing} className="space-y-2.5 border-t border-white/10 pt-4">
            <label htmlFor="scanner-pair-token" className="block text-[13px] font-semibold text-ink-200">
              <BiHeading locale={locale} label={copy.pairLabel} />
            </label>
            <input
              id="scanner-pair-token"
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={copy.tokenPlaceholder}
              autoComplete="off"
              dir="ltr"
              className="scanner-input w-full font-mono"
            />
            <button
              type="submit"
              disabled={!tokenInput.trim()}
              className="scanner-tool press inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-white px-4 text-[15px] font-semibold text-ink-950 shadow-[0_12px_30px_-14px_rgb(255_151_255/0.5)] hover:bg-aiteb-lavender disabled:bg-white/[0.08] disabled:text-ink-300 disabled:shadow-none"
            >
              <Icon name="key" size={18} />
              <BiLabel locale={locale} label={copy.authorize} />
            </button>
            <p className="flex items-center gap-1.5 text-[12px] text-ink-400">
              <Icon name="lock" size={13} />
              {copy.tokenNote}
            </p>
          </form>
          <DiscardUnsynced locale={locale} copy={copy} pendingCount={pendingCount} onDiscard={discardUnsynced} />
          <div className="flex flex-col gap-2 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => loadManifest(true)}
              className="scanner-tool inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-4 text-[13.5px] font-semibold text-ink-100 hover:bg-white/[0.09]"
            >
              <Icon name="sync" size={16} />
              {copy.retry}
            </button>
            <Link to="/organizer" className="inline-flex min-h-11 items-center justify-center gap-1.5 text-[13px] font-medium text-ink-300 hover:text-white">
              <Icon name="arrow-left" size={16} />
              {copy.backToOrganizer}
            </Link>
          </div>
        </SetupPanel>
      </SetupFrame>
    );
  }

  const point = manifest.checkin_point;
  const scanningPaused = storageFailed || authBlocked !== null || (authVerdict !== null && !authVerdict.ok);
  const manifestReadout =
    !authBlocked && (!authVerdict || authVerdict.ok) && manifestCachedAt
      ? {
          synced: isOnline,
          at: clockTime(manifestCachedAt),
          windowLeft:
            authVerdict && authVerdict.ok && authVerdict.reason === "WITHIN_WINDOW" && !isOnline
              ? formatRemainingWindow(authVerdict.remainingMs)
              : null,
        }
      : null;
  const verdictKind = activeResult ? takeoverKind(activeResult) : null;

  const handleManualSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = normalizeScannedCode(manualCode);
    if (!code) return;

    // Check if user accidentally pasted a Tracking ID format
    if (code.startsWith("tck-") || (code.length <= 14 && code.includes("-") && !code.includes("sec"))) {
      setTrackingIdWarning(true);
      return;
    }

    setTrackingIdWarning(false);
    setManualCode(""); // Immediately clear raw QR secret so it is never displayed/retained
    void processScannedCode(code);
  };

  return (
    <ScannerScreen locale={locale} className="flex flex-col select-none">
      {verdictKind && <div key={verdictKey} aria-hidden="true" className={`scanner-halo scanner-halo--${verdictKind}`} />}
      {storageFailed && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="scanner-storage-failed" className="fixed inset-0 z-50 flex items-center justify-center bg-[#2A0614]/95 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-status-danger-solid/60 bg-ink-950 p-5">
            <h2 id="scanner-storage-failed" className="flex items-start gap-2 text-[1.25rem] font-semibold leading-snug text-[#FFC9D5]">
              <Icon name="x-circle" size={24} className="mt-0.5 shrink-0 text-[#FF8BA8]" />
              <BiHeading locale={locale} label={copy.storageFailedTitle} />
            </h2>
            <p className="text-[14px] leading-relaxed text-ink-200">{copy.storageFailedBody}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="scanner-tool inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-[14px] font-semibold text-ink-950 hover:bg-aiteb-lavender"
            >
              <Icon name="sync" size={17} />
              {copy.reload}
            </button>
          </div>
        </div>
      )}

      <ScannerHeader
        locale={locale}
        copy={copy}
        languageLabel={t.languageToggle}
        onToggleLocale={toggleLocale}
        pointName={point.name}
        policyType={point.policy_type}
        location={point.location}
        cachedTickets={Object.keys(ticketMap).length}
        conflictCount={conflicts.length}
        conflictsHeading={t.conflictsHeading}
        onOpenConflicts={() => setShowConflictDrawer(true)}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled((prev) => !prev)}
        isOnline={isOnline}
        isSyncing={isSyncing}
        pendingCount={pendingCount}
        syncFailCount={syncFailCount}
        manifest={manifestReadout}
      />

      {/* Authorization state banner: definitive rejects + offline-window expiry.
          Records are preserved in both cases; only NEW admissions stop. */}
      {authBlocked && (
        <div role="alert" className="border-b border-status-danger-solid/50 bg-[#2A0614]">
          <div className="mx-auto flex w-full max-w-6xl items-start gap-3 px-4 py-3 sm:px-6">
            <Icon name="x-circle" size={20} className="mt-0.5 text-[#FF8BA8]" />
            <div className="min-w-0 space-y-1 text-[13px] leading-relaxed">
              <p className="text-[14px] font-semibold text-[#FFC9D5]">
                <BiHeading
                  locale={locale}
                  label={{
                    fa: copy.pausedTitle.fa,
                    en: `Scanning paused — ${
                      authBlocked.kind === "REVOKED"
                        ? "device deauthorized"
                        : authBlocked.kind === "FORBIDDEN"
                          ? "wrong check-in point"
                          : "credential expired"
                    }`,
                  }}
                />
              </p>
              <p dir="auto" className="text-[#FFB3C4]">{authBlocked.message}</p>
              <p className="text-[#FFB3C4]/80">
                {locale === "en"
                  ? `${pendingCount} unsynced scan(s) preserved. Ask a supervisor for a fresh token, then re-pair from the Unpair section below — your queued records are kept.`
                  : copy.preserved(pendingCount)}
              </p>
            </div>
          </div>
        </div>
      )}
      {!authBlocked && authVerdict && !authVerdict.ok && (
        <div role="alert" className="border-b border-status-warning-solid/50 bg-[#2B1A02]">
          <div className="mx-auto flex w-full max-w-6xl items-start gap-3 px-4 py-3 sm:px-6">
            <Icon name="pause" size={20} className="mt-0.5 text-[#FFC266]" />
            <div className="min-w-0 space-y-1 text-[13px] leading-relaxed">
              <p className="text-[14px] font-semibold text-[#FFD08A]">
                <BiHeading locale={locale} label={copy.windowExpired} />
              </p>
              <p className="text-[#FFE2B0]">
                {authVerdict.reason === "TOKEN_EXPIRED" ? copy.windowTokenExpired : copy.windowStale} {copy.preserved(pendingCount)}
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 pt-0 sm:px-6 sm:pt-5 lg:pt-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            <Viewfinder
              videoRef={videoRef}
              cameraActive={cameraActive}
              cameraError={cameraError ? copy[cameraError] : null}
              onStartCamera={startCamera}
              onStopCamera={stopCamera}
              copy={copy}
            >
              {activeResult && <ResultTakeover key={verdictKey} result={activeResult} t={t} copy={copy} />}
            </Viewfinder>
            <ManualEntry
              copy={copy}
              value={manualCode}
              onChange={(value) => {
                setManualCode(value);
                if (trackingIdWarning) setTrackingIdWarning(false);
              }}
              onSubmit={handleManualSubmit}
              placeholder={copy.manualPlaceholder}
              submitLabel={t.manualCodeSubmit}
              disabled={scanningPaused}
              warning={trackingIdWarning ? copy.trackingIdWarning : null}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <BufferBar
              locale={locale}
              copy={copy}
              pendingCount={pendingCount}
              isSyncing={isSyncing}
              onSync={flushQueue}
              onRefresh={() => void refreshManifest(true)}
            />
            <ScanLog scans={recentScans} copy={copy} t={t} />
            {/* Device Settings: unpair without destroying audit trail */}
            <DeviceSettings
              locale={locale}
              copy={copy}
              pointId={pointId}
              unpairNotice={unpairNoticeText}
              unpairDetail={unpairNoticeDetail}
              showConfirm={showUnpairConfirm}
              unpairing={unpairing}
              pendingCount={pendingCount}
              isOnline={navigator.onLine}
              onAskUnpair={() => setShowUnpairConfirm(true)}
              onConfirmUnpair={handleUnpair}
              onCancelUnpair={() => setShowUnpairConfirm(false)}
            />
          </div>
        </div>

        {/* Conflict Review Drawer */}
        {showConflictDrawer && (
          <ConflictDrawer
            conflicts={conflicts}
            copy={copy}
            t={t}
            onClose={() => setShowConflictDrawer(false)}
            onAcknowledge={async (scanId) => {
              await acknowledgeConflict(scanId);
              const updated = await getConflictsForPoint(pointId ?? "");
              setConflicts(updated);
            }}
          />
        )}
      </main>
    </ScannerScreen>
  );
}
