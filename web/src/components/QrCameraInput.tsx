import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { createRepeatFilter } from "../hooks/useHidScanner";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import "../styles/qr-camera.css";

interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<{ rawValue?: string }[]>;
}
interface WindowWithBarcodeDetector extends Window {
  BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorInstance;
}

type CameraState = "off" | "starting" | "live" | "denied" | "unavailable";

interface QrCameraInputProps {
  /** Receives one decoded value per intentional start; the camera stops right after (unless `continuous`). */
  onDecode: (value: string) => void;
  isRtl: boolean;
  /** Turning the camera off from outside (dialog closed, booth or session changed, submitting). */
  disabled?: boolean;
  /**
   * Start the camera on its own, but only when the browser already granted camera permission: the prompt
   * itself still waits for the person to press the button.
   */
  autoStart?: boolean;
  /**
   * Keep the camera running after a decode and hand over every new code (a station scanning one badge after
   * another). The same value is not handed over again until it has been out of view for 3 s.
   */
  continuous?: boolean;
}

/** True when the browser has already been allowed to use the camera (the API is missing or refuses on some browsers). */
async function cameraPermissionGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

/**
 * Opt-in camera input. Requests permission only after the user presses the button, decodes with
 * the native BarcodeDetector or jsQR, hands exactly one value to the caller and releases the
 * camera. Every exit path (decode, stop, unmount, `disabled`) stops all media tracks, including a
 * stream that resolves late. Manual entry elsewhere stays available for every failure. Shared by
 * the exhibitor lead capture and attendee peer networking (both scan an attendee badge QR).
 */
export function QrCameraInput({ onDecode, isRtl, disabled = false, autoStart = false, continuous = false }: QrCameraInputProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(0);
  const [state, setState] = useState<CameraState>("off");
  const onDecodeRef = useRef(onDecode);
  const continuousRef = useRef(continuous);
  const repeatRef = useRef(createRepeatFilter());
  useEffect(() => {
    onDecodeRef.current = onDecode;
    continuousRef.current = continuous;
  }, [onDecode, continuous]);

  // Releases the camera without touching React state (safe in effect cleanups).
  const release = useCallback(() => {
    runRef.current += 1; // invalidates the frame loop and any pending permission request
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setState((current) => (current === "live" || current === "starting" ? "off" : current));
  }, [release]);

  useEffect(() => release, [release]);
  useEffect(() => {
    if (disabled) release();
  }, [disabled, release]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setState("unavailable");
      return;
    }
    const run = ++runRef.current;
    repeatRef.current.reset();
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (error) {
      if (run !== runRef.current) return;
      const name = error instanceof DOMException ? error.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      return;
    }
    if (run !== runRef.current) {
      // Stopped, unmounted or disabled while the permission prompt was open.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      stop();
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay refusal still leaves a usable stream on most browsers; the loop tolerates it.
    }
    if (run !== runRef.current) return;
    setState("live");

    const Detector = (window as WindowWithBarcodeDetector).BarcodeDetector;
    let native: BarcodeDetectorInstance | null = null;
    try {
      native = Detector ? new Detector({ formats: ["qr_code"] }) : null;
    } catch {
      native = null;
    }
    const canvas = native ? null : document.createElement("canvas");
    const context = canvas ? canvas.getContext("2d", { willReadFrequently: true }) : null;

    const tick = async () => {
      if (run !== runRef.current) return;
      const el = videoRef.current;
      if (el && el.readyState >= 2 && el.videoWidth > 0) {
        try {
          let value: string | null = null;
          if (native) {
            const codes = await native.detect(el);
            value = codes[0]?.rawValue ?? null;
          } else if (canvas && context) {
            canvas.width = el.videoWidth;
            canvas.height = el.videoHeight;
            context.drawImage(el, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            value = jsQR(image.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" })?.data ?? null;
          }
          if (run !== runRef.current) return;
          if (value && value.trim()) {
            const code = value.trim();
            if (!continuousRef.current) {
              stop();
              onDecodeRef.current(code);
              return;
            }
            if (repeatRef.current.accept(code, performance.now())) onDecodeRef.current(code);
          }
        } catch {
          // A failed frame is skipped.
        }
      }
      setTimeout(() => requestAnimationFrame(() => void tick()), 100);
    };
    requestAnimationFrame(() => void tick());
  };

  // Runs on mount and whenever the camera is enabled again; a failure or denial leaves the button in place.
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  useEffect(() => {
    if (!autoStart || disabled) return;
    let cancelled = false;
    void cameraPermissionGranted().then((granted) => {
      if (granted && !cancelled) void startRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [autoStart, disabled]);

  const view: CameraState = disabled && (state === "live" || state === "starting") ? "off" : state;
  const message: Record<CameraState, string> = {
    off: "",
    starting: isRtl ? "در انتظار مجوز دوربین..." : "Waiting for camera permission...",
    live: isRtl ? "کد QR کارت شرکت‌کننده را مقابل دوربین بگیرید." : "Hold the attendee's badge QR in front of the camera.",
    denied: isRtl ? "دسترسی به دوربین داده نشد. کد را دستی وارد کنید." : "Camera permission was denied. Enter the code manually.",
    unavailable: isRtl ? "دوربین در دسترس نیست (یا اتصال امن نیست). کد را دستی وارد کنید." : "No usable camera (or the page is not secure). Enter the code manually.",
  };

  const active = view === "live" || view === "starting";
  const failed = view === "denied" || view === "unavailable";
  const toggle = active ? (
    <Button type="button" variant="light" size="md" onClick={stop} className="min-w-[10rem]">
      <Icon name="x" size={16} />
      <span>{isRtl ? "بستن دوربین" : "Stop camera"}</span>
    </Button>
  ) : (
    <Button type="button" variant="light" size="md" disabled={disabled} onClick={() => void start()} className="min-w-[10rem]">
      <Icon name="camera" size={18} className="text-aiteb-indigo" />
      <span>{isRtl ? "اسکن با دوربین" : "Scan with camera"}</span>
    </Button>
  );

  return (
    <div className="space-y-2">
      <div className="qr-viewfinder relative overflow-hidden rounded-2xl bg-surface-ink bg-meridian-ink">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label={isRtl ? "پیش‌نمایش دوربین" : "Camera preview"}
          className={`block aspect-[4/3] max-h-64 w-full bg-black object-cover ${view === "live" ? "" : "hidden"}`}
        />
        {view === "live" ? (
          <>
            <span aria-hidden="true" className="qr-viewfinder__sweep pointer-events-none absolute inset-x-8 inset-y-6 motion-safe:animate-sweep" />
            <div className="absolute inset-x-0 bottom-3 flex justify-center">{toggle}</div>
          </>
        ) : (
          <div className="flex min-h-[156px] flex-col items-center justify-center gap-3.5 px-5 py-6 text-center">
            <span aria-hidden="true" className="relative grid size-12 place-items-center rounded-full border border-white/15 text-white">
              {view === "starting" && <span className="absolute inset-0 rounded-full border border-aiteb-orchid/70 motion-safe:animate-pulse-ring" />}
              <Icon name={failed ? "alert" : "qr"} size={22} className={failed ? "text-status-warning-solid" : ""} />
            </span>
            {toggle}
          </div>
        )}
        <span aria-hidden="true" className="qr-viewfinder__corners pointer-events-none absolute inset-3" />
      </div>
      {message[view] && (
        <p
          role={failed ? "alert" : "status"}
          className={`flex items-start gap-2 text-xs leading-relaxed ${failed ? "rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-status-warning-text" : "text-text-secondary"}`}
        >
          {failed && <Icon name="info" size={15} className="mt-px shrink-0" />}
          <span>{message[view]}</span>
        </p>
      )}
    </div>
  );
}
