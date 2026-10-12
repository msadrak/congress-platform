import { useEffect, useRef, useState } from "react";
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

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement | ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}

interface WindowWithBarcodeDetector extends Window {
  BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorInstance;
}

export default function GateScanner() {
  const { pointId } = useParams<{ pointId: string }>();
  const { locale, setLocale, t, isRtl, dir } = useAttendeeLocale();
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
  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-neutral-400">Loading gate manifest snapshot...</p>
        </div>
      </div>
    );
  }

  if (deactivationPending) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-neutral-800 p-6 rounded-2xl border border-red-800/60 text-center space-y-4">
          <h1 className="text-lg font-bold text-red-200">Scanner Deactivated</h1>
          <p role="alert" className="text-xs text-amber-200">
            {unpairNotice ??
              "This browser is locally disabled. Server revocation is not confirmed. No attendee data or admissions are available here; scan and conflict records remain stored for supervisor recovery."}
          </p>
          <p className="text-xs text-neutral-300">
            {pendingCount} unsynced scan(s) remain on this device.
            {!isOnline && " Reconnect before retrying server revocation."}
          </p>
          {persistedCredential?.token && (
            <button
              type="button"
              disabled={unpairing || !isOnline}
              onClick={handleUnpair}
              className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold py-2.5 px-4 rounded-xl"
            >
              {unpairing ? "Revoking…" : "Retry Server Revocation"}
            </button>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!pointId || !tokenInput.trim()) return;
              await storeCredential(tokenInput.trim());
              setTokenInput("");
              setInitError(null);
              setAuthBlocked(null);
              await loadManifest(true);
            }}
            className="pt-2 text-left space-y-2 border-t border-neutral-700/60"
          >
            <label className="block text-[11px] font-semibold text-neutral-300 uppercase tracking-wider">
              Supervisor Re-pair
            </label>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste a newly issued scanner token..."
              autoComplete="off"
              className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-xl text-xs text-white font-mono"
            />
            <button
              type="submit"
              disabled={!tokenInput.trim()}
              className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold py-2.5 px-4 rounded-xl"
            >
              Pair Fresh Supervisor Token
            </button>
          </form>
          <Link to="/organizer" className="block text-xs text-neutral-400 hover:text-white">
            ← Back to Organizer Console
          </Link>
        </div>
      </div>
    );
  }

  if (initError || !manifest) {
    const authTitle =
      authBlocked?.kind === "REVOKED"
        ? "Device Deauthorized"
        : authBlocked?.kind === "FORBIDDEN"
          ? "Wrong Check-In Point"
          : authBlocked?.kind === "EXPIRED"
            ? "Credential Expired"
            : "Check-In Point Unavailable";
    const authHint =
      authBlocked?.kind === "REVOKED"
        ? `This device was revoked by the organizer. Ask a supervisor for a fresh scanner token, then re-pair below. ${pendingCount} unsynced scan(s) preserved on this device for recovery.`
        : authBlocked?.kind === "FORBIDDEN"
          ? "This token is not authorized for this check-in point or event. Confirm the gate URL with a supervisor, then re-pair with the correct token."
          : authBlocked?.kind === "EXPIRED"
            ? "The scanner credential has expired. Ask a supervisor for a fresh token, then re-pair below."
            : null;
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-neutral-800 p-6 rounded-2xl border border-neutral-700 text-center space-y-4">
          <div className="text-3xl">⚠️</div>
          <h1 className="text-lg font-bold">{authTitle}</h1>
          <p className="text-xs text-neutral-400">{authBlocked?.message ?? initError ?? "Manifest not found."}</p>
          {authHint && <p className="text-xs text-amber-200/90">{authHint}</p>}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!pointId || !tokenInput.trim()) return;
              await storeCredential(tokenInput.trim());
              setTokenInput("");
              setInitError(null);
              setAuthBlocked(null);
              await loadManifest(true);
            }}
            className="pt-2 text-left space-y-2 border-t border-neutral-700/60"
          >
            <label className="block text-[11px] font-semibold text-neutral-300 uppercase tracking-wider">
              Pair Scanner Device
            </label>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste device scanner token..."
              autoComplete="off"
              className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-hidden focus:border-emerald-500 font-mono"
            />
            <button
              type="submit"
              disabled={!tokenInput.trim()}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition"
            >
              🔐 Authorize This Device
            </button>
          </form>
          <div className="pt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => loadManifest(true)}
              className="w-full bg-neutral-700 hover:bg-neutral-600 text-white text-xs font-semibold py-2 px-4 rounded-xl transition"
            >
              Retry Connection
            </button>
            <Link
              to="/organizer"
              className="text-xs text-neutral-400 hover:text-white pt-1"
            >
              ← Back to Organizer Console
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const point = manifest.checkin_point;

  return (
    <div dir={dir} lang={locale} className={`min-h-screen bg-neutral-950 text-white flex flex-col font-sans select-none ${isRtl ? "text-start font-sans" : "text-start font-sans"}`}>
      {/* Top Header Bar */}
      <header className="bg-neutral-900/95 border-b border-neutral-800 px-3 sm:px-4 py-3 sticky top-0 z-20 backdrop-blur-xs flex flex-wrap items-center justify-between gap-3 max-w-full overflow-hidden">
        <div className="space-y-0.5 min-w-0 max-w-[200px] sm:max-w-xs">
          <div className="flex items-center gap-2">
            <h1 className="font-extrabold text-sm sm:text-base tracking-tight truncate">
              {point.name}
            </h1>
            <span
              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${
                point.policy_type === "SINGLE_USE"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : point.policy_type === "TIER_RESTRICTED"
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                  : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
              }`}
            >
              {point.policy_type}
            </span>
          </div>
          <p className="text-[11px] text-neutral-400 truncate">
            📍 {point.location || (isRtl ? "درب اصلی" : "General Access")} • {Object.keys(ticketMap).length} {isRtl ? "کارت در حافظه" : "in cache"}
          </p>
        </div>

        {/* Controls: Language, Sync & Sound */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleLocale}
            className="text-xs font-semibold px-2 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 transition cursor-pointer"
            aria-label={isRtl ? "Switch to English" : "تغییر زبان به فارسی"}
          >
            🌐 {t.languageToggle}
          </button>

          {conflicts.length > 0 && (
            <button
              type="button"
              onClick={() => setShowConflictDrawer(true)}
              className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-red-950/90 text-red-300 border border-red-700/80 animate-pulse hover:bg-red-900 transition cursor-pointer"
              title={t.conflictsHeading}
            >
              <span>⚠️</span>
              <span>{conflicts.length} {isRtl ? "تداخل" : "Conflicts"}</span>
            </button>
          )}

          <div
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
              isOnline
                ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/60"
                : "bg-amber-950/60 text-amber-400 border-amber-800/60"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isOnline ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
              }`}
            />
            <span>{isOnline ? (isRtl ? "آنلاین" : "Online") : (isRtl ? "آفلاین" : "Offline")}</span>
            {pendingCount > 0 && (
              <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
            {syncFailCount > 0 && (
              <span className="text-[10px] bg-red-900/60 text-red-300 px-1.5 py-0.5 rounded-full">
                ⚠ {syncFailCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSoundEnabled((prev) => !prev)}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs cursor-pointer"
            title={soundEnabled ? "Mute audio chimes" : "Enable audio chimes"}
          >
            {soundEnabled ? "🔔" : "🔕"}
          </button>
        </div>
      </header>
      {/* Authorization state banner: definitive rejects + offline-window expiry.
          Records are preserved in both cases; only NEW admissions stop. */}
      {authBlocked && (
        <div
          role="alert"
          className="bg-red-950/90 border-b border-red-800/60 px-4 py-2.5 text-xs space-y-1"
        >
          <p className="text-red-200 font-bold">
            ⛔ Scanning paused —{" "}
            {authBlocked.kind === "REVOKED"
              ? "device deauthorized"
              : authBlocked.kind === "FORBIDDEN"
                ? "wrong check-in point"
                : "credential expired"}
          </p>
          <p className="text-red-300/90">{authBlocked.message}</p>
          <p className="text-red-300/70">
            {pendingCount} unsynced scan(s) preserved. Ask a supervisor for a fresh token, then re-pair
            from the Unpair section below — your queued records are kept.
          </p>
        </div>
      )}
      {!authBlocked && authVerdict && !authVerdict.ok && (
        <div
          role="alert"
          className="bg-amber-950/90 border-b border-amber-800/60 px-4 py-2.5 text-xs space-y-1"
        >
          <p className="text-amber-200 font-bold">
            ⏸ Offline window expired — new admissions paused
          </p>
          <p className="text-amber-300/90">
            {authVerdict.reason === "TOKEN_EXPIRED"
              ? "The scanner credential has expired. Reconnect and re-pair for a fresh token."
              : "The cached manifest is older than 24h. Reconnect to refresh it."}{" "}
            {pendingCount} unsynced scan(s) preserved.
          </p>
        </div>
      )}
      {!authBlocked && (!authVerdict || authVerdict.ok) && manifestCachedAt && (
        <div className="bg-neutral-900/60 border-b border-neutral-800/60 px-4 py-1 text-[11px] text-neutral-500">
          Manifest {isOnline ? "synced" : "cached"} {new Date(manifestCachedAt).toLocaleTimeString()}
          {authVerdict && authVerdict.ok && authVerdict.reason === "WITHIN_WINDOW" && !isOnline && (
            <span> • offline window {formatRemainingWindow(authVerdict.remainingMs)} left</span>
          )}
        </div>
      )}

      {/* Main Scanner Body */}
      <main className="flex-1 max-w-2xl w-full mx-auto p-4 flex flex-col justify-between gap-4">
        {/* Scanner Viewfinder Area */}
        <div className="relative bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden aspect-4/3 sm:aspect-16/10 flex flex-col items-center justify-center shadow-2xl">
          {/* Video element always mounted so videoRef is always accessible */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${cameraActive ? "block" : "hidden"}`}
          />

          {!cameraActive && (
            <div className="text-center p-6 space-y-4">
              <div className="text-4xl animate-bounce">⚡</div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-neutral-200">
                  {isRtl ? "آماده دریافت بارکدخوان سخت‌افزاری" : "Hardware Scanner Listening"}
                </p>
                <p className="text-xs text-neutral-400 max-w-xs mx-auto">
                  {isRtl
                    ? "بارکدخوان تفنگی USB یا بلوتوث را به سمت بلیت نشانه بگیرید؛ یا دوربین دستگاه را فعال کنید."
                    : "Aim any USB or Bluetooth 2D barcode gun at an attendee badge, or enable device camera."}
                </p>
              </div>
              <button
                type="button"
                onClick={startCamera}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 px-4 rounded-xl transition shadow-lg cursor-pointer"
              >
                📷 {isRtl ? "فعال‌سازی دوربین دستگاه" : "Enable Device Camera"}
              </button>
            </div>
          )}
          {cameraActive && (
            <>
              {/* Reticle Overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-52 h-52 border-2 border-emerald-500/80 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                  <div className="absolute top-1/2 left-2 right-2 h-0.5 bg-emerald-400/90 animate-pulse" />
                </div>
              </div>

              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[11px] bg-neutral-950/80 backdrop-blur-xs px-3 py-1.5 rounded-xl border border-neutral-800">
                <span className="text-neutral-300">Camera active (sub-80ms decode)</span>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="text-neutral-400 hover:text-white"
                >
                  Turn off camera ✕
                </button>
              </div>
            </>
          )}

          {cameraError && (
            <div className="absolute inset-x-3 bottom-3 p-2.5 bg-red-950/90 border border-red-800 rounded-xl text-[11px] text-red-200 text-center">
              {cameraError}
            </div>
          )}

          {/* Flash Feedback Overlay (Renders full-screen over the viewfinder upon scan) */}
          {activeResult && (
            <div
              role="alert"
              aria-live="assertive"
              className={`absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center animate-in zoom-in-95 duration-100 ${
                activeResult.status === "ADMITTED"
                  ? activeResult.is_provisional
                    ? "bg-amber-500 text-neutral-950"
                    : "bg-emerald-600 text-white"
                  : "bg-red-600 text-white"
              }`}
            >
              <div className="text-6xl mb-2">
                {activeResult.status === "ADMITTED"
                  ? activeResult.is_provisional
                    ? "⏳"
                    : "✓"
                  : "✕"}
              </div>
              <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-wider">
                {activeResult.status === "ADMITTED"
                  ? activeResult.is_provisional
                    ? t.statusProvisionalAdmitted
                    : t.statusConfirmedAdmitted
                  : t.statusRejected}
              </h2>

              {activeResult.ticket ? (
                <div className="mt-3 space-y-1">
                  <p className="text-xl sm:text-2xl font-bold">
                    {activeResult.ticket.attendee_name}
                  </p>
                  <p className="text-xs sm:text-sm font-semibold opacity-90">
                    {t.tierLabel}: {activeResult.ticket.ticket_tier_name}
                  </p>
                </div>
              ) : null}

              {activeResult.rejection_reason && (
                <div className="mt-3 bg-black/25 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold uppercase tracking-wider">
                  {activeResult.rejection_reason === "ALREADY_ADMITTED"
                    ? t.reasonAlreadyAdmitted
                    : activeResult.rejection_reason === "CAPACITY_REACHED"
                    ? t.reasonCapacityReached
                    : activeResult.rejection_reason === "TIER_NOT_ALLOWED"
                    ? t.reasonTierNotAllowed
                    : activeResult.rejection_reason === "SCAN_ID_CONFLICT"
                    ? t.reasonScanConflict
                    : activeResult.rejection_reason === "NOT_IN_LOCAL_MANIFEST"
                    ? t.reasonNotInManifest
                    : activeResult.rejection_reason === "CAPACITY_UNAVAILABLE_OFFLINE"
                    ? t.reasonCapacityOffline
                    : t.reasonInvalidTicket}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Manual QR / Ticket Code Entry */}
        <form
          onSubmit={(e) => {
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
          }}
          className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3 flex flex-col gap-2 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => {
                  setManualCode(e.target.value);
                  if (trackingIdWarning) setTrackingIdWarning(null);
                }}
                placeholder={
                  isRtl
                    ? "ورود دستی سکرت کیوآر بلیت (QR Secret / Payload)..."
                    : "Enter Ticket QR Secret / Payload (not Tracking ID)..."
                }
                disabled={authBlocked !== null || (authVerdict !== null && !authVerdict.ok)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                dir="ltr"
                className="w-full bg-neutral-950 border border-neutral-800 text-white placeholder-neutral-500 text-xs sm:text-sm rounded-xl px-3 py-2 font-mono focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={!manualCode.trim() || authBlocked !== null || (authVerdict !== null && !authVerdict.ok)}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-xs sm:text-sm font-bold px-4 py-2 rounded-xl transition cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
            >
              {t.manualCodeSubmit || (isRtl ? "بررسی ورود" : "Evaluate Code")}
            </button>
          </div>
          {trackingIdWarning ? (
            <p className="text-[11px] text-amber-300 bg-amber-950/60 border border-amber-800/60 rounded-lg p-2 leading-relaxed">
              ⚠️ {trackingIdWarning}
            </p>
          ) : (
            <p className="text-[11px] text-neutral-400 px-1 leading-relaxed">
              {isRtl
                ? "ℹ️ توجه: جهت ورود دستی، مقدار رمزشده داخل بارکد (QR Secret) الزامی است. شناسه رهگیری عمومی بلیت (Tracking ID) به عنوان کلید ورود معتبر نیست."
                : "ℹ️ Note: Manual admission requires the cryptographic QR Secret payload. Public Ticket Tracking IDs cannot authorize entry."}
            </p>
          )}
        </form>

        {/* Sync Status Controls & Recent Scans Feed */}
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
            <span>
              Offline Buffer: <strong className="text-white">{pendingCount}</strong> scans queued
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isSyncing || pendingCount === 0}
                onClick={flushQueue}
                className="hover:text-white disabled:opacity-40 transition font-medium"
              >
                {isSyncing ? "Syncing..." : "Sync Queue Now ↗"}
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => loadManifest(true)}
                className="hover:text-white transition font-medium"
              >
                Refresh Cache ↻
              </button>
            </div>
          </div>

          {/* Recent Scans Feed */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              Recent Scans at this Gate
            </h3>
            {recentScans.length === 0 ? (
              <p className="text-xs text-neutral-600 py-3 text-center">
                Ready for attendees. No scans recorded yet.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {recentScans.map((s) => (
                  <div
                    key={s.scan_id}
                    className="text-xs p-2 rounded-lg bg-neutral-950/60 border border-neutral-800 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          s.status === "ADMITTED" ? "bg-emerald-500" : "bg-red-500"
                        }`}
                      />
                      <span className="font-mono text-[11px] text-neutral-400">
                        {s.qr_secret.slice(0, 8)}…
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px]">
                      <span
                        className={`font-bold ${
                          s.status === "ADMITTED" ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {s.status}
                        {s.rejection_reason ? ` (${s.rejection_reason})` : ""}
                      </span>
                      <span className="text-neutral-500 text-[10px]">
                        {new Date(s.scanned_at).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Device Settings: unpair without destroying audit trail */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
            Device Settings
          </h3>
          <p className="text-[11px] text-neutral-500">
            Unpairing disables this browser immediately. Online unpairing revokes the server
            credential only after queued scans are reconciled; offline or failed revocation
            remains visibly pending and retains the credential and recovery records.
          </p>
          {unpairNotice && (
            <p role="status" className="text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-xl px-3 py-2">
              {unpairNotice}
            </p>
          )}
          {!showUnpairConfirm ? (
            <button
              type="button"
              onClick={() => setShowUnpairConfirm(true)}
              className="w-full bg-neutral-800 hover:bg-neutral-700 text-red-300 text-xs font-bold py-2.5 px-4 rounded-xl transition border border-neutral-700"
            >
              🔓 Unpair This Scanner
            </button>
          ) : (
            <div className="space-y-2 border border-red-800/60 bg-red-950/30 rounded-xl p-3">
              <p className="text-[11px] text-red-200 font-semibold">
                Unpair this device? Admissions stop immediately.{" "}
                {pendingCount > 0
                  ? `${pendingCount} unsynced scan(s) must be recovered before server revocation.`
                  : "The credential is retained until the server confirms revocation."}{" "}
                {!navigator.onLine &&
                  "You are offline, so this action can only disable this browser; the server may still accept the credential."}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={unpairing}
                  onClick={handleUnpair}
                  className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold py-2 px-4 rounded-xl transition"
                >
                  {unpairing ? "Unpairing…" : "Confirm Unpair"}
                </button>
                <button
                  type="button"
                  disabled={unpairing}
                  onClick={() => setShowUnpairConfirm(false)}
                  className="flex-1 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-200 text-xs font-bold py-2 px-4 rounded-xl transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      {/* Conflict Review Drawer */}
      {showConflictDrawer && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Sync conflict review">
          <div className="w-full max-w-lg bg-neutral-900 border border-neutral-700 rounded-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Sync Reconciliation Conflicts</h2>
              <button
                type="button"
                onClick={() => setShowConflictDrawer(false)}
                className="text-neutral-400 hover:text-white text-xs px-2 py-1"
              >
                Close ✕
              </button>
            </div>
            <p className="text-[11px] text-neutral-400">
              The server rejected these scans (e.g. admitted at another gate). Records are
              preserved for audit — acknowledging only marks them reviewed.
            </p>
            <div className="space-y-2">
              {conflicts.map((c) => (
                <div key={c.scan_id} className="bg-neutral-950/60 border border-red-800/50 rounded-xl p-3 space-y-1">
                  <p className="text-xs font-bold text-red-200">
                    {c.attendee_name ?? c.qr_secret.slice(0, 8)} — {c.rejection_reason ?? "SERVER_REJECTED"}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    Scanned {new Date(c.scanned_at).toLocaleString()}
                    {c.reconciled_at ? ` • reconciled ${new Date(c.reconciled_at).toLocaleString()}` : ""}
                  </p>
                  {!c.conflict_acknowledged ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await acknowledgeConflict(c.scan_id);
                        const updated = await getConflictsForPoint(pointId ?? "");
                        setConflicts(updated);
                      }}
                      className="text-[11px] bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold px-3 py-1.5 rounded-lg transition"
                    >
                      Acknowledge Conflict ✓
                    </button>
                  ) : (
                    <span className="text-[11px] text-neutral-500">Acknowledged ✓</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}
