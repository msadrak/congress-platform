import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import QRCode from "react-qr-code";
import { passCopy } from "../../copy/pass";
import { useWakeLock } from "../../hooks/useWakeLock";
import type { AttendeeLocale } from "../../lib/i18n";

const DIRECTION = { fa: "rtl", en: "ltr" } as const;

interface QrFullscreenProps {
  value: string;
  holder: string;
  tier: string;
  locale: AttendeeLocale;
  onClose: () => void;
}

/**
 * The pass's QR alone, as large as the screen allows, black on white for the gate scanner. Keeps the screen awake
 * (`useWakeLock`) while open; any tap, Escape or the back button closes it.
 */
export function QrFullscreen({ value, holder, tier, locale, onClose }: QrFullscreenProps) {
  const copy = passCopy[locale];
  const surface = useRef<HTMLDivElement>(null);

  useWakeLock();

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
      aria-label={copy.fullscreen.label}
      data-testid="qr-fullscreen"
      tabIndex={-1}
      dir={DIRECTION[locale]}
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
      <p className="text-sm text-black/60">{copy.fullscreen.close}</p>
    </div>,
    document.body,
  );
}
