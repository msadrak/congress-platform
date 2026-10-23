import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import QRCode from "react-qr-code";
import type { AttendeeLocale } from "../../lib/i18n";

interface QrFullscreenProps {
  value: string;
  holder: string;
  tier: string;
  locale: AttendeeLocale;
  onClose: () => void;
}

/**
 * The pass's QR alone, as large as the screen allows, black on white for the gate scanner. Keeps the screen awake
 * (Screen Wake Lock API, where available) while open; any tap, Escape or the back button closes it.
 */
export function QrFullscreen({ value, holder, tier, locale, onClose }: QrFullscreenProps) {
  const isRtl = locale === "fa";
  const surface = useRef<HTMLDivElement>(null);

  // Screen Wake Lock: released by the browser when the tab is hidden, so it is taken again on return.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let active = true;
    let sentinel: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (active) sentinel = lock;
        else void lock.release();
      } catch {
        // refused (battery saver, permissions policy): the QR still shows
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    surface.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={surface}
      role="dialog"
      aria-modal="true"
      aria-label={isRtl ? "کد QR کارت ورود، تمام‌صفحه" : "Pass QR code, full screen"}
      data-testid="qr-fullscreen"
      tabIndex={-1}
      dir={isRtl ? "rtl" : "ltr"}
      lang={locale}
      onClick={onClose}
      className="fixed inset-0 z-[80] flex cursor-pointer flex-col items-center justify-center gap-6 bg-white p-6 text-center text-black outline-none print:hidden"
    >
      <QRCode
        value={value}
        size={256}
        level="H"
        viewBox="0 0 256 256"
        fgColor="#000000"
        bgColor="#FFFFFF"
        className="block h-auto w-[min(86vw,62vh)] max-w-[480px] select-none"
      />
      <div className="space-y-1">
        <p dir="auto" className="text-2xl font-bold tracking-[-0.02em]">{holder}</p>
        <p dir="auto" className="text-base font-semibold text-black/75">{tier}</p>
      </div>
      <p className="text-sm text-black/60">{isRtl ? "برای بستن، صفحه را لمس کنید" : "Tap anywhere to close"}</p>
    </div>,
    document.body,
  );
}
