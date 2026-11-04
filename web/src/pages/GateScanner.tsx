import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { apiErrorCode, apiErrorDiagnostic, createScannerApiClient, localizedApiError, type CheckInManifest } from "../api/client";
import { usePageTitle } from "../hooks/usePageTitle";
import { useWakeLock } from "../hooks/useWakeLock";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { playErrorBuzz, playSuccessChime, playProvisionalChime, warmUpAudio } from "../lib/audioFeedback";
import { useLocale } from "../lib/i18n";
import { canPromptInstall, isIosInstallBrowser, promptInstall, subscribeInstallPrompt } from "../lib/installPrompt";
import {
  evaluateOfflineAuthorization,
  getJwtExpiryIso,
  isServerReachable,
  type OfflineAuthVerdict,
} from "../lib/scannerAuthPolicy";
import { hidCharacter, normalizeScannedCode, qrHash } from "../lib/scannerInput";
import { createQrFrameDecoder } from "../lib/qrFrameDecoder";
import { canSwitchCamera, chooseNextCamera, hasTorch, openScannerCamera, setTorch } from "../lib/scannerCamera";
import { HEARTBEAT_MS, MANIFEST_POLL_MS, mergeManifest, upgradeLegacyManifest } from "../lib/scannerManifest";
import { SCANNER_APP_VERSION } from "../lib/appBuild";
import {
  clearPersistedToken,
  getPersistedScannerCredential,
  markScannerDeactivationPending,
  persistScannerToken,
  type PersistedScannerCredential,
} from "../lib/scannerTokenStore";
import {
  admissionWindowKey,
  applyServerScan,
  evaluateLocalScan,
  reconstructLocalState,
  type AdmissionContext,
  type LocalPolicyConfig,
  type LocalScanResult,
  type LocalTicket,
  type ScanDirection,
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
import { commonCopy } from "../copy/common";
import { operatorCopy, type OperatorGateKind } from "../copy/operator";
import { scannerCopy, type ScannerCopy } from "../copy/scanner";
import { OperatorBar } from "../components/operator/OperatorBar";
import { OperatorGate } from "../components/operator/OperatorGate";
import { OperatorMenu, type OperatorMenuItem } from "../components/operator/OperatorMenu";
import { StatusPill, type StatusPillProps } from "../components/operator/StatusPill";
import { InstallHint } from "../components/attendee/InstallHint";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { LanguageToggle } from "../components/ui/LanguageToggle";
import { Spinner } from "../components/ui/Spinner";
import { DiscardUnsynced } from "../components/scanner/DiscardUnsynced";
import { policyLabel, verdictView } from "../components/scanner/copy";
import { Viewfinder } from "../components/scanner/Viewfinder";
import { ScanVerdict } from "../components/scanner/ScanVerdict";
import { ManualEntry } from "../components/scanner/ManualEntry";
import { ScanLog } from "../components/scanner/ScanLog";
import { ConflictDrawer } from "../components/scanner/ConflictDrawer";
import { DirectionToggle } from "../components/scanner/DirectionToggle";
import { PairingPanel } from "../components/scanner/PairingPanel";
import "../styles/scanner.css";

/** Longest pause between heartbeats after failures. */
const HEARTBEAT_MAX_BACKOFF_MS = 15 * 60_000;
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
/** Scans listed beside the stage on tablets and kiosks. */
const SIDE_LOG_SIZE = 5;
/** The offline time left shows in the status pill once it falls under this. */
const OFFLINE_LEFT_SHOWN_MS = 2 * 60 * 60_000;
/** Whether the operator left the camera on at this point (localStorage, per point). */
const CAMERA_KEY_PREFIX = "congress_scanner_camera_";

/** How an unpair ended, rendered in the current language. */
type UnpairOutcome = { kind: "confirmed" } | { kind: "notConfirmed"; detail?: string } | { kind: "unsynced"; count: number };

type ManifestRefresh = { kind: "ok" } | { kind: "blocked" | "transient"; detail: string };

/** The admission window the device is in now, and the one the manifest's state refers to. */
function admissionContext(manifest: CheckInManifest, at: Date = new Date()): AdmissionContext {
  const point = manifest.checkin_point;
  return {
    window: admissionWindowKey(point.reset_window, manifest.event_timezone, at),
    // A manifest of an older server carries no window: its state is taken as current.
    manifestWindow: manifest.admission_window ?? undefined,
    resetWindow: point.reset_window ?? "EVENT",
    timeZone: manifest.event_timezone ?? undefined,
  };
}

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
  const { locale, setLocale, dir } = useLocale();
  const copy = scannerCopy[locale];
  const op = operatorCopy[locale];
  usePageTitle(copy.product);
  const [manualCode, setManualCode] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  // Persisted scanner credential (survives browser restart via IndexedDB)
  const [persistedCredential, setPersistedCredential] = useState<PersistedScannerCredential | null>(null);
  // Authorization lifecycle: definitive server rejects + offline-window verdict
  // `message` is the server's English diagnostic (shown verbatim to supervisors); `localized` is the reader's language.
  type AuthBlock = { kind: "REVOKED" | "FORBIDDEN" | "EXPIRED"; message: string; localized?: string };
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
  const [unpairOutcome, setUnpairOutcome] = useState<UnpairOutcome | null>(null);
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

  // Build the audio output before the first scan, so the first chime cannot split a barcode-gun burst.
  useEffect(() => warmUpAudio(), []);

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
    setUnpairOutcome(null);
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

  // Authorization failure classification (Phase 3), by the server's error code first:
  // - 401 missing/invalid/expired/revoked  -> definitive credential failure.
  // - 403 wrong point/event/scope, archived point, deleted point -> definitive scope failure.
  // - Network throw / no status            -> transient. Keep scanning, retry later.
  // Servers without codes are classified by status and their English text, as before.
  const classifyAuthFailure = (
    status: number | undefined,
    detail: string,
    code?: string
  ): "REVOKED" | "FORBIDDEN" | "EXPIRED" | "TRANSIENT" => {
    switch (code) {
      case "SCANNER_REVOKED":
      case "SCANNER_TOKEN_INVALID":
      case "SCANNER_CREDENTIALS_MISSING":
        return "REVOKED";
      case "SCANNER_SCOPE_MISMATCH":
      case "SCANNER_CREDENTIALS_REQUIRED":
      case "CHECKIN_POINT_ARCHIVED":
      case "POINT_NOT_FOUND":
        return "FORBIDDEN";
    }
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
  const enterAuthBlocked = (kind: "REVOKED" | "FORBIDDEN" | "EXPIRED", message: string, localized?: string) => {
    setAuthBlocked({ kind, message, localized });
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
  const detectionLoopRef = useRef(0);
  const startCameraRef = useRef<() => Promise<void>>(async () => undefined);
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
  // The admission state every scan evaluates against. evaluateLocalScan mutates the ticket entries in
  // place, so the map and the admitted count are only ever read and advanced through this ref.
  const admissionRef = useRef<{ ticketMap: Record<string, LocalTicket>; admittedCount: number; occupancy: number }>({
    ticketMap: {},
    admittedCount: 0,
    occupancy: 0,
  });
  // People inside (points that track occupancy), as this device knows it; shown in the header.
  const [occupancy, setOccupancy] = useState(0);
  const applyAdmissionState = (map: Record<string, LocalTicket>, admittedCount: number, inside = 0) => {
    admissionRef.current = { ticketMap: map, admittedCount, occupancy: inside };
    setOccupancy(inside);
  };
  // Entry or exit, at points that track occupancy; remembered per point for this tab.
  const [direction, setDirectionState] = useState<ScanDirection>(() =>
    typeof window !== "undefined" && pointId && sessionStorage.getItem(`congress_scanner_direction_${pointId}`) === "OUT" ? "OUT" : "IN"
  );
  const directionRef = useRef<ScanDirection>(direction);
  const setDirection = (value: ScanDirection) => {
    directionRef.current = value;
    setDirectionState(value);
    if (pointId) sessionStorage.setItem(`congress_scanner_direction_${pointId}`, value);
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
      const { ticketMap: map, currentAdmittedCount, occupancy: inside } = reconstructLocalState(
        source.tickets,
        [...history, ...unsavedScansRef.current.filter((s) => !saved.has(s.scan_id))],
        admissionContext(source)
      );
      applyAdmissionState(map, currentAdmittedCount, inside);
      return;
    }
  };
  const [conflicts, setConflicts] = useState<QueuedScan[]>([]);
  const [showConflictDrawer, setShowConflictDrawer] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  // Why the scanner cannot start: a copy key (rendered in the current language) or the server's own text.
  type InitProblem = ((c: ScannerCopy) => string) | string;
  const [initError, setInitErrorState] = useState<InitProblem | null>(null);
  const setInitError = (problem: InitProblem | null) => setInitErrorState(() => problem);

  // Sync states
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
  // null: the camera has no light the page can switch.
  const [torchOn, setTorchOn] = useState<boolean | null>(null);
  const [cameraSwitchable, setCameraSwitchable] = useState(false);

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
          const detail = apiErrorDiagnostic(res.error) ?? `HTTP ${status}`;
          const kind = classifyAuthFailure(status, detail, apiErrorCode(res.error));
          if (kind !== "TRANSIENT") {
            enterAuthBlocked(kind, detail, res.error ? localizedApiError(res.error, locale) : detail);
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

  // While the server answers, the device reports its unsynced scans and version for the organizer's device list.
  // A refused credential blocks the device like any other scanner call (no retries with a dead token); other
  // failures back off, doubling up to 15 minutes, so a struggling server is not hammered.
  const heartbeatRef = useRef({ at: 0, delay: HEARTBEAT_MS });
  const sendHeartbeat = async () => {
    const beat = heartbeatRef.current;
    if (!pointId || !ownsPoint() || authBlockedRef.current || deactivationRef.current || !manifestRef.current) return;
    if (!serverReachable() || Date.now() - beat.at < beat.delay) return;
    const client = scannerClient(getStoredScannerToken());
    if (!client) return;
    beat.at = Date.now();
    const backOff = () => {
      beat.delay = Math.min(beat.delay * 2, HEARTBEAT_MAX_BACKOFF_MS);
    };
    try {
      const unsynced = (await getUnsyncedScans(pointId)).length;
      const { error, response } = await client.POST("/api/checkin-points/{point_id}/devices/self/heartbeat", {
        params: { path: { point_id: pointId } },
        body: { unsynced_count: unsynced, app_version: SCANNER_APP_VERSION },
      });
      if (response.ok) {
        beat.delay = HEARTBEAT_MS;
        return;
      }
      const detail = apiErrorDiagnostic(error) ?? `HTTP ${response.status}`;
      const kind = classifyAuthFailure(response.status, detail, apiErrorCode(error));
      if (kind !== "TRANSIENT") {
        enterAuthBlocked(kind, detail, error ? localizedApiError(error, locale) : detail);
        return;
      }
      backOff();
    } catch {
      backOff();
    }
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
      setInitError((c) => c.initNoToken);
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
      setInitError(error instanceof ScannerStorageBlockedError ? (c) => c.initStorageBlocked : (c) => c.initStorageUnavailable);
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
        setInitError(outcome.kind === "blocked" ? outcome.detail : (c) => c.initConnectFailed);
      }
    } else if (!cached) {
      setInitError((c) => c.initConnectFailed);
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
                direction: s.direction ?? "IN",
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
          const detail = apiErrorDiagnostic(err) ?? `HTTP ${response.status}`;
          const kind = classifyAuthFailure(response.status, detail, apiErrorCode(err));
          if (kind !== "TRANSIENT") {
            enterAuthBlocked(kind, detail, localizedApiError(err, locale));
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
  const askServer = async (
    scanId: string,
    code: string,
    scannedAt: string,
    scanDirection: ScanDirection
  ): Promise<ServerScanResult | "blocked" | null> => {
    const client = scannerClient(getStoredScannerToken());
    if (!pointId || !client) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_SCAN_TIMEOUT_MS);
    try {
      const { data, error, response } = await client.POST("/api/checkin-points/{point_id}/scan", {
        params: { path: { point_id: pointId } },
        body: { scan_id: scanId, qr_secret: code, scanned_at: scannedAt, direction: scanDirection },
        signal: controller.signal,
      });
      if (data && typeof data.status === "string") {
        noteServerContact(true);
        return data;
      }
      if (error) {
        const detail = apiErrorDiagnostic(error) ?? `HTTP ${response.status}`;
        const kind = classifyAuthFailure(response.status, detail, apiErrorCode(error));
        if (kind !== "TRANSIENT") {
          enterAuthBlocked(kind, detail, localizedApiError(error, locale));
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
    const point = current.checkin_point;
    const tracksOccupancy = Boolean(point.tracks_occupancy);
    // Exits exist only where the point tracks occupancy; anywhere else every scan is an entry.
    const scanDirection: ScanDirection = tracksOccupancy ? directionRef.current : "IN";
    const scanWindow = admissionWindowKey(point.reset_window, current.event_timezone, scannedAt);
    const hash = await qrHash(current.event_id, code);
    const server = serverReachable() ? await askServer(scanId, code, scannedAt, scanDirection) : null;
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
      result = applyServerScan(admission, hash, server, {
        window: scanWindow,
        scannedAt,
        tracksOccupancy,
      });
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
        direction: scanDirection,
      };
    } else {
      const policy: LocalPolicyConfig = {
        policy_type: point.policy_type as LocalPolicyConfig["policy_type"],
        allowed_tier_ids: point.allowed_tier_ids ?? [],
        max_capacity: point.max_capacity,
        current_admitted_count: admission.admittedCount,
        // A device that cannot reach the server cannot know the room's count across gates.
        is_offline: true,
        fail_closed_offline_capacity: true,
        tracks_occupancy: tracksOccupancy,
        current_occupancy: admission.occupancy,
        requires_point: Boolean(point.requires_point_id),
        direction: scanDirection,
        admission_window: scanWindow,
        scanned_at: scannedAt,
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
        direction: scanDirection,
      };
    }
    const inside = result.current_occupancy ?? admission.occupancy;
    admissionRef.current = { ticketMap: admission.ticketMap, admittedCount: result.current_admitted_count, occupancy: inside };
    setOccupancy(inside);
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
    startCameraRef.current = startCamera;
    tickRef.current = () => {
      setIsOnline(serverReachable());
      pollManifest();
      void sendHeartbeat();
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
    setUnpairOutcome(null);
    try {
      const credential = await getPersistedScannerCredential(pointId);
      if (credential) {
        const pendingCredential = { ...credential, deactivation_pending: true };
        setPersistedCredential(pendingCredential);
        await markScannerDeactivationPending(pointId);
      }
      const token = credential?.token ?? getStoredScannerToken();
      if (!navigator.onLine) {
        setUnpairOutcome({ kind: "notConfirmed", detail: "Offline: server revocation pending" });
        return;
      }
      if (!token) {
        setUnpairOutcome({ kind: "notConfirmed", detail: "No device credential to revoke" });
        return;
      }

      let remaining = await getUnsyncedScans(pointId);
      if (remaining.length > 0) {
        await flushQueue();
        remaining = await getUnsyncedScans(pointId);
        if (remaining.length > 0) {
          setUnpairOutcome({ kind: "unsynced", count: remaining.length });
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
        setUnpairOutcome({ kind: "notConfirmed", detail: `Server revocation not confirmed (HTTP ${response.status})` });
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
      setUnpairOutcome({ kind: "confirmed" });
    } catch {
      setUnpairOutcome({ kind: "notConfirmed", detail: "Server revocation could not be confirmed" });
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


  // 5. Mobile / Desktop Camera Detection Loop (native detector, ZXing and jsQR: lib/qrFrameDecoder)
  // The operator's camera choice is remembered per point, so a reload or the next shift starts the camera again.
  const rememberCamera = (on: boolean) => {
    if (!pointId) return;
    try {
      if (on) localStorage.setItem(`${CAMERA_KEY_PREFIX}${pointId}`, "on");
      else localStorage.removeItem(`${CAMERA_KEY_PREFIX}${pointId}`);
    } catch {
      // storage blocked: the camera starts by hand next time
    }
  };

  // Stops the stream and the frame loop, keeping the operator's choice (a restart follows).
  const releaseCamera = () => {
    detectionActiveRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    // Browsers expose the camera only on https (or localhost); a LAN http address has no mediaDevices.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("cameraInsecure");
      return;
    }
    releaseCamera();
    try {
      const stream = await openScannerCamera();
      streamRef.current = stream;
      setTorchOn(hasTorch(stream) ? false : null);
      void canSwitchCamera().then(setCameraSwitchable);
      // A locked screen or another app can end the track; it comes back when the page is visible again.
      stream.getVideoTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          if (streamRef.current === stream && document.visibilityState === "visible") void startCameraRef.current();
        })
      );
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          // Autoplay may be deferred by browser policy; element is muted
        }
      }
      setCameraActive(true);
      rememberCamera(true);
      startDetectionLoop();
    } catch (err: unknown) {
      setCameraActive(false);
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
    releaseCamera();
    setCameraActive(false);
    rememberCamera(false);
  };

  const switchCamera = async () => {
    if (await chooseNextCamera(streamRef.current)) await startCamera();
  };

  const toggleTorch = async () => {
    if (torchOn === null) return;
    if (await setTorch(streamRef.current, !torchOn)) setTorchOn(!torchOn);
  };

  const startDetectionLoop = () => {
    // One loop at a time: a restarted camera ends the loop of the stream before it.
    const loop = ++detectionLoopRef.current;
    detectionActiveRef.current = true;
    const running = () => detectionActiveRef.current && loop === detectionLoopRef.current;
    const decoder = createQrFrameDecoder();

    const checkFrame = async () => {
      if (!running()) return;
      const video = videoRef.current;

      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        if (running()) {
          requestAnimationFrame(checkFrame);
        }
        return;
      }

      // Frames keep being read while a verdict is up: a re-read of the same badge is dropped below and in
      // processScannedCode, and a different badge replaces the verdict at once.
      try {
        const detectedValue = await decoder.decode(video);
        if (!running()) return;

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

      if (running()) {
        setTimeout(() => requestAnimationFrame(checkFrame), 80);
      }
    };

    requestAnimationFrame(checkFrame);
  };

  // Pair (or re-pair) with a pairing code: from the scanned pairing QR code or pasted.
  const pairWith = async (token: string) => {
    if (!pointId || !token.trim()) return;
    await storeCredential(token.trim());
    setInitError(null);
    setAuthBlocked(null);
    await loadManifest(true);
  };

  // The live screen: paired, the point's list loaded, nothing blocking it.
  const live = !loading && tabLock !== "busy" && !deactivationPending && !initError && manifest !== null;
  // The screen stays on while the scanner is live: a locked phone also kills the camera.
  useWakeLock(live);
  const update = useAppUpdate();
  const promptable = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, () => false);

  // The camera the operator left on starts by itself once the live screen is up.
  const cameraRestoredRef = useRef(false);
  useEffect(() => {
    if (!live || !pointId || cameraRestoredRef.current) return;
    cameraRestoredRef.current = true;
    let remembered = false;
    try {
      remembered = localStorage.getItem(`${CAMERA_KEY_PREFIX}${pointId}`) === "on";
    } catch {
      remembered = false;
    }
    if (remembered) void startCameraRef.current();
  }, [live, pointId]);

  // Back from a locked screen or another app: a dead camera stream starts again, a paused preview plays again.
  useEffect(() => {
    const onVisible = () => {
      const stream = streamRef.current;
      if (document.visibilityState !== "visible" || !stream) return;
      const tracks = stream.getVideoTracks();
      if (tracks.length === 0 || tracks.some((track) => track.readyState === "ended")) void startCameraRef.current();
      else if (videoRef.current?.paused) void videoRef.current.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const timeZone = manifest?.event_timezone ?? null;
  // Supervisor data, folded under «جزئیات فنی» on the setup screens.
  const details = (english?: string | null) => (
    <>
      <p>
        {copy.pointLabel}: <bdi dir="ltr" className="font-mono">{pointId}</bdi>
      </p>
      <p>
        {op.menu.version}: <bdi dir="ltr" className="font-mono">{SCANNER_APP_VERSION}</bdi>
      </p>
      {english && (
        <p lang="en" dir="ltr">
          {english}
        </p>
      )}
    </>
  );
  const renderGate = (props: {
    kind: OperatorGateKind;
    title?: string;
    body?: string;
    icon?: "layers";
    action?: ReactNode;
    secondary?: ReactNode;
    children?: ReactNode;
    details?: ReactNode;
  }) => (
    <div dir={dir} lang={locale} className="surface-ink relative">
      <LanguageToggle locale={locale} onChange={setLocale} tone="ink" className="absolute end-3 top-[max(env(safe-area-inset-top),0.75rem)] z-10" />
      <OperatorGate locale={locale} tone="ink" {...props} />
    </div>
  );
  const pairing = pointId ? <PairingPanel copy={copy} locale={locale} pointId={pointId} onPair={pairWith} /> : null;
  const unsent = <DiscardUnsynced copy={copy} pendingCount={pendingCount} onDiscard={discardUnsynced} />;

  if (loading) {
    return (
      <div dir={dir} lang={locale} role="status" className="surface-ink flex h-dvh flex-col items-center justify-center gap-4 bg-surface-ink text-white">
        <Spinner size={40} className="text-aiteb-orchid" />
        <p className="text-body-sm text-ink-200">{copy.loading}</p>
      </div>
    );
  }

  if (tabLock === "busy") {
    return renderGate({ kind: "unavailable", icon: "layers", title: copy.otherTabTitle, body: copy.otherTabBody });
  }

  if (deactivationPending) {
    // Unpaired for good: the device is ready to be paired again.
    if (unpairOutcome?.kind === "confirmed") {
      return renderGate({ kind: "unpaired", title: copy.unpairedTitle, action: pairing, children: unsent, details: details() });
    }
    const line =
      unpairOutcome?.kind === "unsynced"
        ? copy.unpairUnsynced(unpairOutcome.count)
        : unpairOutcome
          ? copy.unpairNotConfirmed
          : copy.deactivatedDefault;
    return renderGate({
      kind: "suspended",
      title: copy.deactivatedTitle,
      body: line,
      action: pairing,
      secondary: persistedCredential?.token ? (
        <Button type="button" variant="secondary" tone="ink" icon="sync" isFullWidth loading={unpairing} disabled={!isOnline} onClick={() => void handleUnpair()}>
          {copy.retryUnpair}
        </Button>
      ) : undefined,
      children: (
        <>
          {unpairOutcome?.kind !== "unsynced" && pendingCount > 0 && (
            <p>
              {copy.remaining(pendingCount)} {!isOnline && copy.reconnectFirst}
            </p>
          )}
          {unsent}
        </>
      ),
      details: details(unpairOutcome?.kind === "notConfirmed" ? unpairOutcome.detail : null),
    });
  }

  if (initError || !manifest) {
    const kind = authBlocked?.kind ?? (getStoredScannerToken() ? "UNAVAILABLE" : "UNPAIRED");
    const problem: InitProblem = initError ?? ((c) => c.initManifestMissing);
    // The English diagnostic for supervisors (folded away), and a sentence in the reader's language.
    const english = authBlocked?.message ?? (typeof problem === "string" ? problem : problem(scannerCopy.en));
    const iosInstall =
      typeof navigator !== "undefined" && isIosInstallBrowser(navigator.userAgent, navigator.maxTouchPoints) ? (
        <InstallHint locale={locale} persona="scanner" />
      ) : null;
    switch (kind) {
      case "REVOKED":
      case "FORBIDDEN":
      case "EXPIRED":
        return renderGate({
          kind: kind === "REVOKED" ? "revoked" : kind === "FORBIDDEN" ? "wrongGate" : "expired",
          action: pairing,
          children: unsent,
          details: details(english),
        });
      case "UNAVAILABLE":
        return renderGate({
          kind: "unavailable",
          title: copy.unavailableTitle,
          body: typeof problem === "string" ? undefined : problem(copy),
          action: (
            <Button type="button" tone="ink" size="lg" icon="sync" isFullWidth onClick={() => void loadManifest(true)}>
              {commonCopy[locale].retry}
            </Button>
          ),
          children: unsent,
          details: details(english),
        });
      default:
        return renderGate({
          kind: "unpaired",
          action: pairing,
          children: (
            <>
              {iosInstall}
              {unsent}
            </>
          ),
          details: details(),
        });
    }
  }

  const point = manifest.checkin_point;
  const scanningPaused = storageFailed || authBlocked !== null || (authVerdict !== null && !authVerdict.ok);
  const view = activeResult ? verdictView(activeResult, copy) : null;
  const policy = policyLabel(copy, point.policy_type, point.reset_window);
  const remainingMs = authVerdict?.ok && authVerdict.reason === "WITHIN_WINDOW" ? authVerdict.remainingMs : null;
  const offlineLeft =
    !isOnline && remainingMs !== null && remainingMs < OFFLINE_LEFT_SHOWN_MS
      ? copy.offlineLeft(Math.floor(remainingMs / 3_600_000), Math.floor((remainingMs % 3_600_000) / 60_000))
      : undefined;
  // A new version reloads the page: only with nothing waiting to send and no verdict on screen.
  const canApplyUpdate = pendingCount === 0 && !activeResult;
  const pill: Omit<StatusPillProps, "locale"> =
    conflicts.length > 0
      ? { status: "conflicts", count: conflicts.length, onClick: () => setShowConflictDrawer(true) }
      : !isOnline
        ? { status: "offline", count: pendingCount, detail: offlineLeft }
        : isSyncing
          ? { status: "syncing" }
          : pendingCount > 0
            ? { status: "queued", count: pendingCount }
            : update.waiting
              ? { status: "update", onClick: canApplyUpdate ? update.apply : undefined }
              : { status: "online" };
  const menuItems: OperatorMenuItem[] = [
    {
      id: "sound",
      label: soundEnabled ? op.menu.soundOff : op.menu.soundOn,
      icon: soundEnabled ? "volume-off" : "volume",
      onSelect: () => setSoundEnabled((on) => !on),
    },
    { id: "language", label: op.menu.language, lang: op.menu.languageLang, icon: "globe", onSelect: () => setLocale(op.menu.languageLang) },
    { id: "recent", label: copy.recentScans, icon: "list", onSelect: () => setRecentOpen(true) },
    {
      id: "refresh",
      label: copy.refreshList,
      icon: "sync",
      disabled: refreshing,
      onSelect: () => {
        setRefreshing(true);
        void refreshManifest(true).finally(() => setRefreshing(false));
      },
    },
    {
      id: "send",
      label: copy.sendQueue,
      icon: "upload",
      disabled: pendingCount === 0 || isSyncing,
      hint: syncFailCount > 0 ? copy.syncFailures(syncFailCount) : undefined,
      onSelect: () => void flushQueue(),
    },
  ];
  if (promptable) menuItems.push({ id: "install", label: op.menu.install, icon: "smartphone", onSelect: () => void promptInstall() });
  if (update.waiting) {
    menuItems.push({
      id: "update",
      label: op.menu.update,
      icon: "download",
      disabled: !canApplyUpdate,
      hint: pendingCount > 0 ? op.menu.updateAfterQueue : undefined,
      onSelect: update.apply,
    });
  }
  menuItems.push({ id: "unpair", label: op.menu.unpair, icon: "lock", danger: true, divider: true, onSelect: () => setShowUnpairConfirm(true) });

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
    <div dir={dir} lang={locale} className="scanner-root surface-ink flex h-dvh select-none flex-col overflow-hidden bg-surface-ink text-white">
      {view && <div key={verdictKey} aria-hidden="true" className={`scanner-halo scanner-halo--${view.tone}`} />}
      {storageFailed && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="scanner-storage-failed" className="fixed inset-0 z-50 flex items-center justify-center bg-status-danger-solid p-4">
          <div className="w-full max-w-md space-y-4 rounded-card bg-surface-ink p-5">
            <h2 id="scanner-storage-failed" className="flex items-start gap-2 text-title-sm font-bold">
              <Icon name="x-circle" size={24} className="mt-0.5 shrink-0" />
              {copy.storageFailedTitle}
            </h2>
            <p className="text-body-sm text-ink-200">{copy.storageFailedBody}</p>
            <Button type="button" tone="ink" size="lg" icon="sync" isFullWidth onClick={() => window.location.reload()}>
              {copy.reload}
            </Button>
          </div>
        </div>
      )}

      <OperatorBar
        tone="ink"
        icon="scan"
        title={point.name}
        chip={policy ? <span className="scanner-policy">{policy}</span> : undefined}
        status={<StatusPill locale={locale} tone="ink" {...pill} />}
        menu={<OperatorMenu locale={locale} tone="ink" items={menuItems} version={SCANNER_APP_VERSION} />}
      />

      {/* Offline time is up or the pairing expired: records are kept, only NEW admissions stop. */}
      {!authBlocked && authVerdict && !authVerdict.ok && (
        <p role="alert" className="flex items-start gap-2 bg-status-warning-solid px-4 py-2.5 text-body-sm font-semibold text-ink-950">
          <Icon name="pause" size={18} className="mt-0.5 shrink-0" />
          <span>
            {copy.windowPaused} {authVerdict.reason === "TOKEN_EXPIRED" ? copy.windowTokenExpired : copy.windowStale}
          </span>
        </p>
      )}

      <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:flex-row lg:gap-6 lg:px-6 lg:pt-5">
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-[3]">
          {/* Android and desktop offer to install once paired; never over a verdict. */}
          {promptable && !activeResult && <InstallHint locale={locale} persona="scanner" />}
          {point.tracks_occupancy && (
            <DirectionToggle
              copy={copy}
              direction={direction}
              onChange={setDirection}
              disabled={scanningPaused}
              inside={copy.inside(occupancy)}
            />
          )}
          <Viewfinder
            videoRef={videoRef}
            cameraActive={cameraActive}
            cameraError={cameraError ? copy[cameraError] : null}
            onStartCamera={() => void startCamera()}
            onStopCamera={stopCamera}
            onSwitchCamera={cameraSwitchable ? () => void switchCamera() : undefined}
            torchOn={torchOn}
            onToggleTorch={() => void toggleTorch()}
            copy={copy}
          >
            {activeResult && <ScanVerdict key={verdictKey} result={activeResult} locale={locale} copy={copy} />}
          </Viewfinder>
          <ManualEntry
            copy={copy}
            open={manualOpen}
            onOpenChange={setManualOpen}
            value={manualCode}
            onChange={(value) => {
              setManualCode(value);
              if (trackingIdWarning) setTrackingIdWarning(false);
            }}
            onSubmit={handleManualSubmit}
            disabled={scanningPaused}
            warning={trackingIdWarning ? copy.trackingIdWarning : null}
          />
        </div>

        {/* Tablets and kiosks keep the last scans beside the stage; phones open them from the menu. */}
        <section
          aria-labelledby="scanner-recent-title"
          className="hidden min-h-0 flex-col overflow-hidden rounded-card border border-white/10 md:flex md:max-h-[32vh] lg:max-h-none lg:flex-[2]"
        >
          <h2 id="scanner-recent-title" className="border-b border-white/10 px-4 py-3 text-body-sm font-semibold text-ink-200">
            {copy.recentScans}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ScanLog scans={recentScans.slice(0, SIDE_LOG_SIZE)} copy={copy} locale={locale} timeZone={timeZone} />
          </div>
        </section>
      </main>

      <ConflictDrawer
        isOpen={showConflictDrawer}
        conflicts={conflicts}
        copy={copy}
        locale={locale}
        timeZone={timeZone}
        onClose={() => setShowConflictDrawer(false)}
        onAcknowledge={async (scanId) => {
          await acknowledgeConflict(scanId);
          setConflicts(await getConflictsForPoint(pointId ?? ""));
        }}
      />
      <Dialog isOpen={recentOpen} onClose={() => setRecentOpen(false)} title={copy.recentScans} tone="ink">
        <ScanLog scans={recentScans} copy={copy} locale={locale} timeZone={timeZone} />
      </Dialog>
      <ConfirmDialog
        isOpen={showUnpairConfirm}
        title={copy.unpairQuestion}
        description={!navigator.onLine ? copy.unpairOffline : pendingCount > 0 ? copy.unpairUnsent(pendingCount) : copy.unpairBody}
        confirmLabel={copy.unpairConfirm}
        tone="danger"
        busy={unpairing}
        onConfirm={() => void handleUnpair()}
        onCancel={() => setShowUnpairConfirm(false)}
      />
    </div>
  );
}
