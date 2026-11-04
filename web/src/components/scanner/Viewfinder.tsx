import type { ReactNode, RefObject } from "react";
import type { ScannerCopy } from "../../copy/scanner";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface ViewfinderProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraActive: boolean;
  cameraError: string | null;
  onStartCamera: () => void;
  onStopCamera: () => void;
  /** Left out when the device has a single camera. */
  onSwitchCamera?: () => void;
  /** null when the camera has no light the page can switch. */
  torchOn?: boolean | null;
  onToggleTorch?: () => void;
  copy: ScannerCopy;
  /** The verdict, laid over everything inside the stage. */
  children?: ReactNode;
}

/** The scanning stage: fills the space it is given; camera preview or the ready state, and the verdict surface. */
export function Viewfinder({ videoRef, cameraActive, cameraError, onStartCamera, onStopCamera, onSwitchCamera, torchOn = null, onToggleTorch, copy, children }: ViewfinderProps) {
  return (
    <section className="scanner-stage" aria-label={copy.ready}>
      {/* Always mounted, so the camera can attach to it at any time. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 h-full w-full object-cover ${cameraActive ? "block" : "hidden"}`}
      />

      {cameraActive ? (
        <>
          <div aria-hidden="true" className="scanner-camera-mask">
            <div className="scanner-camera-window" />
          </div>
          <div className="absolute inset-x-3 bottom-3 z-10 flex items-center justify-between gap-3 rounded-control bg-surface-ink/85 py-1 ps-3 pe-1 text-body-sm">
            <span className="inline-flex items-center gap-2 whitespace-nowrap text-ink-100">
              <span aria-hidden="true" className="size-2 rounded-full bg-status-success-solid" />
              {/* A phone has no room for it beside the camera buttons; the preview itself says the camera is on. */}
              <span className="max-sm:sr-only">{copy.cameraLive}</span>
            </span>
            <span className="flex shrink-0 items-center">
              {torchOn !== null && onToggleTorch && (
                <IconButton
                  icon="flashlight"
                  tone="ink"
                  label={torchOn ? copy.torchOff : copy.torchOn}
                  aria-pressed={torchOn}
                  className="aria-pressed:bg-status-warning-solid aria-pressed:text-black"
                  onClick={onToggleTorch}
                />
              )}
              {onSwitchCamera && <IconButton icon="camera-switch" tone="ink" label={copy.switchCamera} onClick={onSwitchCamera} />}
              <Button type="button" variant="ghost" tone="ink" icon="x" onClick={onStopCamera}>
                <span className="max-[359px]:sr-only">{copy.cameraOff}</span>
              </Button>
            </span>
          </div>
        </>
      ) : (
        <div className="relative z-10 flex h-full flex-col items-center justify-center gap-5 px-6 py-6 text-center">
          <span className="grid size-16 place-items-center rounded-card border border-white/15 bg-white/5" aria-hidden="true">
            <Icon name="qr" size={30} strokeWidth={1.5} />
          </span>
          <p className="text-title-sm font-semibold">{copy.ready}</p>
          <Button type="button" tone="ink" size="lg" icon="camera" onClick={onStartCamera}>
            {copy.cameraOn}
          </Button>
        </div>
      )}

      {cameraError && (
        <div role="status" className="absolute inset-x-3 bottom-3 z-20 flex items-start gap-2 rounded-control bg-status-danger-solid p-3 text-body-sm text-white">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>{cameraError}</span>
        </div>
      )}

      {children}
    </section>
  );
}
