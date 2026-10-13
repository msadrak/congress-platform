import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { createApiClient, formatApiError, type EventOut, type MediaAssetOut, type PageStateOut } from "../api/client";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { Notice } from "../components/organizer/WorkspaceUi";
import { BrandPanel } from "../components/organizer/studio/BrandPanel";
import { MediaLibrary } from "../components/organizer/studio/MediaLibrary";
import { PreviewFrame } from "../components/organizer/studio/PreviewFrame";
import { SectionEditor } from "../components/organizer/studio/SectionEditor";
import { SeoPanel } from "../components/organizer/studio/SeoPanel";
import { IconButton } from "../components/organizer/studio/StudioFields";
import { StudioContext, type StudioContextValue } from "../components/organizer/studio/studioContext";
import { SECTION_ICONS, studioCopy } from "../components/organizer/studio/studioCopy";
import {
  ADDABLE_SECTIONS,
  MAX_SECTIONS,
  addSection,
  isCoreSection,
  localized,
  moveSection,
  normalizeDocument,
  referencedImages,
  removeSection,
  sameDocument,
  sectionAnchor,
  toApiDocument,
  updateSection,
  type PageDoc,
  type PageLocale,
  type PageSection,
  type SectionType,
} from "../lib/pageDocument";
import { uploadPageImage, useOrganizerImages } from "../lib/pageMedia";
import type { OrganizerOutletContext } from "./OrganizerLayout";

type Tab = "sections" | "brand" | "seo";

const clockTime = (iso: string, locale: PageLocale) =>
  new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
type Confirm = "publish" | "unpublish" | "discard" | { remove: string } | null;

// Remount per event: a response for event A can never land in event B's editor.
export default function OrganizerPageStudio() {
  const { eventId } = useParams<{ eventId: string }>();
  return <PageStudio key={eventId} eventId={eventId ?? ""} />;
}

function PageStudio({ eventId }: { eventId: string }) {
  const { apiKey, onKeyRejected, reportEvent, locale, isRtl } = useOutletContext<OrganizerOutletContext>();
  const copy = studioCopy[locale];

  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [event, setEvent] = useState<EventOut | null>(null);
  const [page, setPage] = useState<PageStateOut | null>(null);
  const [saved, setSaved] = useState<PageDoc | null>(null);
  const [doc, setDoc] = useState<PageDoc | null>(null);
  const [assets, setAssets] = useState<MediaAssetOut[]>([]);

  const [tab, setTab] = useState<Tab>("sections");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lang, setLang] = useState<PageLocale>(locale);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState<null | "save" | "publish" | "unpublish" | "discard">(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [adding, setAdding] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const pickResolver = useRef<((id: string | null) => void) | null>(null);

  const client = useMemo(() => (apiKey ? createApiClient({ kind: "organizer", token: apiKey }) : null), [apiKey]);
  const path = { params: { path: { event_id: eventId } } };

  const reject = useCallback(
    (status: number) => {
      if (status === 401 && apiKey) onKeyRejected(apiKey);
    },
    [apiKey, onKeyRejected],
  );

  const accept = (next: PageStateOut) => {
    const normalized = normalizeDocument(next.draft);
    setPage(next);
    setSaved(normalized);
    return normalized;
  };

  const loadAll = useCallback(async () => {
    if (!client) return;
    setLoad("loading");
    try {
      const [ev, pg, media] = await Promise.all([
        client.GET("/api/events/{event_id}", path),
        client.GET("/api/events/{event_id}/page", path),
        client.GET("/api/events/{event_id}/media", path),
      ]);
      if (!ev.data || !pg.data || !media.data) {
        reject([ev, pg, media].find((r) => !r.data)?.response.status ?? 0);
        setLoad("error");
        return;
      }
      setEvent(ev.data);
      reportEvent(ev.data);
      setAssets(media.data);
      const normalized = normalizeDocument(pg.data.draft);
      setPage(pg.data);
      setSaved(normalized);
      setDoc(normalized);
      setConflict(false);
      setLoad("ready");
    } catch {
      setLoad("error");
    }
    // `path` is derived from eventId, which is fixed for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, reject, reportEvent, eventId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const dirty = Boolean(doc && saved && !sameDocument(doc, saved));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const images = useOrganizerImages(apiKey, eventId, assets);
  const previewAssets = useMemo(() => assets.map((a) => ({ id: a.id, width: a.width, height: a.height })), [assets]);
  const inUse = useMemo(() => {
    const ids = new Set<string>();
    for (const d of [doc, saved]) if (d) referencedImages(d).forEach((id) => ids.add(id));
    return ids;
  }, [doc, saved]);

  const failure = (status: number, body: unknown) => {
    if (status === 409) setConflict(true);
    else {
      reject(status);
      setNotice({ tone: "error", text: formatApiError(body) });
    }
  };

  /** Saves the draft; returns the new revision, or null when it failed. */
  const save = async (): Promise<number | null> => {
    if (!client || !doc || !page) return null;
    const sent = doc;
    const { data, error, response } = await client.PUT("/api/events/{event_id}/page", {
      ...path,
      body: { revision: page.draft_revision, document: toApiDocument(sent) },
    });
    if (!data) {
      failure(response.status, error);
      return null;
    }
    const normalized = accept(data);
    setDoc((current) => (current === sent ? normalized : current));
    return data.draft_revision;
  };

  const run = async (kind: NonNullable<typeof busy>) => {
    if (!client || !page) return;
    setBusy(kind);
    setNotice(null);
    try {
      if (kind === "save") {
        if ((await save()) !== null) setNotice({ tone: "ok", text: page.is_published ? copy.savedNotice : copy.savedFirstNotice });
        return;
      }
      if (kind === "unpublish") {
        const { data, error, response } = await client.POST("/api/events/{event_id}/page/unpublish", path);
        if (data) {
          accept(data);
          setNotice({ tone: "ok", text: copy.unpublishedNotice });
        } else failure(response.status, error);
        return;
      }
      const revision = dirty ? await save() : page.draft_revision;
      if (revision === null) return;
      const route = kind === "publish" ? "/api/events/{event_id}/page/publish" : "/api/events/{event_id}/page/discard";
      const { data, error, response } = await client.POST(route, { ...path, body: { revision } });
      if (!data) {
        failure(response.status, error);
        return;
      }
      const normalized = accept(data);
      setDoc(normalized);
      setNotice({ tone: "ok", text: kind === "publish" ? copy.publishedNotice : copy.discardedNotice });
    } catch {
      setNotice({ tone: "error", text: copy.loadFailed });
    } finally {
      setBusy(null);
    }
  };

  // Ctrl/Cmd+S saves the draft.
  const saveRef = useRef(run);
  saveRef.current = run;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current("save");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickImage = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        pickResolver.current?.(null);
        pickResolver.current = resolve;
        setLibraryOpen(true);
      }),
    [],
  );
  const closeLibrary = (id: string | null) => {
    pickResolver.current?.(id);
    pickResolver.current = null;
    setLibraryOpen(false);
  };
  const upload = async (file: File): Promise<string | null> => {
    if (!apiKey) return copy.loadFailed;
    const result = await uploadPageImage(apiKey, eventId, file);
    if ("message" in result) {
      reject(result.status);
      return result.message;
    }
    setAssets((current) => [result.asset, ...current]);
    closeLibrary(result.asset.id);
    return null;
  };
  const deleteImage = async (id: string): Promise<string | null> => {
    if (!client) return copy.media.deleteFailed;
    const { error, response } = await client.DELETE("/api/events/{event_id}/media/{asset_id}", {
      params: { path: { event_id: eventId, asset_id: id } },
    });
    if (!response.ok) {
      reject(response.status);
      return formatApiError(error) || copy.media.deleteFailed;
    }
    setAssets((current) => current.filter((a) => a.id !== id));
    return null;
  };

  const studio: StudioContextValue = { copy, lang, assets, images, pickImage };
  const onPreviewLocale = useCallback((next: PageLocale) => setLang(next), []);

  if (load !== "ready" || !doc || !page || !event || !saved) {
    return (
      <div role="status" className="grid min-h-[50vh] place-items-center">
        {load === "error" ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-text-secondary">{copy.loadFailed}</p>
            <Button variant="secondary" onClick={() => void loadAll()}>
              <Icon name="sync" size={16} />
              {copy.retry}
            </Button>
          </div>
        ) : (
          <Icon name="sync" size={22} className="text-text-muted motion-safe:animate-spin" />
        )}
      </div>
    );
  }

  const selected = doc.sections.find((s) => s.id === selectedId) ?? null;
  const ahead = page.is_published && (page.has_unpublished_changes || dirty);
  const status = !page.is_published
    ? { tone: "warning" as const, label: copy.statusNotPublished, body: copy.statusNotPublishedBody, icon: "eye-off" as const }
    : ahead
      ? { tone: "info" as const, label: copy.statusPending, body: copy.statusPendingBody, icon: "note" as const }
      : { tone: "success" as const, label: copy.statusLive, body: copy.statusLiveBody, icon: "web" as const };
  const canPublish = dirty || page.has_unpublished_changes || !page.is_published;
  const publicUrl = `${window.location.host}/e/${event.slug}`;
  const select = (section: PageSection | null) => {
    setSelectedId(section?.id ?? null);
  };
  const focusAnchor = selected ? sectionAnchor(selected) : null;

  const sectionLabel = (section: PageSection) => {
    const own = localized(section.title, lang);
    return { name: copy.sections[section.type].name, detail: own ?? copy.sections[section.type].description };
  };

  const languageSwitch = (
    <div role="group" aria-label={copy.editingLanguage} className="inline-flex rounded-xl border border-border-default bg-surface-panel-subtle p-1">
      {(["fa", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={`min-h-[34px] cursor-pointer rounded-lg px-3 text-xs font-semibold transition-colors ${lang === l ? "bg-surface-panel text-text-primary shadow-soft" : "text-text-secondary hover:text-text-primary"}`}
        >
          {copy.languages[l]}
        </button>
      ))}
    </div>
  );

  return (
    <StudioContext.Provider value={studio}>
      <div className="space-y-5" data-testid="page-studio">
        {/* ── Command bar ───────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 -mx-4 border-b border-border-default bg-surface-page/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                <span className="font-mono text-[0.6875rem] text-aiteb-indigo">06</span>
                {copy.eyebrow}
              </p>
              <h1 className="font-display text-xl font-[680] tracking-[-0.02em] text-text-primary sm:text-2xl">{copy.title}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.tone} size="md" dot data-testid="page-status">
                {status.label}
              </Badge>
              <span className="text-xs text-text-muted" aria-live="polite" data-testid="save-state">
                {busy === "save" ? copy.saving : dirty ? copy.unsaved : copy.savedAt(clockTime(page.draft_updated_at, locale))}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {dirty && (
                <Button variant="ghost" size="sm" onClick={() => setDoc(saved)} disabled={busy !== null}>
                  {copy.revert}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => void run("save")} disabled={!dirty || busy !== null || conflict}>
                <Icon name="check" size={15} />
                {copy.save}
              </Button>
              <Button variant="primary" size="sm" onClick={() => setConfirm("publish")} disabled={!canPublish || busy !== null || conflict}>
                <Icon name="web" size={15} />
                {busy === "publish" ? copy.publishing : copy.publish}
              </Button>
            </div>
          </div>
        </header>

        {conflict && (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-status-warning-border bg-status-warning-bg p-4 text-sm text-status-warning-text sm:flex-row sm:items-center">
            <Icon name="alert" size={18} className="shrink-0" />
            <p className="flex-1 leading-relaxed">{copy.conflict}</p>
            <Button variant="secondary" size="sm" onClick={() => void loadAll()}>
              <Icon name="sync" size={15} />
              {copy.reload}
            </Button>
          </div>
        )}
        {notice && (
          <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={copy.dismiss}>
            {notice.text}
          </Notice>
        )}

        {/* Below 1280 px the editor and the preview share the space through this switch. */}
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl border border-border-default bg-surface-panel-subtle p-1 xl:hidden">
          {(["edit", "preview"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={pane === p}
              onClick={() => setPane(p)}
              className={`min-h-[40px] cursor-pointer rounded-lg text-sm font-semibold ${pane === p ? "bg-surface-panel text-text-primary shadow-soft" : "text-text-secondary"}`}
            >
              {p === "edit" ? copy.edit : copy.preview.label}
            </button>
          ))}
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
          {/* ── Editor ────────────────────────────────────────────────── */}
          <aside aria-label={copy.eyebrow} className={`space-y-5 ${pane === "preview" ? "max-xl:hidden" : ""}`}>
            <section className="relative overflow-hidden rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft [border-start-end-radius:28px]">
              <div className="flex items-start gap-3">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${page.is_published ? "bg-status-success-bg text-status-success-text" : "bg-status-warning-bg text-status-warning-text"}`}>
                  <Icon name={status.icon} size={19} />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-bold text-text-primary">{status.label}</p>
                  <p className="text-xs leading-relaxed text-text-secondary">{status.body}</p>
                  <p className="truncate font-mono text-[11px] text-text-muted" dir="ltr">
                    {publicUrl}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                {page.is_published && (
                  <a
                    href={`/e/${encodeURIComponent(event.slug)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-action-primary hover:bg-action-subtle"
                  >
                    {copy.openLive}
                    <Icon name="arrow-up-right" size={14} />
                  </a>
                )}
                {page.is_published && page.has_unpublished_changes && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirm("discard")} disabled={busy !== null || conflict}>
                    {copy.discard}
                  </Button>
                )}
                {page.is_published && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirm("unpublish")} disabled={busy !== null}>
                    <Icon name="eye-off" size={14} />
                    {copy.unpublish}
                  </Button>
                )}
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label={copy.eyebrow} className="flex gap-1">
                {(
                  [
                    ["sections", copy.tabSections, "layers"],
                    ["brand", copy.tabBrand, "palette"],
                    ["seo", copy.tabSeo, "globe"],
                  ] as const
                ).map(([key, label, icon]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={`relative inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                      tab === key ? "bg-surface-ink text-white" : "text-text-secondary hover:bg-surface-panel-subtle hover:text-text-primary"
                    }`}
                  >
                    <Icon name={icon} size={15} />
                    {label}
                  </button>
                ))}
              </div>
              {languageSwitch}
            </div>

            <div className="rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft sm:p-5">
              {tab === "brand" && <BrandPanel doc={doc} onChange={setDoc} eventName={event.name} />}
              {tab === "seo" && <SeoPanel doc={doc} onChange={setDoc} eventName={event.name} slug={event.slug} />}
              {tab === "sections" && !selected && (
                <div className="space-y-4">
                  <p className="flex items-start gap-2.5 rounded-xl bg-aiteb-lavender/60 px-3.5 py-3 text-xs leading-relaxed text-text-secondary">
                    <Icon name="info" size={16} className="mt-px shrink-0 text-aiteb-indigo" />
                    <span>
                      <strong className="font-semibold text-text-primary">{copy.operationalTitle}. </strong>
                      {copy.operationalBody}
                    </span>
                  </p>
                  <ol className="space-y-2" data-testid="section-list">
                    {doc.sections.map((section, i) => {
                      const label = sectionLabel(section);
                      const core = isCoreSection(section);
                      return (
                        <li
                          key={section.id}
                          data-section={section.id}
                          className={`group flex items-center gap-2 rounded-xl border bg-surface-panel p-2 transition-colors ${section.visible ? "border-border-default" : "border-dashed border-border-strong bg-surface-panel-subtle"}`}
                        >
                          <button type="button" onClick={() => select(section)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg p-1 text-start focus-visible:outline-2 focus-visible:outline-focus-ring">
                            <span className="w-5 shrink-0 text-center font-mono text-[11px] text-text-muted tabular">{String(i + 1).padStart(2, "0")}</span>
                            <span className={`grid size-9 shrink-0 place-items-center rounded-lg [border-start-end-radius:14px] ${section.visible ? "bg-surface-ink text-white" : "bg-surface-panel text-text-muted ring-1 ring-border-default"}`}>
                              <Icon name={SECTION_ICONS[section.type]} size={17} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`flex items-center gap-1.5 text-sm font-semibold ${section.visible ? "text-text-primary" : "text-text-muted"}`}>
                                <span className="truncate">{label.name}</span>
                                {!section.visible && <Badge variant="neutral" size="sm">{copy.hidden}</Badge>}
                                {core && <Icon name="lock" size={12} className="shrink-0 text-text-muted" aria-label={copy.eventData} />}
                              </span>
                              <span className="block truncate text-xs text-text-muted">{label.detail}</span>
                            </span>
                          </button>
                          <span className="flex shrink-0 items-center">
                            <IconButton icon="arrow-up" label={copy.moveUp} disabled={i === 0} onClick={() => setDoc(moveSection(doc, section.id, -1))} />
                            <IconButton icon="arrow-down" label={copy.moveDown} disabled={i === doc.sections.length - 1} onClick={() => setDoc(moveSection(doc, section.id, 1))} />
                            <IconButton
                              icon={section.visible ? "eye" : "eye-off"}
                              label={section.visible ? copy.hide : copy.show}
                              pressed={!section.visible}
                              onClick={() => setDoc(updateSection(doc, { ...section, visible: !section.visible }))}
                            />
                            {!core && <IconButton icon="trash" tone="danger" label={copy.remove} onClick={() => setConfirm({ remove: section.id })} />}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                  <Button variant="outline" size="md" isFullWidth onClick={() => setAdding(true)} disabled={doc.sections.length >= MAX_SECTIONS}>
                    <Icon name="plus" size={16} />
                    {copy.addSection}
                  </Button>
                </div>
              )}
              {tab === "sections" && selected && (
                <div className="space-y-5">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => select(null)}>
                      <Icon name={isRtl ? "arrow-right" : "arrow-left"} size={15} />
                      {copy.back}
                    </Button>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-ink text-white [border-start-end-radius:18px]">
                      <Icon name={SECTION_ICONS[selected.type]} size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-bold text-text-primary">{copy.sections[selected.type].name}</h2>
                      <p className="text-xs leading-relaxed text-text-muted">{isCoreSection(selected) ? copy.coreHint : copy.sections[selected.type].description}</p>
                    </div>
                  </div>
                  <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-xl border border-border-default px-3.5">
                    <span className="text-sm font-semibold text-text-primary">{copy.fields.visible}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={selected.visible}
                      onChange={() => setDoc(updateSection(doc, { ...selected, visible: !selected.visible }))}
                      className="size-5 accent-[var(--aiteb-indigo)]"
                    />
                  </label>
                  <div className="space-y-5">
                    <SectionEditor section={selected} eventDescription={event.description} onChange={(next) => setDoc(updateSection(doc, next))} />
                  </div>
                </div>
              )}
            </div>
          </aside>

          {/* ── Preview ───────────────────────────────────────────────── */}
          <section
            aria-label={copy.preview.label}
            className={`space-y-3 xl:sticky xl:top-24 ${pane === "edit" ? "max-xl:hidden" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="group" aria-label={copy.preview.label} className="inline-flex rounded-xl border border-border-default bg-surface-panel-subtle p-1">
                {(
                  [
                    ["desktop", copy.preview.desktop, "monitor"],
                    ["mobile", copy.preview.mobile, "smartphone"],
                  ] as const
                ).map(([key, label, icon]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={device === key}
                    onClick={() => setDevice(key)}
                    className={`inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${device === key ? "bg-surface-panel text-text-primary shadow-soft" : "text-text-secondary"}`}
                  >
                    <Icon name={icon} size={15} />
                    {label}
                  </button>
                ))}
              </div>
              {languageSwitch}
            </div>
            <div className="h-[min(78vh,980px)] rounded-2xl border border-border-default bg-[radial-gradient(circle_at_30%_0%,var(--aiteb-lavender),transparent_60%)] p-3 sm:p-4">
              <PreviewFrame
                eventId={eventId}
                doc={doc}
                assets={previewAssets}
                locale={lang}
                device={device}
                focusAnchor={focusAnchor}
                onLocaleChange={onPreviewLocale}
                title={copy.preview.frameTitle}
              />
            </div>
            <p className="text-xs leading-relaxed text-text-muted">{copy.preview.note}</p>
          </section>
        </div>
      </div>

      <Dialog isOpen={adding} onClose={() => setAdding(false)} title={copy.addSectionTitle} description={copy.addSectionBody} size="lg">
        <ul className="grid gap-2 sm:grid-cols-2">
          {ADDABLE_SECTIONS.map((type: SectionType) => (
            <li key={type}>
              <button
                type="button"
                onClick={() => {
                  const result = addSection(doc, type, selectedId ?? undefined);
                  setDoc(result.doc);
                  setSelectedId(result.id);
                  setTab("sections");
                  setAdding(false);
                }}
                className="flex h-full w-full cursor-pointer items-start gap-3 rounded-xl border border-border-default bg-surface-panel p-3 text-start transition-colors hover:border-aiteb-indigo hover:bg-aiteb-lavender/40 focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-ink text-white [border-start-end-radius:16px]">
                  <Icon name={SECTION_ICONS[type]} size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-primary">{copy.sections[type].name}</span>
                  <span className="block text-xs leading-relaxed text-text-muted">{copy.sections[type].description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>

      <MediaLibrary
        isOpen={libraryOpen}
        copy={copy}
        assets={assets}
        images={images}
        inUse={inUse}
        onUpload={upload}
        onDelete={deleteImage}
        onPick={(id) => closeLibrary(id)}
        onClose={() => closeLibrary(null)}
      />

      <ConfirmDialog
        isOpen={confirm === "publish"}
        title={copy.confirmPublishTitle}
        description={copy.confirmPublishBody(publicUrl)}
        confirmLabel={copy.publish}
        cancelLabel={copy.cancel}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void run("publish");
        }}
      />
      <ConfirmDialog
        isOpen={confirm === "unpublish"}
        title={copy.confirmUnpublishTitle}
        description={copy.confirmUnpublishBody}
        confirmLabel={copy.unpublish}
        cancelLabel={copy.cancel}
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void run("unpublish");
        }}
      />
      <ConfirmDialog
        isOpen={confirm === "discard"}
        title={copy.confirmDiscardTitle}
        description={copy.confirmDiscardBody}
        confirmLabel={copy.discard}
        cancelLabel={copy.cancel}
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void run("discard");
        }}
      />
      <ConfirmDialog
        isOpen={typeof confirm === "object" && confirm !== null}
        title={copy.confirmRemoveTitle}
        description={copy.confirmRemoveBody}
        confirmLabel={copy.remove}
        cancelLabel={copy.cancel}
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (typeof confirm === "object" && confirm !== null) {
            setDoc(removeSection(doc, confirm.remove));
            if (selectedId === confirm.remove) setSelectedId(null);
          }
          setConfirm(null);
        }}
      />
    </StudioContext.Provider>
  );
}
