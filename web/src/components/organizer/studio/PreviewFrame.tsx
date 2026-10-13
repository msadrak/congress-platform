import { useEffect, useRef, useState } from "react";
import type { PageDoc, PageLocale } from "../../../lib/pageDocument";
import { previewPath, readPreviewMessage, type PreviewAsset, type StudioToPreview } from "../../../lib/studioPreview";

const DEVICES = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;

interface PreviewFrameProps {
  eventId: string;
  doc: PageDoc;
  assets: PreviewAsset[];
  locale: PageLocale;
  device: keyof typeof DEVICES;
  /** Section the editor is working on; the preview scrolls to it. */
  focusAnchor: string | null;
  onLocaleChange: (locale: PageLocale) => void;
  title: string;
}

/**
 * The real public page in an iframe at a real device width (so responsive breakpoints are the visitor's),
 * scaled to fit the studio column. It receives the editor's document on every change.
 */
export function PreviewFrame({ eventId, doc, assets, locale, device, focusAnchor, onLocaleChange, title }: PreviewFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  // The frame URL is fixed at mount; later language changes travel by message (no reload, no flash).
  const [src] = useState(() => previewPath(eventId, locale));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSpace({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = readPreviewMessage(event, frame.current?.contentWindow);
      if (!message) return;
      if (message.type === "page-studio:ready") setReady(true);
      else onLocaleChange(message.locale);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onLocaleChange]);

  const post = (message: StudioToPreview) => frame.current?.contentWindow?.postMessage(message, window.location.origin);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => post({ type: "page-studio:draft", doc, assets, locale }), 120);
    return () => window.clearTimeout(timer);
  }, [ready, doc, assets, locale]);

  useEffect(() => {
    if (ready && focusAnchor) post({ type: "page-studio:focus", anchor: focusAnchor });
  }, [ready, focusAnchor]);

  const size = DEVICES[device];
  const scale = space.width ? Math.min(1, space.width / size.width, device === "mobile" && space.height ? space.height / size.height : 1) : 0;
  const frameHeight = device === "mobile" ? size.height : scale ? space.height / scale : size.height;

  return (
    // Layout box is LTR so the scaled frame anchors predictably; the page inside keeps its own direction.
    <div ref={box} dir="ltr" className="relative h-full min-h-[420px] w-full overflow-hidden">
      <div
        className="absolute top-0"
        style={{
          left: device === "mobile" ? Math.max(0, (space.width - size.width * scale) / 2) : 0,
          width: size.width * scale,
          height: frameHeight * scale,
        }}
      >
        <div
          className={`overflow-hidden bg-surface-page ${device === "mobile" ? "rounded-[44px] shadow-pop ring-[10px] ring-surface-ink" : "rounded-xl shadow-lift ring-1 ring-border-default"}`}
          style={{ width: size.width, height: frameHeight, transform: `scale(${scale})`, transformOrigin: "0 0" }}
        >
          <iframe ref={frame} src={src} title={title} className="size-full border-0 bg-surface-page" data-testid="page-preview-frame" />
        </div>
      </div>
    </div>
  );
}
