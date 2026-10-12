import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Button } from "../ui/Button";

interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<{ rawValue?: string }[]>;
}
interface WindowWithBarcodeDetector extends Window {
  BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorInstance;
}

type CameraState = "off" | "starting" | "live" | "denied" | "unavailable";

interface QrCameraInputProps {
  /** Receives one decoded value per intentional start; the camera stops right after. */
  onDecode: (value: string) => void;
  isRtl: boolean;
  /** Turning the camera off from outside (dialog closed, booth or session changed). */
  disabled?: boolean;
}

/**
 * Opt-in camera input. Requests permission only after the user presses the button, decodes with
 * the native BarcodeDetector or jsQR, hands exactly one value to the caller and releases the
 * camera. Every exit path (decode, stop, unmount, `disabled`) stops all media tracks, including a
 * stream that resolves late. Manual entry elsewhere stays available for every failure.
 */
export function QrCameraInput({ onDecode, isRtl, disabled = false }: QrCameraInputProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(0);
  const [state, setState] = useState<CameraState>("off");
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

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
            stop();
            onDecodeRef.current(value.trim());
            return;
          }
        } catch {
          // A failed frame is skipped.
        }
      }
      setTimeout(() => requestAnimationFrame(() => void tick()), 100);
    };
    requestAnimationFrame(() => void tick());
  };

  const view: CameraState = disabled && (state === "live" || state === "starting") ? "off" : state;
  const message: Record<CameraState, string> = {
    off: "",
    starting: isRtl ? "در انتظار مجوز دوربین..." : "Waiting for camera permission...",
    live: isRtl ? "کیوآر کارت شرکت‌کننده را مقابل دوربین بگیرید." : "Hold the attendee's badge QR in front of the camera.",
    denied: isRtl ? "دسترسی به دوربین داده نشد. کد را دستی وارد کنید." : "Camera permission was denied. Enter the code manually.",
    unavailable: isRtl ? "دوربین در دسترس نیست (یا اتصال امن نیست). کد را دستی وارد کنید." : "No usable camera (or the page is not secure). Enter the code manually.",
  };

  return (
    <div className="space-y-2">
      {view === "live" || view === "starting" ? (
        <Button type="button" variant="secondary" size="md" isFullWidth onClick={stop}>
          {isRtl ? "بستن دوربین" : "Stop camera"}
        </Button>
      ) : (
        <Button type="button" variant="secondary" size="md" isFullWidth disabled={disabled} onClick={() => void start()}>
          <span aria-hidden="true">📷</span>
          <span>{isRtl ? "اسکن با دوربین" : "Scan with camera"}</span>
        </Button>
      )}
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label={isRtl ? "پیش‌نمایش دوربین" : "Camera preview"}
        className={`w-full max-h-64 rounded-xl bg-black object-cover ${view === "live" ? "" : "hidden"}`}
      />
      {message[view] && (
        <p role={view === "denied" || view === "unavailable" ? "alert" : "status"} className="text-xs text-text-secondary">
          {message[view]}
        </p>
      )}
    </div>
  );
}
