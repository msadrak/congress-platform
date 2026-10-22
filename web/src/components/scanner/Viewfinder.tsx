import type { ReactNode, RefObject } from "react";
import { Icon } from "../ui/Icon";
import type { ScannerCopy } from "./copy";

interface ViewfinderProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraActive: boolean;
  cameraError: string | null;
  onStartCamera: () => void;
  onStopCamera: () => void;
  copy: ScannerCopy;
  /** Result takeover, rendered above everything inside the stage. */
  children?: ReactNode;
}

function Brackets({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`scanner-brackets ${className}`.trim()}>
      <span className="scanner-bracket scanner-bracket--ss" />
      <span className="scanner-bracket scanner-bracket--se" />
      <span className="scanner-bracket scanner-bracket--es" />
      <span className="scanner-bracket scanner-bracket--ee" />
    </div>
  );
}

/** The scanning stage: reticle target, camera preview and the verdict surface. */
export function Viewfinder({ videoRef, cameraActive, cameraError, onStartCamera, onStopCamera, copy, children }: ViewfinderProps) {
  return (
    <section className="scanner-stage" aria-label={copy.listeningTitle}>
      {/* Video element always mounted so videoRef is always accessible */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 h-full w-full object-cover ${cameraActive ? "block" : "hidden"}`}
      />

      {!cameraActive && (
        <>
          <div aria-hidden="true" className="absolute inset-0 bg-meridian-ink" />
          <Brackets className="scanner-brackets--stage" />
          <p aria-hidden="true" className="absolute start-[3.75rem] top-[1.35rem] z-10 flex items-center gap-2 text-[11.5px] font-semibold text-ink-300">
            <span className="scanner-index">{copy.sectionIndex(1)}</span>
            {copy.stageLabel}
          </p>
          <div aria-hidden="true" className="scanner-sweep motion-safe:animate-sweep" />
          <div className="relative z-10 flex h-full flex-col items-center justify-center gap-4 px-6 py-8 text-center">
            <span className="scanner-idle-mark" aria-hidden="true">
              <Icon name="qr" size={30} strokeWidth={1.5} />
            </span>
            <div className="max-w-sm space-y-1.5">
              <p className="text-[1.0625rem] font-semibold text-white">{copy.listeningTitle}</p>
              <p className="text-[13.5px] leading-relaxed text-ink-300">{copy.listeningBody}</p>
            </div>
            <button
              type="button"
              onClick={onStartCamera}
              className="scanner-tool press inline-flex min-h-12 items-center gap-2.5 rounded-xl bg-white px-5 text-[15px] font-semibold text-ink-950 shadow-[0_10px_30px_-12px_rgb(255_151_255/0.45)] hover:bg-aiteb-lavender"
            >
              <Icon name="camera" size={19} />
              {copy.enableCamera}
            </button>
          </div>
        </>
      )}

      {cameraActive && (
        <>
          <div aria-hidden="true" className="scanner-camera-mask">
            <div className="scanner-camera-window">
              <Brackets />
              <div className="scanner-sweep scanner-sweep--window motion-safe:animate-sweep" />
            </div>
          </div>
          <div className="absolute inset-x-3 bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-950/85 py-1 ps-3 pe-1 text-[13px] backdrop-blur-sm">
            <span className="inline-flex items-center gap-2 text-ink-100">
              <span aria-hidden="true" className="size-2 rounded-full bg-[#5BE3AE]" />
              {copy.cameraLive}
            </span>
            <button
              type="button"
              onClick={onStopCamera}
              className="scanner-tool inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 font-semibold text-ink-200 hover:bg-white/10 hover:text-white"
            >
              <Icon name="x" size={16} />
              {copy.cameraOff}
            </button>
          </div>
        </>
      )}

      {cameraError && (
        <div role="status" className="absolute inset-x-3 bottom-3 z-20 flex items-start gap-2 rounded-xl border border-status-danger-solid/60 bg-[#2A0614]/95 p-3 text-[13px] leading-relaxed text-[#FFC9D5]">
          <Icon name="alert" size={17} className="mt-0.5" />
          <span>{cameraError}</span>
        </div>
      )}

      {children}
    </section>
  );
}
