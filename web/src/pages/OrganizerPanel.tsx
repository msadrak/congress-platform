import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { createApiClient, ORGANIZER_KEY_STORAGE, type PagePreview } from "../api/client";
import { BoothDirectoryView } from "../components/BoothDirectory";
import { CongressDetailsView } from "../components/attendee/CongressDetailsView";
import { CongressHomeView } from "../components/attendee/CongressHomeView";
import { DigitalPassCard, type PassCardTicket } from "../components/attendee/DigitalPassCard";
import { panelLabels, type PanelPage } from "../components/attendee/panelContent";
import { Icon } from "../components/ui/Icon";
import { organizerProgramCopy } from "../copy/organizerProgram";
import { eventAccentStyle } from "../lib/eventAccent";
import { translations, type AttendeeLocale } from "../lib/i18n";
import { normalizeDocument } from "../lib/pageDocument";
import { useOrganizerImages } from "../lib/pageMedia";
import { usePageTitle } from "../hooks/usePageTitle";
import "../styles/attendee.css";

// ── Control page ↔ preview frame messages (same origin, checked source window) ───────────────────────

const PANEL_VIEWS = ["home", "details", "card"] as const;
export type PanelView = (typeof PANEL_VIEWS)[number];
const isPanelView = (value: unknown): value is PanelView => PANEL_VIEWS.some((v) => v === value);

type ControlToFrame = { type: "attendee-panel:show"; view: PanelView; locale: AttendeeLocale } | { type: "attendee-panel:refresh" };
type FrameToControl = { type: "attendee-panel:ready" } | { type: "attendee-panel:view"; view: PanelView };

function messageData(event: MessageEvent, source: MessageEventSource | null | undefined): object | null {
  if (event.origin !== window.location.origin || !source || event.source !== source) return null;
  const data: unknown = event.data;
  return typeof data === "object" && data !== null ? data : null;
}

function readControlMessage(event: MessageEvent): ControlToFrame | null {
  const data = messageData(event, window.parent);
  if (!data || !("type" in data)) return null;
  if (data.type === "attendee-panel:refresh") return { type: "attendee-panel:refresh" };
  if (data.type === "attendee-panel:show" && "view" in data && isPanelView(data.view) && "locale" in data) {
    return { type: "attendee-panel:show", view: data.view, locale: data.locale === "en" ? "en" : "fa" };
  }
  return null;
}

function readFrameMessage(event: MessageEvent, frame: Window | null | undefined): FrameToControl | null {
  const data = messageData(event, frame);
  if (!data || !("type" in data)) return null;
  if (data.type === "attendee-panel:ready") return { type: "attendee-panel:ready" };
  if (data.type === "attendee-panel:view" && "view" in data && isPanelView(data.view)) return { type: "attendee-panel:view", view: data.view };
  return null;
}

// ── Preview frame: `/organizer/events/:eventId/panel/preview` ──────────────────────────────────────────

type FrameLoad = { status: "loading" } | { status: "ready"; preview: PagePreview } | { status: "denied" } | { status: "error" };

/**
 * The attendee panel as attendees will see it, drawn by the same view components as `/c/:slug/*`, fed
 * with the organizer preview (draft page, live tiers, venue, program and booths) and a sample pass.
 * Links never leave the frame: links between Home, Details and My Card switch the view.
 */
export function OrganizerPanelFrame() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const [search] = useSearchParams();
  const apiKey = typeof window !== "undefined" ? sessionStorage.getItem(ORGANIZER_KEY_STORAGE) : null;
  const [fetched, setFetched] = useState<FrameLoad>({ status: "loading" });
  const load: FrameLoad = apiKey ? fetched : { status: "denied" };
  const [view, setView] = useState<PanelView>(() => {
    const requested = search.get("view");
    return isPanelView(requested) ? requested : "home";
  });
  const [locale, setLocale] = useState<AttendeeLocale>(search.get("lang") === "en" ? "en" : "fa");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!apiKey) return;
    let active = true;
    createApiClient({ kind: "organizer", token: apiKey })
      .GET("/api/events/{event_id}/page/preview", { params: { path: { event_id: eventId } } })
      .then(({ data, response }) => {
        if (!active) return;
        if (data) setFetched({ status: "ready", preview: data });
        // A failed refresh keeps the preview already drawn.
        else setFetched((prev) => (prev.status === "ready" ? prev : response.status === 401 || response.status === 404 ? { status: "denied" } : { status: "error" }));
      })
      .catch(() => active && setFetched((prev) => (prev.status === "ready" ? prev : { status: "error" })));
    return () => {
      active = false;
    };
  }, [apiKey, eventId, reloadKey]);

  useEffect(() => {
    const tell = (message: FrameToControl) => {
      if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
    };
    const onMessage = (event: MessageEvent) => {
      const message = readControlMessage(event);
      if (!message) return;
      if (message.type === "attendee-panel:refresh") {
        setReloadKey((k) => k + 1);
      } else {
        setView(message.view);
        setLocale(message.locale);
        setAnchor(null);
      }
    };
    window.addEventListener("message", onMessage);
    tell({ type: "attendee-panel:ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  }, [view, anchor]);

  const preview = load.status === "ready" ? load.preview : null;
  const c = organizerProgramCopy[locale];
  usePageTitle(c.panel.frameTitle, preview?.name);
  const doc = useMemo(() => (preview ? normalizeDocument(preview.page.document) : null), [preview]);
  const images = useOrganizerImages(apiKey, eventId, preview?.page.assets ?? []);
  const isRtl = locale === "fa";
  const t = translations[locale];

  const sample = useMemo<PassCardTicket | null>(
    () =>
      preview && {
        id: "sample-pass-0000",
        event_name: preview.name,
        event_slug: preview.slug,
        event_location: preview.location,
        event_starts_at: preview.starts_at,
        event_ends_at: preview.ends_at,
        ticket_tier_name: preview.ticket_tiers[0]?.name ?? c.panel.sampleTier,
        attendee_name: c.panel.sampleName,
        qr_secret: "SAMPLE-PASS-ORGANIZER-PREVIEW",
        created_at: preview.starts_at,
      },
    [preview, c],
  );

  if (!preview || !doc || !sample) {
    return (
      <div role="status" className="grid min-h-dvh place-items-center bg-surface-page p-8 text-center text-sm text-text-secondary">
        {load.status === "loading"
          ? "…"
          : load.status === "denied"
            ? c.frame.denied
            : c.frame.failed}
      </div>
    );
  }

  const page: PanelPage = { doc, images };
  const labels = panelLabels(doc, locale);
  const slug = preview.slug;

  // Links behave as in the panel between its own views; everything else is inert in the preview.
  const keepInside = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link) return;
    event.preventDefault();
    const url = new URL(link.href, window.location.origin);
    const base = `/c/${encodeURIComponent(slug)}/`;
    if (url.search || !url.pathname.startsWith(base)) return;
    const destination = url.pathname.slice(base.length);
    const next: PanelView | null = destination === "my-congress" ? "home" : destination === "details" ? "details" : destination === "my-ticket" ? "card" : null;
    if (!next) return;
    setView(next);
    setAnchor(url.hash ? url.hash.slice(1) : null);
    if (window.parent !== window) window.parent.postMessage({ type: "attendee-panel:view", view: next } satisfies FrameToControl, window.location.origin);
  };

  let content: ReactNode;
  if (view === "details") {
    content = (
      <div className="mx-auto max-w-6xl space-y-10 px-4 pt-6 sm:space-y-14 sm:px-6 sm:pt-10">
        <CongressDetailsView event={preview} page={page} labels={labels} locale={locale} t={t} agendaOwner={null} />
      </div>
    );
  } else if (view === "card") {
    content = (
      <div className="mx-auto max-w-[480px] space-y-5 px-4 pt-5 sm:pt-8">
        <p className="flex items-center gap-2 rounded-2xl border border-dashed border-status-info-border bg-status-info-bg px-4 py-3 text-xs font-semibold text-status-info-text">
          <Icon name="eye" size={16} />
          {c.panel.samplePass}
        </p>
        <DigitalPassCard ticket={sample} locale={locale} t={t} verified />
      </div>
    );
  } else {
    content = (
      <div className="mx-auto max-w-6xl space-y-12 px-4 pt-5 sm:space-y-16 sm:px-6 sm:pt-8">
        <CongressHomeView
          event={preview}
          page={page}
          labels={labels}
          locale={locale}
          t={t}
          personal={{
            status: "ready",
            overview: {
              tickets: [{ id: sample.id, ticket_tier_name: sample.ticket_tier_name, attendee_name: sample.attendee_name, status: "active", qr_secret: sample.qr_secret }],
              fromCache: false, connectionCount: 0, otherCongresses: [] },
          }}
          booths={() => (
            <BoothDirectoryView
              slug={slug}
              isRtl={isRtl}
              title={labels.boothsTitle}
              lead={labels.boothsLead}
              directory={{ status: "ready", booths: preview.booths }}
              onRetry={() => undefined}
              signedIn
              savedIds={null}
              onToggleSaved={() => undefined}
            />
          )}
        />
      </div>
    );
  }

  return (
    <div
      dir={locale === "en" ? "ltr" : "rtl"}
      lang={locale}
      style={eventAccentStyle(slug, doc.branding.accent)}
      onClickCapture={keepInside}
      data-testid="panel-preview"
      className="at-shell min-h-dvh bg-surface-page pb-16 font-sans text-start text-text-primary"
    >
      {content}
    </div>
  );
}

// ── Preview inside Page Studio («پنل شرکت‌کننده») ─────────────────────────────────────────────────────

const DEVICES = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;
type Device = keyof typeof DEVICES;

export interface PanelFrameProps {
  eventId: string;
  view: PanelView;
  locale: AttendeeLocale;
  device: Device;
  /** Increments ask the frame to re-read the preview. */
  refreshTick: number;
  onViewChange: (view: PanelView) => void;
  title: string;
}

/** The preview at a real device width (so the attendee breakpoints apply), scaled to fit the column. */
export function PanelFrame({ eventId, view, locale, device, refreshTick, onViewChange, title }: PanelFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  // The frame URL is fixed at mount; later changes travel by message (no reload, no flash).
  const [src] = useState(() => `/organizer/events/${encodeURIComponent(eventId)}/panel/preview?view=${view}&lang=${locale}`);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSpace({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = readFrameMessage(event, frame.current?.contentWindow);
      if (!message) return;
      if (message.type === "attendee-panel:ready") setReady(true);
      else onViewChange(message.view);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onViewChange]);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: "attendee-panel:show", view, locale } satisfies ControlToFrame, window.location.origin);
  }, [ready, view, locale]);

  useEffect(() => {
    if (ready && refreshTick > 0) frame.current?.contentWindow?.postMessage({ type: "attendee-panel:refresh" } satisfies ControlToFrame, window.location.origin);
  }, [ready, refreshTick]);

  const size = DEVICES[device];
  const scale = space.width ? Math.min(1, space.width / size.width, device === "mobile" && space.height ? space.height / size.height : 1) : 0;
  const frameHeight = device === "mobile" ? size.height : scale ? space.height / scale : size.height;

  return (
    // Layout box is LTR so the scaled frame anchors predictably; the panel inside keeps its own direction.
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
          <iframe ref={frame} src={src} title={title} className="size-full border-0 bg-surface-page" data-testid="panel-preview-frame" />
        </div>
      </div>
    </div>
  );
}
