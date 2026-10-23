import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { createApiClient, ORGANIZER_KEY_STORAGE, type PagePreview, type PageStateOut } from "../api/client";
import { BoothDirectoryView } from "../components/BoothDirectory";
import { CongressDetailsView } from "../components/attendee/CongressDetailsView";
import { CongressHomeView } from "../components/attendee/CongressHomeView";
import { DigitalPassCard, type PassCardTicket } from "../components/attendee/DigitalPassCard";
import { panelLabels, type PanelPage } from "../components/attendee/panelContent";
import { FormAlert, SectionHeader } from "../components/organizer/WorkspaceUi";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon, type IconName } from "../components/ui/Icon";
import { useRevalidateOnFocus } from "../lib/congressContext";
import { eventAccentStyle } from "../lib/eventAccent";
import { translations, type AttendeeLocale } from "../lib/i18n";
import { eventSectionNumber, eventWorkspacePath } from "../lib/organizerWorkspace";
import { normalizeDocument } from "../lib/pageDocument";
import { useOrganizerImages } from "../lib/pageMedia";
import { usePageTitle } from "../hooks/usePageTitle";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import "../styles/attendee.css";

// ── Control page ↔ preview frame messages (same origin, checked source window) ───────────────────────

const PANEL_VIEWS = ["home", "details", "card"] as const;
type PanelView = (typeof PANEL_VIEWS)[number];
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
  usePageTitle(locale === "fa" ? "پیش‌نمایش پنل شرکت‌کننده" : "Attendee panel preview", preview?.name);
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
        ticket_tier_name: preview.ticket_tiers[0]?.name ?? (isRtl ? "نوع کارت ورود" : "Pass type"),
        attendee_name: isRtl ? "نام شرکت‌کننده (نمونه)" : "Attendee name (sample)",
        qr_secret: "SAMPLE-PASS-ORGANIZER-PREVIEW",
        created_at: preview.starts_at,
      },
    [preview, isRtl],
  );

  if (!preview || !doc || !sample) {
    return (
      <div role="status" className="grid min-h-dvh place-items-center bg-surface-page p-8 text-center text-sm text-text-secondary">
        {load.status === "loading"
          ? "…"
          : load.status === "denied"
            ? isRtl ? "برای پیش‌نمایش، با کلید برگزارکنندهٔ این همایش وارد شوید." : "Sign in with this congress's organizer key to preview it."
            : isRtl ? "پیش‌نمایش بارگذاری نشد." : "The preview could not be loaded."}
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
          {isRtl ? "کارت نمونه: هر شرکت‌کننده کارت و کد QR خودش را می‌بیند." : "Sample pass: each attendee sees their own card and QR."}
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
          booths={(index) => (
            <BoothDirectoryView
              slug={slug}
              isRtl={isRtl}
              index={index}
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
      dir={isRtl ? "rtl" : "ltr"}
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

// ── Control page: `/organizer/events/:eventId/panel` ───────────────────────────────────────────────────

const DEVICES = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;
type Device = keyof typeof DEVICES;

interface PanelFrameProps {
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
function PanelFrame({ eventId, view, locale, device, refreshTick, onViewChange, title }: PanelFrameProps) {
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

// Remount per event: a response for event A can never land in event B's page.
export default function OrganizerPanel() {
  const { eventId } = useParams<{ eventId: string }>();
  return <PanelControl key={eventId} eventId={eventId ?? ""} />;
}

function PanelControl({ eventId }: { eventId: string }) {
  const { apiKey, reportEvent, locale, isRtl } = useOutletContext<OrganizerOutletContext>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [pageState, setPageState] = useState<PageStateOut | null>(null);
  const [view, setView] = useState<PanelView>("home");
  const [device, setDevice] = useState<Device>("mobile");
  const [lang, setLang] = useState<AttendeeLocale>(locale);
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // A 401 reaches the organizer layout's key gate through the API client (registerUnauthorizedHandler).
  const client = useMemo(() => (apiKey ? createApiClient({ kind: "organizer", token: apiKey }) : null), [apiKey]);

  const load = useCallback(async () => {
    if (!client) return;
    const path = { params: { path: { event_id: eventId } } };
    try {
      const [pv, pg] = await Promise.all([client.GET("/api/events/{event_id}/page/preview", path), client.GET("/api/events/{event_id}/page", path)]);
      if (!pv.data || !pg.data) {
        // A failed refresh keeps what is on screen.
        setStatus((prev) => (prev === "ready" ? prev : "error"));
        return;
      }
      setPreview(pv.data);
      setPageState(pg.data);
      setStatus("ready");
    } catch {
      setStatus((prev) => (prev === "ready" ? prev : "error"));
    }
  }, [client, eventId]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- load's state updates happen after the preview and page fetches resolve; the effect syncs this event's server state.
    void load();
  }, [load]);

  useEffect(() => {
    if (preview) reportEvent({ id: preview.id, name: preview.name, slug: preview.slug, starts_at: preview.starts_at, ends_at: preview.ends_at });
  }, [preview, reportEvent]);

  // Edits made in other tabs (program, venue, studio …) show up when the organizer comes back.
  const refresh = useCallback(() => {
    setRefreshTick((k) => k + 1);
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);
  useRevalidateOnFocus(refresh);

  const doc = useMemo(() => (preview ? normalizeDocument(preview.page.document) : null), [preview]);

  if (!client) return null;
  if (status === "loading") {
    return (
      <div role="status" aria-label={isRtl ? "در حال بارگذاری" : "Loading"} className="space-y-4">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-96" />
      </div>
    );
  }
  if (status === "error" || !preview || !pageState || !doc) {
    return <FormAlert>{isRtl ? "پیش‌نمایش پنل شرکت‌کننده بارگذاری نشد." : "The attendee panel preview could not be loaded."}</FormAlert>;
  }

  const to = (path: string) => eventWorkspacePath(eventId, path);
  const n = (value: number) => (isRtl ? value.toLocaleString("fa-IR") : String(value));
  const entrances = preview.venue.filter((p) => p.kind === "entrance").length;
  const halls = preview.venue.filter((p) => p.kind === "hall").length;
  const labels = panelLabels(doc, lang);
  const studioState = [
    doc.branding.logo_asset_id ? (isRtl ? "لوگو دارد" : "Logo set") : isRtl ? "بدون لوگو" : "No logo",
    doc.hero.layout !== "signature" && doc.hero.cover_asset_id ? (isRtl ? "تصویر کاور دارد" : "Cover image set") : isRtl ? "طرح پیش‌فرض" : "Generated artwork",
  ].join(" · ");

  const modules: { key: string; icon: IconName; title: string; drives: string; state: string; note?: string | null; to: string; action: string }[] = [
    {
      key: "program",
      icon: "calendar",
      title: isRtl ? "برنامه جلسات" : "Program",
      drives: isRtl ? "ماژول «برنامه» در خانه و برنامه کامل در جزئیات" : "Home program module and the full program on Details",
      state: isRtl ? `${n(preview.sessions.length)} جلسه` : `${preview.sessions.length} session${preview.sessions.length === 1 ? "" : "s"}`,
      to: to("/program"),
      action: isRtl ? "ویرایش برنامه" : "Edit program",
    },
    {
      key: "venue",
      icon: "pin",
      title: isRtl ? "ورودی‌ها و سالن‌ها" : "Entrances & halls",
      drives: isRtl ? "بخش «محل برگزاری» در جزئیات و نام سالن هر جلسه" : "Venue section on Details and each session's hall",
      state: isRtl ? `${n(entrances)} ورودی · ${n(halls)} سالن` : `${entrances} entrance${entrances === 1 ? "" : "s"} · ${halls} hall${halls === 1 ? "" : "s"}`,
      to: to("/venue"),
      action: isRtl ? "ویرایش محل برگزاری" : "Edit venue",
    },
    {
      key: "booths",
      icon: "booth",
      title: isRtl ? "غرفه‌ها" : "Booths",
      drives: isRtl ? "فهرست غرفه‌های نمایشگاه در خانه" : "Exhibition booth directory on Home",
      state: isRtl ? `${n(preview.booths.length)} غرفه` : `${preview.booths.length} booth${preview.booths.length === 1 ? "" : "s"}`,
      note: labels.showBooths ? null : isRtl ? "پنهان در صفحه" : "Hidden on the page",
      to: to("/booths"),
      action: isRtl ? "مدیریت غرفه‌ها" : "Manage booths",
    },
    {
      key: "tiers",
      icon: "ticket",
      title: isRtl ? "انواع کارت ورود" : "Ticket tiers",
      drives: isRtl ? "نام نوع کارت روی «کارت من» و بخش بلیت در خانه" : "Tier name on My Card and the Home pass section",
      state: isRtl ? `${n(preview.ticket_tiers.length)} نوع کارت` : `${preview.ticket_tiers.length} tier${preview.ticket_tiers.length === 1 ? "" : "s"}`,
      to: to("/tiers"),
      action: isRtl ? "ویرایش کارت‌ها" : "Edit tiers",
    },
    {
      key: "page",
      icon: "palette",
      title: isRtl ? "صفحه‌ساز (لوگو، کاور، عنوان‌ها)" : "Page Studio (logo, cover, labels)",
      drives: isRtl
        ? "لوگو و کاور سربرگ، رنگ تأکیدی، عنوان غرفه‌ها، برنامه و «درباره» و نمایش یا پنهان بودن آن‌ها"
        : "Header logo and cover, accent colour, the booths, program and about titles and whether they show",
      state: studioState,
      note: pageState.has_unpublished_changes ? (isRtl ? "تغییرات منتشرنشده دارد" : "Has unpublished changes") : null,
      to: to("/page"),
      action: isRtl ? "باز کردن صفحه‌ساز" : "Open Page Studio",
    },
    {
      key: "event",
      icon: "info",
      title: isRtl ? "مشخصات همایش" : "Congress details",
      drives: isRtl ? "نام، تاریخ، نشانی و توضیحات در سربرگ و جزئیات" : "Name, dates, address and description in the header and Details",
      state: preview.location || (isRtl ? "بدون نشانی" : "No address"),
      to: to(""),
      action: isRtl ? "ویرایش مشخصات" : "Edit details",
    },
  ];

  const viewLabels: Record<PanelView, string> = {
    home: isRtl ? "خانه" : "Home",
    details: isRtl ? "جزئیات همایش" : "Details",
    card: isRtl ? "کارت من" : "My Card",
  };
  const segment = "inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold";
  const segmentState = (on: boolean) => (on ? "bg-surface-panel text-text-primary shadow-soft" : "text-text-secondary hover:text-text-primary");

  return (
    <div className="space-y-6" data-testid="attendee-panel-control">
      <SectionHeader
        index={eventSectionNumber("panel")}
        eyebrow={<bdi>{preview.name}</bdi>}
        title={isRtl ? "پنل شرکت‌کننده" : "Attendee panel"}
        description={
          isRtl
            ? "همان چیزی که شرکت‌کنندگان در پنل خود می‌بینند، با داده‌های فعلی. برنامه، محل برگزاری، غرفه‌ها و کارت‌ها بلافاصله پس از ذخیره برای شرکت‌کنندگان به‌روز می‌شوند؛ تغییرات صفحه‌ساز پس از انتشار."
            : "What attendees see in their panel, with current data. Program, venue, booths and tiers reach attendees as soon as they are saved; Page Studio changes once published."
        }
        action={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing}>
            <Icon name="sync" size={15} />
            {isRtl ? "تازه‌سازی" : "Refresh"}
          </Button>
        }
      />

      {!pageState.is_published ? (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-status-warning-border bg-status-warning-bg p-4 text-sm text-status-warning-text sm:flex-row sm:items-center">
          <Icon name="eye-off" size={18} className="shrink-0" />
          <p className="flex-1 leading-relaxed">
            {isRtl
              ? "صفحه این همایش هنوز منتشر نشده است؛ تا انتشار، شرکت‌کنندگان نمی‌توانند پنل را باز کنند."
              : "This congress's page is not published yet; attendees cannot open the panel until it is."}
          </p>
          <Link to={to("/page")} className="inline-flex min-h-11 items-center gap-1.5 font-semibold underline-offset-4 hover:underline">
            {isRtl ? "انتشار در صفحه‌ساز" : "Publish in Page Studio"}
            <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      ) : pageState.has_unpublished_changes ? (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-status-info-border bg-status-info-bg p-4 text-sm text-status-info-text sm:flex-row sm:items-center">
          <Icon name="note" size={18} className="shrink-0" />
          <p className="flex-1 leading-relaxed">
            {isRtl
              ? "صفحه‌ساز تغییرات منتشرنشده دارد. این پیش‌نمایش پیش‌نویس را نشان می‌دهد؛ شرکت‌کنندگان هنوز نسخه منتشرشده را می‌بینند."
              : "Page Studio has unpublished changes. This preview shows the draft; attendees still see the published version."}
          </p>
          <Link to={to("/page")} className="inline-flex min-h-11 items-center gap-1.5 font-semibold underline-offset-4 hover:underline">
            {isRtl ? "بازبینی و انتشار" : "Review and publish"}
            <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <section aria-label={isRtl ? "پیش‌نمایش" : "Preview"} className="space-y-3 xl:sticky xl:top-24">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label={isRtl ? "صفحه پنل" : "Panel page"} className="inline-flex rounded-xl border border-border-default bg-surface-panel-subtle p-1">
              {PANEL_VIEWS.map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`${segment} ${segmentState(view === v)}`}>
                  {viewLabels[v]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label={isRtl ? "اندازه صفحه" : "Screen size"} className="inline-flex rounded-xl border border-border-default bg-surface-panel-subtle p-1">
                {(
                  [
                    ["mobile", isRtl ? "موبایل" : "Mobile", "smartphone"],
                    ["desktop", isRtl ? "دسکتاپ" : "Desktop", "monitor"],
                  ] as const
                ).map(([key, label, icon]) => (
                  <button key={key} type="button" aria-pressed={device === key} onClick={() => setDevice(key)} className={`${segment} ${segmentState(device === key)}`}>
                    <Icon name={icon} size={15} />
                    {label}
                  </button>
                ))}
              </div>
              <div role="group" aria-label={isRtl ? "زبان پیش‌نمایش" : "Preview language"} className="inline-flex rounded-xl border border-border-default bg-surface-panel-subtle p-1">
                {(["fa", "en"] as const).map((l) => (
                  <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`${segment} ${segmentState(lang === l)}`}>
                    {l === "fa" ? "فارسی" : "English"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="h-[min(78vh,980px)] rounded-2xl border border-border-default bg-[radial-gradient(circle_at_30%_0%,var(--aiteb-lavender),transparent_60%)] p-3 sm:p-4">
            <PanelFrame
              eventId={eventId}
              view={view}
              locale={lang}
              device={device}
              refreshTick={refreshTick}
              onViewChange={setView}
              title={isRtl ? "پیش‌نمایش پنل شرکت‌کننده" : "Attendee panel preview"}
            />
          </div>
          <p className="text-xs leading-relaxed text-text-muted">
            {isRtl
              ? "کارت ورود، نام دارنده و تعداد ارتباطات نمونه‌اند. پیوندها در پیش‌نمایش به بیرون نمی‌روند."
              : "The pass, holder name and connection count are samples. Links do not leave the preview."}
          </p>
        </section>

        <aside aria-labelledby="panel-sources-title" className="space-y-3">
          <h2 id="panel-sources-title" className="text-sm font-bold text-text-primary">
            {isRtl ? "هر بخش پنل از کجا می‌آید" : "What drives each part of the panel"}
          </h2>
          <ul className="space-y-2.5">
            {modules.map((m) => (
              <li key={m.key} className="rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-ink text-white [border-start-end-radius:16px]">
                    <Icon name={m.icon} size={18} />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-semibold text-text-primary">{m.title}</p>
                    <p className="text-xs leading-relaxed text-text-secondary">{m.drives}</p>
                    <p className="flex flex-wrap items-center gap-2 pt-1 text-xs font-medium text-text-muted">
                      <bdi className="break-words">{m.state}</bdi>
                      {m.note && (
                        <Badge variant="warning" size="sm">
                          {m.note}
                        </Badge>
                      )}
                    </p>
                  </div>
                </div>
                <Link
                  to={m.to}
                  className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded text-xs font-semibold text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {m.action}
                  <Icon name="arrow-right" size={15} />
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
