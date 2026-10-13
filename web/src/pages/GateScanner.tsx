import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { createScannerApiClient, formatApiError, type CheckInManifest } from "../api/client";
import { playErrorBuzz, playSuccessChime, playProvisionalChime } from "../lib/audioFeedback";
import { useAttendeeLocale } from "../lib/i18n";
import jsQR from "jsqr";
import {
  evaluateOfflineAuthorization,
  formatRemainingWindow,
  getJwtExpiryIso,
  type OfflineAuthVerdict,
} from "../lib/scannerAuthPolicy";
import {
  clearPersistedToken,
  getPersistedScannerCredential,
  markScannerDeactivationPending,
  persistScannerToken,
  type PersistedScannerCredential,
} from "../lib/scannerTokenStore";
import {
  evaluateLocalScan,
  reconstructLocalState,
  type LocalPolicyConfig,
  type LocalScanResult,
  type LocalTicket,
} from "../lib/scannerEngine";
import {
  acknowledgeConflict,
  getAllScansForPoint,
  getCachedManifestMeta,
  getConflictsForPoint,
  getUnsyncedScans,
  reconcileBatchOutcomes,
  saveCachedManifest,
  saveQueuedScan,
  type QueuedScan,
} from "../lib/scannerStorage";
import { Icon } from "../components/ui/Icon";
import { scannerCopy, clockTime, takeoverKind } from "../components/scanner/copy";
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

export default function GateScanner() {
  const { pointId } = useParams<{ pointId: string }>();
  const { locale, setLocale, t, isRtl } = useAttendeeLocale();
  const toggleLocale = () => { setLocale(locale === "fa" ? "en" : "fa"); };
  const [tokenInput, setTokenInput] = useState("");
  const [manualCode, setManualCode] = useState("");
  // Persisted scanner credential (survives browser restart via IndexedDB)
  const [persistedCredential, setPersistedCredential] = useState<PersistedScannerCredential | null>(null);
  // Authorization lifecycle: definitive server rejects + offline-window verdict
  const [authBlocked, setAuthBlocked] = useState<{
    kind: "REVOKED" | "FORBIDDEN" | "EXPIRED";
    message: string;
  } | null>(null);
  const [lastServerContactAt, setLastServerContactAt] = useState<string | null>(null);
  const [authVerdict, setAuthVerdict] = useState<OfflineAuthVerdict | null>(null);
  // Unpair flow state — durable local lockout remains until server revocation.
  const [showUnpairConfirm, setShowUnpairConfirm] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const [deactivationPending, setDeactivationPending] = useState(false);
  const deactivationRef = useRef(false);
  const [unpairNotice, setUnpairNotice] = useState<string | null>(null);
  const getStoredScannerToken = (): string | null => {
    if (!pointId || typeof window === "undefined") return null;
    return (
      sessionStorage.getItem(`congress_scanner_token_${pointId}`) ||
      persistedCredential?.token ||
      null
    );
  };

  // Explicit device authority bound to this check-in point. Without a device credential nothing is
  // dispatched, so no other session (User, organizer, desk) can ever be attached to scanner requests.
  const scannerClient = (token: string | null) =>
    pointId && token ? createScannerApiClient({ kind: "scanner", token, pointId }, { pointId }) : null;

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

  const storeCredential = async (token: string) => {
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
    setUnpairNotice(null);
  };


  // Handle token from URL query parameter (?token=...) — persist then strip
  useEffect(() => {
    const tokenFromUrl =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("token");
    if (tokenFromUrl && pointId && typeof window !== "undefined") {
      const trimmed = tokenFromUrl.trim();
      sessionStorage.setItem(`congress_scanner_token_${pointId}`, trimmed);
      void storeCredential(trimmed);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [pointId]);

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

  const enterAuthBlocked = (kind: "REVOKED" | "FORBIDDEN" | "EXPIRED", message: string) => {
    setAuthBlocked({ kind, message });
    setManifest(null);
    setTicketMap({});
    setCurrentAdmittedCount(0);
    setRecentScans([]);
    setConflicts([]);
    setShowConflictDrawer(false);
  };

  // Manifest freshness tracking (Phase 4: enforced, not just displayed)
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
  const [trackingIdWarning, setTrackingIdWarning] = useState<string | null>(null);

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
  const [ticketMap, setTicketMap] = useState<Record<string, LocalTicket>>({});
  const [currentAdmittedCount, setCurrentAdmittedCount] = useState<number>(0);
  const [conflicts, setConflicts] = useState<QueuedScan[]>([]);
  const [showConflictDrawer, setShowConflictDrawer] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // Connectivity and sync states
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFailCount, setSyncFailCount] = useState(0);

  // Recompute the offline-window verdict whenever its inputs change
  useEffect(() => {
    const verdict = evaluateOfflineAuthorization(Date.now(), {
      tokenExpiresAt: persistedCredential?.token_expires_at ?? getJwtExpiryIso(getStoredScannerToken()),
      lastServerContactAt,
      manifestCachedAt,
      isOnline,
    });
    setAuthVerdict(verdict);
  }, [persistedCredential, lastServerContactAt, manifestCachedAt, isOnline]);

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Audio mute state
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Current flash evaluation result
  const [activeResult, setActiveResult] = useState<LocalScanResult | null>(null);

  // Recent audit feed
  const [recentScans, setRecentScans] = useState<QueuedScan[]>([]);

  // 1. Initial Load: IndexedDB cache first, then live refresh if online.
  // Definitive 401/403 enters authBlocked (records stay visible); transient
  // network failures keep cached state usable.
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
      setManifest(null);
      setTicketMap({});
      setCurrentAdmittedCount(0);
      setRecentScans([]);
      setConflicts([]);
      setLoading(false);
      updatePendingCount();
      return;
    }
    if (!token) {
      setManifest(null);
      setTicketMap({});
      setCurrentAdmittedCount(0);
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
    const cachedMeta = await getCachedManifestMeta(pointId);
    const cached = cachedMeta?.manifest;
    if (cached && typeof cached === "object" && "checkin_point" in cached) {
      const casted = cached as CheckInManifest;
      setManifest(casted);
      if (cachedMeta.cached_at) setManifestCachedAt(cachedMeta.cached_at);
      const localHistory = await getAllScansForPoint(pointId);
      const { ticketMap: reconMap, currentAdmittedCount: reconCount } =
        reconstructLocalState(casted.tickets, localHistory);
      setTicketMap(reconMap);
      setCurrentAdmittedCount(reconCount);
      setRecentScans(localHistory.slice(0, 10));
      setLoading(false);
    }

    // Refresh from live server if online or forced
    if (navigator.onLine || forceRefresh) {
      try {
        const client = scannerClient(getStoredScannerToken());
        if (!client) throw new Error("No scanner credential available");
        const { data, error: err, response } = await client.GET(
          "/api/checkin-points/{point_id}/manifest",
          {
            params: { path: { point_id: pointId } },
          }
        );
        if (data) {
          setManifest(data);
          const localHistory = await getAllScansForPoint(pointId);
          const { ticketMap: reconMap, currentAdmittedCount: reconCount } =
            reconstructLocalState(data.tickets, localHistory);
          setTicketMap(reconMap);
          setCurrentAdmittedCount(reconCount);
          await saveCachedManifest(pointId, data);
          const nowIso = new Date().toISOString();
          setManifestCachedAt(nowIso);
          setLastServerContactAt(nowIso);
          setRecentScans(localHistory.slice(0, 10));
          setInitError(null);
          setAuthBlocked(null);
        } else if (err) {
          const status = (response as Response | undefined)?.status;
          const detail = formatApiError(err);
          const kind = classifyAuthFailure(status, detail);
          if (kind === "TRANSIENT") {
            if (!cached) setInitError("Failed to connect to event server.");
          } else {
            enterAuthBlocked(kind, detail);
            if (!cached) setInitError(detail);
          }
        }
      } catch {
        if (!cached) {
          setInitError("Failed to connect to event server.");
        }
      }
    }

    const activeConflicts = await getConflictsForPoint(pointId);
    setConflicts(activeConflicts);
    setLoading(false);
    updatePendingCount();
  };


  const updatePendingCount = async () => {
    if (!pointId) return;
    const pending = await getUnsyncedScans(pointId);
    setPendingCount(pending.length);
  };

  useEffect(() => {
    loadManifest();

    const handleOnline = () => {
      setIsOnline(true);
      flushQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Background sync timer every 5 seconds
    const syncInterval = setInterval(() => {
      if (navigator.onLine) {
        flushQueue();
      }
    }, 5000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(syncInterval);
    };
  }, [pointId]);

  // 2. Background queue flush with per-record reconciliation.
  // Definitive 401/403 stops new admissions (authBlocked) while preserving
  // every queued record. Network throws stay transient: the 5 s interval
  // gates retries, so no infinite hot loop exists.
  const flushQueue = async () => {
    if (!pointId || isSyncing || !navigator.onLine) return;
    if (authBlocked) return;
    const unsynced = await getUnsyncedScans(pointId);
    if (unsynced.length === 0) return;

    setIsSyncing(true);
    try {
      const client = scannerClient(getStoredScannerToken());
      // No credential: nothing is sent and every queued record stays on the device.
      if (!client) return;
      const payload = {
        scans: unsynced.map((s) => ({
          scan_id: s.scan_id,
          qr_secret: s.qr_secret,
          scanned_at: s.scanned_at,
        })),
      };

      const { data, error: err, response } = await client.POST(
        "/api/checkin-points/{point_id}/scans/batch",
        {
          params: { path: { point_id: pointId } },
          body: payload,
        }
      );

      if (data && data.results) {
        const report = await reconcileBatchOutcomes(pointId, data.results);
        if (report.conflictCount > 0) {
          const updatedConflicts = await getConflictsForPoint(pointId);
          setConflicts(updatedConflicts);
        }
        const nowIso = new Date().toISOString();
        setLastServerContactAt(nowIso);
        const allPointScans = await getAllScansForPoint(pointId);
        setRecentScans(allPointScans.slice(0, 10));
        updatePendingCount();
        setSyncFailCount(0);
      } else if (err) {
        const status = (response as Response | undefined)?.status;
        const kind = classifyAuthFailure(status, formatApiError(err));
        if (kind !== "TRANSIENT") {
          enterAuthBlocked(kind, formatApiError(err));
        } else {
          setSyncFailCount((c) => c + 1);
        }
      }
    } catch {
      setSyncFailCount((c) => c + 1);
    } finally {
      setIsSyncing(false);
    }
  };

  // 3. Central Scan Processor (Evaluates locally in <10ms, triggers audio/visual, queues to IndexedDB)
  // Hard gates: definitively deauthorized devices and expired offline windows
  // stop NEW admissions. Queued history is never mutated here.
  const processScannedCode = async (rawCode: string) => {
    if (!pointId || !manifest) return;
    if (
      !persistedCredential?.token ||
      persistedCredential.deactivation_pending ||
      deactivationRef.current ||
      deactivationPending ||
      !getStoredScannerToken()
    ) {
      playErrorBuzz();
      return;
    }
    if (authBlocked) {
      playErrorBuzz();
      return;
    }
    const offlineVerdict = evaluateOfflineAuthorization(Date.now(), {
      tokenExpiresAt: persistedCredential.token_expires_at,
      lastServerContactAt,
      manifestCachedAt,
      isOnline: navigator.onLine,
    });
    if (!offlineVerdict.ok) {
      setAuthVerdict(offlineVerdict);
      playErrorBuzz();
      return;
    }
    const cleanSecret = rawCode.trim().toLowerCase();
    if (!cleanSecret) return;

    // The same badge presented again while its own result is still showing (a camera or reader
    // re-reading it) is ignored; a DIFFERENT badge is always evaluated, never silently dropped.
    if (isScanningRef.current && lastProcessedCodeRef.current === cleanSecret) return;
    lastProcessedCodeRef.current = cleanSecret;
    isScanningRef.current = true;

    const policy: LocalPolicyConfig = {
      policy_type: manifest.checkin_point.policy_type as LocalPolicyConfig["policy_type"],
      allowed_tier_ids: manifest.checkin_point.allowed_tier_ids,
      max_capacity: manifest.checkin_point.max_capacity,
      current_admitted_count: currentAdmittedCount,
      is_offline: !navigator.onLine,
    };

    const result = evaluateLocalScan(ticketMap, policy, cleanSecret);
    setActiveResult(result);
    setCurrentAdmittedCount(result.current_admitted_count);

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
    // Queue to IndexedDB
    const scanRecord: QueuedScan = {
      scan_id: crypto.randomUUID(),
      point_id: pointId,
      qr_secret: cleanSecret,
      scanned_at: new Date().toISOString(),
      status: result.status,
      rejection_reason: result.rejection_reason,
      synced: false,
      sync_state: result.status === "ADMITTED" ? "PROVISIONAL" : "LOCAL_REJECTED",
      attendee_name: result.ticket?.attendee_name,
      ticket_tier_name: result.ticket?.ticket_tier_name,
    };

    await saveQueuedScan(scanRecord);
    setRecentScans((prev) => [scanRecord, ...prev.slice(0, 9)]);
    updatePendingCount();

    // Auto-flush immediately if online
    if (navigator.onLine) {
      flushQueue();
    }

    // Auto-clear active flash after 1.8 seconds
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      setActiveResult(null);
      isScanningRef.current = false;
      lastProcessedCodeRef.current = null;
    }, 1800);
  };

  // 4. USB / Bluetooth HID Laser Scanner Listener (Buffered keystrokes with <50ms delta)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is focused on a text input element
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }

      const now = performance.now();
      const delta = now - hidLastKeyTimeRef.current;
      hidLastKeyTimeRef.current = now;

      if (e.key === "Enter") {
        if (hidBufferRef.current.length >= 4) {
          const barcode = hidBufferRef.current;
          hidBufferRef.current = "";
          processScannedCode(barcode);
        } else {
          hidBufferRef.current = "";
        }
      } else if (e.key.length === 1) {
        // If delta is larger than 60ms and buffer was idle, reset buffer (new barcode scan started)
        if (delta > 60 && hidBufferRef.current.length > 0) {
          hidBufferRef.current = "";
        }
        hidBufferRef.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pointId, manifest, ticketMap, soundEnabled]);
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
        setUnpairNotice(
          "Scanner disabled on this browser only. Server revocation is pending; the server may still accept this credential. Keep this device with its supervisor and reconnect to finish."
        );
        return;
      }
      if (!token) {
        setUnpairNotice(
          "Scanner is disabled locally, but no device credential is available to revoke it. Ask an organizer to revoke the device."
        );
        return;
      }

      let remaining = await getUnsyncedScans(pointId);
      if (remaining.length > 0) {
        await flushQueue();
        remaining = await getUnsyncedScans(pointId);
        if (remaining.length > 0) {
          setUnpairNotice(
            `Scanner is disabled locally. ${remaining.length} unsynced scan(s) remain recoverable on this device; server revocation was not attempted. Reconnect or ask a supervisor to recover them before retrying.`
          );
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
        setUnpairNotice(
          `Scanner is disabled locally, but server revocation was not confirmed (HTTP ${response.status}). The credential is retained for retry; the server may still accept it. Ask an organizer to revoke it if retry fails.`
        );
        return;
      }

      sessionStorage.removeItem(`congress_scanner_token_${pointId}`);
      await clearPersistedToken(pointId);
      setPersistedCredential(null);
      setAuthBlocked(null);
      setManifest(null);
      setTicketMap({});
      setCurrentAdmittedCount(0);
      setRecentScans([]);
      setConflicts([]);
      setUnpairNotice(
        "Server revocation confirmed. Scan and conflict records remain stored for authorized supervisor recovery; pair a fresh device token to access them."
      );
    } catch {
      setUnpairNotice(
        "Scanner is disabled locally, but server revocation could not be confirmed. The credential and scan records are retained; reconnect and retry or ask an organizer to revoke it."
      );
    } finally {
      setUnpairing(false);
      setShowUnpairConfirm(false);
    }
  };


  // 5. Mobile / Desktop Camera Detection Loop (Dual Native & jsQR fallback)
  const startCamera = async () => {
    setCameraError(null);
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
        setCameraError(
          isRtl
            ? "دسترسی به دوربین توسط کاربر یا مرورگر مسدود شده است. لطفاً مجوز دسترسی به دوربین را فعال فرمایید."
            : "Camera permission denied. Please grant camera access in browser settings."
        );
      } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
        setCameraError(
          isRtl
            ? "هیچ دوربینی بر روی این دستگاه یافت نشد. می‌توانید از بارکدخوان USB یا ورود دستی استفاده نمایید."
            : "No camera found on this device. You can use a USB scanner or manual entry."
        );
      } else {
        setCameraError(
          isRtl
            ? "امکان راه‌اندازی دوربین وجود ندارد. می‌توانید از بارکدخوان یا ورود دستی استفاده فرمایید."
            : "Unable to start camera preview. Please use a barcode scanner or manual code entry."
        );
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

      if (!isScanningRef.current) {
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
            const trimmed = detectedValue.trim();
            const now = Date.now();
            // Prevent duplicate submissions from repeated video frames within 3 seconds
            const isDuplicateFrame =
              lastScannedCodeRef.current?.code === trimmed &&
              now - lastScannedCodeRef.current.time < 3000;

            if (!isDuplicateFrame) {
              lastScannedCodeRef.current = { code: trimmed, time: now };
              void processScannedCode(trimmed);
            }
          }
        } catch {
          // ignore detection frame errors
        }
      }

      if (detectionActiveRef.current) {
        setTimeout(() => requestAnimationFrame(checkFrame), 80);
      }
    };

    requestAnimationFrame(checkFrame);
  };

  const copy = scannerCopy[locale];
  const frameProps = { locale, product: copy.product, languageLabel: t.languageToggle, onToggleLocale: toggleLocale };

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
            {unpairNotice ?? copy.deactivatedDefault}
          </p>
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
  const scanningPaused = authBlocked !== null || (authVerdict !== null && !authVerdict.ok);
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
    const trimmed = manualCode.trim();
    if (!trimmed) return;

    // Check if user accidentally pasted a Tracking ID format
    if (
      trimmed.toUpperCase().startsWith("TCK-") ||
      (trimmed.length <= 14 && trimmed.includes("-") && !trimmed.toLowerCase().includes("sec"))
    ) {
      setTrackingIdWarning(
        isRtl
          ? "شناسه وارد شده شماره رهگیری بلیت است، نه رمز کیوآرکد. لطفاً بارکد را مقابل دوربین بگیرید یا مقدار QR Secret را وارد نمایید."
          : "This is a Ticket Reference/Tracking ID. The gate scanner requires the cryptographic QR Secret payload."
      );
      return;
    }

    setTrackingIdWarning(null);
    setManualCode(""); // Immediately clear raw QR secret so it is never displayed/retained
    void processScannedCode(trimmed);
  };

  return (
    <ScannerScreen locale={locale} className="flex flex-col select-none">
      {verdictKind && <div aria-hidden="true" className={`scanner-halo scanner-halo--${verdictKind}`} />}

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
              cameraError={cameraError}
              onStartCamera={startCamera}
              onStopCamera={stopCamera}
              copy={copy}
            >
              {activeResult && <ResultTakeover result={activeResult} t={t} copy={copy} />}
            </Viewfinder>
            <ManualEntry
              copy={copy}
              value={manualCode}
              onChange={(value) => {
                setManualCode(value);
                if (trackingIdWarning) setTrackingIdWarning(null);
              }}
              onSubmit={handleManualSubmit}
              placeholder={
                isRtl
                  ? "ورود دستی سکرت کیوآر بلیت (QR Secret / Payload)..."
                  : "Enter Ticket QR Secret / Payload (not Tracking ID)..."
              }
              submitLabel={t.manualCodeSubmit || (isRtl ? "بررسی ورود" : "Evaluate Code")}
              disabled={scanningPaused}
              warning={trackingIdWarning}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <BufferBar
              locale={locale}
              copy={copy}
              pendingCount={pendingCount}
              isSyncing={isSyncing}
              onSync={flushQueue}
              onRefresh={() => loadManifest(true)}
            />
            <ScanLog scans={recentScans} copy={copy} t={t} />
            {/* Device Settings: unpair without destroying audit trail */}
            <DeviceSettings
              locale={locale}
              copy={copy}
              pointId={pointId}
              unpairNotice={unpairNotice}
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
