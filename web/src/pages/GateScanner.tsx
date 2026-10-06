import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatApiError, getApiClient, type CheckInManifest } from "../api/client";
import { playErrorBuzz, playSuccessChime } from "../lib/audioFeedback";
import {
  evaluateLocalScan,
  type LocalPolicyConfig,
  type LocalScanResult,
  type LocalTicket,
} from "../lib/scannerEngine";
import {
  getCachedManifest,
  getUnsyncedScans,
  markScansSyncedInDb,
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hidBufferRef = useRef<string>("");
  const hidLastKeyTimeRef = useRef<number>(0);
  const isScanningRef = useRef<boolean>(false);

  const [manifest, setManifest] = useState<CheckInManifest | null>(null);
  const [ticketMap, setTicketMap] = useState<Record<string, LocalTicket>>({});
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // Connectivity and sync states
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Audio mute state
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Current flash evaluation result
  const [activeResult, setActiveResult] = useState<LocalScanResult | null>(null);

  // Recent audit feed
  const [recentScans, setRecentScans] = useState<QueuedScan[]>([]);

  // 1. Initial Load: Load from IndexedDB cache first, then refresh from live server if online
  const loadManifest = async (forceRefresh = false) => {
    if (!pointId) return;
    setLoading(true);

    // Try IndexedDB cache first
    const cached = await getCachedManifest(pointId);
    if (cached && typeof cached === "object" && "checkin_point" in cached) {
      const casted = cached as CheckInManifest;
      setManifest(casted);
      buildTicketMap(casted);
      setLoading(false);
    }

    // Refresh from live server if online or forced
    if (navigator.onLine || forceRefresh) {
      try {
        const client = getApiClient(null);
        const { data, error: err } = await client.GET(
          "/api/checkin-points/{point_id}/manifest",
          {
            params: { path: { point_id: pointId } },
          }
        );
        if (data) {
          setManifest(data);
          buildTicketMap(data);
          await saveCachedManifest(pointId, data);
          setInitError(null);
        } else if (err && !cached) {
          setInitError(formatApiError(err));
        }
      } catch (e) {
        if (!cached) {
          setInitError("Failed to connect to event server.");
        }
      }
    }

    setLoading(false);
    updatePendingCount();
  };

  const buildTicketMap = (m: CheckInManifest) => {
    const map: Record<string, LocalTicket> = {};
    for (const t of m.tickets) {
      map[t.qr_secret.toLowerCase()] = {
        qr_secret: t.qr_secret,
        ticket_id: t.ticket_id,
        attendee_name: t.attendee_name,
        ticket_tier_id: t.ticket_tier_id,
        ticket_tier_name: t.ticket_tier_name,
        is_admitted: t.is_admitted,
        admission_count: t.admission_count,
      };
    }
    setTicketMap(map);
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

  // 2. Background queue flush
  const flushQueue = async () => {
    if (!pointId || isSyncing || !navigator.onLine) return;
    const unsynced = await getUnsyncedScans(pointId);
    if (unsynced.length === 0) return;

    setIsSyncing(true);
    try {
      const client = getApiClient(null);
      const payload = {
        scans: unsynced.map((s) => ({
          scan_id: s.scan_id,
          qr_secret: s.qr_secret,
          scanned_at: s.scanned_at,
        })),
      };

      const { data } = await client.POST(
        "/api/checkin-points/{point_id}/scans/batch",
        {
          params: { path: { point_id: pointId } },
          body: payload,
        }
      );

      if (data) {
        const syncedIds = unsynced.map((s) => s.scan_id);
        await markScansSyncedInDb(syncedIds);
        updatePendingCount();
      }
    } catch {
      // Sync retry on next interval
    } finally {
      setIsSyncing(false);
    }
  };

  // 3. Central Scan Processor (Evaluates locally in <10ms, triggers audio/visual, queues to IndexedDB)
  const processScannedCode = async (rawCode: string) => {
    if (!pointId || !manifest || isScanningRef.current) return;
    const cleanSecret = rawCode.trim().toLowerCase();
    if (!cleanSecret) return;

    isScanningRef.current = true;

    const policy: LocalPolicyConfig = {
      policy_type: manifest.checkin_point.policy_type as LocalPolicyConfig["policy_type"],
      allowed_tier_ids: manifest.checkin_point.allowed_tier_ids,
      max_capacity: manifest.checkin_point.max_capacity,
    };

    const result = evaluateLocalScan(ticketMap, policy, cleanSecret);
    setActiveResult(result);

    // Sound feedback
    if (soundEnabled) {
      if (result.status === "ADMITTED") {
        playSuccessChime();
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
    };

    await saveQueuedScan(scanRecord);
    setRecentScans((prev) => [scanRecord, ...prev.slice(0, 9)]);
    updatePendingCount();

    // Auto-flush immediately if online
    if (navigator.onLine) {
      flushQueue();
    }

    // Auto-clear active flash after 1.8 seconds
    setTimeout(() => {
      setActiveResult(null);
      isScanningRef.current = false;
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

  // 5. Mobile Camera BarcodeDetector Loop
  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        startDetectionLoop();
      }
    } catch (err) {
      setCameraError(
        "Camera permission denied or camera not available. You can still use a USB barcode scanner."
      );
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startDetectionLoop = () => {
    const win = window as WindowWithBarcodeDetector;
    const hasDetector = typeof win.BarcodeDetector !== "undefined";

    if (!hasDetector) {
      setCameraError(
        "Native BarcodeDetector not available in this browser. Please use USB laser scanner or Chrome Android/iOS Safari."
      );
      return;
    }

    const detector = new win.BarcodeDetector!({ formats: ["qr_code"] });

    let active = true;
    const checkFrame = async () => {
      if (!active || !videoRef.current || videoRef.current.readyState < 2) {
        if (active) requestAnimationFrame(checkFrame);
        return;
      }

      if (!isScanningRef.current) {
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length > 0 && codes[0].rawValue) {
            processScannedCode(codes[0].rawValue);
          }
        } catch {
          // ignore detection frame error
        }
      }

      if (active) {
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

  if (initError || !manifest) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-neutral-800 p-6 rounded-2xl border border-neutral-700 text-center space-y-4">
          <div className="text-3xl">⚠️</div>
          <h1 className="text-lg font-bold">Check-In Point Unavailable</h1>
          <p className="text-xs text-neutral-400">{initError ?? "Manifest not found."}</p>
          <div className="pt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => loadManifest(true)}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition"
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
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col font-sans select-none">
      {/* Top Header Bar */}
      <header className="bg-neutral-900/90 border-b border-neutral-800 px-4 py-3 sticky top-0 z-20 backdrop-blur-xs flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h1 className="font-extrabold text-base tracking-tight truncate max-w-[200px] sm:max-w-xs">
              {point.name}
            </h1>
            <span
              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
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
          <p className="text-[11px] text-neutral-400">
            📍 {point.location || "General Access"} • {Object.keys(ticketMap).length} tickets in local cache
          </p>
        </div>

        {/* Sync & Connectivity Status */}
        <div className="flex items-center gap-2">
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
            <span>{isOnline ? "Online" : "Offline"}</span>
            {pendingCount > 0 && (
              <span className="ml-1 text-[10px] bg-neutral-800 px-1.5 py-0.2 rounded-full">
                {pendingCount} queued
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setSoundEnabled((prev) => !prev)}
            className="p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs"
            title={soundEnabled ? "Mute audio chimes" : "Enable audio chimes"}
          >
            {soundEnabled ? "🔔" : "🔕"}
          </button>
        </div>
      </header>

      {/* Main Scanner Body */}
      <main className="flex-1 max-w-2xl w-full mx-auto p-4 flex flex-col justify-between gap-4">
        {/* Scanner Viewfinder Area */}
        <div className="relative bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden aspect-4/3 sm:aspect-16/10 flex flex-col items-center justify-center shadow-2xl">
          {cameraActive ? (
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-center p-6 space-y-4">
              <div className="text-4xl animate-bounce">⚡</div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-neutral-200">
                  Hardware Scanner Listening
                </p>
                <p className="text-xs text-neutral-400 max-w-xs mx-auto">
                  Aim any USB or Bluetooth 2D barcode gun at an attendee badge and press trigger.
                </p>
              </div>
              <button
                type="button"
                onClick={startCamera}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 px-4 rounded-xl transition shadow-lg"
              >
                📷 Enable Device Camera
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
              className={`absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center animate-in zoom-in-95 duration-100 ${
                activeResult.status === "ADMITTED"
                  ? "bg-emerald-600 text-white"
                  : "bg-red-600 text-white"
              }`}
            >
              <div className="text-6xl mb-2">
                {activeResult.status === "ADMITTED" ? "✓" : "✕"}
              </div>
              <h2 className="text-3xl font-black uppercase tracking-wider">
                {activeResult.status === "ADMITTED" ? "ADMITTED" : "REJECTED"}
              </h2>

              {activeResult.ticket ? (
                <div className="mt-3 space-y-1">
                  <p className="text-2xl font-bold">
                    {activeResult.ticket.attendee_name}
                  </p>
                  <p className="text-sm font-semibold opacity-90">
                    Tier: {activeResult.ticket.ticket_tier_name}
                  </p>
                </div>
              ) : null}

              {activeResult.rejection_reason && (
                <div className="mt-4 bg-black/25 px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-wider">
                  Reason: {activeResult.rejection_reason.replace(/_/g, " ")}
                </div>
              )}
            </div>
          )}
        </div>

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
      </main>
    </div>
  );
}
