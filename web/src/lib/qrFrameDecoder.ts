import jsQR from "jsqr";

export interface NativeQrDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue?: string }[]>;
}

interface NativeQrDetectorClass {
  new (options?: { formats: string[] }): NativeQrDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Copies the current video frame into pixels, or null when it cannot. */
export type FrameGrabber = (video: HTMLVideoElement) => ImageData | null;

/** A QR engine reading pixels; `ready` stays false while it loads and after it breaks. */
export interface ImageQrReader {
  readonly ready: boolean;
  read(image: ImageData): Promise<string | null>;
}

export type QrWorkerRequest = { id: number; image: ImageData };
export type QrWorkerReply =
  | { type: "ready" }
  | { type: "failed" }
  | { type: "result"; id: number; value: string | null }
  | { type: "error"; id: number };

/** An engine that fails this many frames in a row is dropped for the rest of the run. */
const FAILURE_LIMIT = 3;
/** A frame the worker has not answered by then counts as a failure (a hung engine must not stop the scanner). */
const READ_TIMEOUT_MS = 3000;
/** Frames larger than this (a 1080p or 4K stream) are scaled down before decoding. */
const MAX_FRAME_SIDE = 1280;

/**
 * The browser's BarcodeDetector, but only when it says it reads QR codes. Android Chrome exposes the API
 * everywhere while the work is done by a Google Play services module: on a phone without Play services the
 * supported formats come back empty and every detect() fails.
 */
export async function createNativeQrDetector(
  Detector: NativeQrDetectorClass | undefined = (globalThis as { BarcodeDetector?: NativeQrDetectorClass }).BarcodeDetector
): Promise<NativeQrDetector | null> {
  if (!Detector) return null;
  try {
    if (Detector.getSupportedFormats && !(await Detector.getSupportedFormats()).includes("qr_code")) return null;
    return new Detector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/** The size a frame is decoded at: the camera's own, scaled down so its longer side is at most MAX_FRAME_SIDE. */
export function decodeSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(width, height, 1));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function createCanvasFrameGrabber(): FrameGrabber {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return (video) => {
    if (!context || !video.videoWidth || !video.videoHeight) return null;
    const { width, height } = decodeSize(video.videoWidth, video.videoHeight);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.drawImage(video, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  };
}

function readWithJsqr(image: ImageData): string | null {
  return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
}

let sharedZxing: ImageQrReader | null = null;
let sharedZxingBroken = false;

/**
 * ZXing in a Web Worker, shared by every camera on the page and kept between runs, so a restarted camera does
 * not load the engine again. Null where workers or WebAssembly are unavailable (the caller reads with jsQR).
 */
export function zxingWorkerReader(): ImageQrReader | null {
  if (sharedZxing && !sharedZxingBroken) return sharedZxing;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./qrWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  let state: "loading" | "ready" | "broken" = "loading";
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: string | null) => void; reject: (error: Error) => void }>();
  const breakDown = () => {
    state = "broken";
    sharedZxingBroken = true;
    worker.terminate();
    pending.forEach((request) => request.reject(new Error("QR engine stopped")));
    pending.clear();
  };
  worker.addEventListener("error", breakDown);
  worker.addEventListener("message", (event: MessageEvent<QrWorkerReply>) => {
    const reply = event.data;
    if (reply.type === "ready") {
      if (state === "loading") state = "ready";
      return;
    }
    if (reply.type === "failed") {
      breakDown();
      return;
    }
    const request = pending.get(reply.id);
    pending.delete(reply.id);
    if (reply.type === "result") request?.resolve(reply.value);
    else request?.reject(new Error("QR engine could not read the frame"));
  });

  sharedZxingBroken = false;
  sharedZxing = {
    get ready() {
      return state === "ready";
    },
    read(image) {
      if (state !== "ready") return Promise.reject(new Error("QR engine not ready"));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("QR engine timed out"));
        }, READ_TIMEOUT_MS);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        worker.postMessage({ id, image } satisfies QrWorkerRequest, [image.data.buffer]);
      });
    },
  };
  return sharedZxing;
}

/**
 * Decodes camera frames with every engine the device has, so a code is read the same on any phone:
 * 1. the native BarcodeDetector, when it says it reads QR codes (fast, often hardware-assisted);
 * 2. ZXing (WebAssembly in a worker) on every frame the native detector found nothing in: on Android the
 *    detector can list QR support yet return nothing forever (the Play services barcode module never
 *    downloaded), and ZXing reads blurred, tilted, glared and inverted codes far better than jsQR;
 * 3. jsQR on the main thread while ZXing loads, or when it cannot run (no WebAssembly, blocked by policy).
 * An engine that keeps failing is dropped for the rest of the run.
 */
export function createQrFrameDecoder(
  options: { detector?: Promise<NativeQrDetector | null>; reader?: ImageQrReader | null; grabFrame?: FrameGrabber; readFallback?: (image: ImageData) => string | null } = {}
) {
  let native: NativeQrDetector | null | undefined;
  const nativeReady = (options.detector ?? createNativeQrDetector()).then(
    (detector) => {
      native = detector;
    },
    () => {
      native = null;
    }
  );
  let reader = options.reader === undefined ? zxingWorkerReader() : options.reader;
  const grabFrame = options.grabFrame ?? createCanvasFrameGrabber();
  const readFallback = options.readFallback ?? readWithJsqr;
  let nativeFailures = 0;
  let readerFailures = 0;

  return {
    async decode(video: HTMLVideoElement): Promise<string | null> {
      if (native === undefined) await nativeReady;
      if (native) {
        try {
          const codes = await native.detect(video);
          nativeFailures = 0;
          const value = codes.map((code) => code.rawValue?.trim()).find(Boolean);
          if (value) return value;
        } catch {
          nativeFailures += 1;
          if (nativeFailures >= FAILURE_LIMIT) native = null;
        }
      }
      const image = grabFrame(video);
      if (!image) return null;
      if (reader?.ready) {
        try {
          const value = await reader.read(image);
          readerFailures = 0;
          return value?.trim() || null;
        } catch {
          // The frame's pixels went to the worker; the next frame is read again.
          readerFailures += 1;
          if (readerFailures >= FAILURE_LIMIT) reader = null;
          return null;
        }
      }
      return readFallback(image)?.trim() || null;
    },
  };
}
