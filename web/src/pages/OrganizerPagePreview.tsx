import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { createApiClient, ORGANIZER_KEY_STORAGE, type PagePreview } from "../api/client";
import { CongressPage } from "../components/public/page/CongressPage";
import { PassesPanel } from "../components/public/page/PassesPanel";
import { publicCopy } from "../components/public/copy";
import { PublicLayout } from "../layouts/PublicLayout";
import { normalizeDocument, type PageDoc, type PageLocale } from "../lib/pageDocument";
import { useOrganizerImages } from "../lib/pageMedia";
import { readStudioMessage, type PreviewAsset, type PreviewToStudio } from "../lib/studioPreview";

type Load = { status: "loading" } | { status: "ready"; preview: PagePreview } | { status: "denied" } | { status: "error" };

function tell(message: PreviewToStudio) {
  if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
}

/**
 * `/organizer/events/:eventId/page/preview` — the unpublished page drawn by the real public components.
 * Data comes from the organizer-only preview endpoint (the key in this tab's session); inside Page Studio
 * the frame also receives the editor's current, possibly unsaved, document. Links and registration are
 * inert so the frame never leaves the preview.
 */
export default function OrganizerPagePreview() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const [search] = useSearchParams();
  const apiKey = typeof window !== "undefined" ? sessionStorage.getItem(ORGANIZER_KEY_STORAGE) : null;
  const [fetched, setLoad] = useState<Load>({ status: "loading" });
  const load: Load = apiKey ? fetched : { status: "denied" };
  const [live, setLive] = useState<{ doc: PageDoc; assets: PreviewAsset[] } | null>(null);
  const [locale, setLocale] = useState<PageLocale>(search.get("lang") === "en" ? "en" : "fa");
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    let active = true;
    createApiClient({ kind: "organizer", token: apiKey })
      .GET("/api/events/{event_id}/page/preview", { params: { path: { event_id: eventId } } })
      .then(({ data, response }) => {
        if (!active) return;
        if (data) setLoad({ status: "ready", preview: data });
        else setLoad(response.status === 401 || response.status === 404 ? { status: "denied" } : { status: "error" });
      })
      .catch(() => active && setLoad({ status: "error" }));
    return () => {
      active = false;
    };
  }, [apiKey, eventId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = readStudioMessage(event);
      if (!message) return;
      if (message.type === "page-studio:draft") {
        setLive({ doc: message.doc, assets: message.assets });
        setLocale(message.locale);
      } else {
        document.getElementById(message.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    window.addEventListener("message", onMessage);
    tell({ type: "page-studio:ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const preview = load.status === "ready" ? load.preview : null;
  const doc = useMemo(() => live?.doc ?? (preview ? normalizeDocument(preview.page.document) : null), [live, preview]);
  const assets = live?.assets ?? preview?.page.assets ?? [];
  const images = useOrganizerImages(apiKey, eventId, assets);
  const c = publicCopy[locale];

  const changeLocale = (next: PageLocale) => {
    setLocale(next);
    tell({ type: "page-studio:locale", locale: next });
  };

  // Keep the visitor experience but never navigate away: only in-page anchors work.
  const keepInside = (event: MouseEvent) => {
    const link = (event.target as HTMLElement).closest("a");
    if (link && !link.getAttribute("href")?.startsWith("#")) event.preventDefault();
  };

  if (!preview || !doc) {
    return (
      <div role="status" className="grid min-h-dvh place-items-center bg-surface-ink p-8 text-center text-sm text-ink-200">
        {load.status === "loading"
          ? "…"
          : load.status === "denied"
            ? locale === "fa" ? "برای پیش‌نمایش، با کلید برگزارکنندهٔ این همایش وارد شوید." : "Sign in with this congress's organizer key to preview it."
            : locale === "fa" ? "پیش‌نمایش بارگذاری نشد." : "The preview could not be loaded."}
      </div>
    );
  }

  const logo = doc.branding.logo_asset_id ? images[doc.branding.logo_asset_id] ?? null : null;
  return (
    <div onClickCapture={keepInside} data-testid="page-preview">
      <PublicLayout
        locale={locale}
        onLocaleChange={changeLocale}
        congressName={preview.name}
        congressSlug={preview.slug}
        brand={{ accent: doc.branding.accent, logo }}
      >
        <CongressPage
          event={preview}
          doc={doc}
          images={images}
          locale={locale}
          booths={preview.booths}
          mode="preview"
          passes={
            <PassesPanel
              slug={preview.slug}
              tiers={preview.ticket_tiers}
              locale={locale}
              accent={doc.branding.accent}
              selectedTierId={selectedTierId}
              onSelectTier={setSelectedTierId}
              onReserve={() => undefined}
              disabledNote={c.previewReserveDisabled}
            />
          }
        />
      </PublicLayout>
    </div>
  );
}
